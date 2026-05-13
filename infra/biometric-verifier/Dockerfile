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
RUN chmod +x ./scripts/download-models.sh \
  && ./scripts/download-models.sh

# curl is only needed for the download step; purge it from the runtime
# image. ffmpeg stays — /verify_liveness shells out to it.
RUN apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

COPY src/ ./src/

# Smoke-test each model at build time so a structurally broken file
# trips the build rather than the first request.
RUN uv run --no-sync python -c "import cv2; detector = cv2.FaceDetectorYN.create('/app/models/face_detection_yunet_2023mar.onnx', '', (320, 320), 0.85, 0.3, 5000); assert detector is not None"
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
