// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CreditCounter } from "./CreditCounter";

afterEach(cleanup);

describe("CreditCounter", () => {
  it("shows that nothing was spent yet", () => {
    const { container } = render(<CreditCounter usage={{ used: 0 }} />);
    expect(container.textContent).toBe("0 credits used this session");
  });

  it("uses the singular for one credit", () => {
    const { container } = render(<CreditCounter usage={{ used: 1 }} />);
    expect(container.textContent).toBe("1 credit used this session");
  });

  it("shows TTS.ai's reported balance as TTS.ai's figure", () => {
    const { container } = render(<CreditCounter usage={{ used: 1_319, reportedRemaining: 2_415_000 }} />);
    expect(container.textContent).toBe("1,319 credits used this session · TTS.ai reports 2,415,000 left");
    expect(screen.getByTitle(/TTS.ai's own figure/)).not.toBeNull();
  });
});
