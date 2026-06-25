# unplot

*Here for the plot.*

**Read curves off a plot, straight from the vector PDF, with overlapping curves pulled apart and a confidence score on each.**

unplot is a headless library (Python and TypeScript) for digitizing line and curve plots. Interactive tools like WebPlotDigitizer, Engauge, and PlotDigitizer want you to load an image and click to calibrate the axes. unplot runs unattended instead, and does two things those tools don't:

- **Vector-PDF-native.** When a PDF's curves are real drawn paths, unplot reads the exact geometry out of the file. No rasterizing, no pixel re-detection, no clicking. The numbers you get back are the numbers that were drawn.
- **Automatic crossing separation.** Where curves overlap and cross, it keeps them apart: by stroke style or colour for vector paths, by hue for colour-coded raster images, or by de-fanning and re-chaining a single pen stroke that traces several lobes at once.

Every result also carries a **confidence report**, per curve and for the set: shape-prior violations, calibration fit, coverage gaps, crossings. If a curve is suspect, the report says so.

## Quick start

Python:

```python
from unplot import extract, Lobe

cs = extract("plot.pdf", frame=(60, 40, 360, 240),
             prior=Lobe(0.08), expected_curves=3, order_by="peak-x")

for c in cs.curves:
    print(c.id, c.points.shape, c.qa.confidence, c.qa.passed)

named = cs.labeled({0: "blue", 1: "green", 2: "red"})   # you map order to meaning
```

TypeScript, in the browser, with no Python and no server (see [`js/`](js/)):

```ts
import { extract, lobe } from "unplot";   // js/src/index.ts

const data = new Uint8Array(await (await fetch("plot.pdf")).arrayBuffer());
const cs = await extract(data, { expectedCurves: 3, prior: lobe(0.08), orderBy: "peak-x" });
cs.curves.forEach(c => console.log(c.id, c.style.color, c.qa.confidence));
```

[`js/`](js/) also has a drop-a-PDF demo: it renders the page, overlays the recovered curves, shows the QA, and exports CSV. The bytes never leave the page.

## What you get back

`extract(plot) -> CurveSet`. One plot region in, one CurveSet out:

- **calibrated arrays** per curve (`points`, in your axis units), plus source-space points for overlay
- **neutral identity.** Curves come back as `c0, c1, …`, ordered deterministically by peak-x, mean-y, or first-x. unplot knows nothing about your domain; you map order to meaning.
- **a QA report**: `CurveQA` per curve, `CurveSetQA` for the set.

## Shape priors

The one thing you supply is the expected shape of your curves, as a `ShapePrior`. It scores confidence, and it breaks ties at crossings by picking the continuation that keeps each curve on its own flank. Shipped priors:

- `Free`: no assumption, raw geometry.
- `Monotone(direction)`: the curve only goes one way.
- `Lobe(tolerance)`: approximately unimodal (rise to a peak, then fall). `tolerance` is how much flank reversal is allowed before a curve is flagged, not a demand for strict unimodality, so real shoulders and double-humps survive.
- `Smooth`: penalise spikes.

Write your own by implementing `qa_violation` and `separation_bias`.

## Scope

Supported: vector-PDF ingest (exact geometry) and raster images (pixel fallback); linear axis calibration from numeric tick labels, robust to stray labels leaking in from a neighbouring plot; crossing separation under a shape prior; the QA report.

Not yet, and PRs welcome:

- **Log-spaced axes.** Calibration is linear pt-to-value. Axes whose *values* are log quantities work fine when they're drawn linearly; genuinely log-*spaced* axes are not.
- **Heavily occluded mono scans.** Colour curves separate by hue; single-colour curves separate by continuity and the shape prior, which handles clean crossings. A low-resolution mono *scan* with a weak curve buried under a stronger one can mis-assign, and the QA reports it as low confidence. Use vector ingest or a colour-coded source there.
- Broken axis boxes, legends drawn over curves, exotic scales, automatic frame detection for raster scans.

## Accuracy

Peak error on synthetic ground truth, in x-axis units (the plots span x 400 to 700). From `bench/benchmark.py`, seed-fixed, 20 randomized plots per tier:

| tier | median | p90 |
|-|-|-|
| vector, 3–4 curves, separated or crossing | 0.5–0.9 | 1.3–1.5 |
| raster colour, 3 crossing (with or without noise) | 1.1 | 1.5 |
| raster mono, 3 crossing | 1.0 | 1.6 |
| raster mono, 3 occluded | 1.3 | 6.3 |

Vector is essentially exact: it reads drawn geometry, so crossings and curve count don't move the number. Raster is tight on synthetic plots, around 1 unit median, with an occluded lobe (one weak curve buried under its neighbours) the harder synthetic case. The real-world hard case, a low-resolution mono scan with heavy occlusion, still degrades, and there the QA flags it rather than returning a confident wrong answer.

The vector path also reproduces reference extractions of real PDFs numerically: a dash/colour-keyed plot of three overlapping curves (every peak matched exactly, peak-normalised shape RMS 0.000), and a continuous-stroke polyline carrying a real double-hump (peaks within 8 units, the substructure preserved rather than flattened).

## How it compares

unplot is narrower than the established tools on purpose: line and curve plots, headless, vector-native, self-reporting its own confidence, built for batch and automation rather than interactive correction. WebPlotDigitizer and Engauge are mature GUIs that cover many chart types and let a human fix mistakes live. To digitize one chart by hand, use them.

| capability | unplot | WebPlotDigitizer | Engauge | PlotDigitizer |
|-|-|-|-|-|
| reads vector-PDF geometry | yes | no (image) | no (image) | no (image) |
| automatic axis calibration | yes (vector) | click axes | click axes | click axes |
| crossing separation | hue or shape prior | colour / layers | guided | manual / auto |
| QA / confidence output | yes | no | no | no |
| headless, scriptable batch | yes | no (web app) | no (GUI) | no |
| other chart types (polar, bar…) | no | yes | yes | yes |
| license | MIT | AGPL-3.0 | GPL | proprietary |

On clean colour plots a head-to-head against the real WebPlotDigitizer 4.8 (its own auto-extraction, with an exact calibration set through its API) is a dead heat: both land around 0.5 to 1 unit, because both do a colour mask plus per-column averaging. unplot pulls ahead on vector PDFs, which WPD can't read at all; on noise, where its denoising rode out a case WPD's fixed threshold tripped on; and on frame removal, since WPD grabbed the black plot frame until a region was masked. WPD is the only incumbent benchmarked here. Engauge is a desktop GUI and PlotDigitizer is login-gated, so neither can be batch-run.

## Install

Python:

```bash
pip install unplot            # vector-PDF core + numpy
pip install "unplot[raster]"  # adds opencv/pillow for the raster fallback
```

TypeScript: the port lives in [`js/`](js/). Run `npm install` there; the only runtime dependency is pdf.js (`pdfjs-dist`, Apache-2.0).

## Tests

```bash
pip install "unplot[test]" && pytest   # Python
cd js && npm test                          # TypeScript
```

Both suites build synthetic plots with known ground truth and assert the recovered curves and calibration match. No copyrighted source documents are redistributed.

## License

MIT, see [LICENSE](LICENSE).
