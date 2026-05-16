//! Parity harness: Rust `solve_pnp` vs `cv2.solvePnP(SOLVEPNP_EPNP)` over
//! 800 fixtures (400 5-point YuNet config + 400 12-point mesh config).
//!
//! Tolerance: Euler XYZ (pitch, yaw, roll) within ≤ **2°** absolute on
//! ≥99% of fixtures, max ≤ **5°**. The pose values feed `classify_pose`
//! which buckets at 15° (center) / 17° (tilt) thresholds, so a few-degree
//! drift cannot flip the liveness verdict for a clip with proper coverage.
//! Translation parity is not checked — only the rotation matrix feeds
//! downstream logic.

use biometric_verifier::pnp::{
    camera_matrix_for, rotation_to_euler_deg_xyz, solve_pnp,
};
use serde::Deserialize;
use std::fs;

#[derive(Debug, Deserialize)]
struct Fixture {
    kind: String,
    obj: Vec<[f64; 3]>,
    img: Vec<[f64; 2]>,
    #[serde(rename = "cv2_euler_deg")]
    cv2_euler_deg: [f64; 3],
}

fn load_fixtures() -> Vec<Fixture> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/pnp_epnp.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
    serde_json::from_str(&raw).expect("parse fixtures")
}

fn assess(name: &str, fixtures: &[&Fixture]) {
    assert!(!fixtures.is_empty(), "{name}: no fixtures");
    let k = camera_matrix_for(720, 1280);
    let mut max_pitch = 0.0_f64;
    let mut max_yaw = 0.0_f64;
    let mut max_roll = 0.0_f64;
    let mut over_2deg = 0_usize;
    let mut failed = 0_usize;
    let total = fixtures.len();
    for f in fixtures {
        let obj: Vec<(f64, f64, f64)> = f.obj.iter().map(|p| (p[0], p[1], p[2])).collect();
        let img: Vec<(f64, f64)> = f.img.iter().map(|p| (p[0], p[1])).collect();
        let Some(sol) = solve_pnp(&obj, &img, &k) else {
            failed += 1;
            continue;
        };
        let (pitch, yaw, roll) = rotation_to_euler_deg_xyz(&sol.rotation);
        let dp = (pitch - f.cv2_euler_deg[0]).abs();
        let dy = (yaw - f.cv2_euler_deg[1]).abs();
        let dr = (roll - f.cv2_euler_deg[2]).abs();
        max_pitch = max_pitch.max(dp);
        max_yaw = max_yaw.max(dy);
        max_roll = max_roll.max(dr);
        if dp > 2.0 || dy > 2.0 || dr > 2.0 {
            over_2deg += 1;
        }
    }
    let over_pct = 100.0 * over_2deg as f64 / total as f64;
    eprintln!(
        "{name}: max Δpitch={max_pitch:.3}° Δyaw={max_yaw:.3}° Δroll={max_roll:.3}° | over 2°: {over_2deg}/{total} ({over_pct:.1}%) | failed solve: {failed}"
    );
    assert!(failed == 0, "{name}: {failed} solves failed");
    assert!(max_pitch < 5.0, "{name}: max Δpitch {max_pitch:.3}° > 5°");
    assert!(max_yaw < 5.0, "{name}: max Δyaw {max_yaw:.3}° > 5°");
    assert!(max_roll < 5.0, "{name}: max Δroll {max_roll:.3}° > 5°");
    assert!(over_pct < 1.0, "{name}: {over_pct:.1}% over 2°, expected <1%");
}

#[test]
fn epnp_parity_5pt_yunet() {
    let all = load_fixtures();
    let v: Vec<_> = all.iter().filter(|f| f.kind == "yunet_5pt").collect();
    assess("yunet_5pt", &v);
}

#[test]
fn epnp_parity_12pt_mesh() {
    let all = load_fixtures();
    let v: Vec<_> = all.iter().filter(|f| f.kind == "mesh_12pt").collect();
    assess("mesh_12pt", &v);
}
