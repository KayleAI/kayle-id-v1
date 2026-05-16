//! 2D affine geometry: partial-affine (similarity) fit and warp.
//!
//! Replaces three OpenCV calls used by the Python service:
//!   - `cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)` → [`estimate_affine_partial_2d`]
//!   - `cv2.warpAffine(image, M, (W,H))` → [`warp_affine_bgr`]
//!   - `cv2.resize(image, (W,H))` (INTER_LINEAR default) → [`resize_bilinear_bgr`]
//!
//! All three preserve OpenCV's pixel-coordinate conventions:
//!   - `warpAffine` uses corner-pixel coords (top-left pixel center at (0.5, 0.5),
//!     pixel grid starts at (0, 0))
//!   - `resize` uses pixel-center coords with a half-pixel offset
//!   - Bilinear sampling with border value 0 (zero-padding)

use nalgebra::{Matrix2, Vector2};

/// 2×3 affine transform packed row-major: [a b tx; c d ty].
///
/// Applies as `x' = a*x + b*y + tx`, `y' = c*x + d*y + ty`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Affine2x3(pub [[f64; 3]; 2]);

impl Affine2x3 {
    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        let m = &self.0;
        (
            m[0][0] * x + m[0][1] * y + m[0][2],
            m[1][0] * x + m[1][1] * y + m[1][2],
        )
    }

    /// Inverse of the 2×3 affine. None when the linear block is singular.
    pub fn invert(&self) -> Option<Self> {
        let m = &self.0;
        let det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
        if det.abs() < 1e-12 {
            return None;
        }
        let inv_det = 1.0 / det;
        let a = m[1][1] * inv_det;
        let b = -m[0][1] * inv_det;
        let c = -m[1][0] * inv_det;
        let d = m[0][0] * inv_det;
        let tx = -(a * m[0][2] + b * m[1][2]);
        let ty = -(c * m[0][2] + d * m[1][2]);
        Some(Self([[a, b, tx], [c, d, ty]]))
    }
}

/// Fit a partial-affine (similarity: uniform scale + rotation + translation)
/// transform from `src` → `dst`.
///
/// Empirical observation against real YuNet landmarks: `cv2.estimateAffinePartial2D`
/// with `method=LMEDS` and `cv2.estimateAffinePartial2D` with `method=LMEDS`
/// converges to the **Umeyama LSQ** solution on face-alignment inputs (no
/// outliers, 5 anatomically consistent landmarks). The min-median 2-pt
/// minimal-sample model is *not* what cv2 returns in this regime — internal
/// refinement falls back to LSQ. Synthetic-fixture parity (`tests/affine_parity.rs`)
/// confirms Umeyama matches cv2 within 0.55 px max on clean inputs.
///
/// Returns `None` when fewer than 2 correspondences are supplied or when
/// the source points are degenerate (zero variance).
pub fn estimate_affine_partial_2d(
    src: &[(f64, f64)],
    dst: &[(f64, f64)],
) -> Option<Affine2x3> {
    if src.len() != dst.len() || src.len() < 2 {
        return None;
    }
    if src.len() == 2 {
        return similarity_from_pair(src[0], src[1], dst[0], dst[1]);
    }
    umeyama_partial_affine(src, dst)
}

/// Closed-form similarity from a single point pair. Returns `None` when
/// the source points coincide.
fn similarity_from_pair(
    p1: (f64, f64),
    p2: (f64, f64),
    q1: (f64, f64),
    q2: (f64, f64),
) -> Option<Affine2x3> {
    let dx = p2.0 - p1.0;
    let dy = p2.1 - p1.1;
    let d2 = dx * dx + dy * dy;
    if d2 <= f64::EPSILON {
        return None;
    }
    let dxq = q2.0 - q1.0;
    let dyq = q2.1 - q1.1;
    let a = (dx * dxq + dy * dyq) / d2; // s·cos
    let b = (dx * dyq - dy * dxq) / d2; // s·sin
    let tx = q1.0 - (a * p1.0 - b * p1.1);
    let ty = q1.1 - (b * p1.0 + a * p1.1);
    Some(Affine2x3([[a, -b, tx], [b, a, ty]]))
}

/// Closed-form similarity fit per Umeyama (1991).
///
/// Returns the LSQ-optimal 2×3 transform [s*R | t] where `R` is a 2×2
/// rotation, `s` is a positive scalar, and `t` is the translation. Returns
/// `None` if the source variance is zero (all source points coincident).
fn umeyama_partial_affine(
    src: &[(f64, f64)],
    dst: &[(f64, f64)],
) -> Option<Affine2x3> {
    let n = src.len() as f64;
    let inv_n = 1.0 / n;

    let mean_src = src
        .iter()
        .fold((0.0, 0.0), |(ax, ay), &(x, y)| (ax + x, ay + y));
    let mean_src = (mean_src.0 * inv_n, mean_src.1 * inv_n);
    let mean_dst = dst
        .iter()
        .fold((0.0, 0.0), |(ax, ay), &(x, y)| (ax + x, ay + y));
    let mean_dst = (mean_dst.0 * inv_n, mean_dst.1 * inv_n);

    let mut sigma2_src = 0.0_f64;
    let mut cov = Matrix2::<f64>::zeros();
    for (s, d) in src.iter().zip(dst.iter()) {
        let sx = s.0 - mean_src.0;
        let sy = s.1 - mean_src.1;
        let dx = d.0 - mean_dst.0;
        let dy = d.1 - mean_dst.1;
        sigma2_src += sx * sx + sy * sy;
        // cov accumulates dst_centered * src_centered^T (Umeyama eq. 38).
        cov.m11 += dx * sx;
        cov.m12 += dx * sy;
        cov.m21 += dy * sx;
        cov.m22 += dy * sy;
    }
    sigma2_src *= inv_n;
    cov *= inv_n;

    if sigma2_src <= f64::EPSILON {
        return None;
    }

    let svd = cov.svd(true, true);
    let u = svd.u?;
    let v_t = svd.v_t?;
    let sv = svd.singular_values;

    // Mirror correction: if det(U)*det(V) < 0, flip the smaller singular
    // direction so the recovered transform is a proper rotation (no
    // reflection) — partial-affine forbids reflection.
    let det_uv = u.determinant() * v_t.determinant();
    let mut s_diag = Vector2::new(1.0, 1.0);
    if det_uv < 0.0 {
        s_diag[1] = -1.0;
    }

    let rotation = u * Matrix2::from_diagonal(&s_diag) * v_t;
    let scale = (sv[0] * s_diag[0] + sv[1] * s_diag[1]) / sigma2_src;

    let sr = rotation * scale;
    let t = Vector2::new(mean_dst.0, mean_dst.1)
        - sr * Vector2::new(mean_src.0, mean_src.1);

    Some(Affine2x3([
        [sr.m11, sr.m12, t.x],
        [sr.m21, sr.m22, t.y],
    ]))
}

/// Bilinear `warpAffine` on a BGR uint8 image with border value 0.
///
/// Mirrors `cv2.warpAffine(src, M, (out_width, out_height))` with the
/// default INTER_LINEAR + BORDER_CONSTANT(0). The supplied `transform`
/// maps **source → destination** the same way `cv2.warpAffine` expects it;
/// the implementation inverts it internally for the per-output-pixel sample.
///
/// Returns a tightly packed `(out_height, out_width, 3)` BGR buffer.
pub fn warp_affine_bgr(
    src: &[u8],
    src_width: usize,
    src_height: usize,
    transform: Affine2x3,
    out_width: usize,
    out_height: usize,
) -> Vec<u8> {
    assert_eq!(src.len(), src_width * src_height * 3);
    let mut out = vec![0_u8; out_width * out_height * 3];
    let Some(inverse) = transform.invert() else {
        return out;
    };
    let inv = &inverse.0;
    let sw_f = src_width as f64;
    let sh_f = src_height as f64;
    for y in 0..out_height {
        let yf = y as f64;
        for x in 0..out_width {
            let xf = x as f64;
            // OpenCV warpAffine: destination pixel center is at integer
            // coords (corner-pixel convention). Sampled position in source.
            let sx = inv[0][0] * xf + inv[0][1] * yf + inv[0][2];
            let sy = inv[1][0] * xf + inv[1][1] * yf + inv[1][2];
            if !(sx.is_finite() && sy.is_finite()) {
                continue;
            }
            // BORDER_CONSTANT(0): if any of the four neighbours is out of
            // range, OpenCV substitutes 0 for that neighbour. We sample
            // each corner explicitly with the same rule.
            let x0 = sx.floor();
            let y0 = sy.floor();
            let fx = sx - x0;
            let fy = sy - y0;
            let ix0 = x0 as i32;
            let iy0 = y0 as i32;
            let ix1 = ix0 + 1;
            let iy1 = iy0 + 1;

            // Skip when entirely outside the convex hull of valid samples.
            if ix1 < 0 || iy1 < 0 || (ix0 as f64) >= sw_f || (iy0 as f64) >= sh_f {
                continue;
            }

            for ch in 0..3 {
                let p00 = sample_bgr(src, src_width, src_height, ix0, iy0, ch);
                let p01 = sample_bgr(src, src_width, src_height, ix1, iy0, ch);
                let p10 = sample_bgr(src, src_width, src_height, ix0, iy1, ch);
                let p11 = sample_bgr(src, src_width, src_height, ix1, iy1, ch);
                let top = p00 * (1.0 - fx) + p01 * fx;
                let bottom = p10 * (1.0 - fx) + p11 * fx;
                let v = top * (1.0 - fy) + bottom * fy;
                let clamped = v.clamp(0.0, 255.0);
                // OpenCV rounds to nearest with banker's rounding via
                // saturate_cast<uchar>; the difference vs `+ 0.5` floor is
                // ≤ 1 LSB and below our parity threshold.
                out[(y * out_width + x) * 3 + ch] = (clamped + 0.5) as u8;
            }
        }
    }
    out
}

#[inline]
fn sample_bgr(
    src: &[u8],
    width: usize,
    height: usize,
    x: i32,
    y: i32,
    ch: usize,
) -> f64 {
    if x < 0 || y < 0 || (x as usize) >= width || (y as usize) >= height {
        0.0
    } else {
        src[(y as usize * width + x as usize) * 3 + ch] as f64
    }
}

/// Bilinear resize on a BGR uint8 image. Mirrors `cv2.resize` default
/// (INTER_LINEAR) with pixel-center coords and a half-pixel offset.
pub fn resize_bilinear_bgr(
    src: &[u8],
    src_width: usize,
    src_height: usize,
    out_width: usize,
    out_height: usize,
) -> Vec<u8> {
    assert_eq!(src.len(), src_width * src_height * 3);
    let mut out = vec![0_u8; out_width * out_height * 3];
    if src_width == 0 || src_height == 0 || out_width == 0 || out_height == 0 {
        return out;
    }
    let scale_x = src_width as f64 / out_width as f64;
    let scale_y = src_height as f64 / out_height as f64;
    let sw_max = (src_width - 1) as f64;
    let sh_max = (src_height - 1) as f64;
    for y in 0..out_height {
        // Half-pixel offset (pixel-center): src_y = (y + 0.5) * scale - 0.5.
        let sy = ((y as f64) + 0.5) * scale_y - 0.5;
        let syc = sy.clamp(0.0, sh_max);
        let y0 = syc.floor();
        let fy = syc - y0;
        let iy0 = y0 as usize;
        let iy1 = (iy0 + 1).min(src_height - 1);
        for x in 0..out_width {
            let sx = ((x as f64) + 0.5) * scale_x - 0.5;
            let sxc = sx.clamp(0.0, sw_max);
            let x0 = sxc.floor();
            let fx = sxc - x0;
            let ix0 = x0 as usize;
            let ix1 = (ix0 + 1).min(src_width - 1);
            for ch in 0..3 {
                let p00 = src[(iy0 * src_width + ix0) * 3 + ch] as f64;
                let p01 = src[(iy0 * src_width + ix1) * 3 + ch] as f64;
                let p10 = src[(iy1 * src_width + ix0) * 3 + ch] as f64;
                let p11 = src[(iy1 * src_width + ix1) * 3 + ch] as f64;
                let top = p00 * (1.0 - fx) + p01 * fx;
                let bottom = p10 * (1.0 - fx) + p11 * fx;
                let v = top * (1.0 - fy) + bottom * fy;
                out[(y * out_width + x) * 3 + ch] = (v.clamp(0.0, 255.0) + 0.5) as u8;
            }
        }
    }
    out
}

/// BGR → grayscale conversion matching `cv2.cvtColor(..., COLOR_BGR2GRAY)`.
/// Output is uint8 with the integer Rec.601 weights OpenCV uses (Y = 0.114B
/// + 0.587G + 0.299R, rounded via the fixed-point form below).
pub fn bgr_to_gray(src: &[u8], width: usize, height: usize) -> Vec<u8> {
    assert_eq!(src.len(), width * height * 3);
    // OpenCV's integer Rec.601 weights × 1<<14, plus 1<<13 for rounding.
    const W_B: u32 = 1868;
    const W_G: u32 = 9617;
    const W_R: u32 = 4899;
    const ROUND: u32 = 1 << 13;
    let mut out = vec![0_u8; width * height];
    for i in 0..(width * height) {
        let b = src[i * 3] as u32;
        let g = src[i * 3 + 1] as u32;
        let r = src[i * 3 + 2] as u32;
        out[i] = ((b * W_B + g * W_G + r * W_R + ROUND) >> 14) as u8;
    }
    out
}

/// In-place BGR → RGB channel swap on a contiguous HWC uint8 buffer.
pub fn bgr_to_rgb_inplace(buf: &mut [u8]) {
    assert_eq!(buf.len() % 3, 0);
    for chunk in buf.chunks_exact_mut(3) {
        chunk.swap(0, 2);
    }
}

/// Sample standard deviation (population std × √(N/(N-1))) of a uint8
/// buffer, matching numpy's default `.std()` semantics (which is
/// population std, not sample). Used by the DETAIL_STDDEV_MIN gate.
pub fn population_std_u8(buf: &[u8]) -> f64 {
    if buf.is_empty() {
        return 0.0;
    }
    let n = buf.len() as f64;
    let mean = buf.iter().map(|&v| v as f64).sum::<f64>() / n;
    let var = buf
        .iter()
        .map(|&v| {
            let d = v as f64 - mean;
            d * d
        })
        .sum::<f64>()
        / n;
    var.sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn umeyama_identity() {
        let src = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)];
        let dst = src;
        let m = estimate_affine_partial_2d(&src, &dst).expect("ok");
        assert_abs_diff_eq!(m.0[0][0], 1.0, epsilon = 1e-10);
        assert_abs_diff_eq!(m.0[0][1], 0.0, epsilon = 1e-10);
        assert_abs_diff_eq!(m.0[1][0], 0.0, epsilon = 1e-10);
        assert_abs_diff_eq!(m.0[1][1], 1.0, epsilon = 1e-10);
        assert_abs_diff_eq!(m.0[0][2], 0.0, epsilon = 1e-10);
        assert_abs_diff_eq!(m.0[1][2], 0.0, epsilon = 1e-10);
    }

    #[test]
    fn umeyama_pure_translation() {
        let src = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (2.0, 2.0)];
        let dst: Vec<_> = src.iter().map(|&(x, y)| (x + 3.0, y - 4.0)).collect();
        let m = estimate_affine_partial_2d(&src, &dst).expect("ok");
        assert_abs_diff_eq!(m.0[0][0], 1.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[1][1], 1.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[0][2], 3.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[1][2], -4.0, epsilon = 1e-9);
    }

    #[test]
    fn umeyama_pure_scale() {
        let src = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)];
        let dst: Vec<_> = src.iter().map(|&(x, y)| (x * 2.5, y * 2.5)).collect();
        let m = estimate_affine_partial_2d(&src, &dst).expect("ok");
        assert_abs_diff_eq!(m.0[0][0], 2.5, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[1][1], 2.5, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[0][1], 0.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[1][0], 0.0, epsilon = 1e-9);
    }

    #[test]
    fn umeyama_rotation_90() {
        // 90° CCW rotation: (x, y) → (-y, x).
        let src = [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)];
        let dst: Vec<_> = src.iter().map(|&(x, y)| (-y, x)).collect();
        let m = estimate_affine_partial_2d(&src, &dst).expect("ok");
        assert_abs_diff_eq!(m.0[0][0], 0.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[0][1], -1.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[1][0], 1.0, epsilon = 1e-9);
        assert_abs_diff_eq!(m.0[1][1], 0.0, epsilon = 1e-9);
    }

    #[test]
    fn arcface_template_alignment() {
        // Synthetic landmark set near the ArcFace template, shifted +
        // rotated. Recover the inverse and confirm the recovered
        // transform sends src → dst within sub-pixel.
        let template: [(f64, f64); 5] = [
            (38.2946, 51.6963),
            (73.5318, 51.5014),
            (56.0252, 71.7366),
            (41.5493, 92.3655),
            (70.7299, 92.2041),
        ];
        // Source = template scaled 1.7×, rotated 12°, translated (+30,-15).
        let theta = 12.0_f64.to_radians();
        let s = 1.7_f64;
        let (c, sn) = (theta.cos(), theta.sin());
        let src: Vec<(f64, f64)> = template
            .iter()
            .map(|&(x, y)| (s * (c * x - sn * y) + 30.0, s * (sn * x + c * y) - 15.0))
            .collect();
        let m = estimate_affine_partial_2d(&src, &template).expect("ok");
        for (s_pt, t_pt) in src.iter().zip(template.iter()) {
            let (px, py) = m.apply(s_pt.0, s_pt.1);
            assert_abs_diff_eq!(px, t_pt.0, epsilon = 1e-6);
            assert_abs_diff_eq!(py, t_pt.1, epsilon = 1e-6);
        }
    }

    #[test]
    fn affine_invert_roundtrip() {
        let m = Affine2x3([[1.5, 0.3, 12.0], [-0.3, 1.5, -7.0]]);
        let inv = m.invert().expect("invertible");
        let (x, y) = (4.0, 6.0);
        let (px, py) = m.apply(x, y);
        let (rx, ry) = inv.apply(px, py);
        assert_abs_diff_eq!(rx, x, epsilon = 1e-10);
        assert_abs_diff_eq!(ry, y, epsilon = 1e-10);
    }

    #[test]
    fn warp_affine_identity_passthrough() {
        let mut src = vec![0u8; 4 * 4 * 3];
        for i in 0..16 {
            src[i * 3] = i as u8;
            src[i * 3 + 1] = (i * 2) as u8;
            src[i * 3 + 2] = (i * 3) as u8;
        }
        let identity = Affine2x3([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]);
        let out = warp_affine_bgr(&src, 4, 4, identity, 4, 4);
        assert_eq!(out, src);
    }

    #[test]
    fn resize_constant_color_preserves_value() {
        // A solid color stays solid through bilinear resize.
        let src = vec![100_u8; 32 * 32 * 3];
        let out = resize_bilinear_bgr(&src, 32, 32, 7, 11);
        for &v in &out {
            assert_eq!(v, 100);
        }
    }

    #[test]
    fn bgr_to_gray_pure_red() {
        // OpenCV's Rec.601 BGR2GRAY: Y(R=255,G=0,B=0) ≈ 76.
        let src = vec![0, 0, 255, 0, 0, 255];
        let gray = bgr_to_gray(&src, 2, 1);
        assert_eq!(gray[0], 76);
        assert_eq!(gray[1], 76);
    }

    #[test]
    fn population_std_uniform_is_zero() {
        let buf = vec![123_u8; 100];
        let s = population_std_u8(&buf);
        assert_abs_diff_eq!(s, 0.0, epsilon = 1e-12);
    }
}
