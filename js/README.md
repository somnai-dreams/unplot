# getmapped (TypeScript port — in progress)

A browser-native TS port so GetMapped can run on a static page (e.g. GitHub Pages) with no Python, no server,
no Pyodide. PDF vector geometry comes from **pdf.js** (`pdfjs-dist`, Apache-2.0); everything else is
dependency-free array math.

**Status.** The one piece with real risk — the pdf.js → vector-path adapter (`src/io/vector.ts`, the TS
equivalent of the Python `io/vector.py`) — is done and tested. It walks pdf.js's operator list to recover
drawn paths with stroke **colour + dash**, flattens Béziers, applies the CTM, flips to a y-down convention,
and reads numeric axis labels for calibration. Verified to recover colour-keyed curves + frame + labels from
a synthetic PDF (`npm test`). The rest of the pipeline (axis calibration, de-fan/chain/split, separation, QA)
is mechanical to port from the Python — plain array math, no dependencies.

```
npm install
npm test
```
