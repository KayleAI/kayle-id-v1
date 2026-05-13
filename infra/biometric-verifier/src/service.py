import base64
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
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

# onnxruntime is imported lazily so a broken install doesn't prevent the
# container from coming up; mesh inference simply degrades to "absent".
try:
    import onnxruntime as ort
except Exception:  # pragma: no cover - import guard
    ort = None  # type: ignore[assignment]


MODEL_INPUT_SIZE = (112, 112)
DETAIL_STDDEV_MIN = 12.0
STRICT_IMAGE_SIMILARITY_THRESHOLD = 0.995
# AuraFace cosines are reported on the normalized [0, 1] scale via
# `normalize_cosine_score(raw) = (raw + 1) / 2`, so a threshold of
# 0.7 corresponds to raw cosine 0.4 — the canonical "same person"
# threshold InsightFace publishes for glint360k-trained ArcFace
# R100 models (which AuraFace is). Same-identity pairs with real
# ageing / lighting variation typically land in raw 0.3-0.6
# (normalized 0.65-0.80); cross-identity pairs cluster well below
# raw 0.2 (normalized 0.6). A 0.8 normalized threshold (= raw 0.6)
# was the SFace-era default and is too strict for ArcFace-family
# scores — it false-rejected most legitimate same-person pairs with
# >1y age gap. Re-tune from real-traffic telemetry once enough
# labelled pairs accumulate; for now 0.7 is the IDV-grade starting
# point that matches published ArcFace conventions.
DEFAULT_THRESHOLD = 0.7
DEFAULT_DETECTOR_INPUT_SIZE = (320, 320)
# AuraFace (fal/AuraFace-v1, ResNet100 ArcFace) — Apache 2.0,
# trained on commercially-usable data. Replaces the SFace recognizer
# that previously lived at this path. The model is loaded via
# onnxruntime (the same runtime that drives the mesh model) rather
# than cv2.FaceRecognizerSF; we re-implement alignCrop + feature +
# match ourselves in `AuraFaceRecognizer` against the same ArcFace
# canonical 112×112 template.
MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_MODEL_PATH",
    "/app/models/auraface_glintr100.onnx",
)
DETECTOR_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_DETECTOR_PATH",
    "/app/models/face_detection_yunet_2023mar.onnx",
)
PORT = int(os.environ.get("PORT", "8080"))

# Single dev-mode switch derived from NODE_ENV (forwarded by the worker).
# Fails secure: anything other than "development" — including the env
# var being absent entirely — is treated as production.
IS_DEV = os.environ.get("NODE_ENV", "production") == "development"

# Dev-only escape hatches that used to be three separate env flags. Now
# every one of them piggybacks on IS_DEV so there's exactly one switch
# governing all loosened-in-development behaviour. The wrangler-config
# guardrail test asserts production never sets NODE_ENV=development, so
# this collapsing keeps the same security posture.
#
# - ALLOW_PIXEL_FALLBACK gates the raw pixel-correlation fallback in
#   face matching, used by the verify integration tests against
#   synthetic fixtures that fail face detection.
# - ALLOW_FACE_MATCH_SKIP gates the request-level `skipFaceMatch` flag
#   the contributor debug UI uses to exercise the liveness pipeline
#   without a passport.
# - DEBUG_RESPONSES_ALLOWED gates whether request-side `includeDebug`
#   actually populates the rich `debug` block on responses; production
#   responses NEVER carry it even if a caller asks.
ALLOW_PIXEL_FALLBACK = IS_DEV
ALLOW_FACE_MATCH_SKIP = IS_DEV
DEBUG_RESPONSES_ALLOWED = IS_DEV

# Liveness tunables. Tweak via env vars on first deploy after we have real
# fixtures; the defaults are a starting point chosen for an un-mirrored
# front-camera capture.
#
# Frame count: bumped from 10 → 24 after we observed brief peak turns
# (~150-250ms above tilt threshold) falling between samples on short
# clips. 24 samples ≈ one every ~60-100ms at typical clip length so we
# catch peaks reliably, at ~2.4× the per-frame inference cost.
LIVENESS_FRAME_COUNT = int(
    os.environ.get("BIOMETRIC_VERIFIER_FRAME_COUNT", "24")
)
LIVENESS_CENTER_YAW_DEG = float(
    os.environ.get("BIOMETRIC_VERIFIER_CENTER_YAW_DEG", "15")
)
# Tilt threshold: 20° → 17° after switching from the geometric yaw
# estimator to cv2.solvePnP. PnP yaw runs slightly smaller-numbered for
# the same physical head rotation than the old geometric ratio, so the
# threshold needs to come down to keep the same "real-world degrees"
# trigger. iOS still targets 22° for its progress UI which leaves a
# comfortable safety margin on top of this.
LIVENESS_TILT_YAW_DEG = float(
    os.environ.get("BIOMETRIC_VERIFIER_TILT_YAW_DEG", "17")
)
# Each pose must occupy at least this many consecutive sampled frames before
# we treat it as a real pose. Sampled at 10 frames evenly across the clip,
# so 1 frame ≈ 1/10 of the clip duration; ~150 ms at 1.5 s clip.
LIVENESS_MIN_POSE_FRAMES = int(
    os.environ.get("BIOMETRIC_VERIFIER_MIN_POSE_FRAMES", "1")
)
LIVENESS_FFMPEG_BIN = os.environ.get("BIOMETRIC_VERIFIER_FFMPEG_BIN", "ffmpeg")

# Presentation-Attack Detection (PAD). On by default; engages whenever
# both ONNX files are present at their model paths. To temporarily
# bypass without a rebuild, set BIOMETRIC_VERIFIER_PAD_DISABLED=1
# (matches the MESH_DISABLED kill-switch pattern).
#
# Inference uses a TWO-MODEL ENSEMBLE — Minivision's Silent-Face-Anti-
# Spoofing release pairs MiniFASNetV2 (scale 2.7 crop) with
# MiniFASNetV1SE (scale 4.0 crop) and sums the two softmaxes. The
# accuracy numbers their model card cites assume this ensemble; a
# single-model run is measurably weaker. Each model expects a different
# crop scale around the YuNet bbox; we encode the scale in the env var
# names so the right session matches the right crop. Class index 1 =
# "real" in the (summed) softmax (upstream `test.py:71`).
#
# Input convention: 80×80 BGR uint8 values cast to float32 (range
# [0, 255]) — NOT normalized to [0, 1]. The upstream's reference
# predictor (`src/data_io/functional.py:to_tensor`) explicitly
# commented out the `.div(255)` step with a `# modify by zkx`
# annotation, so the trained weights expect raw uint8-as-float
# inputs. Feeding a /255 input produces near-baseline outputs
# (verified end-to-end against upstream PyTorch on their sample
# images via models/pad/scripts/verify.py).
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
# Crop scale per model — the filename suffix records this so the right
# session matches the right crop. Values from upstream filenames.
PAD_V2_CROP_SCALE = 2.7
PAD_V1SE_CROP_SCALE = 4.0
# Real-class probability a single frame must reach to be considered
# "live". The summed-softmax output is divided by 2 to keep the value
# in [0, 1] (each model independently softmaxes to sum=1, so the sum
# is in [0, 2]).
PAD_FRAME_THRESHOLD = float(
    os.environ.get("BIOMETRIC_VERIFIER_PAD_FRAME_THRESHOLD", "0.55")
)
# Fraction of face-bearing frames that must clear PAD_FRAME_THRESHOLD
# for the clip as a whole to pass.
PAD_PASS_FRACTION = float(
    os.environ.get("BIOMETRIC_VERIFIER_PAD_PASS_FRACTION", "0.7")
)

# MediaPipe Face Landmarker (478-pt mesh + iris). Pinned in the
# Dockerfile / download-models.sh against Kayle's R2 mirror (the same
# way YuNet is pinned against opencv_zoo and AuraFace against R2) —
# always downloaded at build time, always loaded at startup. Failure-to-load degrades
# gracefully (head pose falls back to the YuNet 5-pt PnP, mesh
# similarity stays null), but the model being absent in production
# would be a bug.
#
# When the mesh is loaded, it becomes the source of truth for head
# pose (denser PnP using a stable 12-pt subset → tighter yaw than the
# YuNet 5-pt fallback) and enables a new `meshSimilarityScore` signal
# comparing the live-frame mesh against the DG2 mesh. The score is
# emitted but NOT a verdict gate yet — it ships purely for telemetry
# until real-traffic data lets us pick a threshold without false
# rejections.
#
# Kill switch: set `BIOMETRIC_VERIFIER_MESH_DISABLED=1` to skip
# loading the model entirely. Useful only if we ever discover a
# regression post-deploy that needs disabling without a rebuild.
MESH_DISABLED = os.environ.get("BIOMETRIC_VERIFIER_MESH_DISABLED") == "1"
MESH_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_MESH_MODEL_PATH",
    "/app/models/face_landmarks_detector.onnx",
)
# The official MediaPipe Face Landmarker accepts a 256×256 RGB face
# crop scaled to [0, 1]. The "with-attention" head outputs 478×3
# landmarks in the same coord space as the crop (i.e., normalized to
# [0, 1]). Crop expansion is set to roughly match the BlazeFace-style
# loose framing the model was trained on — tight YuNet boxes
# under-perform.
MESH_INPUT_SIZE = (256, 256)
MESH_CROP_EXPAND = float(
    os.environ.get("BIOMETRIC_VERIFIER_MESH_CROP_EXPAND", "0.5")
)

# ArcFace canonical 5-point template in 112×112 output space. Used
# both by `AuraFaceRecognizer.align_crop` (YuNet 5-pt → template)
# and by `align_face_via_mesh` (mesh's anatomical landmarks →
# template). Coords are the de-facto InsightFace/ArcFace standard
# — AuraFace was trained against this exact alignment, so the
# template positions are load-bearing and shouldn't be tweaked.
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
# template expects. Eye "centres" are derived as the midpoint of
# inner+outer corner so they line up with what the template was
# computed against (eye centres, not eye corners).
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


def detect_face(
    detector: cv2.FaceDetectorYN, image: np.ndarray
) -> Optional[np.ndarray]:
    height, width = image.shape[:2]

    if height == 0 or width == 0:
        return None

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
    """Thin wrapper around the AuraFace (fal/AuraFace-v1) ONNX model
    that exposes the alignCrop / feature / match surface our service
    used to lean on from `cv2.FaceRecognizerSF`. Reimplementing those
    three operations here means the rest of `service.py` doesn't have
    to know we swapped recognizers.

    - `align_crop` warps an input image to the ArcFace canonical 112×112
      template using YuNet's 5 landmarks (right_eye, left_eye, nose,
      right_mouth, left_mouth). Replaces SFace's bundled alignCrop —
      same template, same source landmarks.
    - `feature` runs the AuraFace ONNX on a 112×112 BGR crop with
      InsightFace-standard preprocessing (mean 127.5, scale 1/127.5,
      swapRB=True so the model sees RGB) and L2-normalizes the 512-d
      output. Returns None on inference failure.
    - `match` is the dot product of two normalized embeddings — the
      same cosine similarity SFace's `match(..., FR_COSINE)` produces,
      just computed ourselves so we don't carry a vestigial cv2
      enum reference.
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
    # Test-only path. Bypasses face detection by treating the whole image as
    # a face crop. Reachable only when ALLOW_PIXEL_FALLBACK is true.
    if image.size == 0:
        return None

    prepared = cv2.resize(image, MODEL_INPUT_SIZE)
    grayscale = cv2.cvtColor(prepared, cv2.COLOR_BGR2GRAY)

    if float(grayscale.std()) < DETAIL_STDDEV_MIN:
        return None

    return prepared


def _mesh_anatomical_5pt(mesh: np.ndarray) -> Optional[np.ndarray]:
    """Pull 5 ArcFace-template-aligned anatomical points from the 478-pt
    mesh. Eye "centres" are the midpoint of inner + outer corners so
    they match the template's expectation. Returns None when the mesh
    is too short for any of the required indices."""
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
    """Warp `image` to a 112×112 AuraFace-ready crop using a similarity
    transform from the mesh's 5 anatomical landmarks → ArcFace's
    canonical template. The mesh provides denser, more stable source
    landmarks than YuNet's 5 image-domain points, so AuraFace gets a
    better-aligned crop and (in principle) tighter embeddings.

    Returns None on degenerate input (mesh too short, OpenCV's affine
    estimator can't find a transform, the resulting crop is uniform).
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
    """Mesh-driven alternative to `build_embedding`. Skips YuNet
    alignment entirely; the mesh's anatomical landmarks drive a
    similarity warp onto the ArcFace canonical template and AuraFace
    embeds the result.
    """
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


def match_centered_frame(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    dg2_image: np.ndarray,
    dg2_mesh: Optional[np.ndarray],
    selfie_frame: np.ndarray,
    selfie_mesh: Optional[np.ndarray],
    threshold: float,
) -> dict:
    """Match a single centred liveness frame against DG2 with AuraFace.

    Returns BOTH the baseline YuNet-5pt-aligned cosine score (kept as
    the back-compatible `faceMatchScore` the API consumer reads) and,
    when meshes are available on both sides, a mesh-aligned variant
    (`faceMatchScoreMeshAligned`). Both go through the same AuraFace
    weights — only the alignment crop differs. The mesh-aligned score
    is null when either mesh is missing or the warp degenerates.
    """
    result: dict = {
        "faceMatchScore": None,
        "faceMatchPassed": False,
        "faceMatchScoreMeshAligned": None,
        "faceMatchPassedMeshAligned": None,
        "usedFallback": False,
        "reason": None,
    }

    # Baseline path: YuNet detection → AuraFace alignCrop → cosine match.
    # This is the gate the production verdict still reads.
    dg2_embedding = build_embedding(
        detector,
        recognizer,
        dg2_image,
        allow_full_image_fallback=True,
    )
    if dg2_embedding is None:
        result["reason"] = "face_score_dg2_face_not_detected"
    else:
        selfie_embedding = build_embedding(detector, recognizer, selfie_frame)
        if selfie_embedding is not None:
            raw_score = recognizer.match(dg2_embedding, selfie_embedding)
            normalized = normalize_cosine_score(raw_score)
            result["faceMatchScore"] = normalized
            result["faceMatchPassed"] = normalized >= threshold
            result["reason"] = (
                None if normalized >= threshold else "face_score_below_threshold"
            )
        elif ALLOW_PIXEL_FALLBACK:
            normalized = compute_image_similarity(dg2_image, selfie_frame)
            if (
                normalized is not None
                and normalized >= STRICT_IMAGE_SIMILARITY_THRESHOLD
            ):
                result["faceMatchScore"] = normalized
                result["faceMatchPassed"] = normalized >= threshold
                result["usedFallback"] = True
                result["reason"] = (
                    None
                    if normalized >= threshold
                    else "face_score_below_threshold"
                )
            else:
                result["reason"] = "face_score_no_decodable_frame"
        else:
            result["reason"] = "face_score_no_decodable_frame"

    # Bonus path: mesh-driven alignment → AuraFace. Same weights,
    # same cosine — only the source landmarks differ (mesh's
    # anatomical points warped onto ArcFace canonical instead of
    # YuNet's 5 image-domain points). Computed when meshes are
    # available on both sides; null otherwise.
    if dg2_mesh is not None and selfie_mesh is not None:
        dg2_emb_mesh = build_embedding_mesh_aligned(recognizer, dg2_image, dg2_mesh)
        selfie_emb_mesh = build_embedding_mesh_aligned(
            recognizer, selfie_frame, selfie_mesh
        )
        if dg2_emb_mesh is not None and selfie_emb_mesh is not None:
            raw_mesh = recognizer.match(dg2_emb_mesh, selfie_emb_mesh)
            mesh_aligned_normalized = normalize_cosine_score(raw_mesh)
            result["faceMatchScoreMeshAligned"] = mesh_aligned_normalized
            result["faceMatchPassedMeshAligned"] = (
                mesh_aligned_normalized >= threshold
            )

    return result


def extract_frames_with_ffmpeg(
    video_bytes: bytes, frame_count: int
) -> tuple[list[np.ndarray], Optional[float]]:
    """Decode `frame_count` evenly-spaced frames from the supplied video bytes
    using a system ffmpeg binary. Returns (BGR images sorted in display order,
    probed duration in seconds).

    The frame extraction lives in a TemporaryDirectory so simultaneous
    requests cannot collide on the output pattern, and the directory is
    cleared when the function returns. Returns ([], None) on any decode
    failure — the caller treats an empty list as `liveness_video_unreadable`.
    Duration is also returned so the debug surface can report it without
    re-probing.
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

        # Step 2: extract frames at evenly-spaced timestamps. The
        # `select` filter picks the closest decoded frame for each
        # timestamp; vsync=vfr writes them sequentially.
        timestamps = [
            duration_seconds * (i + 0.5) / frame_count
            for i in range(frame_count)
        ]
        select_expr = "+".join(
            f"eq(pts*TB\\,{ts:.6f})" for ts in timestamps
        )
        output_pattern = tmp_path / "frame_%03d.png"

        # The exact `eq()` predicate above only matches frames whose PTS
        # is bit-exact to one of our timestamps. Real videos quantise
        # frames to their encode timebase, so we use ffmpeg's `-vsync vfr`
        # with `-r` instead: split the duration into frame_count equal
        # intervals and emit one frame per interval. This is robust to
        # any input timebase.
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

        # Use `discard select` ordering above — but
        # `-vf "fps=N"` always emits in display order. Read back what
        # ffmpeg actually produced.
        _ = select_expr  # silence unused
        frames: list[np.ndarray] = []
        for path in sorted(tmp_path.glob("frame_*.png")):
            frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if frame is not None:
                frames.append(frame)
        return frames, duration_seconds


def probe_duration_seconds(input_path: Path) -> Optional[float]:
    """Use ffmpeg itself to read the input duration. We avoid taking a
    dependency on ffprobe so the container only carries one binary.
    Returns the duration in seconds, or None if it cannot be parsed.
    """
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


# Canonical 3D head model in millimetres. Object frame is right-handed
# matching OpenCV's camera frame: +X = image-right (which is the SUBJECT'S
# LEFT under un-mirrored capture, because the subject and camera face each
# other), +Y = down, +Z = forward (into the scene). Origin at the nose
# tip; absolute scale is irrelevant — solvePnP only needs consistent
# relative geometry, so these numbers are approximate.
#
# Index order matches YuNet's landmark output:
#   right_eye landmark (image-right) → subject's LEFT eye  → +X
#   left_eye  landmark (image-left)  → subject's RIGHT eye → -X
# Naming-by-image-side is YuNet's convention; we keep it so the array
# indexing lines up with `_yunet_landmarks_2d` below.
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
    """Pinhole intrinsics good enough for an uncalibrated webcam: focal
    length ≈ image width, principal point at frame centre, no skew. Real
    webcams have distortion, but for the head-pose magnitudes we care
    about (±25°) the noise from this approximation is far below the
    classifier's center / tilt thresholds.
    """
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
    """Decompose a rotation matrix into pitch/yaw/roll (X/Y/Z) in degrees.
    Uses the classical Tait–Bryan convention (XYZ, intrinsic): the head
    rotates first around X (pitch, nodding), then Y (yaw, shaking), then
    Z (roll, tilting) as the subject would experience it.
    """
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
    """Returns (pitch_deg, yaw_deg, roll_deg) via cv2.solvePnP using
    YuNet's 5 landmarks. Yaw sign convention matches classify_pose
    (positive yaw → subject's left). Used as the fallback head-pose
    estimator when the mesh model is unavailable; the mesh-based path
    (`head_pose_from_mesh`) gives tighter results when present.

    Returns None when solvePnP fails or raises — caller treats it as a
    failed pose estimate. Broad try/except because solvePnP can throw
    cv2.error on degenerate inputs (collinear landmarks, NaNs, etc.).
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


# 12 identity-stable mesh indices used for head-pose PnP. Chosen to be
# anatomically stable across expression (bone-anchored eye corners +
# nose bridge + chin + alars + mouth corners as gentle position
# anchors). Coords below are approximate millimetres in the same object
# frame as `_CANONICAL_FACE_3D_POINTS` (+X = image-right = subject's
# left under un-mirrored capture), so yaw produced by this path lands
# on the same scale as the YuNet fallback and classify_pose stays
# calibrated.
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

    # Expand YuNet's tight bbox — MediaPipe Face Landmarker was trained
    # on BlazeFace-style loose framing, so tight crops bias landmarks.
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

    # MediaPipe Face Landmarker outputs the 478×3 landmark tensor as
    # the first / largest output; auxiliary outputs (face flag,
    # blendshapes, etc.) are ignored. Coordinates are in the 256×256
    # crop input space.
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
    # Z is in the crop's coord scale; keep it dimensionally consistent
    # with x by reusing scale_x (z has no projective meaning but stays
    # useful as a relative depth signal for the debug overlay).
    image_landmarks[:, 2] = landmarks[:, 2] * scale_x
    return image_landmarks


def head_pose_from_mesh(
    mesh: np.ndarray, frame_shape: tuple[int, int]
) -> Optional[tuple[float, float, float]]:
    """Returns (pitch_deg, yaw_deg, roll_deg) via cv2.solvePnP using the
    12-point identity-stable mesh subset. Coord conventions match
    head_pose_from_yunet so produced yaw is on the same scale —
    classify_pose and LIVENESS_TILT_YAW_DEG don't need re-tuning.
    """
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
    """Returns the SUBJECT's pose: "left" when they've turned their own
    head to the left (nose shifted to image-right under un-mirrored
    front-camera capture), "right" when they've turned to their own right.
    """
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
    """Run YuNet (and the mesh model when available) over every frame
    and return a list of timeline entries in display order.

    When `mesh_session` is non-None, each detected face is also fed
    through the Face Landmarker; the resulting 478×3 mesh drives head
    pose (denser PnP, tighter yaw) and is stashed on the timeline
    entry as `mesh` for downstream mesh similarity. When the mesh
    model is absent or inference fails for a frame, head pose falls
    back to the YuNet 5-pt PnP — same scale, same classify_pose
    thresholds.
    """
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
    """Verify the recorded clip contains at least one decisive head-turn
    extreme. The two-direction requirement we shipped initially produced a
    lot of `liveness_*_turn_missing` failures whenever the server's
    fixed-rate frame sampling missed a brief peak — and the movement gate
    is doing very little anti-spoof work that PAD doesn't already cover.
    A single decisive turn satisfies "the head physically moved in 3D" so
    we accept either direction; only "no movement at all" still fails.
    """
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
    """Return the index of the first frame classified as "center" with a
    detected face; falls back to the most-centred frame by yaw magnitude."""
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
    """Produce an 80×80 BGR crop centred on the YuNet bbox, with the
    bbox's width/height scaled by `scale` and the result clipped to
    the source image. Mirrors `CropImage._get_new_box` in the upstream
    Silent-Face-Anti-Spoofing repo — when `scale=2.7`, the new crop is
    2.7× the bbox dimensions; when `scale=4.0`, 4.0×. Clipping at the
    image edges shifts the centre toward the interior rather than
    truncating, which is what the upstream does. Returns None if the
    bbox is unusable.
    """
    src_h, src_w = image.shape[:2]
    x, y, box_w, box_h = (
        float(face[0]),
        float(face[1]),
        float(face[2]),
        float(face[3]),
    )

    if box_w <= 0 or box_h <= 0 or src_h <= 1 or src_w <= 1:
        return None

    # Match upstream: cap the requested scale so the new box always
    # fits inside the image — `scale = min((src_h-1)/box_h, (src_w-1)/box_w, scale)`
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
    """Numerically-stable softmax for the 3-class PAD logit vector.
    Returns None if the vector shape is wrong or the denominator
    degenerates."""
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
    """Run BOTH MiniFASNet sessions on per-scale crops of the YuNet
    bbox, sum the two softmaxes, and return the (real-class
    probability normalised to [0, 1]). This matches Minivision's
    reference `test.py` predictor: each model independently softmaxes
    to a 3-vector summing to 1.0, the two vectors are summed (so the
    real-class slot in the summed vector lives in [0, 2]), and the
    final probability is sum/2 ∈ [0, 1].

    Returns None if either crop or either inference step fails — the
    ensemble decision requires both signals.
    """
    v2_crop = crop_face_for_pad(image, face, PAD_V2_CROP_SCALE)
    v1se_crop = crop_face_for_pad(image, face, PAD_V1SE_CROP_SCALE)
    if v2_crop is None or v1se_crop is None:
        return None

    summed: Optional[np.ndarray] = None
    for session, crop in ((v2_session, v2_crop), (v1se_session, v1se_crop)):
        # Upstream pipeline: cv2.imread (BGR) → custom `to_tensor` that
        # does HWC→CHW reshape + float cast but DELIBERATELY skips the
        # /255 normalization (see src/data_io/functional.py — they
        # commented out `.div(255)` with a "modify by zkx" annotation).
        # Replicate with blobFromImage at scalefactor=1.0 (no scaling),
        # mean=0, swapRB=False (we already have BGR). Resize is a no-op
        # because crop_face_for_pad already produced an 80×80 image.
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
    # summed[1] ∈ [0, 2] (each of the two softmaxes contributes [0, 1]).
    # Halve to get the ensemble's mean real-class probability in [0, 1].
    return clamp_score(float(summed[1] / 2.0))


def run_pad_over_timeline(
    v2_session,
    v1se_session,
    detector: cv2.FaceDetectorYN,
    frames: list[np.ndarray],
    timeline: list[dict],
) -> dict:
    """Run the PAD ensemble on every frame in the timeline where YuNet
    detected a face. Aggregates per-frame real-class probabilities into
    a clip-level verdict.
    """
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
    """Slice a raw YuNet detection (15-column ndarray) into JSON-friendly
    bbox + landmarks dicts. Caller has already checked `face is not None`.
    """
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
            # Emit only the identity-stable subset (~12 anchored points)
            # rather than all 478×3 — the full mesh would balloon the
            # debug payload to ~500 KB per request without giving the
            # debug overlay anything it can't already render from the
            # subset.
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
    # Request-level includeDebug is honored ONLY when the container is
    # running in development mode. Production responses NEVER carry the
    # rich debug block even if a caller asks — the kill switch is
    # server-side, not client-trustworthy.
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

    # We need enough frames to plausibly see a left turn and a right turn
    # — two pose extremes plus at least one centred frame.
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
            "padPassed": False,
            "padScore": None,
            "usedFallback": False,
            "reason": coverage_reason or "liveness_pose_coverage_failed",
            **_mesh_aligned_face_match_defaults(),
        }
        if debug is not None:
            response["debug"] = debug
        return response

    # PAD runs after movement coverage so we don't waste inference on
    # clips that were going to fail anyway. When PAD is disabled or
    # either model failed to load, padPassed defaults to True so the
    # gate is a no-op until both ONNX files are in place — the gate
    # never falls back to single-model inference because the published
    # accuracy numbers assume both signals.
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
                "padPassed": False,
                "padScore": pad_result["padScore"],
                "usedFallback": False,
                "reason": pad_result["padReason"] or "liveness_spoof_suspected",
                **_mesh_aligned_face_match_defaults(),
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
            "padPassed": pad_passed_for_response,
            "padScore": pad_score_for_response,
            "usedFallback": False,
            "reason": "face_match_skipped",
            **_mesh_aligned_face_match_defaults(),
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

    # Compute the DG2 mesh once up-front so it can be shared by both
    # the similarity score and the mesh-aligned AuraFace path.
    # center_mesh comes off the timeline entry the pose builder
    # already populated.
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
        # Production verdict gate — unchanged. Reads back through the
        # API consumer's `LivenessVerificationResult` type as today.
        "livenessPassed": True,
        "livenessScore": liveness_score,
        "faceMatchPassed": bool(face_match["faceMatchPassed"]),
        "faceMatchScore": face_match["faceMatchScore"],
        "padPassed": pad_passed_for_response,
        "padScore": pad_score_for_response,
        "usedFallback": bool(face_match["usedFallback"]),
        "reason": face_match["reason"],
        # Mesh-aligned AuraFace: same AuraFace weights, but the input
        # crop is produced by warping the mesh's anatomical landmarks
        # onto the ArcFace canonical template instead of using
        # YuNet's 5-pt `align_crop`. Telemetry alongside the YuNet
        # path — gives a same-model comparison of alignment quality.
        "faceMatchScoreMeshAligned": face_match.get("faceMatchScoreMeshAligned"),
        "faceMatchPassedMeshAligned": face_match.get(
            "faceMatchPassedMeshAligned"
        ),
    }
    if debug is not None:
        response["debug"] = debug
    return response


def decode_image_payload(image_payload: dict, label: str) -> np.ndarray:
    """Decode a `{ bytesBase64: str }` payload into a BGR numpy image. Used
    by the face-match endpoint for selfie stills (the DG2 helper above is
    structurally identical but kept separate for its dg2-specific error
    codes). Raises ValueError on any decode failure.
    """
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
    """Run YuNet (and the mesh model when available) on the image and
    return a (debug-friendly dict, mesh-or-None) pair. The dict shape
    feeds the face-match endpoint's DG2 + selfie responses; the second
    return value is the full mesh kept in memory so the caller can pair
    DG2 with selfie meshes for similarity scoring without re-running
    inference."""
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


def verify_face_match_payload(
    detector: cv2.FaceDetectorYN,
    recognizer: "AuraFaceRecognizer",
    mesh_session,
    payload: dict,
) -> dict:
    """Face-match-only endpoint: takes the DG2 inner image + a list of
    selfie images, runs YuNet + AuraFace per pair, returns per-selfie
    scores along with bbox / landmarks for both sides. Bypasses ffmpeg,
    PAD, and the movement-coverage classifier entirely. When the mesh
    model is loaded, each selfie response also gains a mesh-aligned
    AuraFace score against the DG2 mesh (telemetry signal alongside
    the YuNet-aligned verdict)."""
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

    selfies_response: list[dict] = []
    for index, selfie_payload in enumerate(selfies_input):
        try:
            selfie_image = decode_image_payload(selfie_payload, "selfie")
        except ValueError as error:
            emit_log(
                "face_match_selfie_decode_failed",
                index=index,
                error=str(error),
            )
            selfies_response.append(
                {
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
                    "usedFallback": False,
                    "reason": "selfie_decode_failed",
                    **_mesh_aligned_face_match_defaults(),
                }
            )
            continue

        selfie_debug, selfie_mesh = _image_to_debug_face(
            detector, mesh_session, selfie_image
        )
        match = match_centered_frame(
            detector,
            recognizer,
            dg2_image,
            dg2_mesh,
            selfie_image,
            selfie_mesh,
            threshold,
        )

        selfie_entry = {
            "index": index,
            **selfie_debug,
            "faceMatchScore": match["faceMatchScore"],
            "faceMatchPassed": bool(match["faceMatchPassed"]),
            "usedFallback": bool(match["usedFallback"]),
            "reason": match["reason"],
            # Mesh-aligned AuraFace — same AuraFace weights,
            # mesh-warped input crop instead of YuNet's 5-pt
            # alignCrop. Same `faceMatchThreshold` the caller supplied.
            "faceMatchScoreMeshAligned": match.get("faceMatchScoreMeshAligned"),
            "faceMatchPassedMeshAligned": match.get(
                "faceMatchPassedMeshAligned"
            ),
        }
        if selfie_mesh is not None:
            subset = stable_subset(selfie_mesh)
            if subset is not None:
                selfie_entry["mesh"] = {
                    "subsetPoints": subset.tolist(),
                    "subsetIndices": list(IDENTITY_STABLE_INDICES),
                }
        selfies_response.append(selfie_entry)

    return {
        "threshold": threshold,
        "dg2": dg2_response,
        "selfies": selfies_response,
    }


def _mesh_aligned_face_match_defaults() -> dict:
    """Shared null defaults for the mesh-aligned AuraFace strategy.
    Every response shape carries these fields so the wire contract is
    stable — failure paths populate them with None.
    """
    return {
        "faceMatchScoreMeshAligned": None,
        "faceMatchPassedMeshAligned": None,
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
        "padPassed": False,
        "padScore": None,
        "usedFallback": False,
        "reason": reason,
        **_mesh_aligned_face_match_defaults(),
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
        # AuraFace runs on onnxruntime alongside the mesh model. The
        # file is always present (pinned in download-models.sh), so
        # failure here is a real configuration bug — log it and leave
        # `recognizer = None` so `ready` flips false. The runtime
        # returns the same "unavailable" verdict it always did when
        # the recognizer can't load.
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
        # PAD is on by default — set BIOMETRIC_VERIFIER_PAD_DISABLED=1
        # only as a kill switch for an incident. Both ONNX files must
        # load for inference to run, because the upstream ensemble's
        # accuracy comes from summing the two softmaxes; falling back
        # to a single model would ship an undocumented accuracy
        # downgrade. If either side fails, leave both sessions None
        # and the gate becomes a no-op.
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
        # Mesh model is hardcoded in download-models.sh and always
        # downloaded at build time, so the file SHOULD always be on
        # disk. Loaded eagerly at startup because `sleepAfter = "10m"`
        # on the Durable Object means cold containers re-pay load
        # anyway; deferring to the first request would push the
        # 200-400ms onnxruntime init into a user-visible latency
        # budget. Graceful degrade on any failure — head pose falls
        # back to YuNet's 5-pt PnP and mesh similarity stays null.
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
                "padPassed": False,
                "padScore": None,
                "usedFallback": True,
                "reason": f"biometric_verifier_unavailable:runtime_not_ready:{reason_suffix}",
                **_mesh_aligned_face_match_defaults(),
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
                face_match_score_mesh_aligned=result.get(
                    "faceMatchScoreMeshAligned"
                ),
                face_match_passed_mesh_aligned=result.get(
                    "faceMatchPassedMeshAligned"
                ),
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
                    "padPassed": False,
                    "padScore": None,
                    "usedFallback": True,
                    "reason": "biometric_verifier_unavailable:container_runtime_failed",
                    **_mesh_aligned_face_match_defaults(),
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
