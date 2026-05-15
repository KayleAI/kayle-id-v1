#!/usr/bin/env python3
"""Dump cv2's 112×112 BGR crop AND the resized 320×320 BGR image used as
input to warpAffine, for cross-checking against Rust."""

import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parents[1]
IMAGE = Path("/tmp/face_test.jpg")
DETECTOR_MODEL = HERE / "models" / "face_detection_yunet_2023mar.onnx"

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

image = cv2.imread(str(IMAGE))
target = (320, 320)
resized = cv2.resize(image, target)
cv2.imwrite("/tmp/cv2_resized_320.png", resized)
print("resized 320 saved")

detector = cv2.FaceDetectorYN.create(str(DETECTOR_MODEL), "", target, 0.85, 0.3, 5000)
detector.setInputSize(target)
_, faces = detector.detect(resized)
best = max(faces, key=lambda f: float(f[2]) * float(f[3]) * max(float(f[14]), 0.0))
landmarks = np.array(
    [
        [float(best[4]), float(best[5])],
        [float(best[6]), float(best[7])],
        [float(best[8]), float(best[9])],
        [float(best[10]), float(best[11])],
        [float(best[12]), float(best[13])],
    ],
    dtype=np.float64,
)
print("best face row:", [float(v) for v in best])
print("landmarks:")
for lm in landmarks:
    print(f"  ({lm[0]:.4f}, {lm[1]:.4f})")

transform, _ = cv2.estimateAffinePartial2D(landmarks, ARCFACE_TEMPLATE_112, method=cv2.LMEDS)
print("cv2 transform:\n", transform)

warped = cv2.warpAffine(resized, transform, (112, 112))
cv2.imwrite("/tmp/cv2_crop_112.png", warped)
print("cv2 crop 112 saved")

# Also save raw BGR bytes for binary diffing.
resized.tofile("/tmp/cv2_resized_320.bgr")
warped.tofile("/tmp/cv2_crop_112.bgr")
print("raw BGR dumps saved")
