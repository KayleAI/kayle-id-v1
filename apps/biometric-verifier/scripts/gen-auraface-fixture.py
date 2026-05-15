#!/usr/bin/env python3
"""Capture the full Python face-match pipeline output on a fixed face image:

  decode JPEG → cv2.FaceDetectorYN → align_crop → AuraFace → L2-norm embedding

The Rust parity test runs the same flow and compares the resulting embedding
via cosine — target ≥ 0.9999.

Output: tests/fixtures/auraface_embedding.json with image dims, the best
face's 15-float YuNet row at 320×320, and the 512-d embedding.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

HERE = Path(__file__).resolve().parents[1]
IMAGE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/face_test.jpg")
DETECTOR_MODEL = HERE / "models" / "face_detection_yunet_2023mar.onnx"
RECOGNIZER_MODEL = HERE / "models" / "auraface_glintr100.onnx"

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


def main() -> int:
    if not IMAGE.exists() or not DETECTOR_MODEL.exists() or not RECOGNIZER_MODEL.exists():
        print("missing inputs", file=sys.stderr)
        return 1

    image = cv2.imread(str(IMAGE))
    target = (320, 320)
    resized = cv2.resize(image, target)

    detector = cv2.FaceDetectorYN.create(
        str(DETECTOR_MODEL), "", target, 0.85, 0.3, 5000
    )
    detector.setInputSize(target)
    _, faces = detector.detect(resized)
    if faces is None or len(faces) == 0:
        print("no detections", file=sys.stderr)
        return 1
    best = max(faces, key=lambda f: float(f[2]) * float(f[3]) * max(float(f[14]), 0.0))

    # 5-point landmarks → 112×112 ArcFace template.
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
    transform, _ = cv2.estimateAffinePartial2D(
        landmarks, ARCFACE_TEMPLATE_112, method=cv2.LMEDS
    )
    warped = cv2.warpAffine(resized, transform, (112, 112))

    blob = cv2.dnn.blobFromImage(
        warped, scalefactor=1.0 / 127.5, size=(112, 112), mean=(127.5, 127.5, 127.5), swapRB=True
    )

    session = ort.InferenceSession(
        str(RECOGNIZER_MODEL), providers=["CPUExecutionProvider"]
    )
    input_name = session.get_inputs()[0].name
    out = session.run(None, {input_name: blob})[0]
    embedding = np.asarray(out, dtype=np.float64).reshape(-1)
    norm = float(np.linalg.norm(embedding))
    embedding /= norm

    out_path = HERE / "tests" / "fixtures" / "auraface_embedding.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "image_path": str(IMAGE),
        "model_input_size": list(target),
        "best_face_row": [float(v) for v in best],
        "embedding": embedding.tolist(),
        "embedding_dim": int(embedding.size),
    }
    out_path.write_text(json.dumps(record))
    print(f"wrote embedding ({embedding.size}-d) to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
