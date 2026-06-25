"""ShapePrior: the pluggable shape knowledge the caller injects.

A prior does two jobs:
  - qa_violation(points) -> Violation : score how far a finished curve departs from the expected shape
  - separation_bias(prefix, cand) -> float : at a crossing, prefer the continuation that fits the shape

Shipped priors: Free (no assumption), Monotone, Lobe (approximately-unimodal), Smooth. A caller selects and
parameterises these for its domain (monotone curves vs single-peaked lobes, etc.) and maps the recovered
curve order to its own labels; no domain knowledge lives here.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

import numpy as np
from numpy.typing import NDArray

from ..qa import shape

# Separation runs in SOURCE pixel coords (y increases downward), so "visual up" = decreasing y. The
# shape-aware priors score a candidate continuation by height h = -y, matching standard plot orientation.
_TREND = 40   # window for the established-direction estimate — long enough to survive a flat crossing blob


def _height_step(prefix: NDArray, cand: NDArray) -> tuple[float, float, int]:
    """Return (established height trend, candidate height step, peak index) in visual-height (h = -y).

    `trend` is the net height change over the last `_TREND` points — a window deliberately longer than a
    crossing's merged blob, so a curve's direction survives the brief flat stretch at the crossing.
    """
    h = -prefix[:, 1]
    win = h[-_TREND:]
    trend = float(win[-1] - win[0])
    step = float(-cand[1] - h[-1])
    return trend, step, int(np.argmax(h))


@dataclass(frozen=True)
class Violation:
    magnitude: float               # 0 = clean
    kind: str                      # "flank" | "backtrack" | "curvature" | "none"
    at: float | None               # x (data units) of worst violation


@runtime_checkable
class ShapePrior(Protocol):
    name: str
    tolerance: float

    def qa_violation(self, points: NDArray) -> Violation: ...
    def separation_bias(self, prefix: NDArray, cand: NDArray) -> float: ...


@dataclass(frozen=True)
class Free:
    """No shape assumption — raw recovered geometry. Everything passes."""
    name: str = "free"
    tolerance: float = math.inf

    def qa_violation(self, points: NDArray) -> Violation:
        return Violation(0.0, "none", None)

    def separation_bias(self, prefix: NDArray, cand: NDArray) -> float:
        return 0.0


@dataclass(frozen=True)
class Monotone:
    """Curve should be monotone in one direction (e.g. a characteristic D-vs-logE curve).

    direction in {"auto","up","down"}. Violation = largest backtrack against that direction / y-range.
    """
    direction: Literal["auto", "up", "down"] = "auto"
    tolerance: float = 0.05
    name: str = "monotone"

    def qa_violation(self, points: NDArray) -> Violation:
        v, at = shape.backtrack(points, self.direction)
        return Violation(v, "backtrack", at)

    def separation_bias(self, prefix: NDArray, cand: NDArray) -> float:
        # reward continuing the prefix's established direction; penalise a reversal (a monotone curve
        # should never turn back). Disambiguates a crossing where the other curve runs the opposite way.
        if len(prefix) < 2:
            return 0.0
        trend, step, _ = _height_step(prefix, cand)
        if trend == 0.0:
            return 0.0
        return (1.0 if trend > 0 else -1.0) * step


@dataclass(frozen=True)
class Lobe:
    """Curve should be an approximately-unimodal lobe: rise to a peak, then fall.

    'Approximately' is load-bearing: real lobes carry within-lobe substructure (the blue 415/470
    double-hump, asymmetric broad-shoulder/sharp-drop lobes). `tolerance` (fraction of amplitude) is how
    much flank reversal is allowed before the curve is flagged — NOT a demand for strict unimodality.
    Violation = flank reversal as a fraction of amplitude.
    """
    tolerance: float = 0.08
    name: str = "lobe"

    def qa_violation(self, points: NDArray) -> Violation:
        v, at = shape.flank_violation(points)
        return Violation(v, "flank", at)

    def separation_bias(self, prefix: NDArray, cand: NDArray) -> float:
        # a lobe rises to a peak then falls. Before the prefix's peak, reward a rising candidate; after it,
        # reward a falling one. Where two lobes cross they run opposite flanks, so this picks the
        # continuation that keeps each curve single-peaked instead of letting the trace swap curves.
        if len(prefix) < 3:
            return 0.0
        _, step, pk = _height_step(prefix, cand)
        past_peak = (len(prefix) - 1 - pk) > 2
        return -step if past_peak else step


@dataclass(frozen=True)
class Smooth:
    """Curve should be smooth (no spikes). Violation = max normalised second difference."""
    tolerance: float = 0.25
    name: str = "smooth"

    def qa_violation(self, points: NDArray) -> Violation:
        v, at = shape.curvature(points)
        return Violation(v, "curvature", at)

    def separation_bias(self, prefix: NDArray, cand: NDArray) -> float:
        return 0.0


__all__ = ["ShapePrior", "Violation", "Free", "Monotone", "Lobe", "Smooth"]
