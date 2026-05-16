//! Wire types for `/verify` request and response, matching the Zod schema
//! at `packages/config/src/biometric-verifier.ts` field-for-field.
//!
//! Every optional response field uses `Option<T>` with explicit `null`
//! serialization (no `skip_serializing_if`) — the TypeScript consumer
//! schema in `@kayle-id/config` requires every key present on the wire.
//!
//! Direct port of the Python `verify_liveness` request handling and
//! response builders in `service.py`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    pub dg2_image: Dg2ImagePayload,
    /// Base64-encoded video bytes. Empty string treated as "no video".
    #[serde(default)]
    pub video_base64: String,
    #[serde(default)]
    pub challenge_nonce_base64: Option<String>,
    #[serde(default)]
    pub face_match_threshold: Option<f64>,
    #[serde(default)]
    pub include_debug: Option<bool>,
    #[serde(default)]
    pub skip_face_match: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dg2ImagePayload {
    pub bytes_base64: String,
    /// Format hint ("jpeg" / "png") — informational only; decode probes
    /// the magic bytes.
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResponse {
    pub liveness_passed: bool,
    pub liveness_score: Option<f64>,
    pub face_match_passed: bool,
    pub face_match_score: Option<f64>,
    pub pad_passed: bool,
    pub pad_score: Option<f64>,
    pub used_fallback: bool,
    pub reason: Option<String>,
    /// `"mesh"` | `"yunet"` | `null`.
    pub face_match_alignment: Option<FaceMatchAlignment>,
    /// Populated only when `includeDebug=true` AND container is in dev mode.
    pub debug: Option<LivenessDebug>,
    /// Bench-only timing trace. Emitted when `BIOMETRIC_VERIFIER_DEBUG_METRICS=1`.
    #[serde(rename = "_perfTrace")]
    pub perf_trace: Option<PerfTrace>,
}

impl VerifyResponse {
    /// "Runtime unavailable" / "container can't process" failure. Sets
    /// `usedFallback=true` so the Worker's downstream code knows the
    /// verifier itself couldn't run, distinct from an evaluated rejection.
    /// Mirrors `service.py:2129-2141`.
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            liveness_passed: false,
            liveness_score: None,
            face_match_passed: false,
            face_match_score: None,
            pad_passed: false,
            pad_score: None,
            used_fallback: true,
            reason: Some(reason.into()),
            face_match_alignment: None,
            debug: None,
            perf_trace: None,
        }
    }

    /// "Pipeline failure": the verifier ran but couldn't produce a positive
    /// verdict (no face, bad nonce, no head movement, etc.). `usedFallback=false`
    /// — mirrors `liveness_failure_response` at `service.py:1893-1912`.
    pub fn pipeline_failure(reason: impl Into<String>) -> Self {
        Self {
            liveness_passed: false,
            liveness_score: None,
            face_match_passed: false,
            face_match_score: None,
            pad_passed: false,
            pad_score: None,
            used_fallback: false,
            reason: Some(reason.into()),
            face_match_alignment: None,
            debug: None,
            perf_trace: None,
        }
    }

    /// Pipeline failure that already has a `liveness_score` computed
    /// (e.g. coverage failed but face detection succeeded). Matches
    /// `liveness_failure_response(..., liveness_score=score)`.
    pub fn pipeline_failure_with_score(reason: impl Into<String>, liveness_score: f64) -> Self {
        let mut r = Self::pipeline_failure(reason);
        r.liveness_score = Some(liveness_score);
        r
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FaceMatchAlignment {
    Mesh,
    Yunet,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfTrace {
    pub video_decode_ms: Option<f64>,
    pub ffmpeg_extract_ms: Option<f64>,
    pub pose_timeline_ms: Option<f64>,
    pub pad_ms: Option<f64>,
    pub face_match_ms: Option<f64>,
    pub total_ms: Option<f64>,
    pub frame_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivenessDebug {
    pub frame_count: u32,
    pub duration_seconds: Option<f64>,
    pub frame_width: u32,
    pub frame_height: u32,
    pub center_frame_index: Option<u32>,
    pub timeline: Vec<LivenessTimelineEntry>,
    pub pad_frame_threshold: Option<f64>,
    pub pad_pass_fraction: Option<f64>,
    pub pad_scored_frames: u32,
    pub pad_passing_frames: u32,
    pub pad_disabled: bool,
    pub pad_loaded: bool,
    pub mesh_disabled: Option<bool>,
    pub mesh_loaded: Option<bool>,
    pub dg2_mesh: Option<MeshSubset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivenessTimelineEntry {
    pub frame_index: u32,
    pub face_detected: bool,
    pub pitch_deg: Option<f64>,
    pub yaw_deg: Option<f64>,
    pub roll_deg: Option<f64>,
    pub pose: PoseClass,
    pub pad_score: Option<f64>,
    pub bbox: Option<DebugBbox>,
    pub landmarks: Option<DebugLandmarks>,
    pub mesh: Option<MeshSubset>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PoseClass {
    Center,
    Left,
    Right,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBbox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLandmarks {
    pub right_eye: [f64; 2],
    pub left_eye: [f64; 2],
    pub nose: [f64; 2],
    pub right_mouth: [f64; 2],
    pub left_mouth: [f64; 2],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshSubset {
    pub subset_points: Vec<[f64; 3]>,
    pub subset_indices: Vec<u32>,
}

/// Health-payload envelope matching `health_payload` at `service.py:2105`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub data: HealthData,
    pub error: Option<HealthError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthData {
    pub detector_model_path: String,
    pub model_path: String,
    pub recognizer_loaded: bool,
    pub pad_disabled: bool,
    pub pad_loaded: bool,
    pub mesh_disabled: bool,
    pub mesh_loaded: bool,
    pub is_dev: bool,
    pub ready: bool,
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthError {
    pub code: &'static str,
    pub message: String,
}

/// `/_debug/metrics` payload (gated by `BIOMETRIC_VERIFIER_DEBUG_METRICS=1`).
/// Mirrors `read_debug_metrics` at `service.py:2229-2268`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugMetrics {
    pub memory: MetricsMemory,
    pub cpu: MetricsCpu,
    pub disk: MetricsDisk,
    pub process: MetricsProcess,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsMemory {
    pub vm_rss_bytes: Option<u64>,
    pub vm_hwm_bytes: Option<u64>,
    pub cgroup_limit_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsCpu {
    pub utime_sec: Option<f64>,
    pub stime_sec: Option<f64>,
    pub uptime_sec: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsDisk {
    pub app_bytes: Option<u64>,
    pub tmp_bytes: Option<u64>,
    pub root_free_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsProcess {
    pub pid: u32,
}

/// Generic 404 envelope, matching the Python `NOT_FOUND` shape.
#[derive(Debug, Clone, Serialize)]
pub struct NotFoundEnvelope {
    pub error: NotFoundBody,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotFoundBody {
    pub code: &'static str,
    pub message: &'static str,
}

impl NotFoundEnvelope {
    pub fn new() -> Self {
        Self {
            error: NotFoundBody {
                code: "NOT_FOUND",
                message: "Route not found.",
            },
        }
    }
}

impl Default for NotFoundEnvelope {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// VerifyResponse must always emit every field as `null` (not omit them).
    /// The TS consumer's Zod schema requires presence.
    #[test]
    fn failure_response_emits_explicit_nulls() {
        let r = VerifyResponse::unavailable("test_reason");
        let json = serde_json::to_value(&r).unwrap();
        let obj = json.as_object().unwrap();
        for key in [
            "livenessPassed",
            "livenessScore",
            "faceMatchPassed",
            "faceMatchScore",
            "padPassed",
            "padScore",
            "usedFallback",
            "reason",
            "faceMatchAlignment",
            "debug",
            "_perfTrace",
        ] {
            assert!(obj.contains_key(key), "missing key {key}");
        }
        assert_eq!(obj["reason"], "test_reason");
        assert_eq!(obj["livenessPassed"], false);
        assert_eq!(obj["usedFallback"], true);
        assert!(obj["livenessScore"].is_null());
        assert!(obj["faceMatchAlignment"].is_null());
        assert!(obj["debug"].is_null());
        assert!(obj["_perfTrace"].is_null());
    }

    #[test]
    fn alignment_serializes_lowercase() {
        let s = serde_json::to_string(&FaceMatchAlignment::Mesh).unwrap();
        assert_eq!(s, "\"mesh\"");
        let s = serde_json::to_string(&FaceMatchAlignment::Yunet).unwrap();
        assert_eq!(s, "\"yunet\"");
    }

    #[test]
    fn pose_class_serializes_lowercase() {
        let s = serde_json::to_string(&PoseClass::Center).unwrap();
        assert_eq!(s, "\"center\"");
        let s = serde_json::to_string(&PoseClass::Unknown).unwrap();
        assert_eq!(s, "\"unknown\"");
    }

    #[test]
    fn request_parses_optional_fields_absent() {
        let body = r#"{"dg2Image":{"bytesBase64":"AAAA"},"videoBase64":""}"#;
        let r: VerifyRequest = serde_json::from_str(body).unwrap();
        assert!(r.face_match_threshold.is_none());
        assert!(r.challenge_nonce_base64.is_none());
        assert!(r.include_debug.is_none());
        assert_eq!(r.dg2_image.bytes_base64, "AAAA");
    }
}
