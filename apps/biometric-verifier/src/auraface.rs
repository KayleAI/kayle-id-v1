//! AuraFace embedding + cosine matching.
//!
//! Replaces `AuraFaceRecognizer` at `service.py:379-445`.
//!
//! Preprocessing mirrors `cv2.dnn.blobFromImage(crop, 1/127.5, (112,112),
//! (127.5,127.5,127.5), swapRB=True)`: BGR→RGB channel swap, subtract 127.5,
//! divide by 127.5 → range [-1, +1]. Layout NCHW `(1, 3, 112, 112)` f32.
//!
//! Output: 512-d float embedding, L2-normalized. Match: cosine = `np.dot`
//! of two unit embeddings; the normalization step
//! `(raw + 1.0) / 2.0` is the caller's job (see `normalize_cosine_score`
//! in [`crate::pipeline`]).

use crate::affine::{
    estimate_affine_partial_2d, population_std_u8, resize_bilinear_bgr, warp_affine_bgr,
    bgr_to_gray,
};
use crate::config::{DEFAULT_THRESHOLD, DETAIL_STDDEV_MIN, MODEL_INPUT_SIZE};
use anyhow::{Context, Result};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{TensorValueType, Value};
use std::sync::Mutex;

pub const EMBEDDING_DIM: usize = 512;

/// L2-normalized 512-d embedding from AuraFace.
pub type Embedding = Vec<f64>;

/// AuraFace recognizer wrapping the ONNX session.
pub struct AuraFaceRecognizer {
    session: Mutex<Session>,
    input_name: String,
}

impl AuraFaceRecognizer {
    pub fn from_file(path: &str, intra_threads: Option<i32>) -> Result<Self> {
        let mut builder = Session::builder()
            .context("ort builder")?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .context("optimization level")?;
        if let Some(n) = intra_threads {
            builder = builder.with_intra_threads(n as usize).context("intra threads")?;
        }
        let session = builder.commit_from_file(path).context("session from file")?;
        let input_name = session
            .inputs
            .first()
            .context("auraface model has no inputs")?
            .name
            .clone();
        Ok(Self {
            session: Mutex::new(session),
            input_name,
        })
    }

    /// Align via 5-point similarity → warp to 112×112 BGR. Mirrors
    /// `AuraFaceRecognizer.align_crop` at `service.py:393-414`.
    pub fn align_crop(
        &self,
        image: &[u8],
        image_width: usize,
        image_height: usize,
        landmarks: &[(f64, f64); 5],
    ) -> Option<Vec<u8>> {
        let template = arcface_template_112();
        let transform = estimate_affine_partial_2d(landmarks, &template)?;
        let crop = warp_affine_bgr(
            image,
            image_width,
            image_height,
            transform,
            MODEL_INPUT_SIZE.0,
            MODEL_INPUT_SIZE.1,
        );
        Some(crop)
    }

    /// Run AuraFace on a 112×112 BGR crop and return the L2-normalized
    /// 512-d embedding. Mirrors `AuraFaceRecognizer.feature` at
    /// `service.py:416-441`.
    pub fn feature(&self, bgr_crop_112: &[u8]) -> Result<Option<Embedding>> {
        if bgr_crop_112.len() != 112 * 112 * 3 {
            anyhow::bail!("auraface feature: expected 112×112 BGR, got {}", bgr_crop_112.len());
        }
        let blob = preprocess_auraface(bgr_crop_112);
        let input_value: Value<TensorValueType<f32>> =
            Value::from_array(blob).context("input value")?;
        let output = {
            let mut session = self.session.lock().unwrap();
            let outputs = session
                .run(ort::inputs![self.input_name.as_str() => input_value])
                .context("auraface inference")?;
            let value = outputs
                .iter()
                .next()
                .context("auraface produced no outputs")?
                .1;
            let (_, data) = value
                .try_extract_tensor::<f32>()
                .context("extract embedding tensor")?;
            data.to_vec()
        };
        if output.is_empty() {
            return Ok(None);
        }
        // L2-normalize in f64 (matches Python `np.linalg.norm` precision).
        let mut emb: Vec<f64> = output.iter().map(|&v| v as f64).collect();
        let norm: f64 = emb.iter().map(|v| v * v).sum::<f64>().sqrt();
        if !norm.is_finite() || norm <= 0.0 {
            return Ok(None);
        }
        for v in emb.iter_mut() {
            *v /= norm;
        }
        Ok(Some(emb))
    }

    /// Compose `align_crop` → `feature` and apply the same
    /// `DETAIL_STDDEV_MIN` gate as `prepare_face_crop` at
    /// `service.py:448-470`. Returns `None` when the crop is too uniform
    /// (synthetic / no-face), matching the Python pipeline's drop logic.
    pub fn embed_from_yunet_landmarks(
        &self,
        image: &[u8],
        image_width: usize,
        image_height: usize,
        landmarks: &[(f64, f64); 5],
    ) -> Result<Option<Embedding>> {
        let Some(mut crop) = self.align_crop(image, image_width, image_height, landmarks) else {
            return Ok(None);
        };
        // Resize is redundant after warpAffine but matches the Python
        // `prepare_face_crop` flow exactly (`cv2.resize(prepared, (112,112))`).
        crop = resize_bilinear_bgr(&crop, MODEL_INPUT_SIZE.0, MODEL_INPUT_SIZE.1, MODEL_INPUT_SIZE.0, MODEL_INPUT_SIZE.1);
        let gray = bgr_to_gray(&crop, MODEL_INPUT_SIZE.0, MODEL_INPUT_SIZE.1);
        if population_std_u8(&gray) < DETAIL_STDDEV_MIN {
            return Ok(None);
        }
        self.feature(&crop)
    }
}

/// `cv2.dnn.blobFromImage(crop, 1/127.5, (112,112), (127.5,127.5,127.5), swapRB=True)`.
/// BGR → RGB channel swap, then `(pixel - 127.5) / 127.5` per channel,
/// laid out NCHW.
fn preprocess_auraface(bgr_112: &[u8]) -> Array4<f32> {
    let (w, h) = MODEL_INPUT_SIZE;
    let mut arr = Array4::<f32>::zeros((1, 3, h, w));
    let scale = 1.0_f32 / 127.5;
    for y in 0..h {
        for x in 0..w {
            let off = (y * w + x) * 3;
            let b = bgr_112[off] as f32;
            let g = bgr_112[off + 1] as f32;
            let r = bgr_112[off + 2] as f32;
            // After BGR→RGB swap and (pixel - 127.5) / 127.5:
            arr[[0, 0, y, x]] = (r - 127.5) * scale;
            arr[[0, 1, y, x]] = (g - 127.5) * scale;
            arr[[0, 2, y, x]] = (b - 127.5) * scale;
        }
    }
    arr
}

/// ArcFace 5-point template at 112×112 (`_ARCFACE_TEMPLATE_112` at
/// `service.py:189`). Right eye, left eye, nose, right mouth, left mouth.
pub fn arcface_template_112() -> [(f64, f64); 5] {
    [
        (38.2946, 51.6963),
        (73.5318, 51.5014),
        (56.0252, 71.7366),
        (41.5493, 92.3655),
        (70.7299, 92.2041),
    ]
}

/// Raw cosine similarity of two L2-normalized embeddings. Mirrors
/// `AuraFaceRecognizer.match` at `service.py:443-445` — `np.dot(a, b)`.
pub fn cosine(a: &Embedding, b: &Embedding) -> f64 {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// Normalize a raw cosine score `[-1, 1]` to `[0, 1]` and apply the
/// NaN-safe clamp from `clamp_score` (`service.py:229-235`).
pub fn normalize_cosine_score(raw: f64) -> f64 {
    let scaled = (raw + 1.0) / 2.0;
    clamp_score(scaled)
}

/// Mirrors `clamp_score` at `service.py:229-235`. Returns `DEFAULT_THRESHOLD`
/// (`0.7`) on NaN — a plain `clamp` would yield `1.0` and universally fail
/// the gate, which would be wrong.
pub fn clamp_score(value: f64) -> f64 {
    if value.is_nan() {
        return DEFAULT_THRESHOLD;
    }
    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn cosine_orthogonal_zero() {
        let mut a = vec![0.0; EMBEDDING_DIM];
        let mut b = vec![0.0; EMBEDDING_DIM];
        a[0] = 1.0;
        b[1] = 1.0;
        assert_abs_diff_eq!(cosine(&a, &b), 0.0, epsilon = 1e-12);
    }

    #[test]
    fn cosine_identical_one() {
        let mut a = vec![0.0; EMBEDDING_DIM];
        a[0] = 1.0;
        let b = a.clone();
        assert_abs_diff_eq!(cosine(&a, &b), 1.0, epsilon = 1e-12);
    }

    #[test]
    fn normalize_cosine_clamps_and_handles_nan() {
        assert_abs_diff_eq!(normalize_cosine_score(0.4), 0.7, epsilon = 1e-12);
        assert_abs_diff_eq!(normalize_cosine_score(-1.0), 0.0, epsilon = 1e-12);
        assert_abs_diff_eq!(normalize_cosine_score(1.0), 1.0, epsilon = 1e-12);
        assert_abs_diff_eq!(normalize_cosine_score(f64::NAN), DEFAULT_THRESHOLD, epsilon = 1e-12);
    }

    /// Port of `service_clamps_test.py::ClampScoreTests`. Locks the [0, 1]
    /// gate on `clamp_score` so a misconfigured caller cannot silently
    /// invert the face-match gate.
    #[test]
    fn clamp_score_passes_through_in_range() {
        assert_eq!(clamp_score(0.0), 0.0);
        assert_eq!(clamp_score(0.5), 0.5);
        assert_eq!(clamp_score(1.0), 1.0);
    }

    #[test]
    fn clamp_score_clamps_below_zero() {
        assert_eq!(clamp_score(-0.1), 0.0);
        assert_eq!(clamp_score(-999.0), 0.0);
    }

    #[test]
    fn clamp_score_clamps_above_one() {
        assert_eq!(clamp_score(1.0001), 1.0);
        assert_eq!(clamp_score(42.0), 1.0);
    }

    #[test]
    fn clamp_score_handles_infinities() {
        assert_eq!(clamp_score(f64::INFINITY), 1.0);
        assert_eq!(clamp_score(f64::NEG_INFINITY), 0.0);
    }

    #[test]
    fn clamp_score_nan_falls_back_to_default() {
        assert_eq!(clamp_score(f64::NAN), DEFAULT_THRESHOLD);
    }

    #[test]
    fn template_matches_python_constant() {
        let t = arcface_template_112();
        // Exact values from `service.py:189`.
        assert_eq!(t[0], (38.2946, 51.6963));
        assert_eq!(t[1], (73.5318, 51.5014));
        assert_eq!(t[2], (56.0252, 71.7366));
        assert_eq!(t[3], (41.5493, 92.3655));
        assert_eq!(t[4], (70.7299, 92.2041));
    }

    #[test]
    fn preprocess_centered_value() {
        // A 112×112 image of mid-gray (127, 127, 127) should map close to 0.
        let mid = vec![127_u8; 112 * 112 * 3];
        let arr = preprocess_auraface(&mid);
        let v = arr[[0, 0, 50, 50]];
        // (127 - 127.5)/127.5 ≈ -0.00392
        assert!((v - (-0.5 / 127.5) as f32).abs() < 1e-6);
    }

}
