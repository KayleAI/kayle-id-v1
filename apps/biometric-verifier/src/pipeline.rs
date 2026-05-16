//! End-to-end liveness + face-match orchestration.
//!
//! Direct port of `verify_liveness_payload` at `service.py:1502-1869`.
//! Every `reason` string and the structural ordering of failure branches
//! match the Python implementation verbatim so the TypeScript consumer
//! sees identical wire output.

use crate::auraface::{cosine, normalize_cosine_score, AuraFaceRecognizer};
use crate::config::{NONCE_BYTES, PAD_FRAME_THRESHOLD, PAD_PASS_FRACTION};
use crate::image_io::BgrImage;
use crate::mesh::{stable_subset, IDENTITY_STABLE_INDICES};
use crate::nonce::verify_challenge_nonce;
use crate::pad::run_pad_over_timeline;
use crate::pad::PadVerdict;
use crate::pose_timeline::{
    build_pose_timeline, pick_center_frame_index, validate_movement_coverage, PoseEntry, PoseLabel,
};
use crate::runtime::Runtime;
use crate::types::{
    DebugBbox, DebugLandmarks, FaceMatchAlignment, LivenessDebug, LivenessTimelineEntry,
    MeshSubset, PoseClass, VerifyRequest, VerifyResponse,
};
use crate::video::{extract_frames, DecodedFrames};
use crate::yunet::Detection;
use anyhow::{Context, Result};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::io::Write;
use std::time::Instant;
use tempfile::NamedTempFile;
use tokio::task;

pub async fn verify_liveness_payload(
    runtime: &Runtime,
    request: VerifyRequest,
) -> Result<VerifyResponse> {
    // All decoding + ONNX work runs in a blocking task — keep the tokio
    // runtime responsive to other requests during the 1-3s of CPU work.
    let runtime = runtime.clone();
    task::spawn_blocking(move || run_pipeline(runtime, request)).await?
}

fn extract_frames_from_video_bytes(
    video_bytes: &[u8],
    frame_count: usize,
) -> Result<DecodedFrames> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(frames) = extract_frames_from_memfd(video_bytes, frame_count) {
            return Ok(frames);
        }
    }

    extract_frames_from_tempfile(video_bytes, frame_count)
}

#[cfg(target_os = "linux")]
fn extract_frames_from_memfd(video_bytes: &[u8], frame_count: usize) -> Result<DecodedFrames> {
    use std::ffi::CString;
    use std::io::{Seek, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::path::PathBuf;

    let name = CString::new("kayle-id-liveness-video").context("memfd name")?;
    let fd = unsafe { libc::memfd_create(name.as_ptr(), libc::MFD_CLOEXEC) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error()).context("memfd_create");
    }

    let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
    file.write_all(video_bytes).context("write memfd video")?;
    file.rewind().context("rewind memfd video")?;
    let path = PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()));
    extract_frames(&path, frame_count)
}

fn extract_frames_from_tempfile(video_bytes: &[u8], frame_count: usize) -> Result<DecodedFrames> {
    let mut tmp = NamedTempFile::new().context("create temp video")?;
    tmp.write_all(video_bytes).context("write temp video")?;
    extract_frames(tmp.path(), frame_count)
}

fn run_pipeline(runtime: Runtime, request: VerifyRequest) -> Result<VerifyResponse> {
    let started = Instant::now();
    let settings = runtime.settings.clone();
    let include_debug = settings.debug_responses_allowed && request.include_debug.unwrap_or(false);
    let debug_metrics = settings.debug_metrics_enabled;
    let mut debug = include_debug.then(|| new_debug_payload(&runtime));

    // Clamp so a misbehaving caller can't invert the gate.
    let threshold = crate::auraface::clamp_score(
        request
            .face_match_threshold
            .unwrap_or(crate::config::DEFAULT_THRESHOLD),
    );

    // Validate the video field; the empty string is treated as "missing".
    if request.video_base64.is_empty() {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_video_missing"),
            debug,
            debug_metrics,
            started,
            0,
        ));
    }
    let video_bytes = match B64.decode(request.video_base64.as_bytes()) {
        Ok(b) if !b.is_empty() => b,
        Ok(_) => {
            return Ok(finish_response(
                VerifyResponse::pipeline_failure("liveness_video_empty"),
                debug,
                debug_metrics,
                started,
                0,
            ));
        }
        Err(_) => {
            return Ok(finish_response(
                VerifyResponse::pipeline_failure("liveness_video_decode_failed"),
                debug,
                debug_metrics,
                started,
                0,
            ));
        }
    };

    let extracted =
        match extract_frames_from_video_bytes(&video_bytes, settings.liveness_frame_count as usize)
        {
            Ok(e) => e,
            Err(e) => {
                tracing::event!(
                    target: "biometric_verifier",
                    tracing::Level::WARN,
                    name = "video_decode_failed",
                    error = %e,
                );
                return Ok(finish_response(
                    VerifyResponse::pipeline_failure("liveness_video_unreadable"),
                    debug,
                    debug_metrics,
                    started,
                    0,
                ));
            }
        };
    if extracted.frames.is_empty() {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_video_unreadable"),
            debug,
            debug_metrics,
            started,
            0,
        ));
    }
    let frame_count = extracted.frames.len() as u32;
    if let Some(d) = debug.as_mut() {
        d.frame_count = frame_count;
        d.duration_seconds = extracted.duration_seconds;
        if let Some(first) = extracted.frames.first() {
            d.frame_width = first.width as u32;
            d.frame_height = first.height as u32;
        }
    }
    if let Some(d) = extracted.duration_seconds {
        if d > settings.liveness_video_max_duration_seconds {
            tracing::event!(
                target: "biometric_verifier",
                tracing::Level::INFO,
                name = "liveness_video_too_long",
                duration_seconds = d,
                max_seconds = settings.liveness_video_max_duration_seconds,
            );
            return Ok(finish_response(
                VerifyResponse::pipeline_failure("liveness_video_too_long"),
                debug,
                debug_metrics,
                started,
                frame_count,
            ));
        }
    }
    let frame_min = std::cmp::max(settings.liveness_min_pose_frames as usize * 2 + 1, 3);
    if extracted.frames.len() < frame_min {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_video_too_short"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    }

    // Challenge nonce — base64-decoded, must be exactly NONCE_BYTES.
    let Some(challenge_b64) = request.challenge_nonce_base64.as_ref() else {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_challenge_mismatch"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    };
    if challenge_b64.is_empty() {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_challenge_mismatch"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    }
    let expected_nonce = match B64.decode(challenge_b64.as_bytes()) {
        Ok(b) if b.len() == NONCE_BYTES => b,
        _ => {
            return Ok(finish_response(
                VerifyResponse::pipeline_failure("liveness_challenge_mismatch"),
                debug,
                debug_metrics,
                started,
                frame_count,
            ));
        }
    };
    let nonce_result = verify_challenge_nonce(&extracted.frames, &expected_nonce);
    tracing::event!(
        target: "biometric_verifier",
        tracing::Level::INFO,
        name = "liveness_challenge_evaluated",
        matched = nonce_result.matched,
        frames_total = nonce_result.frames_total as i64,
        frames_decoded = nonce_result.frames_decoded as i64,
        frames_matched = nonce_result.frames_matched as i64,
    );
    if !nonce_result.matched {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_challenge_mismatch"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    }

    let Some(detector) = runtime.state.detector.as_ref() else {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_runtime_degraded"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    };
    let Some(recognizer) = runtime.state.recognizer.as_ref() else {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_runtime_degraded"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    };
    let mesh = runtime.state.mesh.as_ref();
    let pad = runtime.state.pad.as_ref();

    // Pose timeline.
    let timeline = build_pose_timeline(&extracted.frames, detector, mesh, &settings);
    if let Some(d) = debug.as_mut() {
        d.timeline = timeline_to_debug_entries(&timeline);
    }
    let detected_count = timeline.iter().filter(|e| e.face_detected).count();
    if detected_count == 0 {
        return Ok(finish_response(
            VerifyResponse::pipeline_failure("liveness_no_face"),
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    }
    let liveness_score =
        crate::auraface::clamp_score(detected_count as f64 / extracted.frames.len().max(1) as f64);

    // Coverage gate.
    if let Some(reason) = validate_movement_coverage(&timeline, &settings) {
        tracing::event!(
            target: "biometric_verifier",
            tracing::Level::INFO,
            name = "liveness_coverage_failed",
            reason = reason,
        );
        let r = VerifyResponse::pipeline_failure_with_score(reason, liveness_score);
        return Ok(finish_response(
            r,
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    }

    // PAD.
    let (pad_passed, pad_score) = if let Some(pad) = pad {
        let verdict = run_pad_over_timeline(pad, &extracted.frames, &timeline);
        if let Some(d) = debug.as_mut() {
            apply_pad_debug(d, &verdict);
        }
        if !verdict.pad_passed {
            tracing::event!(
                target: "biometric_verifier",
                tracing::Level::INFO,
                name = "liveness_pad_evaluated",
                pad_passed = false,
                pad_scored_frames = verdict.pad_scored_frames as i64,
                pad_passing_frames = verdict.pad_passing_frames as i64,
            );
            let mut r = VerifyResponse::pipeline_failure_with_score(
                verdict.pad_reason.unwrap_or("liveness_spoof_suspected"),
                liveness_score,
            );
            r.pad_score = verdict.pad_score;
            return Ok(finish_response(
                r,
                debug,
                debug_metrics,
                started,
                frame_count,
            ));
        }
        (true, verdict.pad_score)
    } else if settings.pad_disabled {
        tracing::event!(
            target: "biometric_verifier",
            tracing::Level::INFO,
            name = "liveness_pad_disabled_by_operator",
        );
        (true, None)
    } else {
        // PAD load failed — fail-closed (Python uses "liveness_pad_unavailable"
        // with usedFallback=true).
        tracing::event!(
            target: "biometric_verifier",
            tracing::Level::ERROR,
            name = "liveness_pad_unavailable",
        );
        let mut r = VerifyResponse::unavailable("liveness_pad_unavailable");
        r.liveness_score = Some(liveness_score);
        return Ok(finish_response(
            r,
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    };

    // Pick the centered frame.
    let Some(center_index) = pick_center_frame_index(&timeline) else {
        let r =
            VerifyResponse::pipeline_failure_with_score("liveness_no_center_frame", liveness_score);
        return Ok(finish_response(
            r,
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    };
    if let Some(d) = debug.as_mut() {
        d.center_frame_index = Some(center_index);
    }

    let skip_face_match =
        settings.allow_face_match_skip && request.skip_face_match.unwrap_or(false);
    if skip_face_match {
        let r = VerifyResponse {
            liveness_passed: true,
            liveness_score: Some(liveness_score),
            face_match_passed: false,
            face_match_score: None,
            pad_passed,
            pad_score,
            used_fallback: false,
            reason: Some("face_match_skipped".into()),
            face_match_alignment: None,
            debug: None,
            perf_trace: None,
        };
        return Ok(finish_response(
            r,
            debug,
            debug_metrics,
            started,
            frame_count,
        ));
    }

    // DG2 decode + face match.
    let dg2_bytes = match B64.decode(request.dg2_image.bytes_base64.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return Ok(finish_response(
                VerifyResponse::pipeline_failure_with_score(
                    "liveness_dg2_decode_failed",
                    liveness_score,
                ),
                debug,
                debug_metrics,
                started,
                frame_count,
            ));
        }
    };
    let dg2_image = match BgrImage::from_jpeg(&dg2_bytes) {
        Ok(im) => im,
        Err(e) => {
            tracing::event!(
                target: "biometric_verifier",
                tracing::Level::WARN,
                name = "liveness_dg2_decode_failed",
                error = %e,
            );
            return Ok(finish_response(
                VerifyResponse::pipeline_failure_with_score(
                    "liveness_dg2_decode_failed",
                    liveness_score,
                ),
                debug,
                debug_metrics,
                started,
                frame_count,
            ));
        }
    };

    let center_frame = &extracted.frames[center_index as usize];
    let center_mesh = timeline
        .iter()
        .find(|e| e.frame_index == center_index)
        .and_then(|e| e.mesh.as_ref());
    let dg2_mesh = match mesh {
        Some(m) => extract_dg2_mesh(detector, m, &dg2_image)?,
        None => None,
    };
    if let Some(d) = debug.as_mut() {
        d.dg2_mesh = dg2_mesh.as_deref().and_then(mesh_subset_for_debug);
    }

    let face_match = match_centered_frame(
        detector,
        recognizer,
        dg2_mesh.as_deref(),
        &dg2_image,
        center_frame,
        center_mesh,
        threshold,
    )?;

    let response = VerifyResponse {
        liveness_passed: true,
        liveness_score: Some(liveness_score),
        face_match_passed: face_match.face_match_passed,
        face_match_score: face_match.face_match_score,
        pad_passed,
        pad_score,
        used_fallback: face_match.used_fallback,
        reason: face_match.reason,
        face_match_alignment: face_match.face_match_alignment,
        debug: None,
        perf_trace: None,
    };
    Ok(finish_response(
        response,
        debug,
        debug_metrics,
        started,
        frame_count,
    ))
}

fn finish_response(
    mut response: VerifyResponse,
    debug: Option<LivenessDebug>,
    perf_enabled: bool,
    started: Instant,
    frame_count: u32,
) -> VerifyResponse {
    response.debug = debug;
    finalize_perf(&mut response, perf_enabled, started, frame_count);
    response
}

fn new_debug_payload(runtime: &Runtime) -> LivenessDebug {
    LivenessDebug {
        frame_count: 0,
        duration_seconds: None,
        frame_width: 0,
        frame_height: 0,
        center_frame_index: None,
        timeline: Vec::new(),
        pad_frame_threshold: Some(PAD_FRAME_THRESHOLD),
        pad_pass_fraction: Some(PAD_PASS_FRACTION),
        pad_scored_frames: 0,
        pad_passing_frames: 0,
        pad_disabled: runtime.settings.pad_disabled,
        pad_loaded: runtime.state.pad_loaded(),
        mesh_disabled: Some(runtime.settings.mesh_disabled),
        mesh_loaded: Some(runtime.state.mesh_loaded()),
        dg2_mesh: None,
    }
}

fn timeline_to_debug_entries(timeline: &[PoseEntry]) -> Vec<LivenessTimelineEntry> {
    timeline
        .iter()
        .map(|entry| LivenessTimelineEntry {
            frame_index: entry.frame_index,
            face_detected: entry.face_detected,
            pitch_deg: entry.pitch_deg,
            yaw_deg: entry.yaw_deg,
            roll_deg: entry.roll_deg,
            pose: pose_class_for_debug(entry.pose),
            pad_score: None,
            bbox: entry.face.as_ref().map(detection_bbox_for_debug),
            landmarks: entry.face.as_ref().map(detection_landmarks_for_debug),
            mesh: entry.mesh.as_deref().and_then(mesh_subset_for_debug),
        })
        .collect()
}

fn pose_class_for_debug(pose: PoseLabel) -> PoseClass {
    match pose {
        PoseLabel::Center => PoseClass::Center,
        PoseLabel::Left => PoseClass::Left,
        PoseLabel::Right => PoseClass::Right,
        PoseLabel::Unknown => PoseClass::Unknown,
    }
}

fn detection_bbox_for_debug(face: &Detection) -> DebugBbox {
    let (x, y, w, h) = face.bbox();
    DebugBbox {
        x,
        y,
        w,
        h,
        confidence: face.confidence(),
    }
}

fn detection_landmarks_for_debug(face: &Detection) -> DebugLandmarks {
    let (right_eye_x, right_eye_y) = face.landmark(0);
    let (left_eye_x, left_eye_y) = face.landmark(1);
    let (nose_x, nose_y) = face.landmark(2);
    let (right_mouth_x, right_mouth_y) = face.landmark(3);
    let (left_mouth_x, left_mouth_y) = face.landmark(4);
    DebugLandmarks {
        right_eye: [right_eye_x, right_eye_y],
        left_eye: [left_eye_x, left_eye_y],
        nose: [nose_x, nose_y],
        right_mouth: [right_mouth_x, right_mouth_y],
        left_mouth: [left_mouth_x, left_mouth_y],
    }
}

fn mesh_subset_for_debug(mesh: &[(f64, f64, f64)]) -> Option<MeshSubset> {
    let subset_points = stable_subset(mesh)?
        .into_iter()
        .map(|(x, y, z)| [x, y, z])
        .collect();
    let subset_indices = IDENTITY_STABLE_INDICES
        .iter()
        .map(|&index| index as u32)
        .collect();
    Some(MeshSubset {
        subset_points,
        subset_indices,
    })
}

fn apply_pad_debug(debug: &mut LivenessDebug, verdict: &PadVerdict) {
    debug.pad_scored_frames = verdict.pad_scored_frames;
    debug.pad_passing_frames = verdict.pad_passing_frames;
    for (entry, score) in debug.timeline.iter_mut().zip(&verdict.pad_frame_scores) {
        entry.pad_score = *score;
    }
}

fn finalize_perf(response: &mut VerifyResponse, enabled: bool, started: Instant, frame_count: u32) {
    if enabled {
        let total = started.elapsed().as_secs_f64() * 1000.0;
        response.perf_trace = Some(crate::types::PerfTrace {
            video_decode_ms: None,
            ffmpeg_extract_ms: None,
            pose_timeline_ms: None,
            pad_ms: None,
            face_match_ms: None,
            total_ms: Some(total),
            frame_count: Some(frame_count),
        });
    }
}

struct FaceMatch {
    face_match_passed: bool,
    face_match_score: Option<f64>,
    face_match_alignment: Option<FaceMatchAlignment>,
    used_fallback: bool,
    reason: Option<String>,
}

fn match_centered_frame(
    detector: &crate::yunet::YunetDetector,
    recognizer: &AuraFaceRecognizer,
    dg2_mesh: Option<&[(f64, f64, f64)]>,
    dg2_image: &BgrImage,
    selfie: &BgrImage,
    selfie_mesh: Option<&Vec<(f64, f64, f64)>>,
    threshold: f64,
) -> Result<FaceMatch> {
    // DG2 embeddings — compute both mesh and YuNet alignments so the
    // selfie can fall back to YuNet if its mesh path is unavailable.
    let dg2_yunet_emb = embed_via_yunet(detector, recognizer, dg2_image)?;
    let dg2_mesh_emb = match dg2_mesh {
        Some(points) => embed_via_mesh(recognizer, dg2_image, points)?,
        None => None,
    };

    // Selfie embeddings — prefer mesh-aligned, fall back to YuNet-aligned.
    let selfie_mesh_emb = match selfie_mesh {
        Some(points) => embed_via_mesh(recognizer, selfie, points)?,
        None => None,
    };
    let selfie_yunet_emb = if selfie_mesh_emb.is_none() {
        embed_via_yunet(detector, recognizer, selfie)?
    } else {
        None
    };

    // Match selection — mesh > yunet > none.
    if let (Some(dg2_m), Some(selfie_m)) = (&dg2_mesh_emb, &selfie_mesh_emb) {
        let raw = cosine(dg2_m, selfie_m);
        let normalized = normalize_cosine_score(raw);
        let passed = normalized >= threshold;
        return Ok(FaceMatch {
            face_match_passed: passed,
            face_match_score: Some(normalized),
            face_match_alignment: Some(FaceMatchAlignment::Mesh),
            used_fallback: false,
            reason: if passed {
                None
            } else {
                Some("face_score_below_threshold".into())
            },
        });
    }
    let Some(dg2_y) = dg2_yunet_emb else {
        return Ok(FaceMatch {
            face_match_passed: false,
            face_match_score: None,
            face_match_alignment: None,
            used_fallback: false,
            reason: Some("face_score_dg2_face_not_detected".into()),
        });
    };
    if let Some(selfie_y) = selfie_yunet_emb {
        let raw = cosine(&dg2_y, &selfie_y);
        let normalized = normalize_cosine_score(raw);
        let passed = normalized >= threshold;
        return Ok(FaceMatch {
            face_match_passed: passed,
            face_match_score: Some(normalized),
            face_match_alignment: Some(FaceMatchAlignment::Yunet),
            used_fallback: false,
            reason: if passed {
                None
            } else {
                Some("face_score_below_threshold".into())
            },
        });
    }
    Ok(FaceMatch {
        face_match_passed: false,
        face_match_score: None,
        face_match_alignment: None,
        used_fallback: false,
        reason: Some("face_score_no_decodable_frame".into()),
    })
}

fn extract_dg2_mesh(
    detector: &crate::yunet::YunetDetector,
    mesh: &crate::mesh::MeshLandmarker,
    dg2_image: &BgrImage,
) -> Result<Option<Vec<(f64, f64, f64)>>> {
    let detections = detector.detect(dg2_image)?;
    let Some(face) = crate::yunet::pick_best_face(&detections) else {
        return Ok(None);
    };
    mesh.extract(
        &dg2_image.pixels,
        dg2_image.width,
        dg2_image.height,
        face.bbox(),
    )
}

fn embed_via_yunet(
    detector: &crate::yunet::YunetDetector,
    recognizer: &AuraFaceRecognizer,
    image: &BgrImage,
) -> Result<Option<Vec<f64>>> {
    let detections = detector.detect(image)?;
    let Some(face) = crate::yunet::pick_best_face(&detections) else {
        return Ok(None);
    };
    let landmarks: [(f64, f64); 5] = [
        face.landmark(0),
        face.landmark(1),
        face.landmark(2),
        face.landmark(3),
        face.landmark(4),
    ];
    recognizer.embed_from_yunet_landmarks(&image.pixels, image.width, image.height, &landmarks)
}

fn embed_via_mesh(
    recognizer: &AuraFaceRecognizer,
    image: &BgrImage,
    mesh_points: &[(f64, f64, f64)],
) -> Result<Option<Vec<f64>>> {
    let Some(landmarks) = crate::mesh::mesh_anatomical_5pt(mesh_points) else {
        return Ok(None);
    };
    recognizer.embed_from_yunet_landmarks(&image.pixels, image.width, image.height, &landmarks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Settings;
    use crate::types::Dg2ImagePayload;

    #[tokio::test]
    async fn include_debug_populates_dev_debug_envelope_on_early_failure() {
        let mut settings = Settings::from_env();
        settings.is_dev = true;
        settings.debug_responses_allowed = true;
        let runtime = Runtime::placeholder(settings);

        let response = verify_liveness_payload(
            &runtime,
            VerifyRequest {
                dg2_image: Dg2ImagePayload {
                    bytes_base64: "AA==".into(),
                    format: None,
                },
                video_base64: String::new(),
                challenge_nonce_base64: None,
                face_match_threshold: None,
                include_debug: Some(true),
                skip_face_match: None,
            },
        )
        .await
        .expect("pipeline returns response");

        let debug = response.debug.expect("debug payload");
        assert_eq!(response.reason.as_deref(), Some("liveness_video_missing"));
        assert_eq!(debug.frame_count, 0);
        assert_eq!(debug.timeline.len(), 0);
        assert_eq!(debug.pad_loaded, false);
        assert_eq!(debug.mesh_loaded, Some(false));
    }
}
