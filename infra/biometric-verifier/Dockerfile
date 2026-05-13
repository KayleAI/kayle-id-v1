FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

COPY scripts/download-models.sh ./scripts/download-models.sh
# YuNet detection lives in opencv_zoo; the AuraFace recognizer, the
# MediaPipe Face Landmarker (mesh), and the two MiniFASNet PAD models
# all live on Kayle's R2 mirror. All URLs + sha256s are hardcoded in
# `download-models.sh` — no build args anymore (PAD used to be
# optional, but is now part of the IDV verdict path).
RUN chmod +x ./scripts/download-models.sh \
  && ./scripts/download-models.sh

# ffmpeg stays installed — the /verify_liveness endpoint shells out to it for
# frame extraction. curl is only needed during the model-download step and is
# purged below to keep the runtime image small.
RUN apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

COPY src/ ./src/

RUN uv run --no-sync python -c "import cv2; detector = cv2.FaceDetectorYN.create('/app/models/face_detection_yunet_2023mar.onnx', '', (320, 320), 0.85, 0.3, 5000); assert detector is not None"

# Smoke-test every onnxruntime session at build time — a structurally
# broken model trips the build here, not the first request. All
# files are always present (pinned in download-models.sh), so this
# is unconditional.
RUN uv run --no-sync python -c "import onnxruntime as ort; sess = ort.InferenceSession('/app/models/face_landmarks_detector.onnx', providers=['CPUExecutionProvider']); assert sess.get_inputs(); print('mesh model OK:', sess.get_inputs()[0].name, sess.get_inputs()[0].shape)"
RUN uv run --no-sync python -c "import onnxruntime as ort; sess = ort.InferenceSession('/app/models/auraface_glintr100.onnx', providers=['CPUExecutionProvider']); assert sess.get_inputs(); print('auraface model OK:', sess.get_inputs()[0].name, sess.get_inputs()[0].shape)"
RUN uv run --no-sync python -c "import onnxruntime as ort; sess = ort.InferenceSession('/app/models/pad_minifasnet_v2_scale27.onnx', providers=['CPUExecutionProvider']); assert sess.get_inputs(); print('pad v2 OK:', sess.get_inputs()[0].name, sess.get_inputs()[0].shape)"
RUN uv run --no-sync python -c "import onnxruntime as ort; sess = ort.InferenceSession('/app/models/pad_minifasnet_v1se_scale40.onnx', providers=['CPUExecutionProvider']); assert sess.get_inputs(); print('pad v1se OK:', sess.get_inputs()[0].name, sess.get_inputs()[0].shape)"

RUN groupadd --system app \
  && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
  && chown -R app:app /app

ENV BIOMETRIC_VERIFIER_DETECTOR_PATH=/app/models/face_detection_yunet_2023mar.onnx \
    BIOMETRIC_VERIFIER_MODEL_PATH=/app/models/auraface_glintr100.onnx \
    BIOMETRIC_VERIFIER_PAD_V2_MODEL_PATH=/app/models/pad_minifasnet_v2_scale27.onnx \
    BIOMETRIC_VERIFIER_PAD_V1SE_MODEL_PATH=/app/models/pad_minifasnet_v1se_scale40.onnx \
    BIOMETRIC_VERIFIER_MESH_MODEL_PATH=/app/models/face_landmarks_detector.onnx \
    PATH="/app/.venv/bin:${PATH}" \
    PORT=8080

EXPOSE 8080

USER app

CMD ["uv", "run", "--no-sync", "python", "src/service.py"]
