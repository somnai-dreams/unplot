import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { extract } from "../src/extract.ts";
import { toData } from "../src/curveset.ts";
import { lobe } from "../src/priors.ts";

describe("extract (vector, end-to-end on the synthetic fixture)", () => {
  it("recovers three colour-keyed lobes, calibrated and ordered by peak-x", async () => {
    const data = new Uint8Array(readFileSync(new URL("./fixtures/three_curves.pdf", import.meta.url)));
    const cs = await extract(data, { expectedCurves: 3, prior: lobe(0.5), orderBy: "peak-x" });

    expect(cs.curves.length).toBe(3);
    expect(cs.curves[0].method).toBe("vector-path"); // colour -> style separation

    // clean linear axes
    expect(Math.abs(cs.xAxis.r)).toBeGreaterThan(0.999);
    expect(Math.abs(cs.yAxis.r)).toBeGreaterThan(0.999);
    expect(toData(cs.xAxis, cs.xAxis.anchors[0][0])).toBeCloseTo(400, 1);

    // ordered by peak-x: blue ~450, green ~550, red ~650
    const peaks = cs.curves.map((c) => {
      const ys = c.points.map((p) => p[1]);
      return c.points[ys.indexOf(Math.max(...ys))][0];
    });
    expect(peaks[0]).toBeLessThan(peaks[1]);
    expect(peaks[1]).toBeLessThan(peaks[2]);
    [450, 550, 650].forEach((want, i) => expect(Math.abs(peaks[i] - want)).toBeLessThanOrEqual(8));

    // colour identity survives: first lobe is blue (B channel dominant), last is red (R dominant)
    expect(cs.curves[0].style.color![2]).toBeGreaterThan(0.8);
    expect(cs.curves[2].style.color![0]).toBeGreaterThan(0.8);

    // all three are clean under the lobe prior, and x stays within the plotted nm band
    expect(cs.curves.every((c) => c.qa.confidence > 0.9)).toBe(true);
    expect(cs.curves.every((c) => c.points.every((p) => p[0] >= 399 && p[0] <= 701))).toBe(true);
  });
});
