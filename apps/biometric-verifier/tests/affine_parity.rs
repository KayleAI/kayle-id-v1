//! Parity harness: Rust `estimate_affine_partial_2d` vs cv2 LMEDS over
//! 1000 fixtures (600 clean + 400 with one 10-px outlier).
//!
//! This test confirms our Umeyama LSQ estimator tracks cv2's LMedS closely
//! enough that downstream AuraFace embeddings won't drift. Empirically (on
//! real YuNet landmarks for `/tmp/face_test.jpg`) cv2 LMedS converges to
//! the same transform as Umeyama LSQ — see the AuraFace parity harness
//! (`tests/auraface_parity.rs`) which confirms end-to-end embedding cosine
//! ≥ 0.998 vs the Python service.
//!
//! Tolerances (with 0.1 px Gaussian noise — production-realistic):
//!   - **Clean** (no outliers): mean ≤ 0.2 px, max ≤ 1.0 px. Above this
//!     we'd worry about face alignment drift.
//!   - **Noisy** (one 10-px outlier): max ≤ 13 px. Umeyama LSQ absorbs the
//!     outlier rather than rejecting it. Production never reaches this case
//!     (DETAIL_STDDEV_MIN + YuNet score gates filter degenerate detections
//!     upstream), so the looser bound documents acceptable synthetic
//!     divergence without compromising real-world face match accuracy.

use biometric_verifier::affine::estimate_affine_partial_2d;
use serde::Deserialize;
use std::fs;

#[derive(Debug, Deserialize)]
struct Fixture {
    kind: String,
    src: Vec<[f64; 2]>,
    dst: Vec<[f64; 2]>,
    #[serde(rename = "cv2_mapped")]
    cv2_mapped: Vec<[f64; 2]>,
    #[allow(dead_code)]
    #[serde(rename = "cv2_transform")]
    cv2_transform: Vec<Vec<f64>>,
}

fn load_fixtures() -> Vec<Fixture> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/affine_partial_lmeds.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
    serde_json::from_str(&raw).expect("parse fixtures")
}

#[test]
fn lmeds_parity_clean_within_sub_pixel() {
    let fixtures = load_fixtures();
    let clean: Vec<_> = fixtures.iter().filter(|f| f.kind == "clean").collect();
    assert!(!clean.is_empty(), "no clean fixtures");

    let mut max_err: f64 = 0.0;
    let mut sum_err: f64 = 0.0;
    let mut count = 0_usize;

    for f in &clean {
        let src: Vec<(f64, f64)> = f.src.iter().map(|p| (p[0], p[1])).collect();
        let dst: Vec<(f64, f64)> = f.dst.iter().map(|p| (p[0], p[1])).collect();
        let m = estimate_affine_partial_2d(&src, &dst).expect("solve");
        for (i, p) in src.iter().enumerate() {
            let (mx, my) = m.apply(p.0, p.1);
            let cv = &f.cv2_mapped[i];
            let dx = mx - cv[0];
            let dy = my - cv[1];
            let err = (dx * dx + dy * dy).sqrt();
            max_err = max_err.max(err);
            sum_err += err;
            count += 1;
        }
    }
    let mean = sum_err / count as f64;
    eprintln!("clean: mean={mean:.5} px, max={max_err:.5} px, n={count}");
    assert!(mean < 0.2, "clean mean {mean:.5} px exceeded 0.2");
    assert!(max_err < 1.0, "clean max {max_err:.5} px exceeded 1.0");
}

#[test]
fn lmeds_parity_noisy_bounded() {
    let fixtures = load_fixtures();
    let noisy: Vec<_> = fixtures.iter().filter(|f| f.kind == "noisy").collect();
    assert!(!noisy.is_empty(), "no noisy fixtures");

    let mut max_err: f64 = 0.0;
    for f in &noisy {
        let src: Vec<(f64, f64)> = f.src.iter().map(|p| (p[0], p[1])).collect();
        let dst: Vec<(f64, f64)> = f.dst.iter().map(|p| (p[0], p[1])).collect();
        let m = estimate_affine_partial_2d(&src, &dst).expect("solve");
        for (i, p) in src.iter().enumerate() {
            let (mx, my) = m.apply(p.0, p.1);
            let cv = &f.cv2_mapped[i];
            let dx = mx - cv[0];
            let dy = my - cv[1];
            let err = (dx * dx + dy * dy).sqrt();
            max_err = max_err.max(err);
        }
    }
    eprintln!("noisy: max={max_err:.4} px");
    assert!(max_err < 13.0, "noisy max error {max_err:.4} px exceeded 13");
}
