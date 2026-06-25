import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { loadVectorPage } from "../src/io/vector.ts";

describe("pdf.js vector adapter", () => {
  it("recovers colour-keyed curves, the frame box, and numeric axis labels", async () => {
    const data = new Uint8Array(readFileSync(new URL("./fixtures/three_curves.pdf", import.meta.url)));
    const pg = await loadVectorPage(data, 0);

    const coloured = pg.paths.filter((p) => p.color);
    expect(coloured.length).toBe(3); // blue, green, red curves
    expect(Math.max(...coloured.map((p) => p.color![0]))).toBeGreaterThan(0.8); // a red curve
    expect(Math.max(...coloured.map((p) => p.color![2]))).toBeGreaterThan(0.8); // a blue curve

    // a grey frame box spanning most of the page is present (will be rejected downstream)
    expect(pg.paths.some((p) => !p.color && p.width > 200 && p.height > 150)).toBe(true);

    // numeric tick labels recovered for axis calibration
    const nums = pg.words.filter((w) => /^-?\d+(\.\d+)?$/.test(w.text)).map((w) => w.text);
    for (const want of ["400", "700", "0", "2"]) expect(nums).toContain(want);
  });
});
