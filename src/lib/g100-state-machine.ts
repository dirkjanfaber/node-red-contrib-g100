import {
  G100Config,
  G100Output,
  G100ResetResult,
  G100Stage,
  G100State
} from './types'

// ---------------------------------------------------------------------------
// G100/2 timing constants (ENA EREC G100 Issue 2)
// ---------------------------------------------------------------------------

const THRESHOLD_15S_MS = 15_000
const THRESHOLD_1MIN_MS = 60_000
const WINDOW_10MIN_MS = 10 * 60_000
const WINDOW_24HR_MS = 24 * 60 * 60_000
const LOCKOUT_COMMERCIAL_TIMEOUT_MS = 4 * 60 * 60_000
const WINDOW_30DAY_MS = 30 * 24 * 60 * 60_000

// G100/2 s.4.5.1.3: Stage 3 triggers when stage-2 excursion count EXCEEDS this
// value in a 24-hour sliding window ("more than three" = strictly > 3)
const STAGE3_TRIGGER_STAGE2_24HR_LIMIT = 3
const STAGE3_TRIGGER_10MIN_COUNT = 2
const STAGE3_TRIGGER_1MIN_COUNT = 1
const DOMESTIC_RESET_LIMIT_IN_30DAYS = 3

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createInitialState (): G100State {
  return {
    stage: 1,
    stage2Count: 0,
    stage2Over1Min: 0,
    stage2ExcursionTimestamps: [],
    stage3Count: 0,
    stage3Timestamps: [],
    lockoutStartTs: null,
    inExcursion: false,
    excursionStartTs: null,
    threshold15sFired: false,
    threshold1MinFired: false
  }
}

/**
 * Process a new grid power reading.
 *
 * All state transitions are pure — no timers, no side effects.
 * Pass `acSourceIsGrid = false` to suspend enforcement (e.g. when on generator).
 */
export function processGridPower (
  power: number,
  config: G100Config,
  state: G100State,
  now: Date,
  acSourceIsGrid = true
): { state: G100State; output: G100Output } {
  if (!acSourceIsGrid || state.stage === 3) {
    return { state, output: computeOutput(state, config, now) }
  }

  let s = { ...state }

  // ---- Excursion start / end -----------------------------------------------
  const excursion = isExcursion(power, config)

  if (excursion && !s.inExcursion) {
    s = {
      ...s,
      inExcursion: true,
      excursionStartTs: now.toISOString(),
      threshold15sFired: false,
      threshold1MinFired: false
    }
  } else if (!excursion && s.inExcursion) {
    s = {
      ...s,
      inExcursion: false,
      excursionStartTs: null,
      threshold15sFired: false,
      threshold1MinFired: false
    }
  }

  // ---- Threshold checks (only while in excursion) --------------------------
  if (s.inExcursion && s.excursionStartTs !== null) {
    const elapsed = now.getTime() - new Date(s.excursionStartTs).getTime()

    if (elapsed >= THRESHOLD_1MIN_MS && !s.threshold1MinFired) {
      s = { ...s, threshold1MinFired: true, stage2Over1Min: s.stage2Over1Min + 1 }
    }

    if (elapsed >= THRESHOLD_15S_MS && !s.threshold15sFired) {
      s = {
        ...s,
        threshold15sFired: true,
        stage2Count: s.stage2Count + 1,
        stage2ExcursionTimestamps: [...s.stage2ExcursionTimestamps, now.toISOString()]
      }
    }
  }

  // ---- Stage 3 triggers ----------------------------------------------------
  const stage2In10MinCount = countWithin(s.stage2ExcursionTimestamps, WINDOW_10MIN_MS, now)
  const stage2In24HrCount = countWithin(s.stage2ExcursionTimestamps, WINDOW_24HR_MS, now)
  const shouldLockout =
    stage2In24HrCount > STAGE3_TRIGGER_STAGE2_24HR_LIMIT ||
    stage2In10MinCount >= STAGE3_TRIGGER_10MIN_COUNT ||
    s.stage2Over1Min >= STAGE3_TRIGGER_1MIN_COUNT

  if (shouldLockout) {
    s = {
      ...s,
      stage: 3 as G100Stage,
      stage3Count: s.stage3Count + 1,
      stage3Timestamps: [...s.stage3Timestamps, now.toISOString()],
      lockoutStartTs: now.toISOString(),
      inExcursion: false,
      excursionStartTs: null
    }
  }

  return { state: s, output: computeOutput(s, config, now) }
}

/**
 * Compute the current output from state without mutating anything.
 * Safe to call at any time for status/dashboard purposes.
 */
export function computeOutput (state: G100State, config: G100Config, now: Date): G100Output {
  const stage2In10MinCount = countWithin(state.stage2ExcursionTimestamps, WINDOW_10MIN_MS, now)
  const stage2In24HrCount = countWithin(state.stage2ExcursionTimestamps, WINDOW_24HR_MS, now)
  const stage3In30DaysCount = config.mode === 'domestic'
    ? countWithin(state.stage3Timestamps, WINDOW_30DAY_MS, now)
    : 0

  let resetEligible = false
  if (state.stage === 3) {
    if (config.mode === 'domestic') {
      resetEligible =
        config.allowUserReset &&
        stage3In30DaysCount < DOMESTIC_RESET_LIMIT_IN_30DAYS
    } else {
      const elapsed = state.lockoutStartTs !== null
        ? now.getTime() - new Date(state.lockoutStartTs).getTime()
        : 0  // unknown start (corrupt/migrated state): assume just entered lockout
      resetEligible = elapsed >= LOCKOUT_COMMERCIAL_TIMEOUT_MS
    }
  }

  return {
    lockout: state.stage === 3,
    stage: state.stage,
    inExcursion: state.inExcursion,
    stage2Count: state.stage2Count,
    stage2Over1Min: state.stage2Over1Min,
    stage2In10MinCount,
    stage2In24HrCount,
    stage3Count: state.stage3Count,
    stage3In30DaysCount,
    resetEligible,
    lockoutStartTs: state.lockoutStartTs
  }
}

/**
 * Attempt to reset from Stage 3 back to Stage 1.
 *
 * - No password: succeeds if policy allows (domestic < 3 in 30 days; commercial after 4h)
 * - Installer password: always succeeds and clears the 30-day history
 */
export function attemptReset (
  config: G100Config,
  state: G100State,
  now: Date,
  password?: number
): G100ResetResult {
  if (state.stage !== 3) {
    return { success: false, reason: 'Not in Stage 3', state }
  }

  // installerPassword === 0 is the unconfigured default; never treat it as a valid credential
  const isInstallerReset = password !== undefined
    && config.installerPassword !== 0
    && password === config.installerPassword
  if (isInstallerReset) {
    return { success: true, state: clearToStage1(state, true) }
  }

  if (config.mode === 'domestic') {
    const stage3In30DaysCount = countWithin(state.stage3Timestamps, WINDOW_30DAY_MS, now)
    if (config.allowUserReset && stage3In30DaysCount < DOMESTIC_RESET_LIMIT_IN_30DAYS) {
      return { success: true, state: clearToStage1(state, false) }
    }
    return { success: false, reason: 'Installer password required', state }
  }

  // Commercial: 4-hour timeout required
  const elapsed = state.lockoutStartTs !== null
    ? now.getTime() - new Date(state.lockoutStartTs).getTime()
    : 0  // unknown start (corrupt/migrated state): assume just entered lockout
  if (elapsed >= LOCKOUT_COMMERCIAL_TIMEOUT_MS) {
    return { success: true, state: clearToStage1(state, false) }
  }
  const remaining = Math.ceil((LOCKOUT_COMMERCIAL_TIMEOUT_MS - elapsed) / 60_000)
  return {
    success: false,
    reason: `Installer password required or wait ${remaining} more minutes`,
    state
  }
}

/**
 * Call once when loading persisted state on startup.
 *
 * Clears any in-flight excursion tracking so that time elapsed during a
 * reboot (or downtime period) is not counted as part of an excursion.
 * Counters, timestamps, and Stage 3 lockout are preserved.
 */
export function sanitizeOnLoad (state: G100State): G100State {
  return {
    ...state,
    inExcursion: false,
    excursionStartTs: null,
    threshold15sFired: false,
    threshold1MinFired: false
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isExcursion (power: number, config: G100Config): boolean {
  if (config.mel !== null && power < config.mel) return true
  if (config.mil !== null && power > config.mil) return true
  return false
}

function countWithin (timestamps: string[], windowMs: number, now: Date): number {
  const cutoff = now.getTime() - windowMs
  return timestamps.filter(ts => new Date(ts).getTime() >= cutoff).length
}

function clearToStage1 (state: G100State, installerReset: boolean): G100State {
  const base: G100State = {
    ...state,
    stage: 1,
    stage2Count: 0,
    stage2Over1Min: 0,
    stage2ExcursionTimestamps: [],
    inExcursion: false,
    excursionStartTs: null,
    threshold15sFired: false,
    threshold1MinFired: false,
    lockoutStartTs: null
  }
  if (installerReset) {
    return { ...base, stage3Count: 0, stage3Timestamps: [] }
  }
  return base
}
