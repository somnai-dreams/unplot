import { describe, it, expect } from "vitest";
import { monoXSegments, chainCurves, splitLobes, type Pt } from "../src/curves/vectorpaths.ts";

describe("vectorpaths (TS port)", () => {
  it("monoXSegments splits at an x-reversal", () => {
    expect(monoXSegments([[0, 0], [2, 5], [1, 0]]).length).toBe(2);
  });

  it("chainCurves does NOT merge two lobes meeting at a baseline valley", () => {
    const a: Pt[] = [[0, 100], [2, 0], [4, 100]];   // baseline -> peak -> baseline
    const b: Pt[] = [[4, 100], [6, 0], [8, 100]];
    expect(chainCurves([a, b]).length).toBe(2);
  });

  it("chainCurves DOES merge a broken stroke continuing the same way", () => {
    const a: Pt[] = [[0, 100], [2, 60], [4, 20]];   // descending
    const b: Pt[] = [[4, 20], [6, 10], [8, 0]];     // continues descending
    expect(chainCurves([a, b]).length).toBe(1);
  });

  it("splitLobes splits a two-peak curve at a deep valley", () => {
    const g = (x: number, c: number) => Math.exp(-0.5 * ((x - c) / 5) ** 2);
    const pts: Pt[] = [];
    for (let x = 0; x <= 60; x++) pts.push([x, 100 * (1 - Math.max(g(x, 15), g(x, 45)))]);
    expect(splitLobes(pts).length).toBe(2);
  });
});
