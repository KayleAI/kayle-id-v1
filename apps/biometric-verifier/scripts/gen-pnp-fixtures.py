#!/usr/bin/env python3
"""Generate cv2.solvePnP(SOLVEPNP_EPNP) fixtures for the Rust pose parity test.

Two fixture families, mirroring the two PnP call sites in service.py:
  - 5-point YuNet path (`_CANONICAL_FACE_3D_POINTS` + YuNet's 5 landmarks)
  - 12-point mesh path (`_MESH_PNP_CANONICAL` + 12 bone-anchored mesh points)

For each fixture we synthesize a known (R, t), project the canonical 3D points
into a 720×1280 image (focal = width, principal point centered), and record
both the cv2 EPnP output and the synthesized ground truth. The Rust test
checks against cv2's output (the parity target), not the ground truth.

Output: tests/fixtures/pnp_epnp.json (list of records)
"""

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np


# 5-point YuNet canonical (`service.py:844`).
YUNET_OBJ_5PT = np.array(
    [
        [32.0, -35.0, -30.0],
        [-32.0, -35.0, -30.0],
        [0.0, 0.0, 0.0],
        [22.0, 35.0, -12.0],
        [-22.0, 35.0, -12.0],
    ],
    dtype=np.float64,
)

# 12-point mesh canonical (`service.py:957-973`).
MESH_OBJ_12PT = np.array(
    [
        [40.0, -30.0, -25.0],   # 33  right eye outer
        [15.0, -30.0, -28.0],   # 133 right eye inner
        [-40.0, -30.0, -25.0],  # 263 left eye outer
        [-15.0, -30.0, -28.0],  # 362 left eye inner
        [0.0, -8.0, -8.0],      # 6   nose bridge
        [0.0, -16.0, -12.0],    # 168 nose root
        [18.0, 8.0, -5.0],      # 98  right alar
        [-18.0, 8.0, -5.0],     # 327 left alar
        [0.0, 0.0, 0.0],        # 1   nose tip
        [0.0, 70.0, -10.0],     # 152 chin tip
        [22.0, 35.0, -12.0],    # 61  right mouth
        [-22.0, 35.0, -12.0],   # 291 left mouth
    ],
    dtype=np.float64,
)


def camera_matrix(width, height):
    return np.array(
        [
            [width, 0.0, width / 2.0],
            [0.0, width, height / 2.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def project(obj, rvec, tvec, K):
    R, _ = cv2.Rodrigues(rvec)
    cam = (R @ obj.T).T + tvec.reshape(1, 3)
    proj = (K @ cam.T).T
    return proj[:, :2] / proj[:, 2:3]


def rotation_to_euler_xyz_deg(R):
    # Mirrors `_rotation_matrix_to_euler_deg` for cross-check.
    sy = float(np.sqrt(R[0, 0] ** 2 + R[1, 0] ** 2))
    if sy < 1e-6:
        pitch = float(np.arctan2(-R[1, 2], R[1, 1]))
        yaw = float(np.arctan2(-R[2, 0], sy))
        roll = 0.0
    else:
        pitch = float(np.arctan2(R[2, 1], R[2, 2]))
        yaw = float(np.arctan2(-R[2, 0], sy))
        roll = float(np.arctan2(R[1, 0], R[0, 0]))
    return np.degrees(pitch), np.degrees(yaw), np.degrees(roll)


def gen(rng, obj, count, kind):
    K = camera_matrix(720, 1280)
    records = []
    for _ in range(count):
        # Random pose: yaw ±35°, pitch ±20°, roll ±15°. Range covers
        # `LIVENESS_TILT_YAW_DEG` (17°) on both sides + headroom.
        rx = np.deg2rad(rng.uniform(-20, 20))
        ry = np.deg2rad(rng.uniform(-35, 35))
        rz = np.deg2rad(rng.uniform(-15, 15))
        # Compose rotation via Euler XYZ (intrinsic) then convert to rvec.
        R = (
            cv2.Rodrigues(np.array([rx, 0.0, 0.0]))[0]
            @ cv2.Rodrigues(np.array([0.0, ry, 0.0]))[0]
            @ cv2.Rodrigues(np.array([0.0, 0.0, rz]))[0]
        )
        rvec, _ = cv2.Rodrigues(R)
        tz = rng.uniform(220.0, 480.0)
        tx = rng.uniform(-40.0, 40.0)
        ty = rng.uniform(-40.0, 40.0)
        tvec = np.array([tx, ty, tz], dtype=np.float64)

        img_pts = project(obj, rvec, tvec, K)
        # 0.3 px Gaussian landmark noise (YuNet realistic).
        img_pts += rng.normal(0.0, 0.3, img_pts.shape)

        object_pts = obj.reshape(-1, 1, 3)
        image_pts = img_pts.reshape(-1, 1, 2)
        distortion = np.zeros((4, 1), dtype=np.float64)

        success, rvec_cv, tvec_cv = cv2.solvePnP(
            object_pts,
            image_pts,
            K,
            distortion,
            flags=cv2.SOLVEPNP_EPNP,
        )
        if not success:
            continue
        R_cv, _ = cv2.Rodrigues(rvec_cv)
        euler = rotation_to_euler_xyz_deg(R_cv)
        records.append(
            {
                "kind": kind,
                "obj": obj.tolist(),
                "img": img_pts.tolist(),
                "cv2_rvec": rvec_cv.flatten().tolist(),
                "cv2_tvec": tvec_cv.flatten().tolist(),
                "cv2_euler_deg": list(euler),
                # Synthesis ground truth (sanity reference).
                "true_rvec": rvec.flatten().tolist(),
                "true_tvec": tvec.tolist(),
            }
        )
    return records


def main():
    seed = int(os.environ.get("PNP_FIXTURE_SEED", "42"))
    rng = np.random.default_rng(seed)
    records = []
    records += gen(rng, YUNET_OBJ_5PT, 400, "yunet_5pt")
    records += gen(rng, MESH_OBJ_12PT, 400, "mesh_12pt")
    out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "pnp_epnp.json"
    out.write_text(json.dumps(records))
    print(f"wrote {len(records)} records to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
