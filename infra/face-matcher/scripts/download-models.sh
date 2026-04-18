#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/../models"

RECOGNIZER_MODEL_URL="https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
DETECTOR_MODEL_URL="https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"

mkdir -p "${MODELS_DIR}"

if [ ! -f "${MODELS_DIR}/face_recognition_sface_2021dec.onnx" ]; then
  curl -L "${RECOGNIZER_MODEL_URL}" -o "${MODELS_DIR}/face_recognition_sface_2021dec.onnx"
fi

if [ ! -f "${MODELS_DIR}/face_detection_yunet_2023mar.onnx" ]; then
  curl -L "${DETECTOR_MODEL_URL}" -o "${MODELS_DIR}/face_detection_yunet_2023mar.onnx"
fi

echo "Face matcher models are ready in ${MODELS_DIR}"
