FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

COPY scripts/download-models.sh ./scripts/download-models.sh
RUN chmod +x ./scripts/download-models.sh && ./scripts/download-models.sh

RUN apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

COPY src/service.py ./src/service.py

RUN uv run --no-sync python -c "import cv2; detector = cv2.FaceDetectorYN.create('/app/models/face_detection_yunet_2023mar.onnx', '', (320, 320), 0.85, 0.3, 5000); recognizer = cv2.FaceRecognizerSF.create('/app/models/face_recognition_sface_2021dec.onnx', ''); assert detector is not None; assert recognizer is not None"

RUN groupadd --system app \
  && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
  && chown -R app:app /app

ENV FACE_MATCHER_DETECTOR_PATH=/app/models/face_detection_yunet_2023mar.onnx \
    FACE_MATCHER_MODEL_PATH=/app/models/face_recognition_sface_2021dec.onnx \
    PATH="/app/.venv/bin:${PATH}" \
    PORT=8080

EXPOSE 8080

USER app

CMD ["uv", "run", "--no-sync", "python", "src/service.py"]
