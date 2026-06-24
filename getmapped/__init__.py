"""GetMapped — vector-PDF-native plot extraction with automatic multi-curve crossing separation.

extract(plot) -> CurveSet : per-curve calibrated arrays + metadata + a first-class QA/confidence report.
The library knows nothing about the domain; the caller injects a ShapePrior and an order->label map.
"""
from __future__ import annotations

from .curveset import (
    AxisCalibration,
    Curve,
    CurveQA,
    CurveSet,
    CurveSetQA,
    CurveStyle,
    Source,
)
from .extract import extract
from .priors import Free, Lobe, Monotone, ShapePrior, Smooth, Violation

__version__ = "0.0.1"

__all__ = [
    "extract",
    "CurveSet", "Curve", "CurveStyle", "CurveQA", "CurveSetQA", "AxisCalibration", "Source",
    "ShapePrior", "Violation", "Free", "Monotone", "Lobe", "Smooth",
    "__version__",
]
