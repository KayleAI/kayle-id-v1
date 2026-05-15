//! One-shot diagnostic: load each ONNX model via `ort` and print its
//! input/output names + shapes. Used during Phase 2 to confirm tensor
//! layout assumptions (NCHW vs NHWC) before writing the per-model
//! preprocessing code.

use ort::session::Session;
use std::env;

fn dump(path: &str) {
    println!("=== {path} ===");
    let session = match Session::builder()
        .and_then(|b| b.commit_from_file(path))
    {
        Ok(s) => s,
        Err(e) => {
            println!("  LOAD FAILED: {e}");
            return;
        }
    };
    for input in &session.inputs {
        println!(
            "  input  name={:<24} dtype={:?} shape={:?}",
            input.name, input.input_type, input.input_type
        );
    }
    for output in &session.outputs {
        println!(
            "  output name={:<24} dtype={:?}",
            output.name, output.output_type
        );
    }
}

fn main() {
    let base = env::args()
        .nth(1)
        .unwrap_or_else(|| "models".to_string());
    for name in [
        "face_detection_yunet_2023mar.onnx",
        "auraface_glintr100.onnx",
        "face_landmarks_detector.onnx",
        "pad_minifasnet_v2_scale27.onnx",
        "pad_minifasnet_v1se_scale40.onnx",
    ] {
        dump(&format!("{base}/{name}"));
    }
}
