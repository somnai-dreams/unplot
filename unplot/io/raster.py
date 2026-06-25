"""Raster ingest: load an image, or rasterize a PDF page. Pillow/fitz imported lazily."""
from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def load_image(path: str) -> NDArray:
    from PIL import Image
    return np.asarray(Image.open(path).convert("RGB"))


def rasterize_pdf(path: str, page: int = 0, dpi: int = 300) -> NDArray:
    import fitz
    pg = fitz.open(path)[page]
    pm = pg.get_pixmap(dpi=dpi)
    arr = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, pm.n)
    return arr[..., :3].copy()
