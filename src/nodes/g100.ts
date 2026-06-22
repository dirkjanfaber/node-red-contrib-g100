'use strict'

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  attemptReset,
  computeOutput,
  createInitialState,
  processGridPower,
  sanitizeOnLoad
} from '../lib/g100-state-machine'
import { isFileContextConfigured } from '../lib/context-check'
import { G100Config, G100Output, G100State } from '../lib/types'

// ---------------------------------------------------------------------------
// Minimal Node-RED type stubs (no official @types package)
// ---------------------------------------------------------------------------

interface NodeContext {
  get(key: string): any
  set(key: string, value: any): void
}

interface NodeRED {
  nodes: {
    createNode(node: any, config: any): void
    registerType(type: string, constructor: any): void
  }
}

interface G100NodeConfig {
  id: string
  type: string
  name: string
  mel: number
  enableMil: boolean
  mil: number
  mode: 'domestic' | 'commercial'
  installerPassword: number
  allowUserReset: boolean
  debug: boolean
}

// ---------------------------------------------------------------------------
// Node implementation
// ---------------------------------------------------------------------------

module.exports = function (RED: NodeRED) {
  function G100Node (this: any, config: G100NodeConfig) {
    RED.nodes.createNode(this, config)

    const g100Config: G100Config = {
      mel: Number(config.mel),
      mil: config.enableMil ? Number(config.mil) : null,
      mode: config.mode === 'commercial' ? 'commercial' : 'domestic',
      installerPassword: Number(config.installerPassword),
      allowUserReset: Boolean(config.allowUserReset)
    }

    // Warn if installer password is at the unconfigured default (0)
    if (g100Config.installerPassword === 0) {
      this.warn(
        'G100: installer password is not configured (value is 0). ' +
        'Installer resets are disabled until a non-zero password is set in the node settings.'
      )
    }

    // Error if MEL is not negative — a positive MEL will cause false excursions on every reading
    if (g100Config.mel !== null && g100Config.mel >= 0) {
      this.error(
        `G100: MEL must be a negative value (e.g. -3500 for 3.5 kW export limit). ` +
        `Current value ${g100Config.mel} W will cause continuous false excursions.`
      )
    }

    // Warn once on deploy if context storage is not file-backed
    if (!isFileContextConfigured((RED as any).settings?.contextStorage)) {
      this.warn(
        'G100: context storage is not configured for file persistence — ' +
        'state (counters, lockout) will be lost on Node-RED restart. ' +
        'Add localfilesystem to contextStorage in settings.js.'
      )
    }

    // Load and sanitise persisted state
    const ctx: NodeContext = this.context()
    const persisted = ctx.get('g100State') as Partial<G100State> | undefined
    let state: G100State = sanitizeOnLoad({ ...createInitialState(), ...(persisted ?? {}) })
    ctx.set('g100State', state)

    // Track last emitted lockout value so output 1 only fires on change
    let lastLockout: boolean | null = null

    // AC source: 1 = grid. Other values (generator, shore) suspend enforcement.
    let acSourceIsGrid = true

    const saveAndEmit = (nextState: G100State, output: G100Output) => {
      state = nextState
      ctx.set('g100State', state)

      const lockoutChanged = output.lockout !== lastLockout
      if (lockoutChanged) lastLockout = output.lockout

      const out1 = lockoutChanged
        ? { payload: output.lockout, topic: 'lockout' }
        : null

      const out2: any = { payload: output }
      if (config.debug) out2.state = state

      this.send([out1, out2])
      updateStatus(this, output)
    }

    this.on('input', (msg: any) => {
      const now = new Date()

      // AC source update from a Victron System node
      // (connect victron-input-system /Ac/ActiveIn/Source with topic='acSource')
      if (msg.topic === 'acSource') {
        const wasGrid = acSourceIsGrid
        acSourceIsGrid = msg.payload === 1
        // Switching away from grid while an excursion is in progress: clear the
        // in-flight excursion so that generator downtime is not counted toward
        // the G100 15s/1min thresholds when the grid returns.
        if (wasGrid && !acSourceIsGrid && state.inExcursion) {
          const sanitized = sanitizeOnLoad(state)
          saveAndEmit(sanitized, computeOutput(sanitized, g100Config, now))
        }
        return
      }

      // Reset command: msg.topic === 'reset', optional msg.payload.password
      if (msg.topic === 'reset') {
        const password: number | undefined =
          typeof msg.payload?.password === 'number' ? msg.payload.password : undefined
        const result = attemptReset(g100Config, state, now, password)
        if (!result.success) {
          this.warn(`G100 reset rejected: ${result.reason}`)
        }
        saveAndEmit(result.state, computeOutput(result.state, g100Config, now))
        return
      }

      // Main input: grid power in Watts
      if (typeof msg.payload !== 'number' || !Number.isFinite(msg.payload)) {
        this.warn('g100: expected a finite numeric payload (grid power in W)')
        return
      }

      const { state: nextState, output } = processGridPower(
        msg.payload, g100Config, state, now, acSourceIsGrid
      )
      saveAndEmit(nextState, output)
    })

    // Show initial status on deploy
    updateStatus(this, computeOutput(state, g100Config, new Date()))
  }

  RED.nodes.registerType('g100', G100Node)
}

// ---------------------------------------------------------------------------
// Node status helper
// ---------------------------------------------------------------------------

function updateStatus (node: any, output: G100Output) {
  if (output.stage === 3) {
    node.status({ fill: 'red', shape: 'ring', text: 'Stage 3 — LOCKED OUT' })
  } else if (output.inExcursion || output.stage2Count > 0) {
    const count = output.stage2Count
    const detail = output.inExcursion ? 'excursion active' : 'tracking'
    node.status({ fill: 'yellow', shape: 'dot', text: `Stage 2 — ${detail} (${count} events)` })
  } else {
    node.status({ fill: 'green', shape: 'dot', text: 'Stage 1 — normal' })
  }
}
