# GetMapped

**Read curves off a plot — straight from the vector PDF, with the overlapping ones pulled apart, and an honest confidence score on every curve.**

Most plot digitizers (WebPlotDigitizer, Engauge, PlotDigitizer) are manual, raster-only tools: you load a
screenshot and click along each curve by hand. GetMapped is built around the two things those tools don't do:

- **Vector-PDF-native extraction.** When a PDF's curves are real drawn paths (a large fraction of technical
  datasheets), GetMapped reads the *exact* geometry out of the file — no rasterizing, no pixel re-detection,
  no manual clicking. The numbers you get are the numbers that were drawn.
- **Automatic multi-curve crossing separation.** Where several curves overlap and cross, GetMapped keeps them
  apart — by stroke style/colour for vector paths, and by de-fanning and re-chaining continuous pen strokes
  that trace several lobes at once. No tangle at the crossings.

And it treats QA as a first-class output, not an afterthought: every `CurveSet` carries a per-curve and
set-level **confidence report** (shape-prior violations, calibration fit quality, coverage gaps, crossings).
If a curve is suspect, the report says so — that honesty is the point.

```python
from getmapped import extract, Lobe

cs = extract("datasheet.pdf", frame=(60, 40, 360, 240),
             prior=Lobe(tolerance=0.08), expected_curves=3, order_by="peak-x")

for c in cs.curves:
    print(c.id, c.points.shape, "confidence", c.qa.confidence, "passed", c.qa.passed)

# the library never names your curves — you map recovered order -> meaning:
named = cs.labeled({0: "blue", 1: "green", 2: "red"})
print(cs.qa.confidence, cs.qa.crossings, cs.qa.warnings)
```

## What you get back

`extract(plot) -> CurveSet`. One plot region in, one `CurveSet` out:

- **per-curve calibrated arrays** (`points`, in your axis units) plus the source-space points (`points_src`)
- **neutral identity** — curves come back as `c0, c1, …` ordered deterministically (by peak-x, mean-y, or
  first-x). GetMapped knows nothing about your domain; *you* map order to meaning.
- **a QA/confidence report** — `CurveQA` per curve and `CurveSetQA` for the set.

## Pluggable shape priors

The one thing GetMapped asks you to supply is the *expected shape* of your curves — a `ShapePrior`. It is used
to score confidence (and, in future, to break ties at crossings). Shipped priors:

- `Free()` — no assumption; raw geometry.
- `Monotone(direction="auto"|"up"|"down")` — the curve should only go one way.
- `Lobe(tolerance=0.08)` — an approximately-unimodal lobe (rise to a peak, then fall). "Approximately" is
  deliberate: real lobes carry shoulders and double-humps; `tolerance` is how much flank reversal is allowed
  before a curve is flagged, *not* a demand for strict unimodality.
- `Smooth(...)` — penalise spikes.

Priors do two jobs: score confidence (`qa_violation`) and **drive crossing separation** (`separation_bias`
— at a crossing the prior picks the continuation that keeps each curve on its own flank, instead of letting
the tracer swap curves). Priors are plain dataclasses — write your own by implementing both.

## Scope

**Validated and supported:**
- Vector-PDF ingest (exact drawn geometry) and raster image ingest (pixel fallback).
- Linear axis calibration from numeric tick labels, with a robust fit that ignores stray labels leaking from
  neighbouring plots.
- Multi-curve crossing separation with a pluggable shape prior.
- A first-class QA/confidence report.

**Not yet — "future / contributions welcome":**
- **Log-spaced axes.** Calibration is linear pt→value. Axes whose *values* are log quantities (log exposure,
  log sensitivity) work fine because they are drawn linearly; genuinely log-*spaced* axes are not handled.
- **Dense raster crossings.** Raster ingest breaks curves into crossing-free fragments and re-chains them
  under the prior, which separates clean crossings (two curves crossing at a point) well. Many curves
  overlapping over a *range* (e.g. a tight 3-lobe mono plot) are not fully solved — separation degrades and
  the QA reports it (low confidence, flagged curves). Vector ingest separates crossings cleanly and is the
  better route when geometry is available.
- Broken/partial axis boxes, dashed lines mistaken for separate curves, legends drawn over curves, exotic
  scales, and automatic frame detection for raster scans.

We scope to what we can validate. If you need one of the above, a PR is the fastest path.

## Validation

Beyond the synthetic test suite, the vector path has been checked against reference extractions of real
datasheet PDFs and reproduces them numerically:

- a **dash/colour-keyed** plot (three overlapping curves): all three recovered, every peak matched to the
  nanometre, peak-normalised shape **RMS 0.000**;
- a **continuous-stroke polyline** plot whose curve carries a real double-hump: all three recovered, peaks
  within **8 nm**, shape **RMS 0.000** — the within-lobe substructure preserved, not flattened.

Raster ingest reproduces clean, non-crossing plots; a tight multi-curve plot where curves overlap over a
range is only partially recovered, and the QA report flags it (low confidence, failed curves) rather than
returning a confident-but-wrong result.

## Install

```bash
pip install getmapped            # core: vector-PDF + numpy
pip install "getmapped[raster]"  # + opencv/pillow for the raster fallback
```

## Tests

```bash
pip install "getmapped[test]"
pytest
```

The test suite builds **synthetic** plots (via PyMuPDF) with known ground truth and asserts the recovered
curves + calibration match — no copyrighted source documents are redistributed.

## License

MIT — see [LICENSE](LICENSE).
