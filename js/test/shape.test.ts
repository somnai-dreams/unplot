import { describe, expect, it } from "bun:test";
import { roughness } from "../src/qa/shape.ts";
import type { Pt } from "../src/curves/vectorpaths.ts";

describe("roughness (separation-quality metric)", () => {
  it("a monotone curve is ~1", () => {
    const mono: Pt[] = Array.from({ length: 20 }, (_, i) => [i, i] as Pt);
    expect(roughness(mono)).toBeCloseTo(1, 5);
  });

  it("a single lobe is ~2 (up then down)", () => {
    const lobe: Pt[] = [];
    for (let x = 0; x <= 40; x++) lobe.push([x, 50 - Math.abs(x - 20) * 2]); // rise to peak, fall
    expect(roughness(lobe)).toBeCloseTo(2, 1);
  });

  it("a tangle of several curves merged into one scores in the tens+", () => {
    const tangle: Pt[] = [];
    for (let x = 0; x < 200; x++) tangle.push([x, x % 2 === 0 ? 0 : 10]); // y flips every step
    expect(roughness(tangle)).toBeGreaterThan(50);
  });

  it("a flat curve scores 0 (no range to normalise against)", () => {
    expect(roughness([[0, 5], [1, 5], [2, 5]])).toBe(0);
  });
});
