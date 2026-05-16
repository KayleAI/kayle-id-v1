//! HTTP routes mirroring `BiometricVerifierHandler` at `service.py:2271-2387`.
//!
//! Routes:
//!   - `GET /health` → [`crate::runtime::Runtime::health_payload`] with
//!     200/503 status reflecting `data.ready`.
//!   - `POST /verify` → runs the verifier pipeline and returns a verdict
//!     payload (always 200, per Python convention).
//!   - `GET /_debug/metrics` → 404 unless `BIOMETRIC_VERIFIER_DEBUG_METRICS=1`.
//!   - Any other path → 404 with the Python NOT_FOUND envelope.

use crate::runtime::Runtime;
use crate::types::{NotFoundEnvelope, VerifyResponse};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use std::ffi::CString;
use std::fs;
use std::path::{Path, PathBuf};

pub fn router(runtime: Runtime) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/verify", post(verify))
        .route("/_debug/metrics", get(debug_metrics))
        .fallback(not_found)
        .with_state(runtime)
}

async fn health(State(runtime): State<Runtime>) -> Response {
    let payload = runtime.health_payload();
    let status = if payload.data.ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(payload)).into_response()
}

async fn verify(
    State(runtime): State<Runtime>,
    Json(_request): Json<crate::types::VerifyRequest>,
) -> Response {
    if !runtime.ready() {
        let suffix = runtime.unavailable_reason();
        let reason = format!("biometric_verifier_unavailable:runtime_not_ready:{suffix}");
        return (StatusCode::OK, Json(VerifyResponse::unavailable(reason))).into_response();
    }
    let result = match crate::pipeline::verify_liveness_payload(&runtime, _request).await {
        Ok(r) => r,
        Err(e) => {
            tracing::event!(
                target: "biometric_verifier",
                tracing::Level::ERROR,
                name = "container_liveness_failed",
                error = %e,
            );
            VerifyResponse::unavailable("biometric_verifier_unavailable:container_runtime_failed")
        }
    };
    (StatusCode::OK, Json(result)).into_response()
}

async fn debug_metrics(State(runtime): State<Runtime>) -> Response {
    if !runtime.settings.debug_metrics_enabled {
        return (StatusCode::NOT_FOUND, Json(NotFoundEnvelope::new())).into_response();
    }
    (StatusCode::OK, Json(read_debug_metrics())).into_response()
}

fn read_debug_metrics() -> crate::types::DebugMetrics {
    let proc_times = read_proc_stat_times();
    let (utime_sec, stime_sec, uptime_sec) = proc_times.unwrap_or((None, None, None));

    crate::types::DebugMetrics {
        memory: crate::types::MetricsMemory {
            vm_rss_bytes: read_proc_status_bytes("VmRSS"),
            vm_hwm_bytes: read_proc_status_bytes("VmHWM"),
            cgroup_limit_bytes: read_cgroup_memory_limit(),
        },
        cpu: crate::types::MetricsCpu {
            utime_sec,
            stime_sec,
            uptime_sec,
        },
        disk: crate::types::MetricsDisk {
            app_bytes: read_dir_bytes(Path::new("/app")),
            tmp_bytes: read_dir_bytes(Path::new("/tmp")),
            root_free_bytes: root_free_bytes(),
        },
        process: crate::types::MetricsProcess {
            pid: std::process::id(),
        },
    }
}

fn read_proc_status_bytes(field: &str) -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if !line.starts_with(field) {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        let value = parts.get(1)?.parse::<u64>().ok()?;
        return if parts
            .last()
            .is_some_and(|unit| unit.eq_ignore_ascii_case("kb"))
        {
            value.checked_mul(1024)
        } else {
            Some(value)
        };
    }
    None
}

fn read_cgroup_memory_limit() -> Option<u64> {
    for path in [
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ] {
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed == "max" {
            return None;
        }
        if let Ok(value) = trimmed.parse::<u64>() {
            return Some(value);
        }
    }
    None
}

fn read_proc_stat_times() -> Option<(Option<f64>, Option<f64>, Option<f64>)> {
    let stat = fs::read_to_string("/proc/self/stat").ok()?;
    let rparen = stat.rfind(')')?;
    let fields: Vec<&str> = stat.get(rparen + 2..)?.split_whitespace().collect();
    let ticks_per_second = ticks_per_second()?;
    let utime_sec = fields.get(11)?.parse::<f64>().ok()? / ticks_per_second;
    let stime_sec = fields.get(12)?.parse::<f64>().ok()? / ticks_per_second;
    let starttime_ticks = fields.get(19)?.parse::<f64>().ok()?;

    let uptime_raw = fs::read_to_string("/proc/uptime").ok()?;
    let system_uptime_sec = uptime_raw.split_whitespace().next()?.parse::<f64>().ok()?;
    let process_age_sec = (system_uptime_sec - (starttime_ticks / ticks_per_second)).max(0.0);

    Some((Some(utime_sec), Some(stime_sec), Some(process_age_sec)))
}

fn ticks_per_second() -> Option<f64> {
    let value = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if value > 0 {
        Some(value as f64)
    } else {
        None
    }
}

fn read_dir_bytes(path: &Path) -> Option<u64> {
    fs::symlink_metadata(path).ok()?;
    let mut total = 0_u64;
    let mut stack = vec![PathBuf::from(path)];
    while let Some(current) = stack.pop() {
        let Ok(metadata) = fs::symlink_metadata(&current) else {
            continue;
        };
        if metadata.is_file() {
            total = total.checked_add(metadata.len())?;
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            stack.push(entry.path());
        }
    }
    Some(total)
}

fn root_free_bytes() -> Option<u64> {
    let root = CString::new("/").ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let rc = unsafe { libc::statvfs(root.as_ptr(), stat.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    let stat = unsafe { stat.assume_init() };
    (stat.f_bavail as u64).checked_mul(stat.f_bsize as u64)
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(NotFoundEnvelope::new())).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Settings;
    use crate::runtime::RuntimeState;
    use axum::body::Body;
    use axum::http::Request;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn dev_runtime() -> Runtime {
        let mut settings = Settings::from_env();
        // Force values for test isolation.
        settings.is_dev = true;
        settings.debug_metrics_enabled = false;
        Runtime::placeholder(settings)
    }

    fn runtime_with_detector_load_error() -> Runtime {
        let mut settings = Settings::from_env();
        settings.debug_metrics_enabled = false;
        Runtime {
            settings: Arc::new(settings),
            state: Arc::new(RuntimeState {
                detector: None,
                recognizer: None,
                mesh: None,
                pad: None,
                recognizer_load_error: None,
                detector_load_error: Some("detector_missing_for_test".into()),
                pad_load_error: None,
                mesh_load_error: None,
                init_error: None,
            }),
        }
    }

    #[tokio::test]
    async fn health_503_when_runtime_unready() {
        let app = router(dev_runtime());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["data"]["ready"], false);
        assert_eq!(v["data"]["status"], "unhealthy");
        assert_eq!(v["error"]["code"], "BIOMETRIC_VERIFIER_UNAVAILABLE");
    }

    #[tokio::test]
    async fn verify_returns_runtime_not_ready_failure() {
        let app = router(dev_runtime());
        let body = r#"{"dg2Image":{"bytesBase64":"AA=="},"videoBase64":""}"#;
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/verify")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["livenessPassed"], false);
        assert_eq!(v["faceMatchPassed"], false);
        assert_eq!(v["padPassed"], false);
        assert_eq!(v["usedFallback"], true);
        let reason = v["reason"].as_str().unwrap();
        assert!(
            reason.starts_with("biometric_verifier_unavailable:runtime_not_ready"),
            "got reason {reason}"
        );
    }

    #[tokio::test]
    async fn verify_runtime_not_ready_reason_uses_model_load_error() {
        let app = router(runtime_with_detector_load_error());
        let body = r#"{"dg2Image":{"bytesBase64":"AA=="},"videoBase64":""}"#;
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/verify")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            v["reason"],
            "biometric_verifier_unavailable:runtime_not_ready:detector_missing_for_test"
        );
    }

    #[tokio::test]
    async fn unknown_route_404() {
        let app = router(dev_runtime());
        let response = app
            .oneshot(Request::builder().uri("/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["error"]["code"], "NOT_FOUND");
        assert_eq!(v["error"]["message"], "Route not found.");
    }

    #[tokio::test]
    async fn debug_metrics_disabled_yields_404() {
        let app = router(dev_runtime());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/_debug/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn debug_metrics_enabled_returns_process_payload() {
        let mut settings = Settings::from_env();
        settings.debug_metrics_enabled = true;
        let app = router(Runtime::placeholder(settings));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/_debug/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["process"]["pid"], std::process::id());
        assert!(v["memory"].is_object());
        assert!(v["cpu"].is_object());
        assert!(v["disk"].is_object());
    }
}
