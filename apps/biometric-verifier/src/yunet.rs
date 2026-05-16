//! YuNet face detection.
//!
//! Loads `face_detection_yunet_2023mar.onnx` directly via `ort` and ports
//! the prior-box decoder + NMS that `cv2.FaceDetectorYN` performs inside
//! the OpenCV wrapper. The wrapper isn't pure ONNX — it does the priors,
//! sigmoid, score combine, anchor decoding, and NMS in C++ (see
//! `opencv/modules/objdetect/src/face_detect.cpp`).
//!
//! Output rows match `_yunet_landmarks_2d` at `service.py:856-867`:
//! `[x, y, w, h, l0x, l0y, l1x, l1y, l2x, l2y, l3x, l3y, l4x, l4y, score]`
//! (15 floats). Landmarks are in image coords.

use crate::affine::resize_bilinear_bgr;
use crate::image_io::BgrImage;
use anyhow::{Context, Result};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{Value, TensorValueType};
use std::sync::Mutex;

const STRIDES: [usize; 3] = [8, 16, 32];

pub const DETECTION_FLOATS: usize = 15;

#[derive(Debug, Clone)]
pub struct Detection {
    /// `[x, y, w, h, l0x, l0y, l1x, l1y, l2x, l2y, l3x, l3y, l4x, l4y, score]`
    pub row: [f64; DETECTION_FLOATS],
}

impl Detection {
    pub fn bbox(&self) -> (f64, f64, f64, f64) {
        (self.row[0], self.row[1], self.row[2], self.row[3])
    }
    pub fn confidence(&self) -> f64 {
        self.row[14]
    }
    pub fn landmark(&self, idx: usize) -> (f64, f64) {
        let base = 4 + idx * 2;
        (self.row[base], self.row[base + 1])
    }
}

/// Wraps a YuNet ONNX session. `detect` is serialized through a mutex
/// because the prior cache is sized per call (input dims may vary).
pub struct YunetDetector {
    session: Mutex<Session>,
    score_threshold: f32,
    nms_threshold: f32,
    top_k: usize,
}

impl YunetDetector {
    /// Defaults match `service.py:1935`: `score_threshold=0.85`,
    /// `nms_threshold=0.3`, `top_k=5000`.
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
        let session = builder.commit_from_file(path).context("session from file")?;
        Ok(Self {
            session: Mutex::new(session),
            score_threshold: 0.85,
            nms_threshold: 0.3,
            top_k: 5000,
        })
    }

    pub fn with_thresholds(mut self, score: f32, nms: f32, top_k: usize) -> Self {
        self.score_threshold = score;
        self.nms_threshold = nms;
        self.top_k = top_k;
        self
    }

    /// Detect faces in a BGR image. The image is resized to the closest
    /// multiple-of-32 dimensions (down to 320×320 minimum), the model is
    /// run, and detections are scaled back to original image coords.
    pub fn detect(&self, image: &BgrImage) -> Result<Vec<Detection>> {
        if image.width == 0 || image.height == 0 {
            return Ok(Vec::new());
        }

        // YuNet's prior generation uses W/stride floor division (matches
        // `face_detect.cpp::generatePriors`). The largest stride is 32,
        // so the model can run at any size — but the smaller the input,
        // the faster. We use the OpenCV detector default (320×320) to
        // match `DEFAULT_DETECTOR_INPUT_SIZE` at `service.py:51`.
        let model_w = 320usize;
        let model_h = 320usize;

        let resized = resize_bilinear_bgr(&image.pixels, image.width, image.height, model_w, model_h);
        let input = bgr_to_nchw_f32(&resized, model_w, model_h);
        let input_value: Value<TensorValueType<f32>> = Value::from_array(input).context("input value")?;

        // Copy each output to an owned Vec before releasing the session
        // lock — SessionOutputs borrows from the session.
        let (cls_8, cls_16, cls_32, obj_8, obj_16, obj_32, bbox_8, bbox_16, bbox_32, kps_8, kps_16, kps_32) = {
            let mut session = self.session.lock().unwrap();
            let input_name = session.inputs[0].name.clone();
            let outputs = session
                .run(ort::inputs![input_name => input_value])
                .context("yunet inference")?;
            (
                extract_owned(&outputs, "cls_8")?,
                extract_owned(&outputs, "cls_16")?,
                extract_owned(&outputs, "cls_32")?,
                extract_owned(&outputs, "obj_8")?,
                extract_owned(&outputs, "obj_16")?,
                extract_owned(&outputs, "obj_32")?,
                extract_owned(&outputs, "bbox_8")?,
                extract_owned(&outputs, "bbox_16")?,
                extract_owned(&outputs, "bbox_32")?,
                extract_owned(&outputs, "kps_8")?,
                extract_owned(&outputs, "kps_16")?,
                extract_owned(&outputs, "kps_32")?,
            )
        };
        let cls = [cls_8.as_slice(), cls_16.as_slice(), cls_32.as_slice()];
        let obj = [obj_8.as_slice(), obj_16.as_slice(), obj_32.as_slice()];
        let bbox = [bbox_8.as_slice(), bbox_16.as_slice(), bbox_32.as_slice()];
        let kps = [kps_8.as_slice(), kps_16.as_slice(), kps_32.as_slice()];

        let scale_x = image.width as f64 / model_w as f64;
        let scale_y = image.height as f64 / model_h as f64;

        let mut faces = Vec::new();
        for (level, &stride) in STRIDES.iter().enumerate() {
            let feat_w = model_w / stride;
            let feat_h = model_h / stride;
            let total = feat_w * feat_h;
            let stride_f = stride as f64;

            let cls_data = cls[level];
            let obj_data = obj[level];
            let bbox_data = bbox[level];
            let kps_data = kps[level];
            if cls_data.len() < total
                || obj_data.len() < total
                || bbox_data.len() < total * 4
                || kps_data.len() < total * 10
            {
                anyhow::bail!("yunet output undersized at stride {stride}");
            }

            for i in 0..feat_h {
                for j in 0..feat_w {
                    let idx = i * feat_w + j;
                    // Empirically (cv2 4.10 + yunet_2023mar) the cls/obj
                    // outputs are post-sigmoid in this export. Treat as
                    // already-bounded [0,1] probabilities and combine via
                    // `sqrt(cls * obj)` per OpenCV's face_detect.cpp.
                    let cls_score = cls_data[idx] as f64;
                    let obj_score = obj_data[idx] as f64;
                    let score = (cls_score * obj_score).max(0.0).sqrt();
                    if (score as f32) < self.score_threshold {
                        continue;
                    }

                    let prior_cx = j as f64;
                    let prior_cy = i as f64;
                    let bbox_cx = (prior_cx + bbox_data[idx * 4] as f64) * stride_f;
                    let bbox_cy = (prior_cy + bbox_data[idx * 4 + 1] as f64) * stride_f;
                    let w = (bbox_data[idx * 4 + 2] as f64).exp() * stride_f;
                    let h = (bbox_data[idx * 4 + 3] as f64).exp() * stride_f;
                    let x = bbox_cx - w / 2.0;
                    let y = bbox_cy - h / 2.0;

                    let mut row = [0.0_f64; DETECTION_FLOATS];
                    row[0] = x * scale_x;
                    row[1] = y * scale_y;
                    row[2] = w * scale_x;
                    row[3] = h * scale_y;
                    for k in 0..5 {
                        let lx = (prior_cx + kps_data[idx * 10 + k * 2] as f64) * stride_f;
                        let ly = (prior_cy + kps_data[idx * 10 + k * 2 + 1] as f64) * stride_f;
                        row[4 + k * 2] = lx * scale_x;
                        row[4 + k * 2 + 1] = ly * scale_y;
                    }
                    row[14] = score;
                    faces.push(Detection { row });
                }
            }
        }

        Ok(nms(faces, self.nms_threshold, self.top_k))
    }
}

fn extract_owned(outputs: &ort::session::SessionOutputs<'_>, name: &str) -> Result<Vec<f32>> {
    let value = outputs
        .get(name)
        .with_context(|| format!("missing output `{name}`"))?;
    let (_, data) = value
        .try_extract_tensor::<f32>()
        .with_context(|| format!("extract tensor `{name}`"))?;
    Ok(data.to_vec())
}

fn bgr_to_nchw_f32(bgr: &[u8], width: usize, height: usize) -> Array4<f32> {
    // YuNet input is float32 uint8-as-float [0, 255], NCHW, BGR (the
    // ONNX was exported from a model trained on BGR — cv2.dnn.blobFromImage
    // with swapRB=false produces the same layout we build here).
    let mut arr = Array4::<f32>::zeros((1, 3, height, width));
    for y in 0..height {
        for x in 0..width {
            let off = (y * width + x) * 3;
            arr[[0, 0, y, x]] = bgr[off] as f32;
            arr[[0, 1, y, x]] = bgr[off + 1] as f32;
            arr[[0, 2, y, x]] = bgr[off + 2] as f32;
        }
    }
    arr
}

fn iou(a: &Detection, b: &Detection) -> f64 {
    let (ax, ay, aw, ah) = a.bbox();
    let (bx, by, bw, bh) = b.bbox();
    let ax2 = ax + aw;
    let ay2 = ay + ah;
    let bx2 = bx + bw;
    let by2 = by + bh;
    let ix = ax.max(bx);
    let iy = ay.max(by);
    let ix2 = ax2.min(bx2);
    let iy2 = ay2.min(by2);
    let iw = (ix2 - ix).max(0.0);
    let ih = (iy2 - iy).max(0.0);
    let inter = iw * ih;
    let union = aw.max(0.0) * ah.max(0.0) + bw.max(0.0) * bh.max(0.0) - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

fn nms(mut faces: Vec<Detection>, threshold: f32, top_k: usize) -> Vec<Detection> {
    faces.sort_by(|a, b| {
        b.confidence()
            .partial_cmp(&a.confidence())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut suppressed = vec![false; faces.len()];
    let mut kept: Vec<Detection> = Vec::new();
    for i in 0..faces.len() {
        if suppressed[i] {
            continue;
        }
        kept.push(faces[i].clone());
        if kept.len() >= top_k {
            break;
        }
        for j in (i + 1)..faces.len() {
            if !suppressed[j] && iou(&faces[i], &faces[j]) > threshold as f64 {
                suppressed[j] = true;
            }
        }
    }
    kept
}

/// Pick the best face from a YuNet detection list using the same key as
/// `service.py:372-376`: `area * confidence`, taking the maximum.
pub fn pick_best_face(faces: &[Detection]) -> Option<&Detection> {
    faces.iter().max_by(|a, b| {
        let aw = a.row[2].max(0.0);
        let ah = a.row[3].max(0.0);
        let bw = b.row[2].max(0.0);
        let bh = b.row[3].max(0.0);
        let ka = aw * ah * a.confidence().max(0.0);
        let kb = bw * bh * b.confidence().max(0.0);
        ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iou_disjoint_is_zero() {
        let a = Detection {
            row: [0.0, 0.0, 10.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9],
        };
        let b = Detection {
            row: [
                100.0, 100.0, 10.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9,
            ],
        };
        assert_eq!(iou(&a, &b), 0.0);
    }

    #[test]
    fn iou_identical_is_one() {
        let a = Detection {
            row: [
                10.0, 10.0, 20.0, 20.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9,
            ],
        };
        let b = a.clone();
        assert!((iou(&a, &b) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn nms_keeps_highest_score() {
        let high = Detection {
            row: [
                10.0, 10.0, 20.0, 20.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.95,
            ],
        };
        let low = Detection {
            row: [
                11.0, 11.0, 20.0, 20.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8,
            ],
        };
        let kept = nms(vec![low.clone(), high.clone()], 0.3, 10);
        assert_eq!(kept.len(), 1);
        assert!((kept[0].confidence() - 0.95).abs() < 1e-9);
    }
}
