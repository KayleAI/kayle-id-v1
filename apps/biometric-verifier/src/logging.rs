//! Structured logging mirroring the Python `emit_log` shape:
//!
//! ```json
//! {"event": "biometric_verifier.<name>", ...details}
//! ```
//!
//! Each log line is a single JSON object on stdout, line-buffered. The
//! event name is the tracing target's message; key/value detail pairs
//! come from `tracing` fields.

use std::io::Write;
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::Layer;

pub fn init() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(EmitLogLayer)
        .init();
}

/// Logs a structured event the same way Python's `emit_log` does:
/// `event = "biometric_verifier.<name>"` plus arbitrary detail fields.
///
/// Use `tracing::info!(target: "biometric_verifier", name = "container_listening", port = 8080)`
/// or the [`emit!`] macro below.
struct EmitLogLayer;

impl<S> Layer<S> for EmitLogLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = JsonFieldVisitor::default();
        event.record(&mut visitor);

        let name = visitor.name.unwrap_or_else(|| visitor.message.unwrap_or_default());
        if name.is_empty() {
            return;
        }
        let event_label = format!("biometric_verifier.{name}");

        let mut map = serde_json::Map::with_capacity(visitor.fields.len() + 1);
        map.insert(
            "event".into(),
            serde_json::Value::String(event_label),
        );
        for (k, v) in visitor.fields {
            if k == "name" || k == "message" {
                continue;
            }
            map.insert(k, v);
        }
        let line = serde_json::Value::Object(map).to_string();
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{line}");
        let _ = stdout.flush();
    }
}

#[derive(Default)]
struct JsonFieldVisitor {
    name: Option<String>,
    message: Option<String>,
    fields: Vec<(String, serde_json::Value)>,
}

impl Visit for JsonFieldVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        let n = field.name();
        if n == "name" {
            self.name = Some(value.to_string());
        } else if n == "message" {
            self.message = Some(value.to_string());
        } else {
            self.fields.push((n.into(), serde_json::Value::String(value.into())));
        }
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.push((field.name().into(), serde_json::json!(value)));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.fields.push((field.name().into(), serde_json::json!(value)));
    }
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.fields.push((field.name().into(), serde_json::json!(value)));
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.fields.push((field.name().into(), serde_json::json!(value)));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let n = field.name();
        let s = format!("{value:?}");
        if n == "message" {
            self.message = Some(s);
        } else {
            self.fields.push((n.into(), serde_json::Value::String(s)));
        }
    }
}

/// Emit a structured `biometric_verifier.<name>` event with arbitrary
/// key/value details. Mirrors Python `emit_log("name", **details)`.
///
/// Usage:
///   emit!("container_listening", port = 8080, model_path = "/app/...");
#[macro_export]
macro_rules! emit {
    ($name:expr) => {
        ::tracing::event!(
            target: "biometric_verifier",
            ::tracing::Level::INFO,
            name = $name,
        )
    };
    ($name:expr, $($k:ident = $v:expr),+ $(,)?) => {
        ::tracing::event!(
            target: "biometric_verifier",
            ::tracing::Level::INFO,
            name = $name,
            $($k = $v,)*
        )
    };
}
