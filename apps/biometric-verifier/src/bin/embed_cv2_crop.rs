//! Take cv2's exact 112×112 crop bytes (dumped to /tmp/cv2_crop_112.bgr)
//! and run it through my AuraFace preprocessing + ONNX. If the resulting
//! embedding matches Python's within 0.9999 cosine, the warp implementation
//! is the sole source of Phase 2 drift. If not, the AuraFace preprocessing
//! itself differs.

use biometric_verifier::auraface::{cosine, AuraFaceRecognizer};
use std::fs;
use std::path::Path;

fn main() -> anyhow::Result<()> {
    let cv2_crop = fs::read("/tmp/cv2_crop_112.bgr")?;
    assert_eq!(cv2_crop.len(), 112 * 112 * 3);
    let model = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("models/auraface_glintr100.onnx");
    let recognizer = AuraFaceRecognizer::from_file(model.to_str().unwrap(), Some(1))?;
    let emb = recognizer.feature(&cv2_crop)?.expect("non-empty");

    // Compare to Python's embedding.
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/auraface_embedding.json");
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(fixture_path)?)?;
    let py: Vec<f64> = v["embedding"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_f64().unwrap())
        .collect();
    let c = cosine(&emb, &py);
    println!("rust(cv2_crop) ↔ python(cv2_crop) cosine = {c:.6}");
    Ok(())
}
