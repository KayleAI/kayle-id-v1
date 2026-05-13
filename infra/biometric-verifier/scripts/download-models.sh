#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/../models"

OPENCV_ZOO_COMMIT="a74cdfad334b102cbd8daed769fbe1d4cb1c327a"
OPENCV_ZOO_RAW_BASE="https://github.com/opencv/opencv_zoo/raw/${OPENCV_ZOO_COMMIT}"

DETECTOR_MODEL="face_detection_yunet_2023mar.onnx"
DETECTOR_MODEL_SHA256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
DETECTOR_MODEL_URL="${OPENCV_ZOO_RAW_BASE}/models/face_detection_yunet/${DETECTOR_MODEL}"

# Face recognition: AuraFace (fal/AuraFace-v1 on HuggingFace). A
# ResNet100 ArcFace embedding model trained on commercially-usable
# data and published under Apache 2.0. We mirror the upstream
# `glintr100.onnx` file verbatim on Kayle's R2 bucket (sha256 below
# matches the LFS oid on HuggingFace), so supply-chain provenance
# lives at the Kayle hop alongside the mesh model. See
# THIRD_PARTY_NOTICES.md for attribution and
# https://github.com/KayleAI/models/tree/main/auraface for the
# fetch + verification scripts.
RECOGNIZER_MODEL="auraface_glintr100.onnx"
RECOGNIZER_MODEL_SHA256="a7933ea5330113b01c9b60351d8f4c33003f145d8470ac5f0e52ee2effe25c60"
RECOGNIZER_MODEL_URL="https://models.kayle.ai/${RECOGNIZER_MODEL}"

# MediaPipe Face Landmarker (478-pt mesh + iris), converted from
# Google's official .task distribution by the conversion script at
# https://github.com/KayleAI/models/blob/main/face-landmarks-detector/scripts/convert.py
# and rehosted on Kayle's R2 bucket. Apache 2.0 licensed; see
# THIRD_PARTY_NOTICES.md for attribution. Pin is tied to a specific
# conversion output — any upstream change to Google's TFLite that
# alters the converted ONNX will fail this checksum and trip a build.
#
# AuraFace and the Face Landmarker live behind models.kayle.ai;
# the supply-chain.test.ts test asserts no direct upstream fetches
# (Google CDN, HuggingFace LFS) appear in the production fetch path.
MESH_MODEL="face_landmarks_detector.onnx"
MESH_MODEL_SHA256="3235ba53fbbce83e3451c7d2fe95f6e884e0fa3d6c25f081fa2282f92c556231"
MESH_MODEL_URL="https://models.kayle.ai/${MESH_MODEL}"

# Presentation-Attack Detection (PAD): a pair of MiniFASNet face
# anti-spoofing models from Minivision-AI's Silent-Face-Anti-Spoofing
# release, converted from PyTorch by the script at
# https://github.com/KayleAI/models/blob/main/pad/scripts/convert.py
# and mirrored on Kayle's R2 bucket alongside AuraFace and the mesh
# model. The ONNX files themselves also live in the models repo
# under `pad/` for transparent provenance — they're small (~1.7 MB
# each) so it's worth carrying them in-tree. Apache 2.0 licensed;
# see THIRD_PARTY_NOTICES.md for attribution.
#
# Inference uses BOTH models as an ensemble (summed softmaxes) —
# this matches Minivision's reference predictor and the accuracy
# numbers their model card cites. Each model expects a different
# crop scale around the YuNet bbox; `service.py` encodes those
# scales (2.7 and 4.0) when preparing the per-model input.
PAD_V2_MODEL="pad_minifasnet_v2_scale27.onnx"
PAD_V2_MODEL_SHA256="46336256a5812b993e59241aa10e345e1fde185ca8792671f3b33b40852b794f"
PAD_V2_MODEL_URL="https://models.kayle.ai/${PAD_V2_MODEL}"

PAD_V1SE_MODEL="pad_minifasnet_v1se_scale40.onnx"
PAD_V1SE_MODEL_SHA256="4476da21e6865fd4dc4f0dab5eb2002cc07bdd33e1e902ecb5aea9bac885db45"
PAD_V1SE_MODEL_URL="https://models.kayle.ai/${PAD_V1SE_MODEL}"

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

download_model \
  "${MESH_MODEL_URL}" \
  "${MODELS_DIR}/${MESH_MODEL}" \
  "${MESH_MODEL_SHA256}"

download_model \
  "${PAD_V2_MODEL_URL}" \
  "${MODELS_DIR}/${PAD_V2_MODEL}" \
  "${PAD_V2_MODEL_SHA256}"

download_model \
  "${PAD_V1SE_MODEL_URL}" \
  "${MODELS_DIR}/${PAD_V1SE_MODEL}" \
  "${PAD_V1SE_MODEL_SHA256}"

echo "Biometric verifier models are ready in ${MODELS_DIR}"
