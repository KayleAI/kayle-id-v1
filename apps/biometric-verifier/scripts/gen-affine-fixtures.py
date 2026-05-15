#!/usr/bin/env python3
"""Generate cv2.estimateAffinePartial2D LMEDS fixtures for the Rust parity test.

Two fixture types:
  - "clean": 5 landmarks sampled near the ArcFace template with sub-pixel noise.
    Models YuNet / MediaPipe output in the real face-alignment flow.
  - "noisy": same plus 1 landmark with a 10-px outlier. Models a degenerate
    detection. cv2 LMedS rejects it; Umeyama LSQ does not.

Each record stores the source / destination point arrays AND the (x,y) of the
source points after applying cv2's chosen transform. The Rust test mirrors:
it computes its own transform from the same src/dst, applies it to src, and
diffs against cv2's transformed src.

Output: tests/fixtures/affine_partial_lmeds.json (list of records)
"""

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np


ARCFACE_TEMPLATE_112 = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float64,
)


def transform_points(transform, points):
    homogeneous = np.hstack([points, np.ones((len(points), 1))])
    return (transform @ homogeneous.T).T


def gen_clean(rng):
    # Source = ArcFace template under random similarity (scale 0.5-3.0,
    # rotation ±25°, translation ±200 px) + 0.3 px Gaussian noise.
    scale = rng.uniform(0.5, 3.0)
    theta = rng.uniform(-np.deg2rad(25), np.deg2rad(25))
    tx = rng.uniform(-200, 200)
    ty = rng.uniform(-200, 200)
    c, s = np.cos(theta), np.sin(theta)
    rot = np.array([[c, -s], [s, c]])
    src = scale * (ARCFACE_TEMPLATE_112 @ rot.T) + np.array([tx, ty])
    # 0.1 px Gaussian noise approximates YuNet's landmark precision at
    # 320×320 input (~sub-pixel on a 720-px-wide capture).
    src += rng.normal(0.0, 0.1, src.shape)
    return src, ARCFACE_TEMPLATE_112.copy()


def gen_noisy(rng):
    src, dst = gen_clean(rng)
    # Displace one source point by ~10 px in a random direction.
    bad = rng.integers(0, 5)
    angle = rng.uniform(0, 2 * np.pi)
    src[bad] += np.array([10.0 * np.cos(angle), 10.0 * np.sin(angle)])
    return src, dst


def main():
    seed = int(os.environ.get("AFFINE_FIXTURE_SEED", "42"))
    rng = np.random.default_rng(seed)
    records = []
    for case_kind, gen, count in [("clean", gen_clean, 600), ("noisy", gen_noisy, 400)]:
        for _ in range(count):
            src, dst = gen(rng)
            transform, _inliers = cv2.estimateAffinePartial2D(
                src.astype(np.float64),
                dst.astype(np.float64),
                method=cv2.LMEDS,
            )
            if transform is None:
                continue
            mapped = transform_points(transform, src)
            records.append(
                {
                    "kind": case_kind,
                    "src": src.tolist(),
                    "dst": dst.tolist(),
                    "cv2_transform": transform.tolist(),
                    "cv2_mapped": mapped.tolist(),
                }
            )
    out_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "affine_partial_lmeds.json"
    out_path.write_text(json.dumps(records))
    print(f"wrote {len(records)} records to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
