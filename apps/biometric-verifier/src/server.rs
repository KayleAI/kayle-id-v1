//! HTTP routes mirroring `BiometricVerifierHandler` at `service.py:2271-2387`.
//!
//! Routes:
//!   - `GET /health` → [`crate::runtime::Runtime::health_payload`] with
//!     200/503 status reflecting `data.ready`.
//!   - `POST /verify` → currently returns a "runtime not yet implemented"
//!     failure payload (always 200, per Python convention). Phase 6 wires
//!     the actual pipeline.
//!   - `GET /_debug/metrics` → 404 unless `BIOMETRIC_VERIFIER_DEBUG_METRICS=1`.
//!     Phase 6 fills in `/proc` and cgroup reads.
//!   - Any other path → 404 with the Python NOT_FOUND envelope.

use crate::runtime::Runtime;
use crate::types::{NotFoundEnvelope, VerifyResponse};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};

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
        let suffix = runtime
            .state
            .init_error
            .clone()
            .unwrap_or_else(|| "unknown".into());
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
            VerifyResponse::unavailable(
                "biometric_verifier_unavailable:container_runtime_failed",
            )
        }
    };
    (StatusCode::OK, Json(result)).into_response()
}

async fn debug_metrics(State(runtime): State<Runtime>) -> Response {
    if !runtime.settings.debug_metrics_enabled {
        return (StatusCode::NOT_FOUND, Json(NotFoundEnvelope::new())).into_response();
    }
    // Phase 6 fills in /proc + cgroup reads. For now: a structurally
    // valid payload with all-None fields so the consumer code path
    // can be exercised in dev without panicking.
    let payload = crate::types::DebugMetrics {
        memory: crate::types::MetricsMemory {
            vm_rss_bytes: None,
            vm_hwm_bytes: None,
            cgroup_limit_bytes: None,
        },
        cpu: crate::types::MetricsCpu {
            utime_sec: None,
            stime_sec: None,
            uptime_sec: None,
        },
        disk: crate::types::MetricsDisk {
            app_bytes: None,
            tmp_bytes: None,
            root_free_bytes: None,
        },
        process: crate::types::MetricsProcess {
            pid: std::process::id(),
        },
    };
    (StatusCode::OK, Json(payload)).into_response()
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(NotFoundEnvelope::new())).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Settings;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn dev_runtime() -> Runtime {
        let mut settings = Settings::from_env();
        // Force values for test isolation.
        settings.is_dev = true;
        settings.debug_metrics_enabled = false;
        Runtime::placeholder(settings)
    }

    #[tokio::test]
    async fn health_503_when_runtime_unready() {
        let app = router(dev_runtime());
        let response = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
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
}
