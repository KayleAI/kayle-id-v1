#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/../models"

OPENCV_ZOO_COMMIT="a74cdfad334b102cbd8daed769fbe1d4cb1c327a"
OPENCV_ZOO_RAW_BASE="https://github.com/opencv/opencv_zoo/raw/${OPENCV_ZOO_COMMIT}"

RECOGNIZER_MODEL="face_recognition_sface_2021dec.onnx"
RECOGNIZER_MODEL_SHA256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
RECOGNIZER_MODEL_URL="${OPENCV_ZOO_RAW_BASE}/models/face_recognition_sface/${RECOGNIZER_MODEL}"

DETECTOR_MODEL="face_detection_yunet_2023mar.onnx"
DETECTOR_MODEL_SHA256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
DETECTOR_MODEL_URL="${OPENCV_ZOO_RAW_BASE}/models/face_detection_yunet/${DETECTOR_MODEL}"

verify_checksum() {
  local file="$1"
  local expected="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "${expected}" "${file}" | sha256sum --check --status
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    local actual
    actual="$(shasum -a 256 "${file}" | awk '{print $1}')"
    [[ "${actual}" == "${expected}" ]]
    return
  fi

  echo "Neither sha256sum nor shasum is available for model verification." >&2
  return 1
}

download_model() {
  local url="$1"
  local destination="$2"
  local expected_sha256="$3"

  if [ -f "${destination}" ]; then
    if verify_checksum "${destination}" "${expected_sha256}"; then
      return
    fi

    echo "Existing model checksum mismatch: ${destination}" >&2
    rm -f "${destination}"
  fi

  local temp_file
  temp_file="$(mktemp "${destination}.tmp.XXXXXX")"

  if ! curl --fail --location --show-error --silent "${url}" -o "${temp_file}"; then
    rm -f "${temp_file}"
    return 1
  fi

  if ! verify_checksum "${temp_file}" "${expected_sha256}"; then
    echo "Downloaded model checksum mismatch: ${url}" >&2
    rm -f "${temp_file}"
    return 1
  fi

  mv "${temp_file}" "${destination}"
}

mkdir -p "${MODELS_DIR}"

download_model \
  "${RECOGNIZER_MODEL_URL}" \
  "${MODELS_DIR}/${RECOGNIZER_MODEL}" \
  "${RECOGNIZER_MODEL_SHA256}"

download_model \
  "${DETECTOR_MODEL_URL}" \
  "${MODELS_DIR}/${DETECTOR_MODEL}" \
  "${DETECTOR_MODEL_SHA256}"

echo "Biometric verifier models are ready in ${MODELS_DIR}"
