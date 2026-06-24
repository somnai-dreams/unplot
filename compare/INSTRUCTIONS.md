# Manual head-to-head: digitize these plots in WebPlotDigitizer / Engauge

GetMapped runs automatically in the scorer. The interactive tools (WPD, Engauge) can't be scripted, so this
is the one part that needs a human. Do as many plots/tools as you have patience for — even one is useful.

## The plots (`compare/plots/`)

Each plot is provided as a **PNG** (load this into the GUI tools) and a **PDF** (GetMapped reads this for its
vector path). Same axes on all: **x = 400…700, y = 0…2**, with tick labels drawn for calibration.

|file|curves|colours (left→right by peak)|
|-|-|-|
|`p1_single`|1|black|
|`p2_three_separated`|3|blue, green, red|
|`p3_three_crossing`|3|blue, green, red|
|`p4_three_noisy`|3|blue, green, red (with image noise)|

## Steps (per plot, per tool)

1. Load the **PNG** into WebPlotDigitizer ([apps.automeris.io](https://apps.automeris.io)) or Engauge.
2. **Calibrate the axes** by clicking known points: on the x-axis click the **400** and **700** ticks; on
   the y-axis click the **0** and **2** ticks. Enter those values when prompted.
3. **Digitize each curve.** For the 3-curve plots, do each colour separately (WPD: add a dataset per colour
   and use *Automatic Extraction → Color*; Engauge: a curve per colour with *Segment Fill*). Use the
   automatic tracer where it works — that's the tool's strength.
4. **Export** each curve as CSV (two columns: x then y, in data units).

## Where to put the exports

Save one CSV per curve, named `<plot>__c<index>.csv`, indexed **left→right by peak** (so c0 = blue, c1 =
green, c2 = red), under the tool's folder:

```
compare/submissions/wpd/p2_three_separated__c0.csv
compare/submissions/wpd/p2_three_separated__c1.csv
compare/submissions/engauge/p3_three_crossing__c0.csv
...
```

CSV format is forgiving — comma or whitespace separated, header lines are skipped.

## Score it

```bash
python compare/score.py
```

It runs GetMapped (vector + raster) on every plot and folds in whatever competitor CSVs you've added,
reporting mean peak error (nm) and mean y-RMS per curve against ground truth. Re-run anytime you add more.

(Regenerate the plots with `python compare/make_plots.py` if needed — deterministic, no randomness.)
