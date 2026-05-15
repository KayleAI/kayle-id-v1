//! Per-frame pose classification timeline.
//!
//! Mirrors `build_pose_timeline`, `_build_pose_entry`, `classify_pose`,
//! `validate_movement_coverage`, and `pick_center_frame_index` from
//! `service.py:1089-1223`.

use crate::config::Settings;
use crate::image_io::BgrImage;
use crate::mesh::{mesh_pnp_12pt, MeshLandmarker, MESH_PNP_CANONICAL};
use crate::pnp::{camera_matrix_for, rotation_to_euler_deg_xyz, solve_pnp};
use crate::yunet::{pick_best_face, Detection, YunetDetector};

/// One frame's worth of pose telemetry. Maps directly to the
/// `LivenessTimelineEntry` wire type for the debug payload.
#[derive(Debug, Clone)]
pub struct PoseEntry {
    pub frame_index: u32,
    pub face_detected: bool,
    pub pitch_deg: Option<f64>,
    pub yaw_deg: Option<f64>,
    pub roll_deg: Option<f64>,
    pub pose: PoseLabel,
    pub face: Option<Detection>,
    pub mesh: Option<Vec<(f64, f64, f64)>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoseLabel {
    Center,
    Left,
    Right,
    Unknown,
}

impl PoseLabel {
    pub fn as_str(self) -> &'static str {
        match self {
            PoseLabel::Center => "center",
            PoseLabel::Left => "left",
            PoseLabel::Right => "right",
            PoseLabel::Unknown => "unknown",
        }
    }
}

/// Classify yaw into pose buckets, mirroring `classify_pose` at
/// `service.py:1089-1101`. Subject's perspective: "left" = subject
/// turned their head to their own left (yaw ≥ tilt_yaw_deg).
pub fn classify_pose(yaw_deg: Option<f64>, settings: &Settings) -> PoseLabel {
    let Some(yaw) = yaw_deg else { return PoseLabel::Unknown };
    if yaw.abs() <= settings.liveness_center_yaw_deg {
        return PoseLabel::Center;
    }
    if yaw >= settings.liveness_tilt_yaw_deg {
        return PoseLabel::Left;
    }
    if yaw <= -settings.liveness_tilt_yaw_deg {
        return PoseLabel::Right;
    }
    PoseLabel::Unknown
}

/// Run YuNet + mesh + PnP on a single frame and assemble a `PoseEntry`.
///
/// Prefers mesh-based pose when available; falls back to YuNet's 5-point
/// PnP for parity with `_build_pose_entry` at `service.py:1104-1141`.
pub fn build_pose_entry(
    frame_index: u32,
    frame: &BgrImage,
    detector: &YunetDetector,
    mesh: Option<&MeshLandmarker>,
    settings: &Settings,
) -> PoseEntry {
    let detections = detector.detect(frame).unwrap_or_default();
    let Some(face) = pick_best_face(&detections).cloned() else {
        return PoseEntry {
            frame_index,
            face_detected: false,
            pitch_deg: None,
            yaw_deg: None,
            roll_deg: None,
            pose: PoseLabel::Unknown,
            face: None,
            mesh: None,
        };
    };

    let bbox = face.bbox();
    let mesh_points = mesh.and_then(|m| {
        m.extract(&frame.pixels, frame.width, frame.height, bbox)
            .ok()
            .flatten()
    });

    // Mesh-based pose preferred; fall back to YuNet 5-pt.
    let (pitch, yaw, roll) = pose_from_mesh(mesh_points.as_deref(), frame.width, frame.height)
        .or_else(|| pose_from_yunet(&face, frame.width, frame.height))
        .map(|(p, y, r)| (Some(p), Some(y), Some(r)))
        .unwrap_or((None, None, None));

    let pose = classify_pose(yaw, settings);
    PoseEntry {
        frame_index,
        face_detected: true,
        pitch_deg: pitch,
        yaw_deg: yaw,
        roll_deg: roll,
        pose,
        face: Some(face),
        mesh: mesh_points,
    }
}

fn pose_from_yunet(face: &Detection, frame_width: usize, frame_height: usize) -> Option<(f64, f64, f64)> {
    let object: [(f64, f64, f64); 5] = [
        (32.0, -35.0, -30.0),
        (-32.0, -35.0, -30.0),
        (0.0, 0.0, 0.0),
        (22.0, 35.0, -12.0),
        (-22.0, 35.0, -12.0),
    ];
    let image: [(f64, f64); 5] = [
        face.landmark(0),
        face.landmark(1),
        face.landmark(2),
        face.landmark(3),
        face.landmark(4),
    ];
    let k = camera_matrix_for(frame_width, frame_height);
    let sol = solve_pnp(&object, &image, &k)?;
    Some(rotation_to_euler_deg_xyz(&sol.rotation))
}

fn pose_from_mesh(
    mesh: Option<&[(f64, f64, f64)]>,
    frame_width: usize,
    frame_height: usize,
) -> Option<(f64, f64, f64)> {
    let mesh = mesh?;
    let image = mesh_pnp_12pt(mesh)?;
    let k = camera_matrix_for(frame_width, frame_height);
    let sol = solve_pnp(&MESH_PNP_CANONICAL, &image, &k)?;
    Some(rotation_to_euler_deg_xyz(&sol.rotation))
}

/// Build the full timeline from a list of decoded frames.
/// Sequential rather than parallel for now — `FRAME_PARALLEL_WORKERS`
/// in the Python implementation primarily helps when mesh+PAD dominate;
/// we'll add a rayon-based parallel variant in Phase 5/6 if benchmarks
/// show it's worthwhile.
pub fn build_pose_timeline(
    frames: &[BgrImage],
    detector: &YunetDetector,
    mesh: Option<&MeshLandmarker>,
    settings: &Settings,
) -> Vec<PoseEntry> {
    frames
        .iter()
        .enumerate()
        .map(|(i, f)| build_pose_entry(i as u32, f, detector, mesh, settings))
        .collect()
}

/// Pass if the clip contains a decisive turn in either direction.
/// Direct port of `validate_movement_coverage` at `service.py:1172-1202`.
/// Returns `Some(reason_code)` on failure, `None` on pass.
pub fn validate_movement_coverage(timeline: &[PoseEntry], settings: &Settings) -> Option<&'static str> {
    let mut left_run = 0_u32;
    let mut right_run = 0_u32;
    let mut saw_left = false;
    let mut saw_right = false;
    for entry in timeline {
        match entry.pose {
            PoseLabel::Left => {
                left_run += 1;
                right_run = 0;
                if left_run >= settings.liveness_min_pose_frames {
                    saw_left = true;
                }
            }
            PoseLabel::Right => {
                right_run += 1;
                left_run = 0;
                if right_run >= settings.liveness_min_pose_frames {
                    saw_right = true;
                }
            }
            _ => {
                left_run = 0;
                right_run = 0;
            }
        }
    }
    if !(saw_left || saw_right) {
        Some("liveness_no_head_movement")
    } else {
        None
    }
}

/// First "center" frame with a face; falls back to lowest |yaw|. Port of
/// `pick_center_frame_index` at `service.py:1205-1223`.
pub fn pick_center_frame_index(timeline: &[PoseEntry]) -> Option<u32> {
    for entry in timeline {
        if matches!(entry.pose, PoseLabel::Center) && entry.face_detected {
            return Some(entry.frame_index);
        }
    }
    let mut best: Option<(u32, f64)> = None;
    for entry in timeline {
        if !entry.face_detected {
            continue;
        }
        let Some(yaw) = entry.yaw_deg else { continue };
        let mag = yaw.abs();
        if best.as_ref().is_none_or(|(_, m)| mag < *m) {
            best = Some((entry.frame_index, mag));
        }
    }
    best.map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with(center: f64, tilt: f64, min_run: u32) -> Settings {
        let mut s = Settings::from_env();
        s.liveness_center_yaw_deg = center;
        s.liveness_tilt_yaw_deg = tilt;
        s.liveness_min_pose_frames = min_run;
        s
    }

    fn entry(idx: u32, yaw: Option<f64>, settings: &Settings) -> PoseEntry {
        let pose = classify_pose(yaw, settings);
        PoseEntry {
            frame_index: idx,
            face_detected: yaw.is_some(),
            pitch_deg: None,
            yaw_deg: yaw,
            roll_deg: None,
            pose,
            face: None,
            mesh: None,
        }
    }

    #[test]
    fn classify_buckets() {
        let s = settings_with(15.0, 17.0, 1);
        assert_eq!(classify_pose(Some(0.0), &s), PoseLabel::Center);
        assert_eq!(classify_pose(Some(15.0), &s), PoseLabel::Center);
        assert_eq!(classify_pose(Some(16.0), &s), PoseLabel::Unknown);
        assert_eq!(classify_pose(Some(17.0), &s), PoseLabel::Left);
        assert_eq!(classify_pose(Some(-17.0), &s), PoseLabel::Right);
        assert_eq!(classify_pose(None, &s), PoseLabel::Unknown);
    }

    #[test]
    fn coverage_requires_one_side_or_other() {
        let s = settings_with(15.0, 17.0, 1);
        let only_center: Vec<_> = (0..5).map(|i| entry(i, Some(0.0), &s)).collect();
        assert_eq!(
            validate_movement_coverage(&only_center, &s),
            Some("liveness_no_head_movement")
        );
        let mut with_left = only_center.clone();
        with_left.push(entry(5, Some(30.0), &s));
        assert!(validate_movement_coverage(&with_left, &s).is_none());
        let mut with_right = only_center;
        with_right.push(entry(5, Some(-30.0), &s));
        assert!(validate_movement_coverage(&with_right, &s).is_none());
    }

    #[test]
    fn coverage_breaks_run_on_interruption() {
        let s = settings_with(15.0, 17.0, 3);
        // Two "left" frames + center break + one more "left" → no run of 3.
        let timeline = vec![
            entry(0, Some(30.0), &s),
            entry(1, Some(30.0), &s),
            entry(2, Some(0.0), &s),
            entry(3, Some(30.0), &s),
        ];
        assert_eq!(
            validate_movement_coverage(&timeline, &s),
            Some("liveness_no_head_movement")
        );
    }

    #[test]
    fn pick_center_prefers_first_center_frame() {
        let s = settings_with(15.0, 17.0, 1);
        let timeline = vec![
            entry(0, Some(30.0), &s),
            entry(1, Some(0.0), &s),
            entry(2, Some(-30.0), &s),
        ];
        assert_eq!(pick_center_frame_index(&timeline), Some(1));
    }

    #[test]
    fn pick_center_falls_back_to_lowest_yaw() {
        let s = settings_with(15.0, 17.0, 1);
        // No frames in the center bucket.
        let timeline = vec![
            entry(0, Some(40.0), &s),
            entry(1, Some(-25.0), &s),
            entry(2, Some(35.0), &s),
        ];
        assert_eq!(pick_center_frame_index(&timeline), Some(1));
    }
}
