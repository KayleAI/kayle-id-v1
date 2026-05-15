"""Pure-NumPy tests for the mesh subset helpers.

The previous version of this file also covered a Procrustes-aligned
similarity metric; that metric was de-scoped from the verifier (see
mesh_similarity.py header for context), so only the subset helpers
remain. The tests run as `uv run pytest src/mesh_similarity_test.py`
without the inference stack on disk.
"""

import unittest

import numpy as np

from mesh_similarity import IDENTITY_STABLE_INDICES, stable_subset


def _make_synthetic_mesh(seed: int) -> np.ndarray:
    """A vaguely-face-shaped 478×3 point cloud."""
    rng = np.random.default_rng(seed)
    points = rng.standard_normal((478, 3))
    points[:, :2] *= 50.0
    points[:, 2] *= 20.0
    return points


class StableSubsetTests(unittest.TestCase):
    def test_returns_subset_shape(self) -> None:
        mesh = _make_synthetic_mesh(seed=1)
        subset = stable_subset(mesh)
        self.assertIsNotNone(subset)
        self.assertEqual(subset.shape, (len(IDENTITY_STABLE_INDICES), 3))

    def test_handles_too_short_mesh(self) -> None:
        # The biggest index in IDENTITY_STABLE_INDICES is 362 — a mesh
        # with fewer points than that can't yield a subset.
        tiny = np.zeros((10, 3))
        self.assertIsNone(stable_subset(tiny))


if __name__ == "__main__":
    unittest.main()
