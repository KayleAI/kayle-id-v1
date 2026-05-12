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
RUN chmod +x ./scripts/download-models.sh && ./scripts/download-models.sh

# ffmpeg stays installed — the /verify_liveness endpoint shells out to it for
# frame extraction. curl is only needed during the model-download step and is
# purged below to keep the runtime image small.
RUN apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

COPY src/service.py ./src/service.py

RUN uv run --no-sync python -c "import cv2; detector = cv2.FaceDetectorYN.create('/app/models/face_detection_yunet_2023mar.onnx', '', (320, 320), 0.85, 0.3, 5000); recognizer = cv2.FaceRecognizerSF.create('/app/models/face_recognition_sface_2021dec.onnx', ''); assert detector is not None; assert recognizer is not None"

RUN groupadd --system app \
  && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
  && chown -R app:app /app

ENV BIOMETRIC_VERIFIER_DETECTOR_PATH=/app/models/face_detection_yunet_2023mar.onnx \
    BIOMETRIC_VERIFIER_MODEL_PATH=/app/models/face_recognition_sface_2021dec.onnx \
    PATH="/app/.venv/bin:${PATH}" \
    PORT=8080

EXPOSE 8080

USER app

CMD ["uv", "run", "--no-sync", "python", "src/service.py"]
