/**
 * Credits spent in this browser tab, added up from TTS.ai's reply to each submitted job.
 * TTS.ai has no balance endpoint, and its `credits_remaining` didn't drop while jobs were being
 * charged (seen in `npm run benchmark:voices`), so the app counts usage itself.
 */
export interface CreditUsage {
  /** Sum of `credits_used`. Audio TTS.ai had already made costs 0. */
  used: number;
  /** The latest `credits_remaining` TTS.ai reported, if any. It can lag behind real usage. */
  reportedRemaining?: number;
}

export const NO_CREDITS_USED: CreditUsage = { used: 0 };

export interface CreditReport {
  creditsUsed?: number;
  creditsRemaining?: number;
}

export function recordCredits(usage: CreditUsage, report: CreditReport): CreditUsage {
  return {
    used: usage.used + Math.max(report.creditsUsed ?? 0, 0),
    reportedRemaining: report.creditsRemaining ?? usage.reportedRemaining,
  };
}

const COUNT_FORMAT = new Intl.NumberFormat("en");

/** 2415000 → "2,415,000" */
export function formatCredits(count: number): string {
  return COUNT_FORMAT.format(count);
}
