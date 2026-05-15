//! MediaPipe Face Landmarker (478×3) wrapper.
//!
//! Replaces `extract_mesh` at `service.py:976-1048` and the mesh-based
//! head-pose path. Input layout is **NHWC** `(1, 256, 256, 3)` float32 —
//! distinct from the NCHW used by AuraFace and PAD — and the channels are
//! **RGB** with `/255` normalization.

use crate::affine::resize_bilinear_bgr;
use crate::config::MESH_INPUT_SIZE;
use anyhow::{Context, Result};
use ndarray::Array4;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{TensorValueType, Value};
use std::sync::Mutex;

/// 12 identity-stable mesh indices used for head-pose PnP. Identical
/// set to `IDENTITY_STABLE_INDICES` in `mesh_similarity.py:31-45` — the
/// PnP path and the debug overlay both rely on this exact subset.
/// Matches `_MESH_PNP_INDICES` at `service.py:950-956`.
pub const MESH_PNP_INDICES: [usize; 12] = [33, 133, 263, 362, 6, 168, 98, 327, 1, 152, 61, 291];

/// Alias for the debug-overlay payload (`mesh_similarity.py`).
pub const IDENTITY_STABLE_INDICES: [usize; 12] = MESH_PNP_INDICES;

/// Canonical 3D head model for the 12 mesh PnP points.
/// Matches `_MESH_PNP_CANONICAL` at `service.py:957-973`.
pub const MESH_PNP_CANONICAL: [(f64, f64, f64); 12] = [
    (-32.0, -32.0, -30.0), // 33  right eye outer
    (-15.0, -32.0, -25.0), // 133 right eye inner
    (32.0, -32.0, -30.0),  // 263 left eye outer
    (15.0, -32.0, -25.0),  // 362 left eye inner
    (0.0, -10.0, -10.0),   // 6   sellion
    (0.0, -35.0, -25.0),   // 168 glabella
    (-12.0, 8.0, -8.0),    // 98  right alar
    (12.0, 8.0, -8.0),     // 327 left alar
    (0.0, 0.0, 0.0),       // 1   nose tip
    (0.0, 65.0, -10.0),    // 152 chin tip
    (-25.0, 30.0, -15.0),  // 61  right mouth
    (25.0, 30.0, -15.0),   // 291 left mouth
];

/// Indices on the 478-pt mesh used for the 5-pt anatomical ArcFace
/// template (eye centres derived as midpoints of inner+outer corners).
/// Mirrors the constants block at `service.py:204-218`.
pub const MESH_RIGHT_EYE_OUTER: usize = 33;
pub const MESH_RIGHT_EYE_INNER: usize = 133;
pub const MESH_LEFT_EYE_OUTER: usize = 263;
pub const MESH_LEFT_EYE_INNER: usize = 362;
pub const MESH_NOSE_TIP: usize = 1;
pub const MESH_RIGHT_MOUTH: usize = 61;
pub const MESH_LEFT_MOUTH: usize = 291;

const MESH_POINT_COUNT: usize = 478;

pub struct MeshLandmarker {
    session: Mutex<Session>,
    input_name: String,
    crop_expand: f64,
}

impl MeshLandmarker {
    pub fn from_file(path: &str, intra_threads: Option<i32>, crop_expand: f64) -> Result<Self> {
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
            .context("mesh model has no inputs")?
            .name
            .clone();
        Ok(Self {
            session: Mutex::new(session),
            input_name,
            crop_expand,
        })
    }

    /// Run the mesh model on a YuNet-bbox crop and return 478 landmarks
    /// in **original image coordinates** (matching `extract_mesh` at
    /// `service.py:976-1048`). Returns `None` for degenerate bboxes,
    /// empty crops, or unexpected output shapes.
    pub fn extract(
        &self,
        image: &[u8],
        image_width: usize,
        image_height: usize,
        bbox: (f64, f64, f64, f64),
    ) -> Result<Option<Vec<(f64, f64, f64)>>> {
        if image_width == 0 || image_height == 0 {
            return Ok(None);
        }
        let (x, y, w, h) = bbox;
        if w <= 0.0 || h <= 0.0 {
            return Ok(None);
        }
        let expand_x = w * self.crop_expand;
        let expand_y = h * self.crop_expand;
        let x0 = (x - expand_x).max(0.0);
        let y0 = (y - expand_y).max(0.0);
        let x1 = (x + w + expand_x).min(image_width as f64);
        let y1 = (y + h + expand_y).min(image_height as f64);
        if x1 <= x0 || y1 <= y0 {
            return Ok(None);
        }
        let ix0 = x0 as usize;
        let iy0 = y0 as usize;
        let ix1 = x1 as usize;
        let iy1 = y1 as usize;
        let crop_w = ix1.saturating_sub(ix0);
        let crop_h = iy1.saturating_sub(iy0);
        if crop_w == 0 || crop_h == 0 {
            return Ok(None);
        }

        // Crop the BGR slab.
        let mut crop = vec![0_u8; crop_w * crop_h * 3];
        let stride = image_width * 3;
        let crop_stride = crop_w * 3;
        for row in 0..crop_h {
            let src_off = (iy0 + row) * stride + ix0 * 3;
            let dst_off = row * crop_stride;
            crop[dst_off..dst_off + crop_stride]
                .copy_from_slice(&image[src_off..src_off + crop_stride]);
        }
        let crop_resized =
            resize_bilinear_bgr(&crop, crop_w, crop_h, MESH_INPUT_SIZE.0, MESH_INPUT_SIZE.1);

        // NHWC RGB float32 / 255 — see service.py:1013-1014.
        let blob = mesh_preprocess_nhwc(&crop_resized);
        let input_value: Value<TensorValueType<f32>> =
            Value::from_array(blob).context("input value")?;

        let landmarks_flat = {
            let mut session = self.session.lock().unwrap();
            let outputs = session
                .run(ort::inputs![self.input_name.as_str() => input_value])
                .context("mesh inference")?;
            // Find the first output with ≥ 478*3 elements — matches the
            // Python "first usable output" heuristic.
            let mut picked: Option<Vec<f32>> = None;
            for (_, value) in outputs.iter() {
                let (_, data) = value
                    .try_extract_tensor::<f32>()
                    .context("extract mesh tensor")?;
                if data.len() >= MESH_POINT_COUNT * 3 {
                    picked = Some(data[..MESH_POINT_COUNT * 3].to_vec());
                    break;
                }
            }
            match picked {
                Some(v) => v,
                None => return Ok(None),
            }
        };

        let scale_x = (x1 - x0) / MESH_INPUT_SIZE.0 as f64;
        let scale_y = (y1 - y0) / MESH_INPUT_SIZE.1 as f64;
        let mut image_landmarks = Vec::with_capacity(MESH_POINT_COUNT);
        for i in 0..MESH_POINT_COUNT {
            let lx = landmarks_flat[i * 3] as f64;
            let ly = landmarks_flat[i * 3 + 1] as f64;
            let lz = landmarks_flat[i * 3 + 2] as f64;
            // x has projective meaning; z is normalized "depth" we scale
            // by the same X factor for dimensional consistency
            // (service.py:1045-1047).
            image_landmarks.push((lx * scale_x + x0, ly * scale_y + y0, lz * scale_x));
        }
        Ok(Some(image_landmarks))
    }
}

fn mesh_preprocess_nhwc(bgr_crop_256: &[u8]) -> Array4<f32> {
    let (w, h) = MESH_INPUT_SIZE;
    let mut arr = Array4::<f32>::zeros((1, h, w, 3));
    let inv = 1.0_f32 / 255.0;
    for y in 0..h {
        for x in 0..w {
            let off = (y * w + x) * 3;
            let b = bgr_crop_256[off] as f32;
            let g = bgr_crop_256[off + 1] as f32;
            let r = bgr_crop_256[off + 2] as f32;
            // BGR → RGB at this stage; matches cv2.cvtColor(BGR2RGB) on
            // service.py:1013.
            arr[[0, y, x, 0]] = r * inv;
            arr[[0, y, x, 1]] = g * inv;
            arr[[0, y, x, 2]] = b * inv;
        }
    }
    arr
}

/// Pull the 5-point anatomical landmark set from a 478×3 mesh, in the
/// same order as the ArcFace template (right eye, left eye, nose,
/// right mouth, left mouth). Eye points are midpoints of inner+outer
/// corners — `service.py:488-510`.
pub fn mesh_anatomical_5pt(mesh: &[(f64, f64, f64)]) -> Option<[(f64, f64); 5]> {
    // `_MESH_ALIGNMENT_REQUIRED_MAX_INDEX` at service.py:211-219 is the
    // max of all anatomical indices — 362 (left eye inner), NOT 291
    // (left mouth). Bounds check must use the true max.
    const MAX_REQUIRED_INDEX: usize = MESH_LEFT_EYE_INNER;
    if mesh.len() <= MAX_REQUIRED_INDEX {
        return None;
    }
    let mid = |a: (f64, f64, f64), b: (f64, f64, f64)| -> (f64, f64) {
        ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0)
    };
    let right_eye = mid(mesh[MESH_RIGHT_EYE_OUTER], mesh[MESH_RIGHT_EYE_INNER]);
    let left_eye = mid(mesh[MESH_LEFT_EYE_OUTER], mesh[MESH_LEFT_EYE_INNER]);
    let nose = (mesh[MESH_NOSE_TIP].0, mesh[MESH_NOSE_TIP].1);
    let right_mouth = (mesh[MESH_RIGHT_MOUTH].0, mesh[MESH_RIGHT_MOUTH].1);
    let left_mouth = (mesh[MESH_LEFT_MOUTH].0, mesh[MESH_LEFT_MOUTH].1);
    Some([right_eye, left_eye, nose, right_mouth, left_mouth])
}

/// Pull the bone-anchored subset (12 points × 3 coords) from a 478×3
/// mesh for the debug overlay. Mirrors `stable_subset` in
/// `mesh_similarity.py:48-59`. Returns `None` when the mesh is too short.
pub fn stable_subset(mesh: &[(f64, f64, f64)]) -> Option<Vec<(f64, f64, f64)>> {
    let max_index = IDENTITY_STABLE_INDICES.iter().copied().max().unwrap();
    if mesh.len() <= max_index {
        return None;
    }
    Some(
        IDENTITY_STABLE_INDICES
            .iter()
            .map(|&i| mesh[i])
            .collect(),
    )
}

/// Pull the 12-point PnP subset (`MESH_PNP_INDICES`) from a 478×3 mesh.
pub fn mesh_pnp_12pt(mesh: &[(f64, f64, f64)]) -> Option<[(f64, f64); 12]> {
    let max_index = MESH_PNP_INDICES.iter().copied().max().unwrap();
    if mesh.len() <= max_index {
        return None;
    }
    let mut out = [(0.0, 0.0); 12];
    for (i, &idx) in MESH_PNP_INDICES.iter().enumerate() {
        out[i] = (mesh[idx].0, mesh[idx].1);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pnp_indices_match_python_constant() {
        let expected = [33_usize, 133, 263, 362, 6, 168, 98, 327, 1, 152, 61, 291];
        assert_eq!(MESH_PNP_INDICES, expected);
    }

    #[test]
    fn pnp_canonical_count_is_twelve() {
        assert_eq!(MESH_PNP_CANONICAL.len(), 12);
    }

    #[test]
    fn anatomical_5pt_short_mesh_none() {
        let mesh: Vec<(f64, f64, f64)> = (0..10).map(|i| (i as f64, i as f64, 0.0)).collect();
        assert!(mesh_anatomical_5pt(&mesh).is_none());
    }

    /// Port of `mesh_similarity_test.py::StableSubsetTests::test_returns_subset_shape`.
    #[test]
    fn stable_subset_returns_correct_size() {
        let mesh: Vec<(f64, f64, f64)> = (0..478)
            .map(|i| (i as f64 * 0.1, i as f64 * 0.2, i as f64 * 0.05))
            .collect();
        let subset = stable_subset(&mesh).expect("subset");
        assert_eq!(subset.len(), IDENTITY_STABLE_INDICES.len());
    }

    /// Port of `mesh_similarity_test.py::StableSubsetTests::test_handles_too_short_mesh`.
    #[test]
    fn stable_subset_short_mesh_is_none() {
        let tiny: Vec<(f64, f64, f64)> = (0..10).map(|_| (0.0, 0.0, 0.0)).collect();
        assert!(stable_subset(&tiny).is_none());
    }
}
