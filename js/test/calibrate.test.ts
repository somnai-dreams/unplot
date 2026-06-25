import { describe, it, expect } from "bun:test";
import { calibrateAxis, robustFit, unfoldSymmetric, type Anchors } from "../src/axes/calibrate.ts";

describe("axis calibration (folded-axis port)", () => {
  it("unfolds a genuine ±-symmetric axis and recovers the signed range", () => {
    const folded: Anchors = [[39, 2], [89, 1], [139, 0], [189, 1], [239, 2]]; // labels read 2 1 0 1 2
    const cal = calibrateAxis([], [0, 0, 300, 240], "y", folded);
    expect(cal.scale).toBeCloseTo(-0.02, 4); // +2 (top) .. -2 (bottom), recovered
    expect(Math.abs(cal.r)).toBeGreaterThan(0.999);
    expect(cal.scale * 39 + cal.offset).toBeCloseTo(2, 3);
    expect(cal.scale * 239 + cal.offset).toBeCloseTo(-2, 3);
  });

  it("does NOT fake a fold from one stray outlier label, and the robust fit drops it", () => {
    // clean monotone axis (4 3 2 1 0) + ONE stray outlier (an x-axis '350' bleeding into the y-band)
    const anchors: Anchors = [[327, 4], [363, 3], [400, 2], [438, 1], [477, 0], [484, 350]];
    expect(unfoldSymmetric(anchors, "y")).toEqual(anchors); // arms not symmetric -> no unfold
    const [scale, , r, nDropped] = robustFit(anchors);
    expect(nDropped).toBe(1);
    expect(Math.abs(scale)).toBeGreaterThan(1e-3);
    expect(Math.abs(r)).toBeGreaterThan(0.999);
  });
});
