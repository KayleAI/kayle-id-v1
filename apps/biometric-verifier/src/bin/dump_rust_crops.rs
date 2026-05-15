//! Dump Rust's 320×320 resized image and 112×112 aligned crop to
//! /tmp/rust_resized_320.bgr and /tmp/rust_crop_112.bgr for binary
//! comparison against cv2's outputs.

use biometric_verifier::affine::{estimate_affine_partial_2d, resize_bilinear_bgr, warp_affine_bgr};
use biometric_verifier::auraface::arcface_template_112;
use biometric_verifier::image_io::BgrImage;
use biometric_verifier::yunet::{pick_best_face, YunetDetector};
use std::fs;
use std::path::Path;

fn main() -> anyhow::Result<()> {
    let bytes = fs::read("/tmp/face_test.jpg")?;
    let image = BgrImage::from_jpeg(&bytes)?;
    let resized_pixels = resize_bilinear_bgr(&image.pixels, image.width, image.height, 320, 320);
    fs::write("/tmp/rust_resized_320.bgr", &resized_pixels)?;
    let resized = BgrImage {
        width: 320,
        height: 320,
        pixels: resized_pixels,
    };

    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let detector = YunetDetector::from_file(
        manifest
            .join("models/face_detection_yunet_2023mar.dynamic.onnx")
            .to_str()
            .unwrap(),
        Some(1),
    )?;
    let detections = detector.detect(&resized)?;
    let best = pick_best_face(&detections).unwrap();
    let landmarks: [(f64, f64); 5] = [
        best.landmark(0),
        best.landmark(1),
        best.landmark(2),
        best.landmark(3),
        best.landmark(4),
    ];
    println!("best confidence: {:.4}", best.confidence());
    println!("rust landmarks:");
    for (i, (x, y)) in landmarks.iter().enumerate() {
        println!("  [{i}] ({x:.4}, {y:.4})");
    }

    let template = arcface_template_112();
    let transform = estimate_affine_partial_2d(&landmarks, &template).unwrap();
    println!("rust transform:\n  [{:.6} {:.6} {:.6}]\n  [{:.6} {:.6} {:.6}]",
        transform.0[0][0], transform.0[0][1], transform.0[0][2],
        transform.0[1][0], transform.0[1][1], transform.0[1][2]);

    let crop = warp_affine_bgr(&resized.pixels, 320, 320, transform, 112, 112);
    fs::write("/tmp/rust_crop_112.bgr", &crop)?;
    println!("dumped rust crops");
    Ok(())
}
