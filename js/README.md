# getmapped (TypeScript port)

A browser-native TS port so GetMapped can run on a static page (e.g. GitHub Pages) with no Python, no server,
no Pyodide. PDF vector geometry comes from **pdf.js** (`pdfjs-dist`, Apache-2.0); everything else is
dependency-free array math.

**Status.** The full **vector** extract pipeline is ported and tested end-to-end: pdf.js → vector-path
adapter (`src/io/vector.ts`) → axis calibration (`src/axes/calibrate.ts`, incl. folded ±-axis sign
recovery) → de-fan / chain / split (`src/curves/vectorpaths.ts`, with the valley-join guard) → crossing
separation (`src/separate.ts`) → shape QA + confidence (`src/qa/*.ts`, `src/priors.ts`) → `extract()`
(`src/extract.ts`). Everything but pdf.js is dependency-free array math. Raster ingest is not yet ported.

`npm test` runs the suite: the pdf.js adapter recovery, the curve-geometry guards, an end-to-end
`extract()` on a synthetic colour-keyed fixture, and folded-axis calibration parity.

```
npm install
npm test
```

## Usage

```ts
import { extract, lobe } from "./src/index.ts";

const data = new Uint8Array(await (await fetch("plot.pdf")).arrayBuffer());
const cs = await extract(data, { expectedCurves: 3, prior: lobe(0.08), orderBy: "peak-x" });

for (const c of cs.curves) {
  console.log(c.id, c.style.color, c.qa.confidence, c.points); // points are [x, y] in DATA space
}
// The library assigns neutral handles c0, c1, ...; the caller maps order -> meaning:
// const named = labeled(cs, { 0: "blue", 1: "green", 2: "red" });
```

## Demo

A static demo (`demo/`) runs the whole thing in the browser: drop a vector PDF, it renders the page with
pdf.js, overlays the recovered curves on the render, shows per-curve QA/confidence, and exports CSV. For
multi-page PDFs you can page through (each page extracts independently) or "Extract all pages" for a per-page
summary and a combined CSV. For a page with several plots, drag a box around one plot's axes to extract just
that plot (the auto-frame would otherwise span every plot on the page). No server, no upload — the bytes
never leave the page. The bundled sample is a 4-page synthetic set, the last page two plots side by side
(`demo/make_sample.py`).

```
npm run build:demo      # bundles app + pdf.js worker into demo/dist/ (GitHub Pages-ready)
npm run serve:demo      # serves demo/dist/ at http://localhost:8099
```

`demo/dist/` is a build artifact (git-ignored); rebuild it on deploy. The bundled `pdf.worker.js` is large
(~2 MB) — that's pdf.js, the only runtime dependency.
