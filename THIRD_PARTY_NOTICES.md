# Third-Party Notices

This project includes third-party model artifacts used by the biometric
verifier in
[`infra/biometric-verifier/models/`](/Users/arsen/Kayle/kayle-id/infra/biometric-verifier/models).

## Face Recognition: AuraFace

- Component: `auraface_glintr100.onnx`
- Upstream project: fal/AuraFace-v1
- Upstream artifact: `glintr100.onnx` (ResNet100 ArcFace face-embedding
  model, trained on commercially-usable data)
- License: Apache License 2.0
- Source:
  - Upstream repository: <https://huggingface.co/fal/AuraFace-v1>
  - Upstream file:
    <https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx>
  - Upstream license:
    <https://huggingface.co/fal/AuraFace-v1/blob/main/LICENSE.md>
  - ONNX distribution mirror (used by this project at build time):
    <https://models.kayle.ai/auraface_glintr100.onnx>
  - License + NOTICE in the Kayle models repo:
    <https://github.com/KayleAI/models/tree/main/auraface>

The Kayle-hosted ONNX is a verbatim byte-for-byte mirror of the upstream
`glintr100.onnx` published by fal.ai on Hugging Face — the sha256 used
by the build matches the upstream LFS oid. The Apache 2.0 license terms
carry through to the mirror. AuraFace is published by fal.ai
specifically to enable commercial face-recognition use cases; the
upstream model card calls this out explicitly.

Copyright © fal.ai. Used with attribution under the terms of the Apache
License, Version 2.0.

## Face Detection: YuNet

- Component: `face_detection_yunet_2023mar.onnx`
- Upstream project: OpenCV Zoo
- Upstream directory:
  `models/face_detection_yunet`
- License: MIT License
- Source:
  - <https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet>
  - <https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/README.md>
  - <https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/LICENSE>

Upstream notice:

> All files in this directory are licensed under MIT License.

MIT license text for YuNet:

```text
MIT License

Copyright (c) 2020 Shiqi Yu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Presentation Attack Detection (Silent-Face-Anti-Spoofing / MiniFASNet)

- Components: `pad_minifasnet_v2_scale27.onnx` and
  `pad_minifasnet_v1se_scale40.onnx` (used together as an ensemble)
- Upstream project: Silent-Face-Anti-Spoofing
- Upstream artifact: MiniFASNetV2 + MiniFASNetV1SE PyTorch checkpoints
  at scales 2.7 and 4.0 around the face bbox
- License: Apache License 2.0
- Source:
  - Upstream repository: <https://github.com/minivision-ai/Silent-Face-Anti-Spoofing>
    @ commit `b6d5f04ad78778917853b25c778acef6d5626d15`
  - Upstream weights:
    `resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth` and
    `resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth`
  - Conversion script (PyTorch → ONNX) hosted by Kayle:
    <https://github.com/KayleAI/models/blob/main/pad/scripts/convert.py>
  - ONNX distribution mirror (used by this project at build time):
    <https://models.kayle.ai/pad_minifasnet_v2_scale27.onnx> and
    <https://models.kayle.ai/pad_minifasnet_v1se_scale40.onnx>
  - License + NOTICE in the Kayle models repo:
    <https://github.com/KayleAI/models/tree/main/pad>

The Kayle-hosted ONNX files are format-only derivative works of
Minivision's PyTorch state dicts — the weights and architecture are
unchanged; only the serialization format and filenames differ. The
Apache 2.0 license terms carry through to the converted artifacts.
See the upstream license link above for the full text.

Copyright © 2020 Minivision Technology Company. Used with attribution
under the terms of the Apache License, Version 2.0.

## Face Landmarks Detector (MediaPipe Face Landmarker)

- Component: `face_landmarks_detector.onnx`
- Upstream project: MediaPipe (Google)
- Upstream artifact: MediaPipe Face Landmarker (478-point face mesh + iris)
- License: Apache License 2.0
- Source:
  - Upstream `.task` distribution:
    <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>
  - Upstream repository: <https://github.com/google-ai-edge/mediapipe>
  - Conversion script (TFLite → ONNX) hosted by Kayle:
    <https://github.com/KayleAI/models/blob/main/face-landmarks-detector/scripts/convert.py>
  - ONNX distribution mirror (used by this project at build time):
    <https://models.kayle.ai/face_landmarks_detector.onnx>
  - License + NOTICE in the Kayle models repo:
    <https://github.com/KayleAI/models/tree/main/face-landmarks-detector>

The Kayle-hosted ONNX is a format-only derivative work of Google's TFLite —
the weights and architecture are unchanged; only the serialization format
differs. The Apache 2.0 license terms (and Google's NOTICE attribution) carry
through to the converted artifact. See the upstream license link above for
the full text.

Copyright 2019-2024 The MediaPipe Authors / Google LLC. Used with attribution
under the terms of the Apache License, Version 2.0.
