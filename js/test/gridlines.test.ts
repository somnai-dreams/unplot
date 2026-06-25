import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { extract } from "../src/extract.ts";
import { lobe } from "../src/priors.ts";
import { loadVectorPage, pathsInFrame } from "../src/io/vector.ts";

const FRAME: [number, number, number, number] = [60, 40, 360, 240];
const data = () => new Uint8Array(readFileSync(new URL("./fixtures/gridded.pdf", import.meta.url)));

describe("gridline removal (ruled-path filter)", () => {
  it("ignores a grid drawn as one stroke and recovers the three curves", async () => {
    const cs = await extract(data(), { frame: FRAME, expectedCurves: 3, prior: lobe(0.08), orderBy: "peak-x" });
    expect(cs.curves.length).toBe(3);
    expect(cs.curves.every((c) => c.qa.confidence > 0.9)).toBe(true);
    const peaks = cs.curves.map((c) => {
      const ys = c.points.map((p) => p[1]);
      return c.points[ys.indexOf(Math.max(...ys))][0];
    });
    [450, 550, 650].forEach((want, i) => expect(Math.abs(peaks[i] - want)).toBeLessThanOrEqual(6));
  });

  it("flags the grid path as ruled and drops it from pathsInFrame", async () => {
    const page = await loadVectorPage(data(), 0);
    expect(page.paths.some((p) => p.ruled && p.width > 200)).toBe(true);   // grid present in the page, flagged
    const raw = pathsInFrame(page, FRAME);
    expect(raw.some((p) => p.color === null && p.width > 0.8 * 300)).toBe(false);   // grid (+ frame) filtered out
  });
});
