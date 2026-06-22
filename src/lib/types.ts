export type G100Stage = 1 | 3

export interface G100Config {
  mel: number | null   // Maximum Export Limit (W, negative). null = no export limit.
  mil: number | null   // Maximum Import Limit (W, positive). null = no import limit.
  mode: 'domestic' | 'commercial'
  installerPassword: number
  allowUserReset: boolean
}

export interface G100State {
  stage: G100Stage

  // Stage 2 counters
  stage2Count: number                   // total excursions sustained ≥15s
  stage2Over1Min: number                // total excursions sustained ≥1min
  stage2ExcursionTimestamps: string[]   // ISO timestamps when each 15s+ excursion fired (used for 10-min window)

  // Stage 3
  stage3Count: number
  stage3Timestamps: string[]            // ISO timestamps of each Stage 3 entry (used for domestic 30-day window)
  lockoutStartTs: string | null

  // Current excursion tracking
  inExcursion: boolean
  excursionStartTs: string | null
  threshold15sFired: boolean            // whether 15s threshold fired for the current excursion
  threshold1MinFired: boolean           // whether 1-min threshold fired for the current excursion
}

export interface G100Output {
  lockout: boolean
  stage: G100Stage
  inExcursion: boolean
  stage2Count: number
  stage2Over1Min: number
  stage2In10MinCount: number            // computed: excursions within the last 10 minutes
  stage2In24HrCount: number            // computed: excursions within the last 24 hours (Stage 3 triggers when > 3)
  stage3Count: number
  stage3In30DaysCount: number           // computed: Stage 3 events within the last 30 days
  resetEligible: boolean                // whether a non-password reset is currently allowed
  lockoutStartTs: string | null
}

export interface G100ResetResult {
  success: boolean
  reason?: string
  state: G100State
}
