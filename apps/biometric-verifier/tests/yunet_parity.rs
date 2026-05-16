//! Parity harness: Rust `YunetDetector::detect` vs `cv2.FaceDetectorYN`
//! on the same 320×320 BGR face image.
//!
//! Tolerance: each landmark within **2 px** of cv2's output, bbox corners
//! within **3 px**, confidence within **0.02**. The Rust preprocessing
//! goes through `resize_bilinear_bgr` (pixel-center coords) while cv2's
//! `cv2.resize` uses the same convention — sub-pixel parity should hold.
//! Larger tolerances would mask a missed sigmoid / wrong decoder formula.

use biometric_verifier::image_io::BgrImage;
use biometric_verifier::yunet::YunetDetector;
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Fixture {
    image_path: String,
    model_input_size: [u32; 2],
    detections: Vec<[f64; 15]>,
}

fn load_fixture() -> Fixture {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/yunet_detections.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read")).expect("parse")
}

#[test]
fn yunet_parity_against_cv2_facedetector_yn() {
    let fixture = load_fixture();
    let Ok(bytes) = fs::read(&fixture.image_path) else {
        eprintln!("skipping: image not found at {}", fixture.image_path);
        return;
    };
    let image = BgrImage::from_jpeg(&bytes).expect("jpeg decode");

    // Resize to the model input size to match cv2's setInputSize+detect flow
    // in `scripts/gen-yunet-fixture.py`.
    let (mw, mh) = (fixture.model_input_size[0] as usize, fixture.model_input_size[1] as usize);
    let resized_pixels = biometric_verifier::affine::resize_bilinear_bgr(
        &image.pixels, image.width, image.height, mw, mh,
    );
    let resized = BgrImage {
        width: mw,
        height: mh,
        pixels: resized_pixels,
    };

    let model_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("models/face_detection_yunet_2023mar.dynamic.onnx");
    if !model_path.exists() {
        eprintln!("skipping: model not at {}", model_path.display());
        return;
    }
    let detector =
        YunetDetector::from_file(model_path.to_str().unwrap(), Some(1)).expect("load detector");

    let detections = detector.detect(&resized).expect("detect");
    eprintln!(
        "cv2 expected {} detection(s), rust found {}",
        fixture.detections.len(),
        detections.len()
    );
    assert_eq!(
        detections.len(),
        fixture.detections.len(),
        "detection count mismatch"
    );

    for (i, (rust, cv)) in detections.iter().zip(fixture.detections.iter()).enumerate() {
        let row = &rust.row;
        let bbox_diff: Vec<f64> = (0..4).map(|k| (row[k] - cv[k]).abs()).collect();
        let lm_diff: Vec<f64> = (4..14).map(|k| (row[k] - cv[k]).abs()).collect();
        let conf_diff = (row[14] - cv[14]).abs();
        eprintln!(
            "det[{i}] bbox Δ max={:.3} px, landmark Δ max={:.3} px, conf Δ={:.4}",
            bbox_diff.iter().cloned().fold(0.0_f64, f64::max),
            lm_diff.iter().cloned().fold(0.0_f64, f64::max),
            conf_diff,
        );
        for (k, &d) in bbox_diff.iter().enumerate() {
            assert!(d < 3.0, "det[{i}] bbox[{k}] Δ {d:.3} > 3 px");
        }
        for (k, &d) in lm_diff.iter().enumerate() {
            assert!(d < 2.0, "det[{i}] landmark[{k}] Δ {d:.3} > 2 px");
        }
        assert!(conf_diff < 0.02, "det[{i}] conf Δ {conf_diff:.4} > 0.02");
    }
}
