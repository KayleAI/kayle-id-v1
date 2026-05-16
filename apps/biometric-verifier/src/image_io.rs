//! JPEG decode to BGR HWC uint8.
//!
//! Mirrors `cv2.imdecode(buffer, cv2.IMREAD_COLOR)` at `service.py:342`:
//! returns a tightly packed `(H, W, 3)` BGR buffer. `zune-jpeg` decodes
//! to RGB; we swap channels to BGR to match the OpenCV-native convention
//! every downstream consumer expects.

use thiserror::Error;
use zune_core::colorspace::ColorSpace;
use zune_core::options::DecoderOptions;
use zune_jpeg::JpegDecoder;

#[derive(Debug, Error)]
pub enum DecodeError {
    #[error("jpeg decode failed: {0}")]
    Jpeg(String),
    #[error("unexpected output: {0}")]
    Format(&'static str),
}

#[derive(Debug, Clone)]
pub struct BgrImage {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl BgrImage {
    pub fn from_jpeg(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut decoder = JpegDecoder::new_with_options(
            bytes,
            DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGB),
        );
        let pixels_rgb = decoder
            .decode()
            .map_err(|e| DecodeError::Jpeg(e.to_string()))?;
        let info = decoder
            .info()
            .ok_or(DecodeError::Format("jpeg info missing"))?;
        let width = info.width as usize;
        let height = info.height as usize;
        if pixels_rgb.len() != width * height * 3 {
            return Err(DecodeError::Format("rgb buffer length mismatch"));
        }
        let mut pixels = pixels_rgb;
        // RGB → BGR in place.
        for chunk in pixels.chunks_exact_mut(3) {
            chunk.swap(0, 2);
        }
        Ok(BgrImage {
            width,
            height,
            pixels,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_fixture_jpeg() {
        let image = BgrImage::from_jpeg(include_bytes!("../../api/tests/fixtures/verify/icon.jpg"))
            .expect("fixture decodes");
        assert!(image.width > 0);
        assert!(image.height > 0);
        assert_eq!(image.pixels.len(), image.width * image.height * 3);
    }
}
