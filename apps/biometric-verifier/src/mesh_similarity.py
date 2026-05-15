"""Mesh subset helpers for the debug overlay.

This module originally hosted a Procrustes-aligned RMSD identity-
similarity score derived from the 478-pt MediaPipe Face Landmarker
output. That metric was tried and de-scoped: it wasn't discriminative
enough to act as a face-match signal in its current form (Procrustes
alignment on the full mesh, RMSD over a bone-anchored subset, mapped
through an exp decay to [0, 1]). If a structural-identity signal is
revisited later it'll likely use a different formulation entirely
(e.g., per-feature inter-point ratios, or a learned encoder), so the
score implementation was removed rather than left as dead code.

What remains is the IDENTITY_STABLE_INDICES list and `stable_subset`,
because the debug payload renders the subset as an overlay on the
played-back video / DG2 image and the indices need a single source of
truth.

Pure NumPy; no opencv, no onnxruntime — keeps the helpers testable
without the inference stack.
"""

from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

# MediaPipe Face Mesh canonical indices for the bone-anchored subset
# the debug overlay highlights. Grouped by anatomical role so future
# maintenance is obvious.
_EYE_CORNERS = (33, 133, 263, 362)        # outer/inner R, inner/outer L
_NOSE_BRIDGE = (6, 168)                   # bottom (between eyes) + top (between brows)
_NASAL_SUBALAR = (98, 327)                # under each nostril
_NOSE_TIP = (1,)
_CHIN = (152,)
_MOUTH_CORNERS = (61, 291)

IDENTITY_STABLE_INDICES: Tuple[int, ...] = (
    *_EYE_CORNERS,
    *_NOSE_BRIDGE,
    *_NASAL_SUBALAR,
    *_NOSE_TIP,
    *_CHIN,
    *_MOUTH_CORNERS,
)


def stable_subset(mesh: np.ndarray) -> Optional[np.ndarray]:
    """Extract just the bone-anchored subset from a full 478-point
    mesh. Used by the debug surface so the response doesn't have to
    carry the full 478×3 array (~22 KB per frame × 24 frames = 500 KB
    of JSON otherwise).
    """
    if mesh is None or mesh.ndim != 2 or mesh.shape[1] != 3:
        return None
    indices = np.asarray(IDENTITY_STABLE_INDICES, dtype=np.int64)
    if indices.max() >= mesh.shape[0]:
        return None
    return mesh[indices]
