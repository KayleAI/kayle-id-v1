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


MODEL_INPUT_SIZE = (112, 112)
DETAIL_STDDEV_MIN = 12.0
STRICT_IMAGE_SIMILARITY_THRESHOLD = 0.995
DEFAULT_THRESHOLD = 0.8
DEFAULT_DETECTOR_INPUT_SIZE = (320, 320)
MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_MODEL_PATH",
    "/app/models/face_recognition_sface_2021dec.onnx",
)
DETECTOR_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_DETECTOR_PATH",
    "/app/models/face_detection_yunet_2023mar.onnx",
)
PORT = int(os.environ.get("PORT", "8080"))

# Test-only escape hatch. When set to "1" the verifier falls back to a raw
# pixel-correlation path if face detection fails on either DG2 or the
# centred-frame face match. Production wrangler config does NOT set this;
# the test wrangler env does, so the verify integration tests can exercise
# the rest of the verify flow without sourcing detectable face-image
# fixtures. A guardrail test asserts the production wrangler block does
# not enable this flag.
ALLOW_PIXEL_FALLBACK = (
    os.environ.get("BIOMETRIC_VERIFIER_ALLOW_PIXEL_FALLBACK") == "1"
)

# Liveness tunables. Tweak via env vars on first deploy after we have real
# fixtures; the defaults are a starting point chosen for an un-mirrored
# front-camera capture.
LIVENESS_FRAME_COUNT = int(
    os.environ.get("BIOMETRIC_VERIFIER_FRAME_COUNT", "10")
)
LIVENESS_CENTER_YAW_DEG = float(
    os.environ.get("BIOMETRIC_VERIFIER_CENTER_YAW_DEG", "15")
)
LIVENESS_TILT_YAW_DEG = float(
    os.environ.get("BIOMETRIC_VERIFIER_TILT_YAW_DEG", "20")
)
# Each pose must occupy at least this many consecutive sampled frames before
# we treat it as a real pose. Sampled at 10 frames evenly across the clip,
# so 1 frame ≈ 1/10 of the clip duration; ~150 ms at 1.5 s clip.
LIVENESS_MIN_POSE_FRAMES = int(
    os.environ.get("BIOMETRIC_VERIFIER_MIN_POSE_FRAMES", "1")
)
LIVENESS_FFMPEG_BIN = os.environ.get("BIOMETRIC_VERIFIER_FFMPEG_BIN", "ffmpeg")

# Presentation-Attack Detection (PAD). Off by default; engages when an ONNX
# model is present at PAD_MODEL_PATH and PAD_ENABLED is set. The model is
# expected to be a MiniFASNet-style classifier accepting an 80x80 RGB face
# crop and outputting per-class logits where index 1 is the "real" class
# (Silent-Face-Anti-Spoofing convention).
PAD_ENABLED = os.environ.get("BIOMETRIC_VERIFIER_PAD_ENABLED") == "1"
PAD_MODEL_PATH = os.environ.get(
    "BIOMETRIC_VERIFIER_PAD_MODEL_PATH",
    "/app/models/face_anti_spoofing_minifasnet.onnx",
)
PAD_INPUT_SIZE = (80, 80)
# Real-class probability a single frame must reach to be considered "live".
PAD_FRAME_THRESHOLD = float(
    os.environ.get("BIOMETRIC_VERIFIER_PAD_FRAME_THRESHOLD", "0.55")
)
# Fraction of face-bearing frames that must clear PAD_FRAME_THRESHOLD for
# the clip as a whole to pass.
PAD_PASS_FRACTION = float(
    os.environ.get("BIOMETRIC_VERIFIER_PAD_PASS_FRACTION", "0.7")
)
# Crop expansion ratio around YuNet's tight face box before resize. PAD
# models train on a bit of head/shoulders context, so a tight crop
# under-performs.
PAD_CROP_EXPAND = float(
    os.environ.get("BIOMETRIC_VERIFIER_PAD_CROP_EXPAND", "0.25")
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


def prepare_face_crop(
    detector: cv2.FaceDetectorYN,
    recognizer: cv2.FaceRecognizerSF,
    image: np.ndarray,
) -> Optional[np.ndarray]:
    face = detect_face(detector, image)

    if face is None:
        return None

    try:
        prepared = recognizer.alignCrop(image, face)
    except Exception:
        return None

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


def build_embedding(
    detector: cv2.FaceDetectorYN,
    recognizer: cv2.FaceRecognizerSF,
    image: np.ndarray,
    allow_full_image_fallback: bool = False,
):
    prepared = prepare_face_crop(detector, recognizer, image)

    if prepared is None and ALLOW_PIXEL_FALLBACK and allow_full_image_fallback:
        prepared = prepare_full_image_crop(image)

    if prepared is None:
        return None

    return recognizer.feature(prepared).copy()


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
    recognizer: cv2.FaceRecognizerSF,
    dg2_image: np.ndarray,
    selfie_frame: np.ndarray,
    threshold: float,
) -> dict:
    """Match a single centred liveness frame against DG2 with SFace."""
    dg2_embedding = build_embedding(
        detector,
        recognizer,
        dg2_image,
        allow_full_image_fallback=True,
    )

    if dg2_embedding is None:
        return {
            "faceMatchScore": None,
            "faceMatchPassed": False,
            "usedFallback": False,
            "reason": "face_score_dg2_face_not_detected",
        }

    selfie_embedding = build_embedding(detector, recognizer, selfie_frame)

    if selfie_embedding is not None:
        raw_score = float(
            recognizer.match(
                dg2_embedding,
                selfie_embedding,
                cv2.FaceRecognizerSF_FR_COSINE,
            )
        )
        normalized = normalize_cosine_score(raw_score)
        return {
            "faceMatchScore": normalized,
            "faceMatchPassed": normalized >= threshold,
            "usedFallback": False,
            "reason": None if normalized >= threshold else "face_score_below_threshold",
        }

    if ALLOW_PIXEL_FALLBACK:
        normalized = compute_image_similarity(dg2_image, selfie_frame)
        if (
            normalized is not None
            and normalized >= STRICT_IMAGE_SIMILARITY_THRESHOLD
        ):
            return {
                "faceMatchScore": normalized,
                "faceMatchPassed": normalized >= threshold,
                "usedFallback": True,
                "reason": None
                if normalized >= threshold
                else "face_score_below_threshold",
            }

    return {
        "faceMatchScore": None,
        "faceMatchPassed": False,
        "usedFallback": False,
        "reason": "face_score_no_decodable_frame",
    }


def extract_frames_with_ffmpeg(
    video_bytes: bytes, frame_count: int
) -> list[np.ndarray]:
    """Decode `frame_count` evenly-spaced frames from the supplied video bytes
    using a system ffmpeg binary. Returns BGR images sorted in display order.

    The frame extraction lives in a TemporaryDirectory so simultaneous
    requests cannot collide on the output pattern, and the directory is
    cleared when the function returns. Returns an empty list on any
    decode failure — the caller treats that as `liveness_video_unreadable`.
    """
    if frame_count <= 0:
        return []

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
            return []

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
            return []

        # Use `discard select` ordering above — but
        # `-vf "fps=N"` always emits in display order. Read back what
        # ffmpeg actually produced.
        _ = select_expr  # silence unused
        frames: list[np.ndarray] = []
        for path in sorted(tmp_path.glob("frame_*.png")):
            frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if frame is not None:
                frames.append(frame)
        return frames


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


def estimate_yaw_deg(landmarks: np.ndarray) -> Optional[float]:
    """Geometric yaw estimate from YuNet's 5 facial landmarks.

    YuNet output columns 4..13 (x,y per landmark): right_eye, left_eye, nose,
    right_mouth_corner, left_mouth_corner — labelled from the IMAGE's
    perspective (right_eye is the eye on the image's right side, which in
    an un-mirrored front-camera buffer is the subject's LEFT eye).

    Sign convention (after this function): positive `yaw_deg` = nose is to
    the RIGHT of the eye midline = the subject's nose has rotated toward
    their own LEFT side. The classifier maps this to a "left" pose. The
    naming follows the SUBJECT'S perspective — i.e., the user thinks of
    themselves turning "left" or "right".
    """
    if landmarks is None or len(landmarks) < 14:
        return None

    right_eye = np.array([float(landmarks[4]), float(landmarks[5])])
    left_eye = np.array([float(landmarks[6]), float(landmarks[7])])
    nose = np.array([float(landmarks[8]), float(landmarks[9])])

    eye_midline = (right_eye + left_eye) / 2.0
    eye_to_eye = float(np.linalg.norm(left_eye - right_eye))

    if eye_to_eye <= 1e-3:
        return None

    # In an un-mirrored front-camera buffer, image-x increases to the
    # subject's LEFT (because the camera and the user face each other —
    # un-mirrored captures preserve user-left as image-right, but YuNet's
    # landmark order makes the eye on the IMAGE's right correspond to the
    # subject's LEFT eye, so the nose shifting to image-right means the
    # subject is turning to their own LEFT). Track sign accordingly.
    nose_offset = float(nose[0] - eye_midline[0])
    ratio = nose_offset / eye_to_eye
    # Map the offset into a degree-like magnitude; tuned with `* 2.0` so
    # ~15° of head yaw corresponds to the classifier thresholds below.
    return math.degrees(math.atan(ratio * 2.0))


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
    detector: cv2.FaceDetectorYN, frames: list[np.ndarray]
) -> list[dict]:
    """Run YuNet over every frame and return a list of {pose, yaw_deg,
    face_detected, frame_index} entries in display order."""
    timeline: list[dict] = []
    for index, frame in enumerate(frames):
        face = detect_face(detector, frame)
        if face is None:
            timeline.append(
                {
                    "frame_index": index,
                    "face_detected": False,
                    "yaw_deg": None,
                    "pose": "unknown",
                }
            )
            continue
        yaw_deg = estimate_yaw_deg(face)
        timeline.append(
            {
                "frame_index": index,
                "face_detected": True,
                "yaw_deg": yaw_deg,
                "pose": classify_pose(yaw_deg),
            }
        )
    return timeline


def validate_movement_coverage(
    timeline: list[dict],
) -> tuple[bool, Optional[str]]:
    """Verify the recorded clip contains BOTH a leftward and a rightward
    head-turn extreme, in any order. The user is told on-device to turn
    left and right (the order is at their discretion), so we accept either
    sequence as long as both extremes appear with enough consecutive frames.
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

    if not saw_left and not saw_right:
        return False, "liveness_no_head_movement"
    if not saw_left:
        return False, "liveness_left_turn_missing"
    if not saw_right:
        return False, "liveness_right_turn_missing"
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


def crop_face_for_pad(image: np.ndarray, face: np.ndarray) -> Optional[np.ndarray]:
    """Expand YuNet's face box by PAD_CROP_EXPAND on each side and resize to
    the PAD model's input size. Returns None if the box is unusable.
    """
    height, width = image.shape[:2]
    x, y, w, h = (float(face[0]), float(face[1]), float(face[2]), float(face[3]))

    if w <= 0 or h <= 0:
        return None

    expand_x = w * PAD_CROP_EXPAND
    expand_y = h * PAD_CROP_EXPAND
    x0 = int(max(0.0, x - expand_x))
    y0 = int(max(0.0, y - expand_y))
    x1 = int(min(float(width), x + w + expand_x))
    y1 = int(min(float(height), y + h + expand_y))

    if x1 <= x0 or y1 <= y0:
        return None

    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return None

    return cv2.resize(crop, PAD_INPUT_SIZE)


def predict_pad_score(net: cv2.dnn.Net, crop: np.ndarray) -> Optional[float]:
    """Run the PAD model on a prepared face crop and return the probability
    that the input is a real (live) face. Returns None on inference failure.
    """
    try:
        blob = cv2.dnn.blobFromImage(
            crop,
            scalefactor=1.0 / 255.0,
            size=PAD_INPUT_SIZE,
            mean=(0.0, 0.0, 0.0),
            swapRB=True,
            crop=False,
        )
        net.setInput(blob)
        logits = net.forward()
    except cv2.error:
        return None

    flat = np.asarray(logits, dtype=np.float64).reshape(-1)
    if flat.size < 2:
        return None

    # Numerically stable softmax over the logit vector. Silent-Face-Anti-
    # Spoofing checkpoints place the "real" class at index 1; output of
    # length > 2 still respects that convention (extra spoof sub-classes).
    shifted = flat - float(flat.max())
    exp = np.exp(shifted)
    denominator = float(exp.sum())
    if denominator <= 0.0 or not math.isfinite(denominator):
        return None

    probabilities = exp / denominator
    return clamp_score(float(probabilities[1]))


def run_pad_over_timeline(
    net: cv2.dnn.Net,
    detector: cv2.FaceDetectorYN,
    frames: list[np.ndarray],
    timeline: list[dict],
) -> dict:
    """Run PAD on every frame in the timeline where YuNet detected a face.
    Aggregates per-frame real-class probabilities into a clip-level verdict.
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
        crop = crop_face_for_pad(frame, face)
        if crop is None:
            per_frame_scores.append(None)
            continue
        score = predict_pad_score(net, crop)
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


def verify_liveness_payload(
    detector: cv2.FaceDetectorYN,
    recognizer: cv2.FaceRecognizerSF,
    pad_net: Optional[cv2.dnn.Net],
    payload: dict,
) -> dict:
    threshold = float(
        payload.get("faceMatchThreshold") or DEFAULT_THRESHOLD
    )

    video_b64 = payload.get("videoBase64")
    if not isinstance(video_b64, str) or len(video_b64) == 0:
        return liveness_failure_response(
            "liveness_video_missing",
            threshold=threshold,
        )

    try:
        video_bytes = base64.b64decode(video_b64)
    except Exception:
        return liveness_failure_response(
            "liveness_video_decode_failed",
            threshold=threshold,
        )

    if len(video_bytes) == 0:
        return liveness_failure_response(
            "liveness_video_empty",
            threshold=threshold,
        )

    frames = extract_frames_with_ffmpeg(video_bytes, LIVENESS_FRAME_COUNT)
    if len(frames) == 0:
        return liveness_failure_response(
            "liveness_video_unreadable",
            threshold=threshold,
        )

    # We need enough frames to plausibly see a left turn and a right turn
    # — two pose extremes plus at least one centred frame.
    if len(frames) < max(LIVENESS_MIN_POSE_FRAMES * 2 + 1, 3):
        return liveness_failure_response(
            "liveness_video_too_short",
            threshold=threshold,
        )

    timeline = build_pose_timeline(detector, frames)
    detected_count = sum(1 for entry in timeline if entry["face_detected"])
    if detected_count == 0:
        return liveness_failure_response(
            "liveness_no_face",
            threshold=threshold,
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
        return {
            "livenessPassed": False,
            "livenessScore": liveness_score,
            "faceMatchPassed": False,
            "faceMatchScore": None,
            "padPassed": False,
            "padScore": None,
            "usedFallback": False,
            "reason": coverage_reason or "liveness_pose_coverage_failed",
        }

    # PAD runs after movement coverage so we don't waste inference on
    # clips that were going to fail anyway. When PAD is disabled or the
    # model isn't loaded, padPassed defaults to True so the gate is a
    # no-op until an ONNX file is in place.
    if pad_net is not None:
        pad_result = run_pad_over_timeline(pad_net, detector, frames, timeline)
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
        if not pad_result["padPassed"]:
            return {
                "livenessPassed": False,
                "livenessScore": liveness_score,
                "faceMatchPassed": False,
                "faceMatchScore": None,
                "padPassed": False,
                "padScore": pad_result["padScore"],
                "usedFallback": False,
                "reason": pad_result["padReason"] or "liveness_spoof_suspected",
            }
        pad_passed_for_response = True
        pad_score_for_response = pad_result["padScore"]
    else:
        pad_passed_for_response = True
        pad_score_for_response = None

    center_index = pick_center_frame_index(timeline)
    if center_index is None:
        return liveness_failure_response(
            "liveness_no_center_frame",
            threshold=threshold,
            liveness_score=liveness_score,
        )

    try:
        dg2_image = decode_dg2_image(payload["dg2Image"])
    except (KeyError, ValueError) as error:
        emit_log("liveness_dg2_decode_failed", error=str(error))
        return liveness_failure_response(
            "liveness_dg2_decode_failed",
            threshold=threshold,
            liveness_score=liveness_score,
        )

    face_match = match_centered_frame(
        detector,
        recognizer,
        dg2_image,
        frames[center_index],
        threshold,
    )

    return {
        "livenessPassed": True,
        "livenessScore": liveness_score,
        "faceMatchPassed": bool(face_match["faceMatchPassed"]),
        "faceMatchScore": face_match["faceMatchScore"],
        "padPassed": pad_passed_for_response,
        "padScore": pad_score_for_response,
        "usedFallback": bool(face_match["usedFallback"]),
        "reason": face_match["reason"],
    }


def liveness_failure_response(
    reason: str,
    *,
    threshold: float,
    liveness_score: Optional[float] = None,
) -> dict:
    _ = threshold  # reserved for future telemetry
    return {
        "livenessPassed": False,
        "livenessScore": liveness_score,
        "faceMatchPassed": False,
        "faceMatchScore": None,
        "padPassed": False,
        "padScore": None,
        "usedFallback": False,
        "reason": reason,
    }


class BiometricVerifierRuntime:
    def __init__(self, detector_model_path: str, model_path: str):
        self.detector_model_path = detector_model_path
        self.model_path = model_path
        self.pad_model_path = PAD_MODEL_PATH
        self.error: Optional[str] = None
        self.detector: Optional[cv2.FaceDetectorYN] = None
        self.recognizer: Optional[cv2.FaceRecognizerSF] = None
        self.pad_net: Optional[cv2.dnn.Net] = None
        self.pad_load_error: Optional[str] = None
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
            self.recognizer = cv2.FaceRecognizerSF.create(self.model_path, "")
            ffmpeg_available = shutil.which(LIVENESS_FFMPEG_BIN) is not None
            if not ffmpeg_available:
                self.error = "ffmpeg_binary_missing"
            self._load_pad_model()
            emit_log(
                "container_ready",
                detector_model_path=self.detector_model_path,
                model_path=self.model_path,
                pad_model_path=self.pad_model_path,
                pad_enabled=PAD_ENABLED,
                pad_loaded=self.pad_net is not None,
                pad_load_error=self.pad_load_error,
                ffmpeg_available=ffmpeg_available,
            )
        except Exception as error:
            self.error = str(error)
            emit_log(
                "container_failed",
                detector_model_path=self.detector_model_path,
                model_path=self.model_path,
                error=self.error,
            )

    def _load_pad_model(self) -> None:
        # PAD stays opt-in: the flag must be set AND the ONNX file must
        # exist. Either condition false leaves pad_net=None and the
        # gate skipped, so the runtime stays serviceable while the
        # weights are being sourced.
        if not PAD_ENABLED:
            self.pad_load_error = "pad_disabled"
            return
        if not os.path.isfile(self.pad_model_path):
            self.pad_load_error = "pad_model_missing"
            return
        try:
            self.pad_net = cv2.dnn.readNetFromONNX(self.pad_model_path)
        except cv2.error as error:
            self.pad_load_error = f"pad_model_load_failed:{error}"
            self.pad_net = None

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
                "padEnabled": PAD_ENABLED,
                "padLoaded": self.pad_net is not None,
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
            }

        return verify_liveness_payload(
            self.detector,
            self.recognizer,
            self.pad_net,
            payload,
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
        if self.path != "/verify_liveness":
            self.respond(
                HTTPStatus.NOT_FOUND,
                {"error": {"code": "NOT_FOUND", "message": "Route not found."}},
            )
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
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
            return

        try:
            result = RUNTIME.verify_liveness(payload)
            threshold = float(
                payload.get("faceMatchThreshold") or DEFAULT_THRESHOLD
            )
            pose_sequence = payload.get("poseSequence")
            emit_log(
                "container_liveness_completed",
                dg2_byte_count=len(
                    base64.b64decode(
                        payload.get("dg2Image", {}).get("bytesBase64", "")
                    )
                ),
                pose_sequence_length=len(pose_sequence)
                if isinstance(pose_sequence, list)
                else 0,
                threshold=threshold,
                face_match_passed=result.get("faceMatchPassed"),
                face_match_score=result.get("faceMatchScore"),
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
        pad_model_path=PAD_MODEL_PATH,
        pad_enabled=PAD_ENABLED,
        port=PORT,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
