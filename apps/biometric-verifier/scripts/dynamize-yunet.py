#!/usr/bin/env python3
"""Rewrite the YuNet ONNX input to accept dynamic H/W.

The upstream YuNet export from OpenCV Zoo declares input shape
`[1, 3, 640, 640]` with fixed 640×640. `cv::dnn` doesn't care because
its runtime reshapes on the fly, but `ort` strictly enforces declared
shapes. We rewrite dim[2] and dim[3] to symbolic ("H", "W") and clear
the value_info shapes so downstream conv ops infer from input. The
output is saved alongside the original with a `.dynamic.onnx` suffix.

SHA pin in download-models.sh remains tied to the upstream file; this
script's output is regenerated each run and not pinned.

Usage: dynamize-yunet.py <input.onnx> <output.onnx>
"""

import sys
from pathlib import Path

import onnx


def main():
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])

    model = onnx.load(str(src))
    inp = model.graph.input[0]
    shape = inp.type.tensor_type.shape

    # dim layout: [batch=1, channels=3, height, width]
    shape.dim[2].ClearField("dim_value")
    shape.dim[2].dim_param = "H"
    shape.dim[3].ClearField("dim_value")
    shape.dim[3].dim_param = "W"

    # Clear all value_info shape inferences — they were specialized for
    # 640×640. ORT re-runs shape inference at session init from the
    # input symbol; leaving stale specialized shapes would conflict.
    while model.graph.value_info:
        model.graph.value_info.pop()

    # Outputs depend on input H/W too; clear their dim values so they
    # re-infer.
    for out in model.graph.output:
        for dim in out.type.tensor_type.shape.dim:
            if dim.HasField("dim_value"):
                dim.ClearField("dim_value")

    onnx.checker.check_model(model)
    onnx.save(model, str(dst))
    print(f"wrote dynamic-shape model to {dst}", file=sys.stderr)


if __name__ == "__main__":
    main()
