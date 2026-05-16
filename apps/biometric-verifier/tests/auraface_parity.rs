//! End-to-end Phase 2 parity: Rust face-match pipeline vs Python.
//!
//! Pipeline:
//!   decode JPEG → resize 320×320 → YuNet detect → pick best face →
//!   align_crop (LMedS partial affine + warpAffine) → 112×112 BGR →
//!   AuraFace ONNX → L2-normalize → 512-d embedding.
//!
//! Tolerance: cosine(rust_embedding, python_embedding) ≥ **0.998**.
//!
//! Empirical floor: feeding cv2's exact crop bytes through the Rust
//! AuraFace path yields cosine = 1.000000 (bit-exact preprocessing
//! parity). The end-to-end gap from Python's full pipeline is ~1.2e-3
//! cosine — entirely from sub-LSB rounding differences in
//! `resize_bilinear_bgr` and `warp_affine_bgr` vs cv2's INTER_LINEAR
//! fixed-point bilinear. After the `(cos+1)/2` normalization that
//! translates to a `faceMatchScore` drift of ~6e-4, far below the
//! production threshold of 0.7. Closing the last 0.001 would require
//! reproducing cv2's exact 11-bit subpixel + saturate_cast rounding
//! (~100 LOC) — not worth it.

use biometric_verifier::affine::resize_bilinear_bgr;
use biometric_verifier::auraface::{cosine, AuraFaceRecognizer};
use biometric_verifier::image_io::BgrImage;
use biometric_verifier::yunet::{pick_best_face, YunetDetector};
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Fixture {
    image_path: String,
    model_input_size: [u32; 2],
    embedding: Vec<f64>,
}

#[test]
fn auraface_embedding_parity_against_python() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/auraface_embedding.json");
    let fixture: Fixture =
        serde_json::from_str(&fs::read_to_string(&path).expect("read")).expect("parse");
    let Ok(bytes) = fs::read(&fixture.image_path) else {
        eprintln!("skipping: image not found at {}", fixture.image_path);
        return;
    };
    let image = BgrImage::from_jpeg(&bytes).expect("jpeg decode");

    let (mw, mh) = (
        fixture.model_input_size[0] as usize,
        fixture.model_input_size[1] as usize,
    );
    let resized_pixels =
        resize_bilinear_bgr(&image.pixels, image.width, image.height, mw, mh);
    let resized = BgrImage {
        width: mw,
        height: mh,
        pixels: resized_pixels,
    };

    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let detector_model = manifest.join("models/face_detection_yunet_2023mar.dynamic.onnx");
    let auraface_model = manifest.join("models/auraface_glintr100.onnx");
    if !detector_model.exists() || !auraface_model.exists() {
        eprintln!("skipping: models missing");
        return;
    }

    let detector =
        YunetDetector::from_file(detector_model.to_str().unwrap(), Some(1)).expect("detector");
    let recognizer = AuraFaceRecognizer::from_file(auraface_model.to_str().unwrap(), Some(1))
        .expect("recognizer");

    let detections = detector.detect(&resized).expect("detect");
    let best = pick_best_face(&detections).expect("a face was found");
    let landmarks: [(f64, f64); 5] = [
        best.landmark(0),
        best.landmark(1),
        best.landmark(2),
        best.landmark(3),
        best.landmark(4),
    ];

    let crop = recognizer
        .align_crop(&resized.pixels, resized.width, resized.height, &landmarks)
        .expect("align_crop succeeds");
    let embedding = recognizer
        .feature(&crop)
        .expect("feature ran")
        .expect("non-empty embedding");

    assert_eq!(embedding.len(), fixture.embedding.len(), "dim mismatch");

    let cos = cosine(&embedding, &fixture.embedding);
    eprintln!("rust↔python embedding cosine = {cos:.6}");
    assert!(
        cos >= 0.998,
        "embedding cosine {cos:.6} below 0.998 — Phase 2 parity floor breached"
    );
}
