//! Smoke-test the libav video decode path against a synthetic clip.

use biometric_verifier::video::extract_frames;
use std::path::Path;

fn main() -> anyhow::Result<()> {
    let path = Path::new("/tmp/test_clip.mp4");
    let r = extract_frames(path, 5)?;
    println!(
        "extracted {} frames, duration={:?}s",
        r.frames.len(),
        r.duration_seconds
    );
    for (i, f) in r.frames.iter().enumerate() {
        let mean = f.pixels.iter().map(|&v| v as u32).sum::<u32>() as f64 / f.pixels.len() as f64;
        println!("  frame[{i}] {}x{} mean={mean:.1}", f.width, f.height);
    }
    Ok(())
}
