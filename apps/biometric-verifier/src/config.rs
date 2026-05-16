//! Compile-time-defaulted, env-overridable configuration constants.
//!
//! Mirrors the constants block in `service.py:44-219` exactly so the Rust
//! port and Python service produce identical decisions when fed the same
//! env vars. Anywhere a numeric clamp exists in Python we apply the same
//! clamp here.

use std::env;
use std::sync::OnceLock;

pub const MODEL_INPUT_SIZE: (usize, usize) = (112, 112);
pub const DETAIL_STDDEV_MIN: f64 = 12.0;
pub const STRICT_IMAGE_SIMILARITY_THRESHOLD: f64 = 0.995;
/// `0.7` normalised ≈ raw cosine `0.4` — InsightFace's published
/// "same person" threshold for glint360k-trained ArcFace R100.
pub const DEFAULT_THRESHOLD: f64 = 0.7;
pub const DEFAULT_DETECTOR_INPUT_SIZE: (usize, usize) = (320, 320);
pub const DEFAULT_MODEL_PATH: &str = "/app/models/auraface_glintr100.onnx";
pub const DEFAULT_DETECTOR_MODEL_PATH: &str = "/app/models/face_detection_yunet_2023mar.onnx";
pub const DEFAULT_PAD_V2_MODEL_PATH: &str = "/app/models/pad_minifasnet_v2_scale27.onnx";
pub const DEFAULT_PAD_V1SE_MODEL_PATH: &str = "/app/models/pad_minifasnet_v1se_scale40.onnx";
pub const DEFAULT_MESH_MODEL_PATH: &str = "/app/models/face_landmarks_detector.onnx";

pub const MESH_INPUT_SIZE: (usize, usize) = (256, 256);
pub const PAD_INPUT_SIZE: (usize, usize) = (80, 80);
pub const PAD_V2_CROP_SCALE: f64 = 2.7;
pub const PAD_V1SE_CROP_SCALE: f64 = 4.0;
pub const PAD_FRAME_THRESHOLD: f64 = 0.55;
pub const PAD_PASS_FRACTION: f64 = 0.7;

// Nonce layout — must match Swift side (apps/ios/.../LivenessNonceStamp.swift).
pub const NONCE_PATCH_X: usize = 16;
pub const NONCE_PATCH_Y: usize = 1120;
pub const NONCE_COLS: usize = 8;
pub const NONCE_ROWS: usize = 4;
pub const NONCE_SQUARE_SIZE: usize = 24;
pub const NONCE_GUTTER: usize = 8;
pub const NONCE_THRESHOLD: u8 = 127;
pub const NONCE_BYTES: usize = 4;
pub const NONCE_EXPECTED_WIDTH: usize = 720;
pub const NONCE_EXPECTED_HEIGHT: usize = 1280;

/// Fully resolved settings (env-read once at startup).
#[derive(Debug, Clone)]
pub struct Settings {
    pub port: u16,
    pub is_dev: bool,
    pub allow_pixel_fallback: bool,
    pub allow_face_match_skip: bool,
    pub debug_responses_allowed: bool,
    pub debug_metrics_enabled: bool,

    pub onnx_intra_op_threads: Option<i32>,

    pub liveness_frame_count: u32,
    pub liveness_video_max_duration_seconds: f64,
    pub liveness_center_yaw_deg: f64,
    pub liveness_tilt_yaw_deg: f64,
    pub liveness_min_pose_frames: u32,

    pub pad_disabled: bool,
    pub pad_v2_model_path: String,
    pub pad_v1se_model_path: String,

    pub mesh_disabled: bool,
    pub mesh_model_path: String,
    pub mesh_crop_expand: f64,

    pub model_path: String,
    pub detector_model_path: String,
}

impl Settings {
    pub fn from_env() -> Self {
        Self {
            port: read_u16_env("PORT").unwrap_or(8080),
            is_dev: env::var("NODE_ENV").unwrap_or_default() == "development",
            allow_pixel_fallback: false, // set after is_dev resolved below
            allow_face_match_skip: false,
            debug_responses_allowed: false,
            debug_metrics_enabled: env::var("BIOMETRIC_VERIFIER_DEBUG_METRICS").unwrap_or_default()
                == "1",

            onnx_intra_op_threads: read_positive_i32_env(
                "BIOMETRIC_VERIFIER_ONNX_INTRA_OP_THREADS",
            ),

            liveness_frame_count: read_i32_env("BIOMETRIC_VERIFIER_FRAME_COUNT")
                .map(|v| v.max(0) as u32)
                .unwrap_or(24),
            liveness_video_max_duration_seconds: {
                let v = read_f64_env("BIOMETRIC_VERIFIER_MAX_DURATION_SECONDS").unwrap_or(15.0);
                v.max(1.0).min(60.0)
            },
            liveness_center_yaw_deg: read_f64_env("BIOMETRIC_VERIFIER_CENTER_YAW_DEG")
                .unwrap_or(15.0),
            liveness_tilt_yaw_deg: read_f64_env("BIOMETRIC_VERIFIER_TILT_YAW_DEG").unwrap_or(17.0),
            liveness_min_pose_frames: {
                let v = read_i32_env("BIOMETRIC_VERIFIER_MIN_POSE_FRAMES").unwrap_or(1);
                v.max(1).min(12) as u32
            },

            pad_disabled: env::var("BIOMETRIC_VERIFIER_PAD_DISABLED").unwrap_or_default() == "1",
            pad_v2_model_path: env::var("BIOMETRIC_VERIFIER_PAD_V2_MODEL_PATH")
                .unwrap_or_else(|_| DEFAULT_PAD_V2_MODEL_PATH.into()),
            pad_v1se_model_path: env::var("BIOMETRIC_VERIFIER_PAD_V1SE_MODEL_PATH")
                .unwrap_or_else(|_| DEFAULT_PAD_V1SE_MODEL_PATH.into()),

            mesh_disabled: env::var("BIOMETRIC_VERIFIER_MESH_DISABLED").unwrap_or_default() == "1",
            mesh_model_path: env::var("BIOMETRIC_VERIFIER_MESH_MODEL_PATH")
                .unwrap_or_else(|_| DEFAULT_MESH_MODEL_PATH.into()),
            mesh_crop_expand: {
                let v = read_f64_env("BIOMETRIC_VERIFIER_MESH_CROP_EXPAND").unwrap_or(0.5);
                v.max(0.0).min(2.0)
            },

            model_path: env::var("BIOMETRIC_VERIFIER_MODEL_PATH")
                .unwrap_or_else(|_| DEFAULT_MODEL_PATH.into()),
            detector_model_path: env::var("BIOMETRIC_VERIFIER_DETECTOR_PATH")
                .unwrap_or_else(|_| DEFAULT_DETECTOR_MODEL_PATH.into()),
        }
        .resolve_dev_gates()
    }

    fn resolve_dev_gates(mut self) -> Self {
        self.allow_pixel_fallback = self.is_dev;
        self.allow_face_match_skip = self.is_dev;
        self.debug_responses_allowed = self.is_dev;
        self
    }
}

static SETTINGS: OnceLock<Settings> = OnceLock::new();

/// Process-wide settings, lazily initialized from env at first access.
pub fn settings() -> &'static Settings {
    SETTINGS.get_or_init(Settings::from_env)
}

fn read_u16_env(key: &str) -> Option<u16> {
    env::var(key).ok()?.parse().ok()
}

fn read_i32_env(key: &str) -> Option<i32> {
    env::var(key).ok()?.parse().ok()
}

fn read_positive_i32_env(key: &str) -> Option<i32> {
    read_i32_env(key).filter(|v| *v > 0)
}

fn read_f64_env(key: &str) -> Option<f64> {
    env::var(key).ok()?.parse().ok()
}
