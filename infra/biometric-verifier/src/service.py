import base64
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from mesh_similarity import (
    IDENTITY_STABLE_INDICES,
    stable_subset,
)

try:
    import onnxruntime as ort
except Exception:  # pragma: no cover - import guard
    ort = None  # type: ignore[assignment]


MODEL_INPUT_SIZE = (112, 112)
DETAIL_STDDEV_MIN = 12.0
STRICT_IMAGE_SIMILARITY_THRESHOLD = 0.995
# 0.7 normalised ≈ raw cosine 0.4 — InsightFace's published "same
# person" threshold for glint360k-trained ArcFace R100. Re-tune from
# real-traffic telemetry once enough labelled pairs accumulate.
DEFAULT_THRESHOLD = 0.7
DEFAULT_DETECTOR_INPUT_SIZE = (320, 320)
MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_MODEL_PATH",
    "/app/models/auraface_glintr100.onnx",
)
DETECTOR_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_DETECTOR_PATH",
    "/app/models/face_detection_yunet_2023mar.onnx",
)
PORT = int(os.environ.get("PORT", "8080"))

# Fail secure: anything other than "development" — including the env
# var being absent entirely — is treated as production.
IS_DEV = os.environ.get("NODE_ENV", "production") == "development"

ALLOW_PIXEL_FALLBACK = IS_DEV
ALLOW_FACE_MATCH_SKIP = IS_DEV
DEBUG_RESPONSES_ALLOWED = IS_DEV

LIVENESS_FRAME_COUNT = int(
    os.environ.get("BIOMETRIC_VERIFIER_FRAME_COUNT", "24")
)
LIVENESS_CENTER_YAW_DEG = float(
    os.environ.get("BIOMETRIC_VERIFIER_CENTER_YAW_DEG", "15")
)
# iOS targets 22° for its progress UI; 17° here gives the server-side
# trigger headroom under that.
LIVENESS_TILT_YAW_DEG = float(
    os.environ.get("BIOMETRIC_VERIFIER_TILT_YAW_DEG", "17")
)
LIVENESS_MIN_POSE_FRAMES = int(
    os.environ.get("BIOMETRIC_VERIFIER_MIN_POSE_FRAMES", "1")
)
LIVENESS_FFMPEG_BIN = os.environ.get("BIOMETRIC_VERIFIER_FFMPEG_BIN", "ffmpeg")

# Silent-Face-Anti-Spoofing dual-model ensemble (MiniFASNetV2 +
# MiniFASNetV1SE). Inference sums the two softmaxes; class index 1 is
# "real" per upstream `test.py:71`. Input is 80×80 BGR uint8 cast to
# float32 in the [0, 255] range — the upstream's `to_tensor`
# (src/data_io/functional.py) has `.div(255)` commented out, so
# normalising to [0, 1] silently degrades to the model's near-baseline
# output. Verified end-to-end against upstream PyTorch via
# models/pad/scripts/verify.py.
PAD_DISABLED = os.environ.get("BIOMETRIC_VERIFIER_PAD_DISABLED") == "1"
PAD_V2_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_PAD_V2_MODEL_PATH",
    "/app/models/pad_minifasnet_v2_scale27.onnx",
)
PAD_V1SE_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_PAD_V1SE_MODEL_PATH",
    "/app/models/pad_minifasnet_v1se_scale40.onnx",
)
PAD_INPUT_SIZE = (80, 80)
PAD_V2_CROP_SCALE = 2.7
PAD_V1SE_CROP_SCALE = 4.0
# Calibration policy lives in source so a deploy-time env override
# can't silently shift spoof detection. BIOMETRIC_VERIFIER_PAD_DISABLED
# remains as the emergency kill switch (asserted unset in
# wrangler-config.test.ts). Summed softmax over two models is in
# [0, 2]; halved before this threshold to keep it in [0, 1].
PAD_FRAME_THRESHOLD = 0.55
PAD_PASS_FRACTION = 0.7

MESH_DISABLED = os.environ.get("BIOMETRIC_VERIFIER_MESH_DISABLED") == "1"
MESH_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_MESH_MODEL_PATH",
    "/app/models/face_landmarks_detector.onnx",
)
# Crop expansion matches the BlazeFace-style loose framing the
# MediaPipe model was trained on — tight YuNet boxes under-perform.
MESH_INPUT_SIZE = (256, 256)
MESH_CROP_EXPAND = float(
    os.environ.get("BIOMETRIC_VERIFIER_MESH_CROP_EXPAND", "0.5")
)

# De-facto InsightFace/ArcFace 5-pt template in 112×112 output space.
# AuraFace was trained against this exact alignment — these positions
# are load-bearing and must not be tweaked.
_ARCFACE_TEMPLATE_112 = np.array(
    [
        [38.2946, 51.6963],   # right eye centre (subject's right)
        [73.5318, 51.5014],   # left eye centre  (subject's left)
        [56.0252, 71.7366],   # nose tip
        [41.5493, 92.3655],   # right mouth corner
        [70.7299, 92.2041],   # left mouth corner
    ],
    dtype=np.float64,
)

# MediaPipe Face Mesh indices for the anatomical points the ArcFace
# template expects. Eye centres are derived as the midpoint of
# inner+outer corner (the template's eye points are centres, not
# corners).
_MESH_RIGHT_EYE_OUTER = 33
_MESH_RIGHT_EYE_INNER = 133
_MESH_LEFT_EYE_OUTER = 263
_MESH_LEFT_EYE_INNER = 362
_MESH_NOSE_TIP = 1
_MESH_RIGHT_MOUTH = 61
_MESH_LEFT_MOUTH = 291
_MESH_ALIGNMENT_REQUIRED_MAX_INDEX = max(
    _MESH_RIGHT_EYE_OUTER,
    _MESH_RIGHT_EYE_INNER,
    _MESH_LEFT_EYE_OUTER,
    _MESH_LEFT_EYE_INNER,
    _MESH_NOSE_TIP,
    _MESH_RIGHT_MOUTH,
    _MESH_LEFT_MOUTH,
)


def emit_log(event: str, **details: object) -> None:
    print(
        json.dumps({"event": f"biometric_verifier.{event}", **details}),
        flush=True,
    )


def clamp_score(value: float) -> float:
    return max(0.0, min(1.0, value))


def normalize_cosine_score(raw_score: float) -> float:
    return clamp_score((raw_score + 1.0) / 2.0)


def normalize_correlation_score(raw_score: float) -> float:
    return clamp_score(raw_score)


def decode_dg2_image(image_payload: dict) -> np.ndarray:
    if not isinstance(image_payload, dict):
        raise ValueError(
            f"dg2_image_payload_invalid:not_a_dict:{type(image_payload).__name__}"
        )
    bytes_base64 = image_payload.get("bytesBase64")
    if not isinstance(bytes_base64, str):
        raise ValueError(
            f"dg2_image_payload_missing_bytes:keys={list(image_payload.keys())}"
        )
    encoded = base64.b64decode(bytes_base64)
    buffer = np.frombuffer(encoded, dtype=np.uint8)
    decoded = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError(
            f"dg2_image_decode_failed:format={image_payload.get('format')!r}:"
            f"byte_count={len(encoded)}"
        )
    return decoded


# cv2.FaceDetectorYN.setInputSize() mutates instance state that detect()
# reads, so concurrent detect_face calls with different-sized images
# race. The detect step is fast (~5-10 ms) so the lock cost is small.
_DETECTOR_LOCK = threading.Lock()


def detect_face(
    detector: cv2.FaceDetectorYN, image: np.ndarray
) -> Optional[np.ndarray]:
    height, width = image.shape[:2]

    if height == 0 or width == 0:
        return None

    with _DETECTOR_LOCK:
        detector.setInputSize((width, height))
        _, faces = detector.detect(image)

    if faces is None or len(faces) == 0:
        return None

    best_face = max(
        faces,
        key=lambda face: float(face[2]) * float(face[3]) * max(float(face[14]), 0.0),
    )
    return best_face


class AuraFaceRecognizer:
    """Thin wrapper around the AuraFace ONNX model.

    `feature` runs the model with InsightFace-standard preprocessing
    (mean 127.5, scale 1/127.5, BGR→RGB) and L2-normalizes the 512-d
    output. `align_crop` warps an input image to the ArcFace canonical
    112×112 template using YuNet's 5 landmarks. `match` is the cosine
    similarity of two unit embeddings.
    """

    def __init__(self, session) -> None:
        self.session = session
        self.input_name = session.get_inputs()[0].name

    def align_crop(
        self, image: np.ndarray, face: np.ndarray
    ) -> Optional[np.ndarray]:
        source_points = _yunet_landmarks_2d(face)
        if source_points is None:
            return None
        try:
            transform, _inliers = cv2.estimateAffinePartial2D(
                source_points,
                _ARCFACE_TEMPLATE_112,
                method=cv2.LMEDS,
            )
        except cv2.error as error:
            emit_log("auraface_align_estimate_failed", error=str(error))
            return None
        if transform is None:
            return None
        try:
            return cv2.warpAffine(image, transform, MODEL_INPUT_SIZE)
        except cv2.error as error:
            emit_log("auraface_align_warp_failed", error=str(error))
            return None

    def feature(self, crop: np.ndarray) -> Optional[np.ndarray]:
        try:
            blob = cv2.dnn.blobFromImage(
                crop,
                scalefactor=1.0 / 127.5,
                size=MODEL_INPUT_SIZE,
                mean=(127.5, 127.5, 127.5),
                swapRB=True,
            )
        except cv2.error as error:
            emit_log("auraface_blob_failed", error=str(error))
            return None
        try:
            outputs = self.session.run(None, {self.input_name: blob})
        except Exception as error:
            emit_log("auraface_inference_failed", error=str(error))
            return None
        if not outputs:
            return None
        embedding = np.asarray(outputs[0], dtype=np.float64).reshape(-1)
        if embedding.size == 0:
            return None
        norm = float(np.linalg.norm(embedding))
        if norm <= 0.0 or not math.isfinite(norm):
            return None
        return embedding / norm

    @staticmethod
    def match(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b))


def prepare_face_crop(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    image: np.ndarray,
) -> Optional[np.ndarray]:
    face = detect_face(detector, image)

    if face is None:
        return None

    prepared = recognizer.align_crop(image, face)

    if prepared is None:
        return None

    prepared = cv2.resize(prepared, MODEL_INPUT_SIZE)

    grayscale = cv2.cvtColor(prepared, cv2.COLOR_BGR2GRAY)

    if float(grayscale.std()) < DETAIL_STDDEV_MIN:
        return None

    return prepared


def prepare_full_image_crop(image: np.ndarray) -> Optional[np.ndarray]:
    # Dev-only path for synthetic fixtures that fail face detection;
    # reachable only when ALLOW_PIXEL_FALLBACK is true.
    if image.size == 0:
        return None

    prepared = cv2.resize(image, MODEL_INPUT_SIZE)
    grayscale = cv2.cvtColor(prepared, cv2.COLOR_BGR2GRAY)

    if float(grayscale.std()) < DETAIL_STDDEV_MIN:
        return None

    return prepared


def _mesh_anatomical_5pt(mesh: np.ndarray) -> Optional[np.ndarray]:
    """5 ArcFace-template-aligned anatomical points pulled from the
    478-pt mesh. Returns None when the mesh is too short."""
    if mesh is None or mesh.ndim != 2 or mesh.shape[1] < 2:
        return None
    if mesh.shape[0] <= _MESH_ALIGNMENT_REQUIRED_MAX_INDEX:
        return None
    right_eye = (
        mesh[_MESH_RIGHT_EYE_OUTER, :2] + mesh[_MESH_RIGHT_EYE_INNER, :2]
    ) / 2.0
    left_eye = (
        mesh[_MESH_LEFT_EYE_OUTER, :2] + mesh[_MESH_LEFT_EYE_INNER, :2]
    ) / 2.0
    return np.array(
        [
            right_eye,
            left_eye,
            mesh[_MESH_NOSE_TIP, :2],
            mesh[_MESH_RIGHT_MOUTH, :2],
            mesh[_MESH_LEFT_MOUTH, :2],
        ],
        dtype=np.float64,
    )


def align_face_via_mesh(
    image: np.ndarray, mesh: np.ndarray
) -> Optional[np.ndarray]:
    """Warp `image` to a 112×112 AuraFace-ready crop using the mesh's
    5 anatomical landmarks → ArcFace template. Returns None on
    degenerate input (mesh too short, no affine transform, uniform crop).
    """
    source_points = _mesh_anatomical_5pt(mesh)
    if source_points is None:
        return None
    try:
        transform, _inliers = cv2.estimateAffinePartial2D(
            source_points,
            _ARCFACE_TEMPLATE_112,
            method=cv2.LMEDS,
        )
    except cv2.error as error:
        emit_log("mesh_alignment_estimate_failed", error=str(error))
        return None
    if transform is None:
        return None
    try:
        warped = cv2.warpAffine(image, transform, MODEL_INPUT_SIZE)
    except cv2.error as error:
        emit_log("mesh_alignment_warp_failed", error=str(error))
        return None

    grayscale = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    if float(grayscale.std()) < DETAIL_STDDEV_MIN:
        return None
    return warped


def build_embedding_mesh_aligned(
    recognizer: "AuraFaceRecognizer",
    image: np.ndarray,
    mesh: np.ndarray,
):
    crop = align_face_via_mesh(image, mesh)
    if crop is None:
        return None
    return recognizer.feature(crop)


def build_embedding(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    image: np.ndarray,
    allow_full_image_fallback: bool = False,
):
    prepared = prepare_face_crop(detector, recognizer, image)

    if prepared is None and ALLOW_PIXEL_FALLBACK and allow_full_image_fallback:
        prepared = prepare_full_image_crop(image)

    if prepared is None:
        return None

    return recognizer.feature(prepared)


def compute_image_similarity(
    dg2_image: np.ndarray, selfie_image: np.ndarray
) -> Optional[float]:
    # Test-only path. Pearson correlation of the two images at MODEL_INPUT_SIZE.
    # Caller must ensure ALLOW_PIXEL_FALLBACK is true before invoking.
    dg2_grayscale = cv2.cvtColor(
        cv2.resize(dg2_image, MODEL_INPUT_SIZE), cv2.COLOR_BGR2GRAY
    ).astype(np.float32)
    selfie_grayscale = cv2.cvtColor(
        cv2.resize(selfie_image, MODEL_INPUT_SIZE), cv2.COLOR_BGR2GRAY
    ).astype(np.float32)

    dg2_centered = dg2_grayscale - float(dg2_grayscale.mean())
    selfie_centered = selfie_grayscale - float(selfie_grayscale.mean())
    dg2_norm = float(np.linalg.norm(dg2_centered))
    selfie_norm = float(np.linalg.norm(selfie_centered))

    if dg2_norm == 0.0 or selfie_norm == 0.0:
        return None

    raw_score = float(
        np.dot(dg2_centered.flatten(), selfie_centered.flatten())
        / (dg2_norm * selfie_norm)
    )
    return normalize_correlation_score(raw_score)


def compute_face_match_embeddings(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    image: np.ndarray,
    mesh: Optional[np.ndarray],
    allow_full_image_fallback: bool = False,
    prefer_alignment: str = "both",
) -> dict:
    """Compute AuraFace embeddings for `image`, keyed by alignment.

    `prefer_alignment="both"` runs both alignments — used for DG2
    once per request so any selfie can fall back to YuNet alignment
    even if its own mesh failed. `prefer_alignment="mesh"` runs only
    mesh-aligned, falling back to YuNet-aligned when mesh is absent
    or the warp degenerated; this halves inference cost per selfie.
    """
    yunet_embedding: Optional[np.ndarray] = None
    mesh_embedding: Optional[np.ndarray] = None

    if mesh is not None and prefer_alignment in ("both", "mesh"):
        mesh_embedding = build_embedding_mesh_aligned(recognizer, image, mesh)

    if prefer_alignment == "both" or mesh_embedding is None:
        yunet_embedding = build_embedding(
            detector,
            recognizer,
            image,
            allow_full_image_fallback=allow_full_image_fallback,
        )

    return {
        "yunet": yunet_embedding,
        "mesh": mesh_embedding,
    }


def match_face_embeddings(
    dg2_embeddings: dict,
    dg2_image: np.ndarray,
    selfie_embeddings: dict,
    selfie_image: np.ndarray,
    threshold: float,
) -> dict:
    """Cosine-match precomputed AuraFace embeddings. Prefers mesh-aligned
    when both sides have a mesh embedding (empirically more accurate),
    falls back to YuNet-aligned otherwise. `faceMatchAlignment` in the
    result reports which path won.
    """
    result: dict = {
        "faceMatchScore": None,
        "faceMatchPassed": False,
        "faceMatchAlignment": None,
        "usedFallback": False,
        "reason": None,
    }

    dg2_mesh_emb = dg2_embeddings.get("mesh")
    selfie_mesh_emb = selfie_embeddings.get("mesh")
    dg2_yunet = dg2_embeddings.get("yunet")
    selfie_yunet = selfie_embeddings.get("yunet")

    if dg2_mesh_emb is not None and selfie_mesh_emb is not None:
        raw_score = float(np.dot(dg2_mesh_emb, selfie_mesh_emb))
        normalized = normalize_cosine_score(raw_score)
        result["faceMatchScore"] = normalized
        result["faceMatchPassed"] = normalized >= threshold
        result["faceMatchAlignment"] = "mesh"
        result["reason"] = (
            None if normalized >= threshold else "face_score_below_threshold"
        )
    elif dg2_yunet is None:
        result["reason"] = "face_score_dg2_face_not_detected"
    elif selfie_yunet is not None:
        raw_score = float(np.dot(dg2_yunet, selfie_yunet))
        normalized = normalize_cosine_score(raw_score)
        result["faceMatchScore"] = normalized
        result["faceMatchPassed"] = normalized >= threshold
        result["faceMatchAlignment"] = "yunet"
        result["reason"] = (
            None if normalized >= threshold else "face_score_below_threshold"
        )
    elif ALLOW_PIXEL_FALLBACK:
        normalized = compute_image_similarity(dg2_image, selfie_image)
        if (
            normalized is not None
            and normalized >= STRICT_IMAGE_SIMILARITY_THRESHOLD
        ):
            result["faceMatchScore"] = normalized
            result["faceMatchPassed"] = normalized >= threshold
            result["usedFallback"] = True
            # Pixel correlation isn't a real alignment; flag as yunet so
            # telemetry distinguishes model match from fallback via
            # `usedFallback`, not alignment.
            result["faceMatchAlignment"] = "yunet"
            result["reason"] = (
                None if normalized >= threshold else "face_score_below_threshold"
            )
        else:
            result["reason"] = "face_score_no_decodable_frame"
    else:
        result["reason"] = "face_score_no_decodable_frame"

    return result


def match_centered_frame(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    dg2_image: np.ndarray,
    dg2_mesh: Optional[np.ndarray],
    selfie_frame: np.ndarray,
    selfie_mesh: Optional[np.ndarray],
    threshold: float,
) -> dict:
    """Single-shot DG2 + frame match used by the liveness endpoint.
    The face-match endpoint reuses DG2 across selfies and calls
    `compute_face_match_embeddings` + `match_face_embeddings` directly.
    """
    dg2_embeddings = compute_face_match_embeddings(
        detector,
        recognizer,
        dg2_image,
        dg2_mesh,
        allow_full_image_fallback=True,
        prefer_alignment="both",
    )
    selfie_embeddings = compute_face_match_embeddings(
        detector,
        recognizer,
        selfie_frame,
        selfie_mesh,
        prefer_alignment="mesh",
    )
    return match_face_embeddings(
        dg2_embeddings,
        dg2_image,
        selfie_embeddings,
        selfie_frame,
        threshold,
    )


def extract_frames_with_ffmpeg(
    video_bytes: bytes, frame_count: int
) -> tuple[list[np.ndarray], Optional[float]]:
    """Decode `frame_count` evenly-spaced frames from the supplied
    video. Returns (BGR images in display order, duration in seconds).
    Returns ([], None) on any decode failure — caller treats an empty
    list as `liveness_video_unreadable`.
    """
    if frame_count <= 0:
        return [], None

    with tempfile.TemporaryDirectory(prefix="liveness-") as tmpdir:
        tmp_path = Path(tmpdir)
        input_path = tmp_path / "input.mp4"
        input_path.write_bytes(video_bytes)

        # Step 1: probe duration via ffprobe-equivalent fast metadata extraction.
        # Failing that, fall back to a heuristic that splits a 5s clip into
        # frame_count windows. We use ffmpeg with -ss 0 -t 0 to read metadata
        # cheaply (no decode) and parse stderr.
        duration_seconds = probe_duration_seconds(input_path)
        if duration_seconds is None or duration_seconds <= 0:
            return [], duration_seconds

        # `-vf fps=N` splits the duration into frame_count equal
        # intervals and emits one frame per interval — robust to any
        # input timebase, unlike an `eq(pts*TB,…)` predicate which
        # requires bit-exact timestamp matches.
        timestamps = [
            duration_seconds * (i + 0.5) / frame_count
            for i in range(frame_count)
        ]
        select_expr = "+".join(
            f"eq(pts*TB\\,{ts:.6f})" for ts in timestamps
        )
        output_pattern = tmp_path / "frame_%03d.png"
        frame_rate = frame_count / duration_seconds
        command = [
            LIVENESS_FFMPEG_BIN,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-vf",
            f"fps={frame_rate:.6f}",
            "-vsync",
            "vfr",
            "-frames:v",
            str(frame_count),
            str(output_pattern),
        ]

        try:
            subprocess.run(
                command,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=15,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            emit_log(
                "ffmpeg_extract_failed",
                error=str(error),
                duration_seconds=duration_seconds,
                frame_count=frame_count,
                stderr=getattr(error, "stderr", b"").decode("utf-8", errors="replace")[:512]
                if hasattr(error, "stderr") and error.stderr
                else None,
            )
            return [], duration_seconds

        _ = select_expr  # silence unused
        frames: list[np.ndarray] = []
        for path in sorted(tmp_path.glob("frame_*.png")):
            frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if frame is not None:
                frames.append(frame)
        return frames, duration_seconds


def probe_duration_seconds(input_path: Path) -> Optional[float]:
    """Read duration via ffmpeg's stderr probe (avoids the ffprobe
    dependency so the container ships only one binary)."""
    command = [
        LIVENESS_FFMPEG_BIN,
        "-nostdin",
        "-hide_banner",
        "-i",
        str(input_path),
    ]

    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=5,
        )
    except subprocess.TimeoutExpired:
        return None

    stderr = result.stderr.decode("utf-8", errors="replace")
    # Look for "Duration: HH:MM:SS.ms" in ffmpeg's stderr probe output.
    needle = "Duration:"
    start = stderr.find(needle)
    if start == -1:
        return None
    fragment = stderr[start + len(needle):].strip()
    end = fragment.find(",")
    if end == -1:
        return None
    duration_text = fragment[:end].strip()
    parts = duration_text.split(":")
    if len(parts) != 3:
        return None
    try:
        hours = float(parts[0])
        minutes = float(parts[1])
        seconds = float(parts[2])
    except ValueError:
        return None
    total = hours * 3600 + minutes * 60 + seconds
    return total if total > 0 else None


# Canonical 3D head model in approximate millimetres. Right-handed
# frame matching OpenCV's camera: +X image-right, +Y down, +Z into
# the scene. Origin at the nose tip; absolute scale is irrelevant
# (solvePnP only uses relative geometry).
#
# Index order matches YuNet's landmark output and `_yunet_landmarks_2d`
# below — naming follows YuNet's image-side convention (right_eye =
# image-right, i.e. subject's left under un-mirrored capture).
_CANONICAL_FACE_3D_POINTS = np.array(
    [
        [32.0, -35.0, -30.0],   # right_eye landmark  (image-right)
        [-32.0, -35.0, -30.0],  # left_eye landmark   (image-left)
        [0.0, 0.0, 0.0],        # nose tip
        [22.0, 35.0, -12.0],    # right_mouth landmark (image-right)
        [-22.0, 35.0, -12.0],   # left_mouth landmark  (image-left)
    ],
    dtype=np.float64,
)


def _yunet_landmarks_2d(landmarks: np.ndarray) -> Optional[np.ndarray]:
    if landmarks is None or len(landmarks) < 14:
        return None
    return np.array(
        [
            [float(landmarks[4]), float(landmarks[5])],   # right eye
            [float(landmarks[6]), float(landmarks[7])],   # left eye
            [float(landmarks[8]), float(landmarks[9])],   # nose
            [float(landmarks[10]), float(landmarks[11])], # right mouth
            [float(landmarks[12]), float(landmarks[13])], # left mouth
        ],
        dtype=np.float64,
    )


def _camera_matrix_for(frame_shape: tuple[int, int]) -> np.ndarray:
    """Pinhole intrinsics good enough for uncalibrated webcam input:
    focal ≈ image width, principal point at centre, no skew.
    Distortion error is far below the classify_pose tilt thresholds."""
    height, width = frame_shape
    focal = float(width)
    cx = width / 2.0
    cy = height / 2.0
    return np.array(
        [
            [focal, 0.0, cx],
            [0.0, focal, cy],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def _rotation_matrix_to_euler_deg(R: np.ndarray) -> tuple[float, float, float]:
    """Pitch/yaw/roll in degrees via Tait–Bryan XYZ intrinsic (pitch =
    nod, yaw = shake, roll = tilt as the subject experiences them)."""
    sy = math.sqrt(R[0, 0] ** 2 + R[1, 0] ** 2)
    singular = sy < 1e-6
    if singular:
        pitch = math.atan2(-R[1, 2], R[1, 1])
        yaw = math.atan2(-R[2, 0], sy)
        roll = 0.0
    else:
        pitch = math.atan2(R[2, 1], R[2, 2])
        yaw = math.atan2(-R[2, 0], sy)
        roll = math.atan2(R[1, 0], R[0, 0])
    return math.degrees(pitch), math.degrees(yaw), math.degrees(roll)


def head_pose_from_yunet(
    landmarks: np.ndarray, frame_shape: tuple[int, int]
) -> Optional[tuple[float, float, float]]:
    """(pitch, yaw, roll) in degrees via solvePnP on YuNet's 5
    landmarks. Positive yaw = subject's left. Fallback for when the
    mesh path is unavailable. Returns None on solvePnP failure
    (collinear landmarks, NaNs, etc.).
    """
    image_points = _yunet_landmarks_2d(landmarks)
    if image_points is None:
        return None

    object_points = _CANONICAL_FACE_3D_POINTS.reshape(-1, 1, 3)
    image_points = image_points.reshape(-1, 1, 2)
    camera_matrix = _camera_matrix_for(frame_shape)
    distortion = np.zeros((4, 1), dtype=np.float64)

    try:
        success, rvec, _tvec = cv2.solvePnP(
            object_points,
            image_points,
            camera_matrix,
            distortion,
            flags=cv2.SOLVEPNP_EPNP,
        )
    except cv2.error as error:
        emit_log("head_pose_solvepnp_failed", error=str(error))
        return None

    if not success:
        return None

    try:
        rotation_matrix, _ = cv2.Rodrigues(rvec)
    except cv2.error as error:
        emit_log("head_pose_rodrigues_failed", error=str(error))
        return None

    return _rotation_matrix_to_euler_deg(rotation_matrix)


# 12 identity-stable mesh indices for head-pose PnP. Bone-anchored
# (eye corners, nose bridge, chin, alars, mouth corners) so they stay
# put across expression changes. Coords share the object frame of
# `_CANONICAL_FACE_3D_POINTS` so yaw scale matches the YuNet fallback.
_MESH_PNP_INDICES = (
    33, 133, 263, 362,   # eye corners (out/in R, in/out L)
    6, 168,              # sellion, glabella (nose bridge)
    98, 327,             # nasal alar (sub-nostril R, L)
    1, 152,              # nose tip, chin tip
    61, 291,             # mouth corners (R, L)
)
_MESH_PNP_CANONICAL = np.array(
    [
        [-32.0, -32.0, -30.0],  # 33  subject's right eye outer
        [-15.0, -32.0, -25.0],  # 133 subject's right eye inner
        [32.0, -32.0, -30.0],   # 263 subject's left eye outer
        [15.0, -32.0, -25.0],   # 362 subject's left eye inner
        [0.0, -10.0, -10.0],    # 6   sellion (between eyes)
        [0.0, -35.0, -25.0],    # 168 glabella (between brows)
        [-12.0, 8.0, -8.0],     # 98  right nostril alar
        [12.0, 8.0, -8.0],      # 327 left nostril alar
        [0.0, 0.0, 0.0],        # 1   nose tip
        [0.0, 65.0, -10.0],     # 152 chin tip
        [-25.0, 30.0, -15.0],   # 61  right mouth corner
        [25.0, 30.0, -15.0],    # 291 left mouth corner
    ],
    dtype=np.float64,
)


def extract_mesh(
    session, image: np.ndarray, bbox: np.ndarray
) -> Optional[np.ndarray]:
    """Run the MediaPipe Face Landmarker on an expanded crop around the
    YuNet bbox. Returns a (478, 3) ndarray in ORIGINAL IMAGE pixel
    coords so downstream PnP can reuse `_camera_matrix_for(frame_shape)`
    without surprises. Returns None on any failure (degenerate bbox,
    decode error, unexpected output shape).
    """
    if session is None or bbox is None:
        return None

    height, width = image.shape[:2]
    if height == 0 or width == 0:
        return None
    x = float(bbox[0])
    y = float(bbox[1])
    w = float(bbox[2])
    h = float(bbox[3])
    if w <= 0 or h <= 0:
        return None

    # MediaPipe Face Landmarker was trained on BlazeFace-style loose
    # framing; YuNet's tight bbox biases landmarks without this expand.
    expand_x = w * MESH_CROP_EXPAND
    expand_y = h * MESH_CROP_EXPAND
    x0 = max(0.0, x - expand_x)
    y0 = max(0.0, y - expand_y)
    x1 = min(float(width), x + w + expand_x)
    y1 = min(float(height), y + h + expand_y)
    if x1 <= x0 or y1 <= y0:
        return None
    crop = image[int(y0) : int(y1), int(x0) : int(x1)]
    if crop.size == 0:
        return None

    crop_resized = cv2.resize(crop, MESH_INPUT_SIZE)
    rgb = cv2.cvtColor(crop_resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    blob = np.expand_dims(rgb, axis=0)  # (1, H, W, C)

    try:
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: blob})
    except Exception as error:
        emit_log("mesh_inference_failed", error=str(error))
        return None

    # Take the first ≥478×3 output (aux outputs like face-flag /
    # blendshapes ignored). Coords are in 256×256 crop space.
    landmarks_flat = None
    for output in outputs:
        flat = np.asarray(output, dtype=np.float64).reshape(-1)
        if flat.size >= 478 * 3:
            landmarks_flat = flat[: 478 * 3]
            break
    if landmarks_flat is None:
        emit_log("mesh_inference_unexpected_output_shape")
        return None

    landmarks = landmarks_flat.reshape(478, 3)

    crop_w = x1 - x0
    crop_h = y1 - y0
    scale_x = crop_w / float(MESH_INPUT_SIZE[0])
    scale_y = crop_h / float(MESH_INPUT_SIZE[1])

    image_landmarks = np.empty_like(landmarks)
    image_landmarks[:, 0] = landmarks[:, 0] * scale_x + x0
    image_landmarks[:, 1] = landmarks[:, 1] * scale_y + y0
    # z has no projective meaning; keep it dimensionally consistent
    # with x for the debug overlay.
    image_landmarks[:, 2] = landmarks[:, 2] * scale_x
    return image_landmarks


def head_pose_from_mesh(
    mesh: np.ndarray, frame_shape: tuple[int, int]
) -> Optional[tuple[float, float, float]]:
    """(pitch, yaw, roll) via solvePnP on the 12-pt identity-stable
    mesh subset. Yaw scale matches `head_pose_from_yunet`."""
    if mesh is None or mesh.ndim != 2 or mesh.shape[0] <= max(_MESH_PNP_INDICES):
        return None

    indices = np.asarray(_MESH_PNP_INDICES, dtype=np.int64)
    image_points = mesh[indices, :2].astype(np.float64).reshape(-1, 1, 2)
    object_points = _MESH_PNP_CANONICAL.reshape(-1, 1, 3)
    camera_matrix = _camera_matrix_for(frame_shape)
    distortion = np.zeros((4, 1), dtype=np.float64)

    try:
        success, rvec, _tvec = cv2.solvePnP(
            object_points,
            image_points,
            camera_matrix,
            distortion,
            flags=cv2.SOLVEPNP_EPNP,
        )
    except cv2.error as error:
        emit_log("mesh_head_pose_solvepnp_failed", error=str(error))
        return None

    if not success:
        return None

    try:
        rotation_matrix, _ = cv2.Rodrigues(rvec)
    except cv2.error as error:
        emit_log("mesh_head_pose_rodrigues_failed", error=str(error))
        return None

    return _rotation_matrix_to_euler_deg(rotation_matrix)


def classify_pose(yaw_deg: Optional[float]) -> str:
    """Pose from the SUBJECT's perspective: "left" = subject turned
    their own head to their left (nose shifted to image-right under
    un-mirrored front-camera capture)."""
    if yaw_deg is None:
        return "unknown"
    if abs(yaw_deg) <= LIVENESS_CENTER_YAW_DEG:
        return "center"
    if yaw_deg >= LIVENESS_TILT_YAW_DEG:
        return "left"
    if yaw_deg <= -LIVENESS_TILT_YAW_DEG:
        return "right"
    return "unknown"


def build_pose_timeline(
    detector: cv2.FaceDetectorYN,
    mesh_session,
    frames: list[np.ndarray],
) -> list[dict]:
    """Per-frame YuNet + (optional) mesh + head pose, in display order.
    Falls back to head_pose_from_yunet when the mesh model is absent
    or inference fails — yaw stays on the same scale."""
    timeline: list[dict] = []
    for index, frame in enumerate(frames):
        face = detect_face(detector, frame)
        if face is None:
            timeline.append(
                {
                    "frame_index": index,
                    "face_detected": False,
                    "pitch_deg": None,
                    "yaw_deg": None,
                    "roll_deg": None,
                    "pose": "unknown",
                    "face": None,
                    "mesh": None,
                }
            )
            continue
        mesh = extract_mesh(mesh_session, frame, face) if mesh_session else None
        head_pose: Optional[tuple[float, float, float]] = None
        if mesh is not None:
            head_pose = head_pose_from_mesh(mesh, frame.shape[:2])
        if head_pose is None:
            head_pose = head_pose_from_yunet(face, frame.shape[:2])
        if head_pose is None:
            pitch_deg, yaw_deg, roll_deg = None, None, None
        else:
            pitch_deg, yaw_deg, roll_deg = head_pose
        timeline.append(
            {
                "frame_index": index,
                "face_detected": True,
                "pitch_deg": pitch_deg,
                "yaw_deg": yaw_deg,
                "roll_deg": roll_deg,
                "pose": classify_pose(yaw_deg),
                "face": face,
                "mesh": mesh,
            }
        )
    return timeline


def validate_movement_coverage(
    timeline: list[dict],
) -> tuple[bool, Optional[str]]:
    """Pass if the clip contains a decisive turn in either direction.
    The earlier two-direction requirement fired too many false
    rejections from fixed-rate sampling missing brief peaks, and PAD
    already covers most anti-spoof concerns this gate aimed at."""
    left_run = 0
    right_run = 0
    saw_left = False
    saw_right = False

    for entry in timeline:
        pose = entry["pose"]
        if pose == "left":
            left_run += 1
            right_run = 0
            if left_run >= LIVENESS_MIN_POSE_FRAMES:
                saw_left = True
        elif pose == "right":
            right_run += 1
            left_run = 0
            if right_run >= LIVENESS_MIN_POSE_FRAMES:
                saw_right = True
        else:
            left_run = 0
            right_run = 0

    if not (saw_left or saw_right):
        return False, "liveness_no_head_movement"
    return True, None


def pick_center_frame_index(timeline: list[dict]) -> Optional[int]:
    """First "center" frame with a face; falls back to lowest |yaw|."""
    for entry in timeline:
        if entry["pose"] == "center" and entry["face_detected"]:
            return int(entry["frame_index"])

    best_index: Optional[int] = None
    best_yaw = float("inf")
    for entry in timeline:
        if not entry["face_detected"]:
            continue
        yaw = entry["yaw_deg"]
        if yaw is None:
            continue
        magnitude = abs(yaw)
        if magnitude < best_yaw:
            best_yaw = magnitude
            best_index = int(entry["frame_index"])
    return best_index


def crop_face_for_pad(
    image: np.ndarray, face: np.ndarray, scale: float
) -> Optional[np.ndarray]:
    """80×80 BGR crop centred on the YuNet bbox, sides scaled by
    `scale` and clipped to the image. Mirrors upstream
    `CropImage._get_new_box` — edge clipping shifts the centre inward
    rather than truncating."""
    src_h, src_w = image.shape[:2]
    x, y, box_w, box_h = (
        float(face[0]),
        float(face[1]),
        float(face[2]),
        float(face[3]),
    )

    if box_w <= 0 or box_h <= 0 or src_h <= 1 or src_w <= 1:
        return None

    # Cap the requested scale so the new box always fits inside the
    # source image.
    bounded_scale = min(
        (src_h - 1) / box_h,
        (src_w - 1) / box_w,
        scale,
    )
    if bounded_scale <= 0:
        return None

    new_width = box_w * bounded_scale
    new_height = box_h * bounded_scale
    center_x = box_w / 2.0 + x
    center_y = box_h / 2.0 + y

    left_top_x = center_x - new_width / 2.0
    left_top_y = center_y - new_height / 2.0
    right_bottom_x = center_x + new_width / 2.0
    right_bottom_y = center_y + new_height / 2.0

    if left_top_x < 0:
        right_bottom_x -= left_top_x
        left_top_x = 0
    if left_top_y < 0:
        right_bottom_y -= left_top_y
        left_top_y = 0
    if right_bottom_x > src_w - 1:
        left_top_x -= right_bottom_x - (src_w - 1)
        right_bottom_x = src_w - 1
    if right_bottom_y > src_h - 1:
        left_top_y -= right_bottom_y - (src_h - 1)
        right_bottom_y = src_h - 1

    x0, y0 = int(left_top_x), int(left_top_y)
    x1, y1 = int(right_bottom_x), int(right_bottom_y)
    if x1 <= x0 or y1 <= y0:
        return None

    crop = image[y0 : y1 + 1, x0 : x1 + 1]
    if crop.size == 0:
        return None

    return cv2.resize(crop, PAD_INPUT_SIZE)


def _pad_softmax_3class(logits: np.ndarray) -> Optional[np.ndarray]:
    """Stable softmax for the 3-class PAD logit vector. Returns None
    on wrong shape or degenerate denominator."""
    flat = np.asarray(logits, dtype=np.float64).reshape(-1)
    if flat.size != 3:
        return None
    shifted = flat - float(flat.max())
    exp = np.exp(shifted)
    denominator = float(exp.sum())
    if denominator <= 0.0 or not math.isfinite(denominator):
        return None
    return exp / denominator


def predict_pad_score(
    v2_session,
    v1se_session,
    image: np.ndarray,
    face: np.ndarray,
) -> Optional[float]:
    """Ensemble PAD: run both MiniFASNet sessions on per-scale crops,
    sum the two 3-class softmaxes, return real-class probability in
    [0, 1] (= summed[1] / 2). Matches Minivision's reference predictor.
    Returns None if either crop or inference fails — both signals
    are required.
    """
    v2_crop = crop_face_for_pad(image, face, PAD_V2_CROP_SCALE)
    v1se_crop = crop_face_for_pad(image, face, PAD_V1SE_CROP_SCALE)
    if v2_crop is None or v1se_crop is None:
        return None

    summed: Optional[np.ndarray] = None
    for session, crop in ((v2_session, v2_crop), (v1se_session, v1se_crop)):
        # scalefactor=1.0 (NOT /255): upstream's to_tensor at
        # src/data_io/functional.py has `.div(255)` commented out, so
        # the trained weights expect raw uint8-as-float inputs.
        # swapRB=False: upstream feeds BGR (cv2.imread + ToTensor with
        # no channel swap).
        try:
            blob = cv2.dnn.blobFromImage(
                crop,
                scalefactor=1.0,
                size=PAD_INPUT_SIZE,
                mean=(0.0, 0.0, 0.0),
                swapRB=False,
                crop=False,
            )
        except cv2.error as error:
            emit_log("pad_blob_failed", error=str(error))
            return None
        try:
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: blob})
        except Exception as error:
            emit_log("pad_inference_failed", error=str(error))
            return None
        if not outputs:
            return None
        probs = _pad_softmax_3class(outputs[0])
        if probs is None:
            return None
        summed = probs if summed is None else summed + probs

    if summed is None:
        return None
    return clamp_score(float(summed[1] / 2.0))


def run_pad_over_timeline(
    v2_session,
    v1se_session,
    detector: cv2.FaceDetectorYN,
    frames: list[np.ndarray],
    timeline: list[dict],
) -> dict:
    """Aggregate per-frame PAD real-class probabilities into a
    clip-level verdict."""
    per_frame_scores: list[Optional[float]] = []
    pass_count = 0
    score_sum = 0.0
    scored_count = 0

    for entry in timeline:
        if not entry["face_detected"]:
            per_frame_scores.append(None)
            continue
        frame = frames[int(entry["frame_index"])]
        face = detect_face(detector, frame)
        if face is None:
            per_frame_scores.append(None)
            continue
        score = predict_pad_score(v2_session, v1se_session, frame, face)
        per_frame_scores.append(score)
        if score is None:
            continue
        scored_count += 1
        score_sum += score
        if score >= PAD_FRAME_THRESHOLD:
            pass_count += 1

    if scored_count == 0:
        return {
            "padPassed": False,
            "padScore": None,
            "padScoredFrames": 0,
            "padPassingFrames": 0,
            "padFrameScores": per_frame_scores,
            "padReason": "liveness_pad_no_scored_frames",
        }

    mean_score = score_sum / scored_count
    pass_fraction = pass_count / scored_count
    passed = pass_fraction >= PAD_PASS_FRACTION

    return {
        "padPassed": passed,
        "padScore": clamp_score(mean_score),
        "padScoredFrames": scored_count,
        "padPassingFrames": pass_count,
        "padFrameScores": per_frame_scores,
        "padReason": None if passed else "liveness_spoof_suspected",
    }


def _new_debug_payload(pad_loaded: bool, mesh_loaded: bool) -> dict:
    return {
        "frameCount": 0,
        "durationSeconds": None,
        "frameWidth": 0,
        "frameHeight": 0,
        "centerFrameIndex": None,
        "timeline": [],
        "padFrameThreshold": PAD_FRAME_THRESHOLD,
        "padPassFraction": PAD_PASS_FRACTION,
        "padScoredFrames": 0,
        "padPassingFrames": 0,
        "padDisabled": PAD_DISABLED,
        "padLoaded": pad_loaded,
        "meshDisabled": MESH_DISABLED,
        "meshLoaded": mesh_loaded,
        "dg2Mesh": None,
    }


def _face_to_debug_geometry(face) -> tuple[dict, dict]:
    """JSON-friendly bbox + landmarks dicts from a YuNet detection."""
    bbox = {
        "x": float(face[0]),
        "y": float(face[1]),
        "w": float(face[2]),
        "h": float(face[3]),
        "confidence": float(face[14]),
    }
    landmarks = {
        "rightEye": [float(face[4]), float(face[5])],
        "leftEye": [float(face[6]), float(face[7])],
        "nose": [float(face[8]), float(face[9])],
        "rightMouth": [float(face[10]), float(face[11])],
        "leftMouth": [float(face[12]), float(face[13])],
    }
    return bbox, landmarks


def _timeline_to_debug_entries(timeline: list[dict]) -> list[dict]:
    entries: list[dict] = []
    for entry in timeline:
        debug_entry: dict = {
            "frameIndex": int(entry["frame_index"]),
            "faceDetected": bool(entry["face_detected"]),
            "pitchDeg": entry.get("pitch_deg"),
            "yawDeg": entry["yaw_deg"],
            "rollDeg": entry.get("roll_deg"),
            "pose": entry["pose"],
            "padScore": None,
            "bbox": None,
            "landmarks": None,
            "mesh": None,
        }
        face = entry.get("face")
        if face is not None:
            bbox, landmarks = _face_to_debug_geometry(face)
            debug_entry["bbox"] = bbox
            debug_entry["landmarks"] = landmarks
        mesh = entry.get("mesh")
        if mesh is not None:
            # Subset only — the full 478×3 mesh would balloon the
            # debug payload to ~500 KB per request.
            subset = stable_subset(mesh)
            if subset is not None:
                debug_entry["mesh"] = {
                    "subsetPoints": subset.tolist(),
                    "subsetIndices": list(IDENTITY_STABLE_INDICES),
                }
        entries.append(debug_entry)
    return entries


def verify_liveness_payload(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    pad_v2_session,
    pad_v1se_session,
    mesh_session,
    payload: dict,
) -> dict:
    threshold = float(
        payload.get("faceMatchThreshold") or DEFAULT_THRESHOLD
    )
    # Server-side kill switch — `includeDebug` is honoured only in
    # development mode; production responses never carry the debug
    # block.
    include_debug = DEBUG_RESPONSES_ALLOWED and bool(payload.get("includeDebug"))
    pad_loaded = pad_v2_session is not None and pad_v1se_session is not None
    debug = (
        _new_debug_payload(pad_loaded, mesh_session is not None)
        if include_debug
        else None
    )

    video_b64 = payload.get("videoBase64")
    if not isinstance(video_b64, str) or len(video_b64) == 0:
        return liveness_failure_response(
            "liveness_video_missing",
            threshold=threshold,
            debug=debug,
        )

    try:
        video_bytes = base64.b64decode(video_b64)
    except Exception:
        return liveness_failure_response(
            "liveness_video_decode_failed",
            threshold=threshold,
            debug=debug,
        )

    if len(video_bytes) == 0:
        return liveness_failure_response(
            "liveness_video_empty",
            threshold=threshold,
            debug=debug,
        )

    frames, duration_seconds = extract_frames_with_ffmpeg(
        video_bytes, LIVENESS_FRAME_COUNT
    )
    if debug is not None:
        debug["frameCount"] = len(frames)
        debug["durationSeconds"] = duration_seconds
        if len(frames) > 0:
            first_height, first_width = frames[0].shape[:2]
            debug["frameWidth"] = int(first_width)
            debug["frameHeight"] = int(first_height)
    if len(frames) == 0:
        return liveness_failure_response(
            "liveness_video_unreadable",
            threshold=threshold,
            debug=debug,
        )

    # Need two pose extremes plus at least one centred frame.
    if len(frames) < max(LIVENESS_MIN_POSE_FRAMES * 2 + 1, 3):
        return liveness_failure_response(
            "liveness_video_too_short",
            threshold=threshold,
            debug=debug,
        )

    timeline = build_pose_timeline(detector, mesh_session, frames)
    if debug is not None:
        debug["timeline"] = _timeline_to_debug_entries(timeline)
    detected_count = sum(1 for entry in timeline if entry["face_detected"])
    if detected_count == 0:
        return liveness_failure_response(
            "liveness_no_face",
            threshold=threshold,
            debug=debug,
        )

    coverage_ok, coverage_reason = validate_movement_coverage(timeline)
    liveness_score = clamp_score(detected_count / max(len(timeline), 1))

    if not coverage_ok:
        emit_log(
            "liveness_coverage_failed",
            reason=coverage_reason,
            timeline=[
                {
                    "frame_index": entry["frame_index"],
                    "pose": entry["pose"],
                    "yaw_deg": entry["yaw_deg"],
                    "face_detected": entry["face_detected"],
                }
                for entry in timeline
            ],
        )
        response = {
            "livenessPassed": False,
            "livenessScore": liveness_score,
            "faceMatchPassed": False,
            "faceMatchScore": None,
            "faceMatchAlignment": None,
            "padPassed": False,
            "padScore": None,
            "usedFallback": False,
            "reason": coverage_reason or "liveness_pose_coverage_failed",
        }
        if debug is not None:
            response["debug"] = debug
        return response

    # PAD runs after movement coverage to avoid wasted inference on
    # clips that would fail anyway. When either model isn't loaded,
    # padPassed defaults to True (the gate never runs single-model;
    # published accuracy assumes both signals).
    if pad_loaded:
        pad_result = run_pad_over_timeline(
            pad_v2_session, pad_v1se_session, detector, frames, timeline
        )
        emit_log(
            "liveness_pad_evaluated",
            pad_passed=pad_result["padPassed"],
            pad_score=pad_result["padScore"],
            pad_scored_frames=pad_result["padScoredFrames"],
            pad_passing_frames=pad_result["padPassingFrames"],
            pad_frame_scores=pad_result["padFrameScores"],
            pad_frame_threshold=PAD_FRAME_THRESHOLD,
            pad_pass_fraction=PAD_PASS_FRACTION,
            pad_reason=pad_result["padReason"],
        )
        if debug is not None:
            debug["padScoredFrames"] = pad_result["padScoredFrames"]
            debug["padPassingFrames"] = pad_result["padPassingFrames"]
            per_frame_scores = pad_result["padFrameScores"]
            for index, score in enumerate(per_frame_scores):
                if index < len(debug["timeline"]):
                    debug["timeline"][index]["padScore"] = score
        if not pad_result["padPassed"]:
            response = {
                "livenessPassed": False,
                "livenessScore": liveness_score,
                "faceMatchPassed": False,
                "faceMatchScore": None,
                "faceMatchAlignment": None,
                "padPassed": False,
                "padScore": pad_result["padScore"],
                "usedFallback": False,
                "reason": pad_result["padReason"] or "liveness_spoof_suspected",
            }
            if debug is not None:
                response["debug"] = debug
            return response
        pad_passed_for_response = True
        pad_score_for_response = pad_result["padScore"]
    else:
        pad_passed_for_response = True
        pad_score_for_response = None

    center_index = pick_center_frame_index(timeline)
    if debug is not None:
        debug["centerFrameIndex"] = center_index
    if center_index is None:
        return liveness_failure_response(
            "liveness_no_center_frame",
            threshold=threshold,
            liveness_score=liveness_score,
            debug=debug,
        )

    skip_face_match = ALLOW_FACE_MATCH_SKIP and bool(payload.get("skipFaceMatch"))
    if skip_face_match:
        response = {
            "livenessPassed": True,
            "livenessScore": liveness_score,
            "faceMatchPassed": False,
            "faceMatchScore": None,
            "faceMatchAlignment": None,
            "padPassed": pad_passed_for_response,
            "padScore": pad_score_for_response,
            "usedFallback": False,
            "reason": "face_match_skipped",
        }
        if debug is not None:
            response["debug"] = debug
        return response

    try:
        dg2_image = decode_dg2_image(payload["dg2Image"])
    except (KeyError, ValueError) as error:
        emit_log("liveness_dg2_decode_failed", error=str(error))
        return liveness_failure_response(
            "liveness_dg2_decode_failed",
            threshold=threshold,
            liveness_score=liveness_score,
            debug=debug,
        )

    # Compute the DG2 mesh once so it can be shared by the
    # mesh-aligned AuraFace path; center_mesh comes off the timeline.
    dg2_mesh: Optional[np.ndarray] = None
    center_mesh: Optional[np.ndarray] = timeline[center_index].get("mesh")
    if mesh_session is not None:
        dg2_face = detect_face(detector, dg2_image)
        if dg2_face is not None:
            dg2_mesh = extract_mesh(mesh_session, dg2_image, dg2_face)

    face_match = match_centered_frame(
        detector,
        recognizer,
        dg2_image,
        dg2_mesh,
        frames[center_index],
        center_mesh,
        threshold,
    )

    if debug is not None:
        debug["dg2Mesh"] = (
            {
                "subsetPoints": stable_subset(dg2_mesh).tolist(),
                "subsetIndices": list(IDENTITY_STABLE_INDICES),
            }
            if dg2_mesh is not None and stable_subset(dg2_mesh) is not None
            else None
        )

    response = {
        "livenessPassed": True,
        "livenessScore": liveness_score,
        "faceMatchPassed": bool(face_match["faceMatchPassed"]),
        "faceMatchScore": face_match["faceMatchScore"],
        "faceMatchAlignment": face_match.get("faceMatchAlignment"),
        "padPassed": pad_passed_for_response,
        "padScore": pad_score_for_response,
        "usedFallback": bool(face_match["usedFallback"]),
        "reason": face_match["reason"],
    }
    if debug is not None:
        response["debug"] = debug
    return response


def decode_image_payload(image_payload: dict, label: str) -> np.ndarray:
    """Decode `{ bytesBase64: str }` to BGR ndarray. Raises ValueError
    on any decode failure. Kept separate from `decode_dg2_image` so
    each side keeps its own error codes."""
    if not isinstance(image_payload, dict):
        raise ValueError(
            f"{label}_payload_invalid:not_a_dict:{type(image_payload).__name__}"
        )
    bytes_base64 = image_payload.get("bytesBase64")
    if not isinstance(bytes_base64, str):
        raise ValueError(
            f"{label}_payload_missing_bytes:keys={list(image_payload.keys())}"
        )
    encoded = base64.b64decode(bytes_base64)
    buffer = np.frombuffer(encoded, dtype=np.uint8)
    decoded = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError(f"{label}_decode_failed:byte_count={len(encoded)}")
    return decoded


def _image_to_debug_face(
    detector: cv2.FaceDetectorYN,
    mesh_session,
    image: np.ndarray,
) -> tuple[dict, Optional[np.ndarray]]:
    """Returns (debug-friendly bbox+landmarks+head-pose dict, full mesh
    or None). The caller can pair the full mesh against another image's
    without re-running inference."""
    height, width = image.shape[:2]
    face = detect_face(detector, image)
    entry: dict = {
        "imageWidth": int(width),
        "imageHeight": int(height),
        "faceDetected": face is not None,
        "bbox": None,
        "landmarks": None,
        "pitchDeg": None,
        "yawDeg": None,
        "rollDeg": None,
    }
    if face is None:
        return entry, None

    bbox, landmarks = _face_to_debug_geometry(face)
    entry["bbox"] = bbox
    entry["landmarks"] = landmarks

    mesh = extract_mesh(mesh_session, image, face) if mesh_session else None

    head_pose: Optional[tuple[float, float, float]] = None
    if mesh is not None:
        head_pose = head_pose_from_mesh(mesh, image.shape[:2])
    if head_pose is None:
        head_pose = head_pose_from_yunet(face, image.shape[:2])
    if head_pose is not None:
        pitch_deg, yaw_deg, roll_deg = head_pose
        entry["pitchDeg"] = pitch_deg
        entry["yawDeg"] = yaw_deg
        entry["rollDeg"] = roll_deg

    return entry, mesh


# Per-request selfie parallelism on top of ThreadingHTTPServer's
# cross-request fan-out. Default 2: onnxruntime already uses
# ~cpu_count threads internally, so more Python workers just add
# context-switching overhead. Tune up only if ORT threads are also
# constrained.
_FACE_MATCH_PARALLEL_WORKERS = max(
    1,
    int(os.environ.get("BIOMETRIC_VERIFIER_FACE_MATCH_PARALLEL_WORKERS", "2")),
)


def _process_face_match_selfie(
    index: int,
    selfie_payload: object,
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    mesh_session,
    dg2_image: np.ndarray,
    dg2_embeddings: dict,
    threshold: float,
) -> dict:
    """One selfie's pipeline, suitable for ThreadPoolExecutor dispatch.
    Failures return a decode-failed entry so one bad selfie can't
    cancel its siblings. Thread safety: detector is serialized by
    `_DETECTOR_LOCK`, onnxruntime sessions are documented thread-safe,
    cv2 ops are pure.
    """
    try:
        selfie_image = decode_image_payload(selfie_payload, "selfie")
    except ValueError as error:
        emit_log(
            "face_match_selfie_decode_failed",
            index=index,
            error=str(error),
        )
        return {
            "index": index,
            "imageWidth": 0,
            "imageHeight": 0,
            "faceDetected": False,
            "bbox": None,
            "landmarks": None,
            "pitchDeg": None,
            "yawDeg": None,
            "rollDeg": None,
            "faceMatchScore": None,
            "faceMatchPassed": False,
            "faceMatchAlignment": None,
            "usedFallback": False,
            "reason": "selfie_decode_failed",
        }

    selfie_debug, selfie_mesh = _image_to_debug_face(
        detector, mesh_session, selfie_image
    )
    selfie_embeddings = compute_face_match_embeddings(
        detector,
        recognizer,
        selfie_image,
        selfie_mesh,
        prefer_alignment="mesh",
    )
    match = match_face_embeddings(
        dg2_embeddings,
        dg2_image,
        selfie_embeddings,
        selfie_image,
        threshold,
    )

    selfie_entry: dict = {
        "index": index,
        **selfie_debug,
        "faceMatchScore": match["faceMatchScore"],
        "faceMatchPassed": bool(match["faceMatchPassed"]),
        # `faceMatchAlignment` reports which alignment produced the
        # score — "mesh" when both sides had a 478-pt mesh-aligned
        # AuraFace embedding (preferred), "yunet" when either side fell
        # back to the YuNet-5pt alignment, None when no face match was
        # produced.
        "faceMatchAlignment": match.get("faceMatchAlignment"),
        "usedFallback": bool(match["usedFallback"]),
        "reason": match["reason"],
    }
    if selfie_mesh is not None:
        subset = stable_subset(selfie_mesh)
        if subset is not None:
            selfie_entry["mesh"] = {
                "subsetPoints": subset.tolist(),
                "subsetIndices": list(IDENTITY_STABLE_INDICES),
            }
    return selfie_entry


def verify_face_match_payload(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    mesh_session,
    payload: dict,
) -> dict:
    """Face-match-only endpoint: DG2 + N selfies → per-selfie scores
    + bbox / landmarks. Bypasses ffmpeg, PAD, and movement coverage.
    Selfies are processed in parallel; DG2 embeddings are computed
    once and reused."""
    threshold = float(payload.get("faceMatchThreshold") or DEFAULT_THRESHOLD)

    dg2_payload = payload.get("dg2Image")
    if not isinstance(dg2_payload, dict):
        return {
            "error": {
                "code": "INVALID_REQUEST",
                "message": "Face match payload missing dg2Image object.",
            }
        }

    try:
        dg2_image = decode_dg2_image(dg2_payload)
    except (KeyError, ValueError) as error:
        emit_log("face_match_dg2_decode_failed", error=str(error))
        return {
            "error": {
                "code": "DG2_DECODE_FAILED",
                "message": str(error),
            }
        }

    dg2_debug, dg2_mesh = _image_to_debug_face(detector, mesh_session, dg2_image)
    dg2_response = {
        **dg2_debug,
        "imageBytesBase64": dg2_payload.get("bytesBase64"),
        "imageFormat": dg2_payload.get("format"),
    }
    if dg2_mesh is not None:
        subset = stable_subset(dg2_mesh)
        if subset is not None:
            dg2_response["mesh"] = {
                "subsetPoints": subset.tolist(),
                "subsetIndices": list(IDENTITY_STABLE_INDICES),
            }

    selfies_input = payload.get("selfies") or []
    if not isinstance(selfies_input, list):
        return {
            "error": {
                "code": "INVALID_REQUEST",
                "message": "Face match payload `selfies` must be a list.",
            }
        }

    # DG2 embeddings computed once and reused across selfies — without
    # this, redundant DG2 inference would dominate per-selfie cost.
    dg2_embeddings = compute_face_match_embeddings(
        detector,
        recognizer,
        dg2_image,
        dg2_mesh,
        allow_full_image_fallback=True,
    )

    selfie_count = len(selfies_input)
    if selfie_count == 0:
        selfies_response: list[dict] = []
    else:
        worker_count = max(1, min(selfie_count, _FACE_MATCH_PARALLEL_WORKERS))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            selfies_response = list(
                executor.map(
                    lambda item: _process_face_match_selfie(
                        item[0],
                        item[1],
                        detector,
                        recognizer,
                        mesh_session,
                        dg2_image,
                        dg2_embeddings,
                        threshold,
                    ),
                    enumerate(selfies_input),
                )
            )

    return {
        "threshold": threshold,
        "dg2": dg2_response,
        "selfies": selfies_response,
    }


def liveness_failure_response(
    reason: str,
    *,
    threshold: float,
    liveness_score: Optional[float] = None,
    debug: Optional[dict] = None,
) -> dict:
    _ = threshold  # reserved for future telemetry
    response: dict = {
        "livenessPassed": False,
        "livenessScore": liveness_score,
        "faceMatchPassed": False,
        "faceMatchScore": None,
        "faceMatchAlignment": None,
        "padPassed": False,
        "padScore": None,
        "usedFallback": False,
        "reason": reason,
    }
    if debug is not None:
        response["debug"] = debug
    return response


class BiometricVerifierRuntime:
    def __init__(self, detector_model_path: str, model_path: str):
        self.detector_model_path = detector_model_path
        self.model_path = model_path
        self.pad_v2_model_path = PAD_V2_MODEL_PATH
        self.pad_v1se_model_path = PAD_V1SE_MODEL_PATH
        self.mesh_model_path = MESH_MODEL_PATH
        self.error: Optional[str] = None
        self.detector: Optional[cv2.FaceDetectorYN] = None
        self.recognizer: Optional[AuraFaceRecognizer] = None
        self.recognizer_load_error: Optional[str] = None
        self.pad_v2_session = None
        self.pad_v1se_session = None
        self.pad_load_error: Optional[str] = None
        self.mesh_session = None  # onnxruntime.InferenceSession when loaded
        self.mesh_load_error: Optional[str] = None
        self._load()

    def _load(self) -> None:
        try:
            self.detector = cv2.FaceDetectorYN.create(
                self.detector_model_path,
                "",
                DEFAULT_DETECTOR_INPUT_SIZE,
                0.85,
                0.3,
                5000,
            )
            self._load_recognizer_model()
            ffmpeg_available = shutil.which(LIVENESS_FFMPEG_BIN) is not None
            if not ffmpeg_available:
                self.error = "ffmpeg_binary_missing"
            self._load_pad_model()
            self._load_mesh_model()
            emit_log(
                "container_ready",
                detector_model_path=self.detector_model_path,
                model_path=self.model_path,
                recognizer_loaded=self.recognizer is not None,
                recognizer_load_error=self.recognizer_load_error,
                pad_v2_model_path=self.pad_v2_model_path,
                pad_v1se_model_path=self.pad_v1se_model_path,
                pad_disabled=PAD_DISABLED,
                pad_loaded=self.pad_loaded,
                pad_load_error=self.pad_load_error,
                mesh_model_path=self.mesh_model_path,
                mesh_disabled=MESH_DISABLED,
                mesh_loaded=self.mesh_session is not None,
                mesh_load_error=self.mesh_load_error,
                ffmpeg_available=ffmpeg_available,
                is_dev=IS_DEV,
            )
        except Exception as error:
            self.error = str(error)
            emit_log(
                "container_failed",
                detector_model_path=self.detector_model_path,
                model_path=self.model_path,
                error=self.error,
            )

    def _load_recognizer_model(self) -> None:
        # AuraFace file is always present (pinned in download-models.sh).
        # Failure here is a configuration bug; leave `recognizer = None`
        # so `ready` flips false and the runtime returns "unavailable".
        if ort is None:
            self.recognizer_load_error = "onnxruntime_import_failed"
            return
        if not os.path.isfile(self.model_path):
            self.recognizer_load_error = "recognizer_model_missing"
            return
        try:
            session = ort.InferenceSession(
                self.model_path,
                providers=["CPUExecutionProvider"],
            )
        except Exception as error:
            self.recognizer_load_error = f"recognizer_model_load_failed:{error}"
            return
        self.recognizer = AuraFaceRecognizer(session)

    def _load_pad_model(self) -> None:
        # Both ONNX files must load — falling back to single-model
        # inference would silently degrade accuracy. If either side
        # fails, leave both sessions None and the gate becomes a no-op.
        if PAD_DISABLED:
            self.pad_load_error = "pad_disabled"
            return
        if ort is None:
            self.pad_load_error = "onnxruntime_import_failed"
            return
        for label, path, attr in (
            ("v2", self.pad_v2_model_path, "pad_v2_session"),
            ("v1se", self.pad_v1se_model_path, "pad_v1se_session"),
        ):
            if not os.path.isfile(path):
                self.pad_load_error = f"pad_{label}_model_missing"
                self.pad_v2_session = None
                self.pad_v1se_session = None
                return
            try:
                session = ort.InferenceSession(
                    path, providers=["CPUExecutionProvider"]
                )
            except Exception as error:
                self.pad_load_error = f"pad_{label}_model_load_failed:{error}"
                self.pad_v2_session = None
                self.pad_v1se_session = None
                return
            setattr(self, attr, session)

    @property
    def pad_loaded(self) -> bool:
        return (
            self.pad_v2_session is not None
            and self.pad_v1se_session is not None
        )

    def _load_mesh_model(self) -> None:
        # Eager load: the Durable Object's 10-min sleepAfter means
        # cold containers re-pay this anyway, and deferring to first
        # request would push 200-400ms onnxruntime init into a
        # user-visible latency budget. Graceful degrade on failure —
        # head pose falls back to YuNet's 5-pt PnP.
        if MESH_DISABLED:
            self.mesh_load_error = "mesh_disabled"
            return
        if ort is None:
            self.mesh_load_error = "onnxruntime_import_failed"
            return
        if not os.path.isfile(self.mesh_model_path):
            self.mesh_load_error = "mesh_model_missing"
            return
        try:
            self.mesh_session = ort.InferenceSession(
                self.mesh_model_path,
                providers=["CPUExecutionProvider"],
            )
        except Exception as error:
            self.mesh_load_error = f"mesh_model_load_failed:{error}"
            self.mesh_session = None

    @property
    def ready(self) -> bool:
        return (
            self.error is None
            and self.detector is not None
            and self.recognizer is not None
        )

    def health_payload(self) -> dict:
        return {
            "data": {
                "detectorModelPath": self.detector_model_path,
                "modelPath": self.model_path,
                "recognizerLoaded": self.recognizer is not None,
                "padDisabled": PAD_DISABLED,
                "padLoaded": self.pad_loaded,
                "meshDisabled": MESH_DISABLED,
                "meshLoaded": self.mesh_session is not None,
                "isDev": IS_DEV,
                "ready": self.ready,
                "status": "healthy" if self.ready else "unhealthy",
            },
            "error": None
            if self.ready
            else {
                "code": "BIOMETRIC_VERIFIER_UNAVAILABLE",
                "message": self.error
                or "Biometric verifier runtime is unavailable.",
            },
        }

    def verify_liveness(self, payload: dict) -> dict:
        if not self.ready or self.detector is None or self.recognizer is None:
            reason_suffix = self.error or "unknown"
            return {
                "livenessPassed": False,
                "livenessScore": None,
                "faceMatchPassed": False,
                "faceMatchScore": None,
                "faceMatchAlignment": None,
                "padPassed": False,
                "padScore": None,
                "usedFallback": True,
                "reason": f"biometric_verifier_unavailable:runtime_not_ready:{reason_suffix}",
            }

        return verify_liveness_payload(
            self.detector,
            self.recognizer,
            self.pad_v2_session,
            self.pad_v1se_session,
            self.mesh_session,
            payload,
        )

    def verify_face_match(self, payload: dict) -> dict:
        if not self.ready or self.detector is None or self.recognizer is None:
            reason_suffix = self.error or "unknown"
            return {
                "error": {
                    "code": "BIOMETRIC_VERIFIER_UNAVAILABLE",
                    "message": f"runtime_not_ready:{reason_suffix}",
                }
            }
        return verify_face_match_payload(
            self.detector, self.recognizer, self.mesh_session, payload
        )


RUNTIME = BiometricVerifierRuntime(DETECTOR_MODEL_PATH, MODEL_PATH)


class BiometricVerifierHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:
        return

    def respond(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.respond(
                HTTPStatus.NOT_FOUND,
                {"error": {"code": "NOT_FOUND", "message": "Route not found."}},
            )
            return

        payload = RUNTIME.health_payload()
        status = (
            HTTPStatus.OK
            if payload["data"]["ready"]
            else HTTPStatus.SERVICE_UNAVAILABLE
        )
        self.respond(status, payload)

    def do_POST(self) -> None:
        if self.path == "/verify_liveness":
            self._handle_verify_liveness()
            return
        if self.path == "/verify_face_match":
            self._handle_verify_face_match()
            return
        self.respond(
            HTTPStatus.NOT_FOUND,
            {"error": {"code": "NOT_FOUND", "message": "Route not found."}},
        )

    def _read_json_body(self) -> Optional[dict]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)
        try:
            return json.loads(raw_body.decode("utf-8"))
        except Exception:
            self.respond(
                HTTPStatus.BAD_REQUEST,
                {
                    "error": {
                        "code": "INVALID_REQUEST",
                        "message": "Biometric verifier payload must be valid JSON.",
                    }
                },
            )
            return None

    def _handle_verify_liveness(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return

        try:
            result = RUNTIME.verify_liveness(payload)
            threshold = float(
                payload.get("faceMatchThreshold") or DEFAULT_THRESHOLD
            )
            emit_log(
                "container_liveness_completed",
                dg2_byte_count=len(
                    base64.b64decode(
                        payload.get("dg2Image", {}).get("bytesBase64", "")
                    )
                ),
                threshold=threshold,
                face_match_passed=result.get("faceMatchPassed"),
                face_match_score=result.get("faceMatchScore"),
                face_match_alignment=result.get("faceMatchAlignment"),
                liveness_passed=result.get("livenessPassed"),
                liveness_score=result.get("livenessScore"),
                pad_passed=result.get("padPassed"),
                pad_score=result.get("padScore"),
                reason=result.get("reason"),
                used_fallback=result.get("usedFallback"),
            )
            self.respond(HTTPStatus.OK, result)
        except Exception as error:
            payload_keys = list(payload.keys()) if isinstance(payload, dict) else None
            emit_log(
                "container_liveness_failed",
                error=str(error),
                error_type=type(error).__name__,
                traceback=traceback.format_exc(),
                payload_keys=payload_keys,
            )
            self.respond(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "livenessPassed": False,
                    "livenessScore": None,
                    "faceMatchPassed": False,
                    "faceMatchScore": None,
                    "faceMatchAlignment": None,
                    "padPassed": False,
                    "padScore": None,
                    "usedFallback": True,
                    "reason": "biometric_verifier_unavailable:container_runtime_failed",
                },
            )

    def _handle_verify_face_match(self) -> None:
        payload = self._read_json_body()
        if payload is None:
            return
        try:
            result = RUNTIME.verify_face_match(payload)
            selfies = result.get("selfies") if isinstance(result, dict) else None
            emit_log(
                "container_face_match_completed",
                dg2_byte_count=len(
                    base64.b64decode(
                        payload.get("dg2Image", {}).get("bytesBase64", "")
                    )
                ),
                selfie_count=len(selfies) if isinstance(selfies, list) else 0,
                threshold=result.get("threshold")
                if isinstance(result, dict)
                else None,
                error_code=(
                    result["error"]["code"]
                    if isinstance(result, dict)
                    and isinstance(result.get("error"), dict)
                    else None
                ),
            )
            if isinstance(result, dict) and isinstance(result.get("error"), dict):
                self.respond(HTTPStatus.BAD_REQUEST, result)
                return
            self.respond(HTTPStatus.OK, result)
        except Exception as error:
            payload_keys = list(payload.keys()) if isinstance(payload, dict) else None
            emit_log(
                "container_face_match_failed",
                error=str(error),
                error_type=type(error).__name__,
                traceback=traceback.format_exc(),
                payload_keys=payload_keys,
            )
            self.respond(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "error": {
                        "code": "BIOMETRIC_VERIFIER_UNAVAILABLE",
                        "message": "container_runtime_failed",
                    }
                },
            )


def main() -> int:
    server = ThreadingHTTPServer(
        ("0.0.0.0", PORT), BiometricVerifierHandler
    )
    emit_log(
        "container_listening",
        detector_model_path=DETECTOR_MODEL_PATH,
        model_path=MODEL_PATH,
        pad_v2_model_path=PAD_V2_MODEL_PATH,
        pad_v1se_model_path=PAD_V1SE_MODEL_PATH,
        pad_disabled=PAD_DISABLED,
        port=PORT,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
