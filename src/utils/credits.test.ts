import { describe, expect, it } from "vitest";
import { NO_CREDITS_USED, formatCredits, recordCredits } from "./credits";

describe("recordCredits", () => {
  it("adds each job's credits and keeps TTS.ai's latest reported balance", () => {
    const afterOne = recordCredits(NO_CREDITS_USED, { creditsUsed: 44, creditsRemaining: 2_415_000 });
    const afterTwo = recordCredits(afterOne, { creditsUsed: 11, creditsRemaining: 2_414_989 });
    expect(afterOne).toEqual({ used: 44, reportedRemaining: 2_415_000 });
    expect(afterTwo).toEqual({ used: 55, reportedRemaining: 2_414_989 });
  });

  it("keeps the last reported balance when a reply has none, such as reused audio", () => {
    const usage = { used: 44, reportedRemaining: 2_415_000 };
    expect(recordCredits(usage, { creditsUsed: 0 })).toEqual(usage);
  });

  it("counts nothing for replies without credits, and never goes down", () => {
    expect(recordCredits({ used: 10 }, {})).toEqual({ used: 10 });
    expect(recordCredits({ used: 10 }, { creditsUsed: -5 })).toEqual({ used: 10 });
  });

  it("doesn't change the usage it was given", () => {
    const usage = { used: 10 };
    recordCredits(usage, { creditsUsed: 5 });
    expect(usage).toEqual({ used: 10 });
  });
});

describe("formatCredits", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [2_415_000, "2,415,000"],
  ])("%d → %s", (count, expected) => {
    expect(formatCredits(count)).toBe(expected);
  });
});
