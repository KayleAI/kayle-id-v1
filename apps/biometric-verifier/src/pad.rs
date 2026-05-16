//! Presentation-attack detection (anti-spoof) via the MiniFASNet
//! v2 + v1se ensemble.
//!
//! Replaces `crop_face_for_pad`, `_pad_softmax_3class`, `predict_pad_score`,
//! and `run_pad_over_timeline` at `service.py:1226-1426`.
//!
//! Critical-but-non-obvious preprocessing knobs (any of these wrong
//! silently degrades scores to near-baseline; see `service.py:1322-1326`):
//!   - `scalefactor = 1.0` (NOT `/255`) — feeds raw uint8-as-float [0, 255].
//!   - `swapRB = False` — channel order stays BGR.
//!   - `mean = (0, 0, 0)` — no mean subtraction.

use crate::affine::resize_bilinear_bgr;
use crate::auraface::clamp_score;
use crate::config::{PAD_FRAME_THRESHOLD, PAD_INPUT_SIZE, PAD_PASS_FRACTION};
use crate::image_io::BgrImage;
use crate::pose_timeline::PoseEntry;
use anyhow::{Context, Result};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{TensorValueType, Value};
use std::sync::Mutex;

pub struct PadDetector {
    pub v2: PadSession,
    pub v1se: PadSession,
    pub v2_scale: f64,
    pub v1se_scale: f64,
}

pub struct PadSession {
    session: Mutex<Session>,
    input_name: String,
}

impl PadSession {
    pub fn from_file(path: &str, intra_threads: Option<i32>) -> Result<Self> {
        let mut builder = Session::builder()
            .context("ort builder")?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .context("optimization level")?;
        if let Some(n) = intra_threads {
            builder = builder
                .with_intra_threads(n as usize)
                .context("intra threads")?;
        }
        let session = builder
            .commit_from_file(path)
            .context("session from file")?;
        let input_name = session
            .inputs
            .first()
            .context("PAD model has no inputs")?
            .name
            .clone();
        Ok(Self {
            session: Mutex::new(session),
            input_name,
        })
    }

    fn run(&self, crop_80: &[u8]) -> Result<Option<[f64; 3]>> {
        let blob = pad_preprocess_nchw(crop_80);
        let input_value: Value<TensorValueType<f32>> =
            Value::from_array(blob).context("input value")?;
        let logits = {
            let mut session = self.session.lock().unwrap();
            let outputs = session
                .run(ort::inputs![self.input_name.as_str() => input_value])
                .context("PAD inference")?;
            let value = outputs.iter().next().context("PAD produced no outputs")?.1;
            let (_, data) = value
                .try_extract_tensor::<f32>()
                .context("extract PAD tensor")?;
            if data.len() < 3 {
                return Ok(None);
            }
            [data[0] as f64, data[1] as f64, data[2] as f64]
        };
        Ok(Some(softmax_3class(&logits)))
    }
}

impl PadDetector {
    pub fn new(v2: PadSession, v1se: PadSession, v2_scale: f64, v1se_scale: f64) -> Self {
        Self {
            v2,
            v1se,
            v2_scale,
            v1se_scale,
        }
    }

    /// Run both PAD models on per-scale crops of the YuNet face and
    /// return the real-class probability (`summed[1] / 2`) clamped to
    /// `[0, 1]`. `None` when any crop / inference step fails.
    pub fn predict(&self, image: &BgrImage, bbox: (f64, f64, f64, f64)) -> Result<Option<f64>> {
        let Some(v2_crop) = crop_face_for_pad(image, bbox, self.v2_scale) else {
            return Ok(None);
        };
        let Some(v1se_crop) = crop_face_for_pad(image, bbox, self.v1se_scale) else {
            return Ok(None);
        };
        let Some(probs_v2) = self.v2.run(&v2_crop)? else {
            return Ok(None);
        };
        let Some(probs_v1se) = self.v1se.run(&v1se_crop)? else {
            return Ok(None);
        };
        let summed_real = probs_v2[1] + probs_v1se[1];
        Ok(Some(clamp_score(summed_real / 2.0)))
    }
}

/// 80×80 BGR crop centred on the YuNet bbox, sides scaled by `scale` and
/// clipped to the image. Direct port of `crop_face_for_pad` at
/// `service.py:1226-1286`. Edge clipping shifts the centre inward rather
/// than truncating, matching upstream `CropImage._get_new_box`.
pub fn crop_face_for_pad(
    image: &BgrImage,
    bbox: (f64, f64, f64, f64),
    scale: f64,
) -> Option<Vec<u8>> {
    let (src_w, src_h) = (image.width as f64, image.height as f64);
    if image.width <= 1 || image.height <= 1 {
        return None;
    }
    let (x, y, box_w, box_h) = bbox;
    if box_w <= 0.0 || box_h <= 0.0 {
        return None;
    }
    // Cap the requested scale so the new box always fits inside the source.
    let bounded_scale = [(src_h - 1.0) / box_h, (src_w - 1.0) / box_w, scale]
        .into_iter()
        .fold(f64::INFINITY, f64::min);
    if !bounded_scale.is_finite() || bounded_scale <= 0.0 {
        return None;
    }

    let new_w = box_w * bounded_scale;
    let new_h = box_h * bounded_scale;
    let cx = box_w / 2.0 + x;
    let cy = box_h / 2.0 + y;

    let mut lt_x = cx - new_w / 2.0;
    let mut lt_y = cy - new_h / 2.0;
    let mut rb_x = cx + new_w / 2.0;
    let mut rb_y = cy + new_h / 2.0;

    if lt_x < 0.0 {
        rb_x -= lt_x;
        lt_x = 0.0;
    }
    if lt_y < 0.0 {
        rb_y -= lt_y;
        lt_y = 0.0;
    }
    if rb_x > src_w - 1.0 {
        lt_x -= rb_x - (src_w - 1.0);
        rb_x = src_w - 1.0;
    }
    if rb_y > src_h - 1.0 {
        lt_y -= rb_y - (src_h - 1.0);
        rb_y = src_h - 1.0;
    }

    let x0 = lt_x as usize;
    let y0 = lt_y as usize;
    let x1 = rb_x as usize;
    let y1 = rb_y as usize;
    if x1 <= x0 || y1 <= y0 {
        return None;
    }

    // Python `image[y0:y1+1, x0:x1+1]` — inclusive on both ends.
    let crop_w = x1 + 1 - x0;
    let crop_h = y1 + 1 - y0;
    if crop_w == 0 || crop_h == 0 {
        return None;
    }
    let stride = image.width * 3;
    let crop_stride = crop_w * 3;
    let mut crop = vec![0_u8; crop_h * crop_stride];
    for row in 0..crop_h {
        let src_off = (y0 + row) * stride + x0 * 3;
        let dst_off = row * crop_stride;
        crop[dst_off..dst_off + crop_stride]
            .copy_from_slice(&image.pixels[src_off..src_off + crop_stride]);
    }
    Some(resize_bilinear_bgr(
        &crop,
        crop_w,
        crop_h,
        PAD_INPUT_SIZE.0,
        PAD_INPUT_SIZE.1,
    ))
}

/// `cv2.dnn.blobFromImage(crop, 1.0, (80, 80), (0,0,0), swapRB=False)`.
/// Output is NCHW float32 with raw `[0, 255]` values in BGR order.
fn pad_preprocess_nchw(bgr_80: &[u8]) -> Array4<f32> {
    let (w, h) = PAD_INPUT_SIZE;
    let mut arr = Array4::<f32>::zeros((1, 3, h, w));
    for y in 0..h {
        for x in 0..w {
            let off = (y * w + x) * 3;
            arr[[0, 0, y, x]] = bgr_80[off] as f32; // B
            arr[[0, 1, y, x]] = bgr_80[off + 1] as f32; // G
            arr[[0, 2, y, x]] = bgr_80[off + 2] as f32; // R
        }
    }
    arr
}

/// Stable softmax over a 3-class logit vector. Mirrors
/// `_pad_softmax_3class` at `service.py:1289-1300`.
fn softmax_3class(logits: &[f64; 3]) -> [f64; 3] {
    let max = logits[0].max(logits[1]).max(logits[2]);
    let e0 = (logits[0] - max).exp();
    let e1 = (logits[1] - max).exp();
    let e2 = (logits[2] - max).exp();
    let denom = e0 + e1 + e2;
    if denom <= 0.0 || !denom.is_finite() {
        return [f64::NAN; 3];
    }
    [e0 / denom, e1 / denom, e2 / denom]
}

#[derive(Debug, Clone)]
pub struct PadVerdict {
    pub pad_passed: bool,
    pub pad_score: Option<f64>,
    pub pad_scored_frames: u32,
    pub pad_passing_frames: u32,
    /// Per-frame real-class probability. `None` when the frame had no
    /// face or PAD inference failed.
    pub pad_frame_scores: Vec<Option<f64>>,
    pub pad_reason: Option<&'static str>,
}

/// Aggregate per-frame PAD scores into a clip-level verdict. Mirrors
/// `run_pad_over_timeline` at `service.py:1368-1426`.
pub fn run_pad_over_timeline(
    pad: &PadDetector,
    frames: &[BgrImage],
    timeline: &[PoseEntry],
) -> PadVerdict {
    let mut per_frame = Vec::with_capacity(timeline.len());
    for entry in timeline {
        if !entry.face_detected {
            per_frame.push(None);
            continue;
        }
        let Some(face) = entry.face.as_ref() else {
            per_frame.push(None);
            continue;
        };
        let frame = &frames[entry.frame_index as usize];
        let score = match pad.predict(frame, face.bbox()) {
            Ok(score) => score,
            Err(error) => {
                tracing::event!(
                    target: "biometric_verifier",
                    tracing::Level::WARN,
                    name = "pad_frame_failed",
                    frame_index = entry.frame_index as i64,
                    error = %error,
                );
                None
            }
        };
        per_frame.push(score);
    }

    let mut pass_count = 0_u32;
    let mut score_sum = 0.0_f64;
    let mut scored_count = 0_u32;
    for s in &per_frame {
        if let Some(score) = *s {
            scored_count += 1;
            score_sum += score;
            if score >= PAD_FRAME_THRESHOLD {
                pass_count += 1;
            }
        }
    }
    if scored_count == 0 {
        return PadVerdict {
            pad_passed: false,
            pad_score: None,
            pad_scored_frames: 0,
            pad_passing_frames: 0,
            pad_frame_scores: per_frame,
            pad_reason: Some("liveness_pad_no_scored_frames"),
        };
    }
    let mean_score = score_sum / scored_count as f64;
    let pass_fraction = pass_count as f64 / scored_count as f64;
    let passed = pass_fraction >= PAD_PASS_FRACTION;
    PadVerdict {
        pad_passed: passed,
        pad_score: Some(clamp_score(mean_score)),
        pad_scored_frames: scored_count,
        pad_passing_frames: pass_count,
        pad_frame_scores: per_frame,
        pad_reason: if passed {
            None
        } else {
            Some("liveness_spoof_suspected")
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn softmax_uniform_is_third() {
        let s = softmax_3class(&[0.5, 0.5, 0.5]);
        assert_abs_diff_eq!(s[0], 1.0 / 3.0, epsilon = 1e-12);
        assert_abs_diff_eq!(s[0] + s[1] + s[2], 1.0, epsilon = 1e-12);
    }

    #[test]
    fn softmax_dominant_class() {
        let s = softmax_3class(&[10.0, 0.0, 0.0]);
        assert!(s[0] > 0.99);
        assert!(s[1] < 0.01);
    }

    #[test]
    fn crop_inside_image() {
        let image = BgrImage {
            width: 200,
            height: 200,
            pixels: vec![128; 200 * 200 * 3],
        };
        let crop = crop_face_for_pad(&image, (50.0, 50.0, 60.0, 60.0), 2.7).expect("ok");
        assert_eq!(crop.len(), PAD_INPUT_SIZE.0 * PAD_INPUT_SIZE.1 * 3);
    }

    #[test]
    fn crop_invalid_bbox_returns_none() {
        let image = BgrImage {
            width: 200,
            height: 200,
            pixels: vec![128; 200 * 200 * 3],
        };
        assert!(crop_face_for_pad(&image, (0.0, 0.0, 0.0, 0.0), 2.7).is_none());
    }

    #[test]
    fn crop_clamps_scale_to_fit_image() {
        // A 60×60 box on a 200×200 image with scale 10× cannot fit;
        // bounded_scale should reduce to ~3.3 → still produces a crop.
        let image = BgrImage {
            width: 200,
            height: 200,
            pixels: vec![128; 200 * 200 * 3],
        };
        let crop = crop_face_for_pad(&image, (50.0, 50.0, 60.0, 60.0), 10.0).expect("ok");
        assert_eq!(crop.len(), PAD_INPUT_SIZE.0 * PAD_INPUT_SIZE.1 * 3);
    }
}
