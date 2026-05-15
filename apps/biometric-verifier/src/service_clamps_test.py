"""Defensive-clamp tests for service.py.

Locks in the [0, 1] gate on `clamp_score` (used for the per-request
faceMatchThreshold) and the [0, 2] cap on MESH_CROP_EXPAND, so a
misconfigured caller or env var can't silently invert the face-match
gate or produce degenerate mesh crops larger than the source frame.
"""

import math
import unittest

from service import MESH_CROP_EXPAND, clamp_score


class ClampScoreTests(unittest.TestCase):
    def test_passes_through_in_range_values(self) -> None:
        self.assertEqual(clamp_score(0.0), 0.0)
        self.assertEqual(clamp_score(0.5), 0.5)
        self.assertEqual(clamp_score(1.0), 1.0)

    def test_clamps_below_zero(self) -> None:
        self.assertEqual(clamp_score(-0.1), 0.0)
        self.assertEqual(clamp_score(-999.0), 0.0)

    def test_clamps_above_one(self) -> None:
        self.assertEqual(clamp_score(1.0001), 1.0)
        self.assertEqual(clamp_score(42.0), 1.0)

    def test_clamps_infinities(self) -> None:
        self.assertEqual(clamp_score(math.inf), 1.0)
        self.assertEqual(clamp_score(-math.inf), 0.0)

    def test_nan_falls_back_to_default(self) -> None:
        # NaN propagates through Python's min/max so the old clamp
        # returned 1.0 (universally fail). DEFAULT_THRESHOLD is the
        # explicit "treat as unspecified" answer.
        from service import DEFAULT_THRESHOLD

        self.assertEqual(clamp_score(float("nan")), DEFAULT_THRESHOLD)


class MeshCropExpandTests(unittest.TestCase):
    def test_default_value_is_in_range(self) -> None:
        # When `BIOMETRIC_VERIFIER_MESH_CROP_EXPAND` is not set the
        # module-level default lands inside the [0.0, 2.0] envelope.
        self.assertGreaterEqual(MESH_CROP_EXPAND, 0.0)
        self.assertLessEqual(MESH_CROP_EXPAND, 2.0)


if __name__ == "__main__":
    unittest.main()
