# Multi-stage Rust build for the biometric verifier container.
#
# Migrated from the Python + uv image (`service.py`); the container's
# HTTP contract is unchanged. See ../scripts/dynamize-yunet.py for the
# one-shot ONNX rewrite needed because the upstream YuNet export
# declares fixed 640×640 input shape (ort enforces this; cv::dnn was
# tolerant in the Python build).

# ---- Stage 1: build Rust binary ---------------------------------------
FROM rust:1.91-slim-bookworm AS builder
WORKDIR /build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       pkg-config \
       libssl-dev \
       clang \
       libavcodec-dev \
       libavformat-dev \
       libavutil-dev \
       libswscale-dev \
       libavfilter-dev \
  && rm -rf /var/lib/apt/lists/*

# Cache deps separately so source-only changes don't redownload crates.
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src && echo 'fn main(){}' > src/main.rs && cargo build --release --bin biometric-verifier && rm -rf src

COPY src/ ./src/
RUN cargo build --release --locked --bin biometric-verifier

# ---- Stage 2: fetch + dynamize models ---------------------------------
# Reuse the existing download-models.sh verbatim. The dynamize step
# rewrites YuNet's input shape from fixed 640×640 to dynamic H/W so
# the Rust ort runtime can run at the actual frame resolution.
FROM debian:bookworm-slim AS models
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       curl \
       ca-certificates \
       python3 \
       python3-pip \
  && pip3 install --no-cache-dir --break-system-packages onnx==1.16.2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY scripts/download-models.sh ./scripts/
COPY scripts/dynamize-yunet.py ./scripts/
RUN chmod +x scripts/download-models.sh \
  && scripts/download-models.sh \
  && python3 scripts/dynamize-yunet.py \
       models/face_detection_yunet_2023mar.onnx \
       models/face_detection_yunet_2023mar.dynamic.onnx \
  && rm models/face_detection_yunet_2023mar.onnx \
  && mv models/face_detection_yunet_2023mar.dynamic.onnx models/face_detection_yunet_2023mar.onnx

# ---- Stage 3: runtime image -------------------------------------------
# Runtime needs the libav .so's for ffmpeg-next; ort's download-binaries
# feature statically links libonnxruntime so no extra ONNX lib ships.
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libavcodec59 \
       libavformat59 \
       libavutil57 \
       libswscale6 \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=builder /build/target/release/biometric-verifier /app/biometric-verifier
COPY --from=models /work/models /app/models
RUN chown -R app:app /app

ENV BIOMETRIC_VERIFIER_DETECTOR_PATH=/app/models/face_detection_yunet_2023mar.onnx \
    BIOMETRIC_VERIFIER_MODEL_PATH=/app/models/auraface_glintr100.onnx \
    BIOMETRIC_VERIFIER_PAD_V2_MODEL_PATH=/app/models/pad_minifasnet_v2_scale27.onnx \
    BIOMETRIC_VERIFIER_PAD_V1SE_MODEL_PATH=/app/models/pad_minifasnet_v1se_scale40.onnx \
    BIOMETRIC_VERIFIER_MESH_MODEL_PATH=/app/models/face_landmarks_detector.onnx \
    PORT=8080

EXPOSE 8080
USER app
CMD ["/app/biometric-verifier"]
