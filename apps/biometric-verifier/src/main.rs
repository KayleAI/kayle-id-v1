use biometric_verifier::config::Settings;
use biometric_verifier::runtime::Runtime;
use biometric_verifier::server::router;
use biometric_verifier::{emit, logging};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    logging::init();
    let settings = Settings::from_env();
    let port = settings.port;
    let detector_path = settings.detector_model_path.clone();
    let model_path = settings.model_path.clone();
    let pad_v2 = settings.pad_v2_model_path.clone();
    let pad_v1se = settings.pad_v1se_model_path.clone();
    let pad_disabled = settings.pad_disabled;

    let runtime = Runtime::load(settings);
    let app = router(runtime);

    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    emit!(
        "container_listening",
        detector_model_path = detector_path.as_str(),
        model_path = model_path.as_str(),
        pad_v2_model_path = pad_v2.as_str(),
        pad_v1se_model_path = pad_v1se.as_str(),
        pad_disabled = pad_disabled,
        port = port as i64,
    );

    axum::serve(listener, app).await?;
    Ok(())
}
