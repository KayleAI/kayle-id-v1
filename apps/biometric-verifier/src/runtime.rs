//! Container runtime: ONNX session handles + health reporting.
//!
//! Mirrors `BiometricVerifierRuntime` at `service.py:1900-2153`. Loads
//! YuNet, AuraFace, mesh, and both PAD sessions at startup. Individual
//! load failures are non-fatal: the corresponding capability is marked
//! unavailable in `/health` and the pipeline degrades accordingly (see
//! `pad_disabled` / `mesh_disabled` env kill-switches).

use crate::auraface::AuraFaceRecognizer;
use crate::config::{Settings, PAD_V1SE_CROP_SCALE, PAD_V2_CROP_SCALE};
use crate::mesh::MeshLandmarker;
use crate::pad::{PadDetector, PadSession};
use crate::types::{HealthData, HealthError, HealthResponse};
use crate::yunet::YunetDetector;
use std::sync::Arc;

#[derive(Clone)]
pub struct Runtime {
    pub settings: Arc<Settings>,
    pub state: Arc<RuntimeState>,
}

pub struct RuntimeState {
    pub detector: Option<YunetDetector>,
    pub recognizer: Option<AuraFaceRecognizer>,
    pub mesh: Option<MeshLandmarker>,
    pub pad: Option<PadDetector>,
    pub recognizer_load_error: Option<String>,
    pub detector_load_error: Option<String>,
    pub pad_load_error: Option<String>,
    pub mesh_load_error: Option<String>,
    pub init_error: Option<String>,
}

impl RuntimeState {
    pub fn detector_loaded(&self) -> bool {
        self.detector.is_some()
    }
    pub fn recognizer_loaded(&self) -> bool {
        self.recognizer.is_some()
    }
    pub fn pad_loaded(&self) -> bool {
        self.pad.is_some()
    }
    pub fn mesh_loaded(&self) -> bool {
        self.mesh.is_some()
    }
}

impl Runtime {
    /// Build a runtime by loading every configured ONNX session.
    /// Per-model failures are recorded but don't abort startup — `/health`
    /// reports `ready=false` if a required session (detector + recognizer)
    /// failed to load; pad/mesh are best-effort and gated by their
    /// `*_DISABLED` env vars.
    pub fn load(settings: Settings) -> Self {
        let mut state = RuntimeState {
            detector: None,
            recognizer: None,
            mesh: None,
            pad: None,
            recognizer_load_error: None,
            detector_load_error: None,
            pad_load_error: None,
            mesh_load_error: None,
            init_error: None,
        };

        match YunetDetector::from_file(&settings.detector_model_path, settings.onnx_intra_op_threads) {
            Ok(d) => state.detector = Some(d),
            Err(e) => {
                state.detector_load_error = Some(e.to_string());
                tracing::event!(
                    target: "biometric_verifier",
                    tracing::Level::ERROR,
                    name = "detector_load_failed",
                    error = %e,
                );
            }
        }

        match AuraFaceRecognizer::from_file(&settings.model_path, settings.onnx_intra_op_threads) {
            Ok(r) => state.recognizer = Some(r),
            Err(e) => {
                state.recognizer_load_error = Some(e.to_string());
                tracing::event!(
                    target: "biometric_verifier",
                    tracing::Level::ERROR,
                    name = "recognizer_load_failed",
                    error = %e,
                );
            }
        }

        if !settings.mesh_disabled {
            match MeshLandmarker::from_file(
                &settings.mesh_model_path,
                settings.onnx_intra_op_threads,
                settings.mesh_crop_expand,
            ) {
                Ok(m) => state.mesh = Some(m),
                Err(e) => {
                    state.mesh_load_error = Some(e.to_string());
                    tracing::event!(
                        target: "biometric_verifier",
                        tracing::Level::ERROR,
                        name = "mesh_load_failed",
                        error = %e,
                    );
                }
            }
        }

        if !settings.pad_disabled {
            let v2 = PadSession::from_file(&settings.pad_v2_model_path, settings.onnx_intra_op_threads);
            let v1se =
                PadSession::from_file(&settings.pad_v1se_model_path, settings.onnx_intra_op_threads);
            match (v2, v1se) {
                (Ok(v2), Ok(v1se)) => {
                    state.pad = Some(PadDetector::new(v2, v1se, PAD_V2_CROP_SCALE, PAD_V1SE_CROP_SCALE));
                }
                (v2_res, v1se_res) => {
                    let mut errors = Vec::new();
                    if let Err(e) = v2_res {
                        errors.push(format!("v2: {e}"));
                    }
                    if let Err(e) = v1se_res {
                        errors.push(format!("v1se: {e}"));
                    }
                    let joined = errors.join("; ");
                    state.pad_load_error = Some(joined.clone());
                    tracing::event!(
                        target: "biometric_verifier",
                        tracing::Level::ERROR,
                        name = "pad_load_failed",
                        error = %joined,
                    );
                }
            }
        }

        Self {
            settings: Arc::new(settings),
            state: Arc::new(state),
        }
    }

    /// Placeholder runtime — used in tests where ONNX loading is undesirable.
    /// `ready()` returns false and `/verify` short-circuits with
    /// "runtime_not_ready". Production uses [`Runtime::load`].
    pub fn placeholder(settings: Settings) -> Self {
        Self {
            settings: Arc::new(settings),
            state: Arc::new(RuntimeState {
                detector: None,
                recognizer: None,
                mesh: None,
                pad: None,
                recognizer_load_error: None,
                detector_load_error: None,
                pad_load_error: None,
                mesh_load_error: None,
                init_error: Some("not_yet_implemented".into()),
            }),
        }
    }

    pub fn ready(&self) -> bool {
        self.state.init_error.is_none()
            && self.state.detector_loaded()
            && self.state.recognizer_loaded()
    }

    pub fn health_payload(&self) -> HealthResponse {
        let ready = self.ready();
        HealthResponse {
            data: HealthData {
                detector_model_path: self.settings.detector_model_path.clone(),
                model_path: self.settings.model_path.clone(),
                recognizer_loaded: self.state.recognizer_loaded(),
                pad_disabled: self.settings.pad_disabled,
                pad_loaded: self.state.pad_loaded(),
                mesh_disabled: self.settings.mesh_disabled,
                mesh_loaded: self.state.mesh_loaded(),
                is_dev: self.settings.is_dev,
                ready,
                status: if ready { "healthy" } else { "unhealthy" },
            },
            error: if ready {
                None
            } else {
                Some(HealthError {
                    code: "BIOMETRIC_VERIFIER_UNAVAILABLE",
                    message: self
                        .state
                        .init_error
                        .clone()
                        .or_else(|| self.state.detector_load_error.clone())
                        .or_else(|| self.state.recognizer_load_error.clone())
                        .unwrap_or_else(|| "Biometric verifier runtime is unavailable.".into()),
                })
            },
        }
    }
}
