//! Liveness challenge nonce extraction from stamped iOS video frames.
//!
//! Direct port of `extract_nonce_from_frame` and `verify_challenge_nonce`
//! at `service.py:254-319`. Layout constants are pinned to match the
//! Swift-side encoder at `apps/ios/Kayle ID/Services/LivenessNonceStamp.swift`.

use crate::config::{
    NONCE_BYTES, NONCE_COLS, NONCE_EXPECTED_HEIGHT, NONCE_EXPECTED_WIDTH, NONCE_GUTTER,
    NONCE_PATCH_X, NONCE_PATCH_Y, NONCE_SQUARE_SIZE, NONCE_THRESHOLD,
};
use crate::image_io::BgrImage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NonceVerification {
    /// Strict majority of decoded frames matched the expected nonce.
    pub matched: bool,
    pub frames_total: usize,
    pub frames_decoded: usize,
    pub frames_matched: usize,
}

/// Decode the 4-byte challenge nonce stamped into a 720×1280 BGR frame.
/// Returns `None` for any frame with mismatched dimensions (legacy clip
/// with no stamp area or a rescaled frame) — the caller treats `None` as
/// "no signal from this frame".
pub fn extract_nonce_from_frame(frame: &BgrImage) -> Option<[u8; NONCE_BYTES]> {
    if frame.width != NONCE_EXPECTED_WIDTH || frame.height != NONCE_EXPECTED_HEIGHT {
        return None;
    }
    let mut bits = [0_u8; NONCE_BYTES];
    let pitch = NONCE_SQUARE_SIZE + NONCE_GUTTER;
    let row_bytes = frame.width * 3;

    for bit_index in 0..(NONCE_BYTES * 8) {
        let col = bit_index % NONCE_COLS;
        let row = bit_index / NONCE_COLS;
        let x0 = NONCE_PATCH_X + col * pitch;
        let y0 = NONCE_PATCH_Y + row * pitch;
        let cx = x0 + NONCE_SQUARE_SIZE / 2;
        let cy = y0 + NONCE_SQUARE_SIZE / 2;

        // 4×4 sample window centered on (cx, cy). Python uses
        // `frame[cy-2:cy+2, cx-2:cx+2]` which is 4×4.
        if cx < 2 || cy < 2 || cx + 2 > frame.width || cy + 2 > frame.height {
            return None;
        }
        let mut sum = 0_u32;
        let mut count = 0_u32;
        for sy in (cy - 2)..(cy + 2) {
            for sx in (cx - 2)..(cx + 2) {
                let off = sy * row_bytes + sx * 3;
                let b = frame.pixels[off] as u32;
                let g = frame.pixels[off + 1] as u32;
                let r = frame.pixels[off + 2] as u32;
                // `sample.mean()` over a 4×4×3 numpy slice averages
                // across both spatial and channel axes — match that.
                sum += b + g + r;
                count += 3;
            }
        }
        let mean = sum as f64 / count as f64;
        if mean > NONCE_THRESHOLD as f64 {
            let byte_index = bit_index / 8;
            let bit_in_byte = 7 - (bit_index % 8);
            bits[byte_index] |= 1 << bit_in_byte;
        }
    }
    Some(bits)
}

/// Majority-vote the embedded nonce across `frames` against `expected`.
/// Mirrors `verify_challenge_nonce` at `service.py:294-319`.
pub fn verify_challenge_nonce(frames: &[BgrImage], expected: &[u8]) -> NonceVerification {
    let mut decoded = 0_usize;
    let mut matched = 0_usize;
    for frame in frames {
        let Some(candidate) = extract_nonce_from_frame(frame) else {
            continue;
        };
        decoded += 1;
        if candidate.as_slice() == expected {
            matched += 1;
        }
    }
    let total = frames.len();
    NonceVerification {
        matched: matched > total / 2,
        frames_total: total,
        frames_decoded: decoded,
        frames_matched: matched,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_frame(value: u8) -> BgrImage {
        BgrImage {
            width: NONCE_EXPECTED_WIDTH,
            height: NONCE_EXPECTED_HEIGHT,
            pixels: vec![value; NONCE_EXPECTED_WIDTH * NONCE_EXPECTED_HEIGHT * 3],
        }
    }

    /// Stamp a 32-bit value into a frame using the iOS encoder layout.
    /// Bit `i` (MSB-first across 4 bytes) → square at (col=i%8, row=i/8).
    /// Bright square ⇒ bit 1, dark square ⇒ bit 0.
    fn stamp(frame: &mut BgrImage, bytes: &[u8; NONCE_BYTES]) {
        let pitch = NONCE_SQUARE_SIZE + NONCE_GUTTER;
        let row_bytes = frame.width * 3;
        for bit_index in 0..(NONCE_BYTES * 8) {
            let byte_index = bit_index / 8;
            let bit_in_byte = 7 - (bit_index % 8);
            let bit = (bytes[byte_index] >> bit_in_byte) & 1;
            let col = bit_index % NONCE_COLS;
            let row = bit_index / NONCE_COLS;
            let x0 = NONCE_PATCH_X + col * pitch;
            let y0 = NONCE_PATCH_Y + row * pitch;
            let color = if bit == 1 { 255 } else { 0 };
            for sy in y0..(y0 + NONCE_SQUARE_SIZE) {
                for sx in x0..(x0 + NONCE_SQUARE_SIZE) {
                    let off = sy * row_bytes + sx * 3;
                    frame.pixels[off] = color;
                    frame.pixels[off + 1] = color;
                    frame.pixels[off + 2] = color;
                }
            }
        }
    }

    #[test]
    fn wrong_dimensions_returns_none() {
        let small = BgrImage {
            width: 100,
            height: 100,
            pixels: vec![0; 100 * 100 * 3],
        };
        assert!(extract_nonce_from_frame(&small).is_none());
    }

    #[test]
    fn all_dark_decodes_to_zero() {
        let frame = blank_frame(0);
        let nonce = extract_nonce_from_frame(&frame).expect("decoded");
        assert_eq!(nonce, [0, 0, 0, 0]);
    }

    #[test]
    fn all_bright_decodes_to_all_ones() {
        let frame = blank_frame(255);
        let nonce = extract_nonce_from_frame(&frame).expect("decoded");
        assert_eq!(nonce, [0xFF; NONCE_BYTES]);
    }

    #[test]
    fn round_trip_stamped_nonce() {
        let expected = [0xDE, 0xAD, 0xBE, 0xEF];
        let mut frame = blank_frame(0);
        stamp(&mut frame, &expected);
        let nonce = extract_nonce_from_frame(&frame).expect("decoded");
        assert_eq!(nonce, expected);
    }

    /// Port of `service_nonce_test.py::ExtractNonceTests::test_round_trip_alternating`.
    #[test]
    fn round_trip_alternating_pattern() {
        let expected = [0xAA, 0x55, 0xAA, 0x55];
        let mut frame = blank_frame(0);
        stamp(&mut frame, &expected);
        let nonce = extract_nonce_from_frame(&frame).expect("decoded");
        assert_eq!(nonce, expected);
    }

    /// Port of `service_nonce_test.py::ExtractNonceTests::test_mismatch_between_stamped_and_expected`.
    #[test]
    fn one_bit_off_is_distinguished() {
        let stamped = [0x12, 0x34, 0x56, 0x78];
        let other = [0x12, 0x34, 0x56, 0x79];
        let mut frame = blank_frame(0);
        stamp(&mut frame, &stamped);
        let nonce = extract_nonce_from_frame(&frame).expect("decoded");
        assert_eq!(nonce, stamped);
        assert_ne!(nonce, other);
    }

    #[test]
    fn verify_majority_passes() {
        let expected = [0x12, 0x34, 0x56, 0x78];
        let mut good = blank_frame(0);
        stamp(&mut good, &expected);
        let mut wrong = blank_frame(0);
        stamp(&mut wrong, &[0, 0, 0, 0]);
        let frames = vec![good.clone(), good.clone(), good, wrong];
        let r = verify_challenge_nonce(&frames, &expected);
        assert!(r.matched);
        assert_eq!(r.frames_total, 4);
        assert_eq!(r.frames_decoded, 4);
        assert_eq!(r.frames_matched, 3);
    }

    #[test]
    fn verify_minority_fails() {
        let expected = [0x12, 0x34, 0x56, 0x78];
        let mut good = blank_frame(0);
        stamp(&mut good, &expected);
        let mut wrong = blank_frame(0);
        stamp(&mut wrong, &[0, 0, 0, 0]);
        let frames = vec![good, wrong.clone(), wrong.clone(), wrong];
        let r = verify_challenge_nonce(&frames, &expected);
        assert!(!r.matched);
        assert_eq!(r.frames_matched, 1);
    }
}
