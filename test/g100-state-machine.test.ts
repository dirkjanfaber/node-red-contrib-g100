import {
  attemptReset,
  computeOutput,
  createInitialState,
  processGridPower,
  sanitizeOnLoad
} from '../src/lib/g100-state-machine'
import { G100Config, G100State } from '../src/lib/types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE = new Date('2024-01-15T10:00:00.000Z')

function at (offsetMs: number): Date {
  return new Date(BASE.getTime() + offsetMs)
}

const sec = (n: number) => n * 1_000
const min = (n: number) => n * 60_000
const hr = (n: number) => n * 3_600_000
const day = (n: number) => n * 86_400_000

const MEL = -3_500   // 3.5 kW export limit
const MIL = 12_500   // 12.5 kW import limit

const defaultConfig: G100Config = {
  mel: MEL,
  mil: MIL,
  mode: 'domestic',
  installerPassword: 123456,
  allowUserReset: true
}

function commercialConfig (): G100Config {
  return { ...defaultConfig, mode: 'commercial' }
}

/** Send a single power reading to the state machine. */
function feed (state: G100State, power: number, offsetMs: number, cfg = defaultConfig): G100State {
  return processGridPower(power, cfg, state, at(offsetMs)).state
}

/**
 * Simulate a sustained power reading from startMs to endMs (inclusive),
 * stepping every intervalMs. Returns the final state.
 */
function sustain (
  state: G100State,
  power: number,
  startMs: number,
  endMs: number,
  cfg = defaultConfig,
  intervalMs = 1_000
): G100State {
  let s = state
  for (let t = startMs; t <= endMs; t += intervalMs) {
    s = feed(s, power, t, cfg)
  }
  return s
}

/**
 * Drive three complete excursions (each > 15s) to reach Stage 3 via stage2Count.
 * Returns the state after Stage 3 is triggered.
 */
function reachStage3ByCount (cfg = defaultConfig): G100State {
  let s = createInitialState()
  for (let i = 0; i < 3; i++) {
    const base = i * min(2)
    s = sustain(s, MEL - 1, base, base + sec(20), cfg)
    s = feed(s, 0, base + sec(25), cfg)  // end excursion
  }
  return s
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  test('starts in Stage 1', () => {
    expect(createInitialState().stage).toBe(1)
  })

  test('all counters are zero', () => {
    const s = createInitialState()
    expect(s.stage2Count).toBe(0)
    expect(s.stage2Over1Min).toBe(0)
    expect(s.stage3Count).toBe(0)
    expect(s.stage2ExcursionTimestamps).toHaveLength(0)
    expect(s.stage3Timestamps).toHaveLength(0)
  })

  test('no excursion in progress', () => {
    const s = createInitialState()
    expect(s.inExcursion).toBe(false)
    expect(s.excursionStartTs).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Excursion detection
// ---------------------------------------------------------------------------

describe('excursion detection', () => {
  test('no excursion when power is within MEL and MIL', () => {
    const s = feed(createInitialState(), 5_000, 0)
    expect(s.inExcursion).toBe(false)
    expect(s.stage).toBe(1)
  })

  test('export excursion starts when power drops below MEL', () => {
    const s = feed(createInitialState(), MEL - 1, 0)
    expect(s.inExcursion).toBe(true)
  })

  test('import excursion starts when power exceeds MIL', () => {
    const s = feed(createInitialState(), MIL + 1, 0)
    expect(s.inExcursion).toBe(true)
  })

  test('excursion ends when power returns within limits', () => {
    let s = feed(createInitialState(), MEL - 1, 0)
    expect(s.inExcursion).toBe(true)
    s = feed(s, 0, sec(1))
    expect(s.inExcursion).toBe(false)
  })

  test('no enforcement when AC source is not grid', () => {
    const s = processGridPower(MEL - 1, defaultConfig, createInitialState(), at(0), false).state
    expect(s.inExcursion).toBe(false)
    expect(s.stage).toBe(1)
  })

  test('no export excursion when MEL is null', () => {
    const cfg: G100Config = { ...defaultConfig, mel: null }
    const s = feed(createInitialState(), -100_000, 0, cfg)
    expect(s.inExcursion).toBe(false)
  })

  test('positive MEL (misconfiguration) triggers excursion on idle power', () => {
    // Documents the dangerous effect of entering 3500 instead of -3500
    const cfg: G100Config = { ...defaultConfig, mel: 3500 }
    const s = feed(createInitialState(), 0, 0, cfg)
    expect(s.inExcursion).toBe(true)
  })

  test('no import excursion when MIL is null', () => {
    const cfg: G100Config = { ...defaultConfig, mil: null }
    const s = feed(createInitialState(), 100_000, 0, cfg)
    expect(s.inExcursion).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Stage 2 — 15-second threshold
// ---------------------------------------------------------------------------

describe('Stage 2 — 15-second threshold', () => {
  test('stage2Count stays 0 before 15 seconds have elapsed', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(14))
    expect(s.stage2Count).toBe(0)
  })

  test('stage2Count increments at exactly 15 seconds', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(15))
    expect(s.stage2Count).toBe(1)
  })

  test('stage2Count does not increment twice for the same excursion', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(30))
    expect(s.stage2Count).toBe(1)
  })

  test('stage2Count increments again for a second distinct excursion', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(20))      // excursion 1 (> 15s)
    s = feed(s, 0, sec(25))                   // return to normal
    s = sustain(s, MEL - 1, min(2), min(2) + sec(20))  // excursion 2
    expect(s.stage2Count).toBe(2)
  })

  test('brief excursion under 15s does not increment stage2Count', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(10))
    s = feed(s, 0, sec(11))                   // end before 15s
    expect(s.stage2Count).toBe(0)
  })

  test('threshold flags reset when a new excursion starts', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(20))      // fires 15s threshold
    s = feed(s, 0, sec(25))                   // end excursion
    s = feed(s, MEL - 1, sec(30))             // new excursion starts
    expect(s.threshold15sFired).toBe(false)
    expect(s.threshold1MinFired).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Stage 2 — 1-minute threshold
// ---------------------------------------------------------------------------

describe('Stage 2 — 1-minute threshold', () => {
  test('stage2Over1Min stays 0 before 60 seconds', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(59))
    expect(s.stage2Over1Min).toBe(0)
  })

  test('stage2Over1Min increments at 60 seconds', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(60))
    expect(s.stage2Over1Min).toBe(1)
  })

  test('a 1-minute excursion also fires the 15-second threshold', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(60))
    expect(s.stage2Count).toBe(1)
    expect(s.stage2Over1Min).toBe(1)
  })

  test('stage2Over1Min does not increment twice for the same excursion', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(120))
    expect(s.stage2Over1Min).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Stage 3 — triggers
// ---------------------------------------------------------------------------

describe('Stage 3 — triggers', () => {
  test('2 excursions within 10-minute window trigger Stage 3 (10-min rule)', () => {
    const s = reachStage3ByCount()
    expect(s.stage).toBe(3)
  })

  test('lockout is true in Stage 3', () => {
    const s = reachStage3ByCount()
    const output = computeOutput(s, defaultConfig, at(min(10)))
    expect(output.lockout).toBe(true)
  })

  test('stage3Count increments each time Stage 3 is entered', () => {
    const s = reachStage3ByCount()
    expect(s.stage3Count).toBe(1)
  })

  test('1 excursion over 1 minute triggers Stage 3', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(61))
    expect(s.stage).toBe(3)
  })

  test('2 excursions in the 10-minute window trigger Stage 3', () => {
    let s = createInitialState()
    // First excursion > 15s
    s = sustain(s, MEL - 1, 0, sec(20))
    s = feed(s, 0, sec(25))
    // Second excursion > 15s, within 10 minutes of first
    s = sustain(s, MEL - 1, min(5), min(5) + sec(20))
    expect(s.stage).toBe(3)
  })

  test('2 excursions more than 10 minutes apart do not trigger Stage 3 via 10-min rule', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(20))
    s = feed(s, 0, sec(25))
    // Second excursion > 10 minutes later
    s = sustain(s, MEL - 1, min(11), min(11) + sec(20))
    expect(s.stage).toBe(1)
    expect(s.stage2Count).toBe(2)
    const output = computeOutput(s, defaultConfig, at(min(11) + sec(20)))
    expect(output.stage2In10MinCount).toBe(1)
  })

  test('processGridPower is a no-op while in Stage 3', () => {
    const s = reachStage3ByCount()
    const stageAfter = feed(s, MEL - 1, min(30)).stage
    expect(stageAfter).toBe(3)
  })

  test('lockoutStartTs is set when Stage 3 is entered', () => {
    const s = reachStage3ByCount()
    expect(s.lockoutStartTs).not.toBeNull()
  })

  test('import excursion (> MIL) triggers Stage 3 via 10-minute rule', () => {
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const base = i * min(2)
      s = sustain(s, MIL + 1, base, base + sec(20))
      s = feed(s, 0, base + sec(25))
    }
    expect(s.stage).toBe(3)
  })

  test('3 excursions >10 min apart in 24 hours do NOT trigger Stage 3 (more than 3 required)', () => {
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const base = i * min(15)
      s = sustain(s, MEL - 1, base, base + sec(20))
      s = feed(s, 0, base + sec(25))
    }
    expect(s.stage).toBe(1)
    expect(s.stage2Count).toBe(3)
  })

  test('4 excursions >10 min apart within 24 hours trigger Stage 3 via 24-hour count', () => {
    let s = createInitialState()
    for (let i = 0; i < 4; i++) {
      const base = i * min(15)
      s = sustain(s, MEL - 1, base, base + sec(20))
      s = feed(s, 0, base + sec(25))
    }
    expect(s.stage).toBe(3)
  })

  test('excursions older than 24 hours fall out of the Stage 3 count window', () => {
    // 3 excursions in the past, now all >24h old
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const base = i * min(15)
      s = sustain(s, MEL - 1, base, base + sec(20))
      s = feed(s, 0, base + sec(25))
    }
    // 4th excursion 25 hours later — the earlier 3 are outside the 24-hr window
    const base4 = hr(25)
    s = sustain(s, MEL - 1, base4, base4 + sec(20))
    expect(s.stage).toBe(1)
    const output = computeOutput(s, defaultConfig, at(base4 + sec(20)))
    expect(output.stage2In24HrCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Stage 3 reset — domestic
// ---------------------------------------------------------------------------

describe('Stage 3 reset — domestic', () => {
  test('user reset succeeds when fewer than 3 Stage 3 events in 30 days', () => {
    const s = reachStage3ByCount()
    const result = attemptReset(defaultConfig, s, at(min(30)))
    expect(result.success).toBe(true)
    expect(result.state.stage).toBe(1)
  })

  test('after user reset, stage2 counters are cleared', () => {
    const s = reachStage3ByCount()
    const { state } = attemptReset(defaultConfig, s, at(min(30)))
    expect(state.stage2Count).toBe(0)
    expect(state.stage2Over1Min).toBe(0)
    expect(state.stage2ExcursionTimestamps).toHaveLength(0)
  })

  test('after user reset, stage3Timestamps are preserved', () => {
    const s = reachStage3ByCount()
    const { state } = attemptReset(defaultConfig, s, at(min(30)))
    expect(state.stage3Timestamps).toHaveLength(1)
  })

  test('user reset fails when allowUserReset is false', () => {
    const cfg: G100Config = { ...defaultConfig, allowUserReset: false }
    const s = reachStage3ByCount(cfg)
    const result = attemptReset(cfg, s, at(min(30)))
    expect(result.success).toBe(false)
  })

  test('user reset fails after 3 Stage 3 events in 30 days', () => {
    let s = createInitialState()
    // Trigger and reset Stage 3 three times within 30 days
    for (let i = 0; i < 3; i++) {
      const offset = i * min(60)
      for (let j = 0; j < 3; j++) {
        const base = offset + j * min(2)
        s = sustain(s, MEL - 1, base, base + sec(20))
        s = feed(s, 0, base + sec(25))
      }
      // Reset after each Stage 3 (except the last one we test)
      if (i < 2) {
        const reset = attemptReset(defaultConfig, s, at(offset + min(10)))
        expect(reset.success).toBe(true)
        s = reset.state
      }
    }
    // Now we've had 3 Stage 3 events in 30 days — 4th reset should fail
    const result = attemptReset(defaultConfig, s, at(min(200)))
    expect(result.success).toBe(false)
  })

  test('installer password reset always succeeds in domestic mode', () => {
    const s = reachStage3ByCount()
    const result = attemptReset(defaultConfig, s, at(min(30)), defaultConfig.installerPassword)
    expect(result.success).toBe(true)
  })

  test('password 0 with installerPassword 0 does not grant installer-level reset (stage3Timestamps preserved)', () => {
    const cfg: G100Config = { ...defaultConfig, installerPassword: 0 }
    const s = reachStage3ByCount(cfg)
    const { state } = attemptReset(cfg, s, at(min(30)), 0)
    // An installer reset would clear stage3Timestamps; a user reset preserves them
    expect(state.stage3Timestamps).toHaveLength(1)
  })

  test('password 0 does not grant installer-level reset when installerPassword is non-zero', () => {
    const s = reachStage3ByCount()  // installerPassword: 123456
    const { state } = attemptReset(defaultConfig, s, at(min(30)), 0)
    expect(state.stage3Timestamps).toHaveLength(1)
  })

  test('password 0 cannot bypass domestic limit even when allowUserReset is exhausted', () => {
    const cfg: G100Config = { ...defaultConfig, installerPassword: 0 }
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const offset = i * min(60)
      for (let j = 0; j < 3; j++) {
        const base = offset + j * min(2)
        s = sustain(s, MEL - 1, base, base + sec(20), cfg)
        s = feed(s, 0, base + sec(25), cfg)
      }
      if (i < 2) s = attemptReset(cfg, s, at(offset + min(10))).state
    }
    // Domestic limit exhausted; password 0 cannot act as installer override
    const result = attemptReset(cfg, s, at(min(200)), 0)
    expect(result.success).toBe(false)
  })

  test('installer password reset clears stage3Timestamps', () => {
    const s = reachStage3ByCount()
    const { state } = attemptReset(defaultConfig, s, at(min(30)), defaultConfig.installerPassword)
    expect(state.stage3Timestamps).toHaveLength(0)
  })

  test('wrong password does not reset in domestic mode when limit is reached', () => {
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const offset = i * min(60)
      for (let j = 0; j < 3; j++) {
        const base = offset + j * min(2)
        s = sustain(s, MEL - 1, base, base + sec(20))
        s = feed(s, 0, base + sec(25))
      }
      if (i < 2) {
        s = attemptReset(defaultConfig, s, at(offset + min(10))).state
      }
    }
    const result = attemptReset(defaultConfig, s, at(min(200)), 999999)
    expect(result.success).toBe(false)
  })

  test('reset fails when not in Stage 3', () => {
    const result = attemptReset(defaultConfig, createInitialState(), at(0))
    expect(result.success).toBe(false)
  })

  test('30-day window expires: Stage 3 events older than 30 days are not counted', () => {
    const cfg = defaultConfig
    // Trigger Stage 3 three times, but 31 days ago
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const offset = i * min(60)
      for (let j = 0; j < 3; j++) {
        const base = offset + j * min(2)
        s = sustain(s, MEL - 1, base, base + sec(20))
        s = feed(s, 0, base + sec(25))
      }
      if (i < 2) {
        s = attemptReset(cfg, s, at(offset + min(10))).state
      }
    }
    // Reset but check at 31 days later — the 30-day window should have reset
    const futureNow = at(day(31))
    const output = computeOutput(s, cfg, futureNow)
    expect(output.stage3In30DaysCount).toBe(0)
    // So a user reset should succeed
    const result = attemptReset(cfg, s, futureNow)
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Stage 3 reset — commercial
// ---------------------------------------------------------------------------

describe('Stage 3 reset — commercial', () => {
  test('user reset fails before 4-hour timeout without password', () => {
    const s = reachStage3ByCount(commercialConfig())
    const result = attemptReset(commercialConfig(), s, at(hr(2)))
    expect(result.success).toBe(false)
  })

  test('user reset succeeds after 4-hour timeout without password', () => {
    const s = reachStage3ByCount(commercialConfig())
    const result = attemptReset(commercialConfig(), s, at(hr(5)))
    expect(result.success).toBe(true)
    expect(result.state.stage).toBe(1)
  })

  test('installer password reset succeeds before 4-hour timeout', () => {
    const s = reachStage3ByCount(commercialConfig())
    const result = attemptReset(commercialConfig(), s, at(hr(1)), commercialConfig().installerPassword)
    expect(result.success).toBe(true)
  })

  test('installer password reset clears stage3Timestamps in commercial mode', () => {
    const s = reachStage3ByCount(commercialConfig())
    const { state } = attemptReset(commercialConfig(), s, at(hr(1)), commercialConfig().installerPassword)
    expect(state.stage3Timestamps).toHaveLength(0)
  })

  test('wrong password does not reset before 4-hour timeout', () => {
    const s = reachStage3ByCount(commercialConfig())
    const result = attemptReset(commercialConfig(), s, at(hr(2)), 999999)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeOutput
// ---------------------------------------------------------------------------

describe('computeOutput', () => {
  test('lockout is false in Stage 1', () => {
    const output = computeOutput(createInitialState(), defaultConfig, at(0))
    expect(output.lockout).toBe(false)
  })

  test('resetEligible is false in Stage 1', () => {
    const output = computeOutput(createInitialState(), defaultConfig, at(0))
    expect(output.resetEligible).toBe(false)
  })

  test('resetEligible is true in Stage 3 domestic with < 3 events in 30 days', () => {
    const s = reachStage3ByCount()
    const output = computeOutput(s, defaultConfig, at(min(10)))
    expect(output.resetEligible).toBe(true)
  })

  test('resetEligible is false in Stage 3 domestic with >= 3 events in 30 days', () => {
    let s = createInitialState()
    for (let i = 0; i < 3; i++) {
      const offset = i * min(60)
      for (let j = 0; j < 3; j++) {
        const base = offset + j * min(2)
        s = sustain(s, MEL - 1, base, base + sec(20))
        s = feed(s, 0, base + sec(25))
      }
      if (i < 2) s = attemptReset(defaultConfig, s, at(offset + min(10))).state
    }
    const output = computeOutput(s, defaultConfig, at(min(200)))
    expect(output.resetEligible).toBe(false)
  })

  test('resetEligible is false in Stage 3 commercial before 4 hours', () => {
    const s = reachStage3ByCount(commercialConfig())
    const output = computeOutput(s, commercialConfig(), at(hr(2)))
    expect(output.resetEligible).toBe(false)
  })

  test('resetEligible is true in Stage 3 commercial after 4 hours', () => {
    const s = reachStage3ByCount(commercialConfig())
    const output = computeOutput(s, commercialConfig(), at(hr(5)))
    expect(output.resetEligible).toBe(true)
  })

  test('stage2In24HrCount reflects only timestamps within last 24 hours', () => {
    let s = createInitialState()
    // 3 excursions 15 min apart
    for (let i = 0; i < 3; i++) {
      s = sustain(s, MEL - 1, i * min(15), i * min(15) + sec(20))
      s = feed(s, 0, i * min(15) + sec(25))
    }
    // All 3 within the 24-hr window
    const output1 = computeOutput(s, defaultConfig, at(min(45)))
    expect(output1.stage2In24HrCount).toBe(3)
    // After 25 hours, all 3 fall out
    const output2 = computeOutput(s, defaultConfig, at(hr(25)))
    expect(output2.stage2In24HrCount).toBe(0)
  })

  test('stage2In10MinCount reflects only timestamps within last 10 minutes', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(20))
    s = feed(s, 0, sec(25))
    // One excursion recorded, check before 10min window expires
    const output1 = computeOutput(s, defaultConfig, at(min(5)))
    expect(output1.stage2In10MinCount).toBe(1)
    // After 10min window, count drops to 0
    const output2 = computeOutput(s, defaultConfig, at(min(11)))
    expect(output2.stage2In10MinCount).toBe(0)
  })

  test('stage3In30DaysCount is always 0 in commercial mode', () => {
    const s = reachStage3ByCount(commercialConfig())
    const output = computeOutput(s, commercialConfig(), at(hr(1)))
    expect(output.stage3In30DaysCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// sanitizeOnLoad — reboot safety
// ---------------------------------------------------------------------------

describe('sanitizeOnLoad', () => {
  test('clears in-flight excursion state so reboot downtime does not count as excursion time', () => {
    // Excursion starts at T=5s; system reboots; comes back at T=25s
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(5))
    expect(s.inExcursion).toBe(true)

    // Simulate: persist → reboot → load
    const loaded = sanitizeOnLoad(s)

    // After sanitize, the excursion is treated as ended
    expect(loaded.inExcursion).toBe(false)
    expect(loaded.excursionStartTs).toBeNull()
    expect(loaded.threshold15sFired).toBe(false)
    expect(loaded.threshold1MinFired).toBe(false)
  })

  test('preserves stage2Count across reboot', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(20))   // fires 15s threshold → stage2Count = 1
    s = feed(s, 0, sec(25))

    const loaded = sanitizeOnLoad(s)
    expect(loaded.stage2Count).toBe(1)
  })

  test('preserves stage2ExcursionTimestamps across reboot', () => {
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(20))
    s = feed(s, 0, sec(25))

    const loaded = sanitizeOnLoad(s)
    expect(loaded.stage2ExcursionTimestamps).toHaveLength(1)
  })

  test('preserves Stage 3 lockout across reboot', () => {
    const s = reachStage3ByCount()
    const loaded = sanitizeOnLoad(s)
    expect(loaded.stage).toBe(3)
    expect(loaded.lockoutStartTs).not.toBeNull()
  })

  test('preserves stage3Timestamps across reboot', () => {
    const s = reachStage3ByCount()
    const loaded = sanitizeOnLoad(s)
    expect(loaded.stage3Timestamps).toHaveLength(1)
  })

  test('after reboot mid-excursion, a new sustained excursion still triggers correctly', () => {
    // Excursion starts, reboots at 5s, restarts — new sustained excursion should count
    let s = createInitialState()
    s = sustain(s, MEL - 1, 0, sec(5))    // 5s into excursion, then reboot
    s = sanitizeOnLoad(s)

    // After reboot, power is still over MEL — a new excursion begins
    s = sustain(s, MEL - 1, sec(30), sec(50))   // sustained > 15s from sec(30)
    expect(s.stage2Count).toBe(1)
  })

  test('sanitizeOnLoad is safe on a clean initial state', () => {
    const s = sanitizeOnLoad(createInitialState())
    expect(s.stage).toBe(1)
    expect(s.inExcursion).toBe(false)
    expect(s.stage2Count).toBe(0)
  })
})
