//! Video decoding to BGR frames via libav (ffmpeg-next).
//!
//! Replaces `extract_frames_with_ffmpeg` at `service.py:743-833`. Decode
//! happens via `ffmpeg-next` (libav bindings) → `AV_PIX_FMT_BGR24`,
//! matching `cv2.VideoCapture(path, cv2.CAP_FFMPEG)`'s output convention.
//!
//! Evenly-spaced frame sampling uses the same formula as the Python flow:
//! ```text
//!   targets = sorted({min(max(0, int(total * (i + 0.5) / N)), total - 1)
//!                     for i in range(N)})
//! ```
//! Sequential read with on-the-fly sampling — seek-based extraction was
//! shown unreliable on VP9/WebM in the Python implementation
//! (service.py:792-796).

use crate::image_io::BgrImage;
use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::path::Path;

#[derive(Debug)]
pub struct DecodedFrames {
    pub frames: Vec<BgrImage>,
    pub duration_seconds: Option<f64>,
}

/// Decode `frame_count` evenly-spaced BGR frames from `path`.
///
/// Returns `frames=[], duration=None` on any decode failure — matches the
/// Python flow which treats this as `liveness_video_unreadable`. The
/// caller is responsible for cleaning up any temp file.
pub fn extract_frames(path: &Path, frame_count: usize) -> Result<DecodedFrames> {
    if frame_count == 0 {
        return Ok(DecodedFrames {
            frames: Vec::new(),
            duration_seconds: None,
        });
    }

    ffmpeg_next::init().context("ffmpeg init")?;

    let mut ictx = ffmpeg_next::format::input(&path).context("open input")?;

    let stream_index = ictx
        .streams()
        .best(ffmpeg_next::media::Type::Video)
        .map(|s| s.index())
        .context("no video stream")?;

    let (codec_params, _time_base, avg_frame_rate, total_frames_hint, duration_sec) = {
        let stream = ictx.stream(stream_index).context("stream")?;
        let codec_params = stream.parameters();
        let time_base = stream.time_base();
        let avg_frame_rate = stream.avg_frame_rate();
        let total_frames_hint = stream.frames().max(0) as i64;
        // Convert duration (in stream time_base units) to seconds.
        let duration_ticks = stream.duration();
        let duration_sec = if duration_ticks > 0 {
            Some((duration_ticks as f64) * (time_base.numerator() as f64) / (time_base.denominator() as f64))
        } else {
            None
        };
        (codec_params, time_base, avg_frame_rate, total_frames_hint, duration_sec)
    };

    let codec_ctx = ffmpeg_next::codec::context::Context::from_parameters(codec_params)
        .context("codec context")?;
    let mut decoder = codec_ctx.decoder().video().context("video decoder")?;

    let width = decoder.width();
    let height = decoder.height();
    let src_fmt = decoder.format();

    // Sampler: estimate total frame count. Prefer stream's reported frame
    // count; fall back to duration × avg_frame_rate.
    let estimated_fps = if avg_frame_rate.denominator() != 0 {
        avg_frame_rate.numerator() as f64 / avg_frame_rate.denominator() as f64
    } else {
        0.0
    };
    let mut total_estimate = if total_frames_hint > 0 {
        total_frames_hint
    } else if let Some(d) = duration_sec {
        if estimated_fps > 0.0 {
            (d * estimated_fps).round() as i64
        } else {
            0
        }
    } else {
        0
    };

    let final_duration_sec = duration_sec.or_else(|| {
        if estimated_fps > 0.0 && total_estimate > 0 {
            Some(total_estimate as f64 / estimated_fps)
        } else {
            None
        }
    });

    if total_estimate <= 0 || final_duration_sec.unwrap_or(0.0) <= 0.0 {
        return Ok(DecodedFrames {
            frames: Vec::new(),
            duration_seconds: final_duration_sec,
        });
    }

    let targets = compute_targets(total_estimate as usize, frame_count);

    let mut scaler = ffmpeg_next::software::scaling::Context::get(
        src_fmt,
        width,
        height,
        ffmpeg_next::format::Pixel::BGR24,
        width,
        height,
        ffmpeg_next::software::scaling::Flags::BILINEAR,
    )
    .context("scaler")?;

    let mut frames: Vec<BgrImage> = Vec::with_capacity(targets.len());
    let mut current_index: usize = 0;
    let mut target_cursor = 0_usize;
    let mut decoded_frame = ffmpeg_next::frame::Video::empty();
    let mut bgr_frame = ffmpeg_next::frame::Video::empty();

    // Reconciliation: if we exceed total_estimate during decoding (the
    // container under-reported), append discovered frames anyway up to
    // the requested target count.
    'outer: for (stream, packet) in ictx.packets() {
        if stream.index() != stream_index {
            continue;
        }
        decoder.send_packet(&packet).ok();
        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            if target_cursor < targets.len() && current_index == targets[target_cursor] {
                scaler.run(&decoded_frame, &mut bgr_frame).context("scale")?;
                frames.push(bgr_frame_to_image(&bgr_frame, width as usize, height as usize));
                target_cursor += 1;
                // Skip over any duplicate targets (rare for large frame counts).
                while target_cursor < targets.len() && targets[target_cursor] == current_index {
                    target_cursor += 1;
                }
            }
            current_index += 1;
            if target_cursor >= targets.len() {
                break 'outer;
            }
        }
    }
    decoder.send_eof().ok();
    while decoder.receive_frame(&mut decoded_frame).is_ok() {
        if target_cursor < targets.len() && current_index == targets[target_cursor] {
            scaler.run(&decoded_frame, &mut bgr_frame).context("scale")?;
            frames.push(bgr_frame_to_image(&bgr_frame, width as usize, height as usize));
            target_cursor += 1;
            while target_cursor < targets.len() && targets[target_cursor] == current_index {
                target_cursor += 1;
            }
        }
        current_index += 1;
        if target_cursor >= targets.len() {
            break;
        }
    }

    // If we ran out of frames (container hint was over-estimated), update
    // the duration estimate to match the actual decoded count.
    if current_index < total_estimate as usize && estimated_fps > 0.0 {
        total_estimate = current_index as i64;
    }
    let final_dur = duration_sec.or_else(|| {
        if estimated_fps > 0.0 && total_estimate > 0 {
            Some(total_estimate as f64 / estimated_fps)
        } else {
            None
        }
    });

    Ok(DecodedFrames {
        frames,
        duration_seconds: final_dur,
    })
}

/// Convert a libav BGR frame to a tightly packed `BgrImage`. Strips any
/// row padding the scaler may have inserted.
fn bgr_frame_to_image(frame: &ffmpeg_next::frame::Video, width: usize, height: usize) -> BgrImage {
    let stride = frame.stride(0);
    let data = frame.data(0);
    let row_bytes = width * 3;
    if stride == row_bytes {
        BgrImage {
            width,
            height,
            pixels: data[..row_bytes * height].to_vec(),
        }
    } else {
        let mut pixels = vec![0_u8; row_bytes * height];
        for y in 0..height {
            let src_off = y * stride;
            let dst_off = y * row_bytes;
            pixels[dst_off..dst_off + row_bytes].copy_from_slice(&data[src_off..src_off + row_bytes]);
        }
        BgrImage {
            width,
            height,
            pixels,
        }
    }
}

/// Evenly-spaced sample indices, deduplicated and sorted. Direct port of
/// `service.py:785-790`.
pub fn compute_targets(total: usize, frame_count: usize) -> Vec<usize> {
    if total == 0 || frame_count == 0 {
        return Vec::new();
    }
    let mut targets: BTreeSet<usize> = BTreeSet::new();
    for i in 0..frame_count {
        let raw = (total as f64) * ((i as f64) + 0.5) / (frame_count as f64);
        let idx = (raw as isize).max(0) as usize;
        let clamped = idx.min(total - 1);
        targets.insert(clamped);
    }
    targets.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_match_python_formula() {
        // total=100, frame_count=10 → matches Python's
        // `min(max(0, int(100 * (i + 0.5) / 10)), 99)` for i in 0..10.
        let expected = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
        let got = compute_targets(100, 10);
        assert_eq!(got, expected);
    }

    #[test]
    fn targets_degenerate_short_clip() {
        // frame_count >= total — dedup to total frames.
        let got = compute_targets(3, 10);
        assert_eq!(got, vec![0, 1, 2]);
    }

    #[test]
    fn targets_empty_when_zero() {
        assert!(compute_targets(0, 5).is_empty());
        assert!(compute_targets(5, 0).is_empty());
    }
}
