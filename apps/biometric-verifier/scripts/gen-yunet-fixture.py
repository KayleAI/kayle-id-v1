#!/usr/bin/env python3
"""Capture cv2.FaceDetectorYN ground-truth detections on a fixed face image.

We run the same flow as `service.py`'s `detect_face`: setInputSize to a
canonical 320×320 then `detect` on the resized image. The Rust parity test
runs its own YunetDetector.detect at the same input size on the same JPEG
and compares decoded rows.

Output: tests/fixtures/yunet_detections.json
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np


HERE = Path(__file__).resolve().parents[1]
IMAGE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/face_test.jpg")
MODEL = HERE / "models" / "face_detection_yunet_2023mar.onnx"


def main() -> int:
    if not IMAGE.exists():
        print(f"missing image: {IMAGE}", file=sys.stderr)
        return 1
    if not MODEL.exists():
        print(f"missing model: {MODEL}", file=sys.stderr)
        return 1

    image = cv2.imread(str(IMAGE))
    h, w = image.shape[:2]
    # Resize to a canonical 320×320 so the parity test runs at the same
    # input size on both sides.
    target = (320, 320)
    resized = cv2.resize(image, target)

    detector = cv2.FaceDetectorYN.create(
        str(MODEL), "", target, 0.85, 0.3, 5000
    )
    detector.setInputSize(target)
    _, faces = detector.detect(resized)
    if faces is None:
        faces = np.zeros((0, 15), dtype=np.float32)

    # Sort by confidence descending so the JSON order is reproducible.
    if faces.shape[0] > 0:
        faces = faces[faces[:, 14].argsort()[::-1]]

    out = HERE / "tests" / "fixtures" / "yunet_detections.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "image_path": str(IMAGE),
        "image_width": int(w),
        "image_height": int(h),
        "model_input_size": list(target),
        "detections": faces.astype(float).tolist(),
    }
    out.write_text(json.dumps(record, indent=2))
    print(f"wrote {faces.shape[0]} detections to {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
