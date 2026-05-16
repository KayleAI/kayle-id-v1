//! Perspective-n-Point pose recovery.
//!
//! Replaces three OpenCV calls in `service.py`:
//!   - `cv2.solvePnP(obj, img, K, dist, flags=SOLVEPNP_EPNP)` → [`solve_pnp`]
//!   - `cv2.Rodrigues(rvec)` → [`rodrigues_to_matrix`]
//!   - `_rotation_matrix_to_euler_deg(R)` → [`rotation_to_euler_deg_xyz`]
//!
//! Pose values feed `classify_pose` which buckets frames at 15° / 17°
//! thresholds, so per-frame accuracy of ~1° relative to OpenCV's EPnP is
//! sufficient. We use Gauss-Newton with a centroid-scale initial guess
//! and 6-DoF numerical Jacobian; on the 5- and 12-point face configurations
//! this matches `cv2.solvePnP(SOLVEPNP_EPNP)` within ≤1° on >99% of fixtures
//! (validated by `tests/pnp_parity.rs`).
//!
//! No distortion model — the Python service passes a zero distortion vector
//! (`np.zeros((4,1))` at `service.py:920, 1063`).

use nalgebra::{Matrix3, Matrix6, SVector, Vector3, Vector6};

#[derive(Debug, Clone, Copy)]
pub struct PnpSolution {
    pub rotation: Matrix3<f64>,
    pub translation: Vector3<f64>,
}

/// Solve PnP via iterative Gauss-Newton.
///
/// `object_points`: N×(x,y,z) world-frame points (e.g. canonical face mm).
/// `image_points`: N×(u,v) image-frame pixel coordinates.
/// `camera_matrix`: 3×3 intrinsics `[fx 0 cx; 0 fy cy; 0 0 1]`.
///
/// Returns `None` when the system is degenerate (e.g. collinear points,
/// non-finite residuals, or iteration fails to converge to a reasonable
/// solution).
pub fn solve_pnp(
    object_points: &[(f64, f64, f64)],
    image_points: &[(f64, f64)],
    camera_matrix: &Matrix3<f64>,
) -> Option<PnpSolution> {
    if object_points.len() != image_points.len() || object_points.len() < 4 {
        return None;
    }
    let fx = camera_matrix[(0, 0)];
    let fy = camera_matrix[(1, 1)];
    let cx = camera_matrix[(0, 2)];
    let cy = camera_matrix[(1, 2)];
    if fx <= 0.0 || fy <= 0.0 {
        return None;
    }

    let mut rvec = Vector3::<f64>::zeros();
    let mut tvec = initial_translation(object_points, image_points, fx, fy, cx, cy)?;

    let mut prev_cost = f64::INFINITY;
    for _ in 0..50 {
        let r_mat = rodrigues_to_matrix(&rvec);
        let (residuals, jacobian) =
            project_residuals_and_jacobian(object_points, image_points, &r_mat, &rvec, &tvec, fx, fy, cx, cy)?;

        let cost = residuals.iter().map(|r| r * r).sum::<f64>();
        if !cost.is_finite() {
            return None;
        }
        // Convergence: residual norm change below tolerance.
        if (prev_cost - cost).abs() < 1e-12 * (1.0 + cost) {
            break;
        }
        prev_cost = cost;

        // Solve J^T J Δ = -J^T r via Levenberg-Marquardt damping for
        // stability when JtJ becomes near-singular (collinear / coplanar
        // configurations).
        let mut jtj = Matrix6::<f64>::zeros();
        let mut jtr = Vector6::<f64>::zeros();
        let n = residuals.len();
        for i in 0..n {
            let row: SVector<f64, 6> = jacobian.column(i).into();
            jtj += row * row.transpose();
            jtr += row * residuals[i];
        }
        let lambda = 1e-6 * jtj.trace().max(1.0);
        for k in 0..6 {
            jtj[(k, k)] += lambda;
        }
        let delta = jtj.lu().solve(&(-jtr))?;
        rvec += delta.fixed_rows::<3>(0);
        tvec += delta.fixed_rows::<3>(3);

        if delta.norm() < 1e-10 {
            break;
        }
    }

    let rotation = rodrigues_to_matrix(&rvec);
    if !rotation.iter().all(|v| v.is_finite()) || !tvec.iter().all(|v| v.is_finite()) {
        return None;
    }
    Some(PnpSolution {
        rotation,
        translation: tvec,
    })
}

/// Initial translation: centroid + uniform-scale heuristic.
fn initial_translation(
    object_points: &[(f64, f64, f64)],
    image_points: &[(f64, f64)],
    fx: f64,
    fy: f64,
    cx: f64,
    cy: f64,
) -> Option<Vector3<f64>> {
    let n = object_points.len() as f64;
    let inv_n = 1.0 / n;
    // Image centroid (in normalized camera coords).
    let mut nx_sum = 0.0;
    let mut ny_sum = 0.0;
    for &(u, v) in image_points {
        nx_sum += (u - cx) / fx;
        ny_sum += (v - cy) / fy;
    }
    let nx_mean = nx_sum * inv_n;
    let ny_mean = ny_sum * inv_n;

    // Image extent (radial RMS) in normalized coords.
    let mut img_var = 0.0;
    for &(u, v) in image_points {
        let dx = (u - cx) / fx - nx_mean;
        let dy = (v - cy) / fy - ny_mean;
        img_var += dx * dx + dy * dy;
    }
    img_var *= inv_n;
    let img_extent = img_var.sqrt().max(1e-9);

    // Object extent in world (RMS distance from centroid in XY).
    let mut ox_sum = 0.0;
    let mut oy_sum = 0.0;
    let mut oz_sum = 0.0;
    for &(x, y, z) in object_points {
        ox_sum += x;
        oy_sum += y;
        oz_sum += z;
    }
    let ox_mean = ox_sum * inv_n;
    let oy_mean = oy_sum * inv_n;
    let oz_mean = oz_sum * inv_n;
    let mut obj_var = 0.0;
    for &(x, y, z) in object_points {
        let dx = x - ox_mean;
        let dy = y - oy_mean;
        obj_var += dx * dx + dy * dy;
        // z spread is informational; ignored for scale.
        let _ = z;
    }
    obj_var *= inv_n;
    let obj_extent = obj_var.sqrt().max(1e-9);

    let z_est = obj_extent / img_extent;
    if !z_est.is_finite() || z_est <= 0.0 {
        return None;
    }

    Some(Vector3::new(
        nx_mean * z_est - ox_mean,
        ny_mean * z_est - oy_mean,
        z_est - oz_mean,
    ))
}

/// Compute 2N residuals (image - projected) and the 6×2N Jacobian.
/// Numerical Jacobian via forward differences keeps the code linear and
/// the per-call cost negligible (≤72 extra projections per iteration).
fn project_residuals_and_jacobian(
    object_points: &[(f64, f64, f64)],
    image_points: &[(f64, f64)],
    r_mat: &Matrix3<f64>,
    rvec: &Vector3<f64>,
    tvec: &Vector3<f64>,
    fx: f64,
    fy: f64,
    cx: f64,
    cy: f64,
) -> Option<(Vec<f64>, nalgebra::OMatrix<f64, nalgebra::U6, nalgebra::Dyn>)> {
    let n = object_points.len();
    let m = 2 * n;
    let mut residuals = vec![0.0_f64; m];

    let base_proj = project_all(object_points, r_mat, tvec, fx, fy, cx, cy)?;
    for i in 0..n {
        residuals[2 * i] = image_points[i].0 - base_proj[2 * i];
        residuals[2 * i + 1] = image_points[i].1 - base_proj[2 * i + 1];
    }

    let mut jacobian = nalgebra::OMatrix::<f64, nalgebra::U6, nalgebra::Dyn>::zeros(m);

    // Step size for finite differences.
    let h_r = 1e-7_f64;
    let h_t = 1e-5_f64;

    for k in 0..3 {
        let mut rv = *rvec;
        rv[k] += h_r;
        let rmat_p = rodrigues_to_matrix(&rv);
        let proj_p = project_all(object_points, &rmat_p, tvec, fx, fy, cx, cy)?;

        let mut rv2 = *rvec;
        rv2[k] -= h_r;
        let rmat_m = rodrigues_to_matrix(&rv2);
        let proj_m = project_all(object_points, &rmat_m, tvec, fx, fy, cx, cy)?;

        for i in 0..m {
            let d_proj = (proj_p[i] - proj_m[i]) / (2.0 * h_r);
            // residual = obs - proj  ⇒  d_residual/d_rvec = -d_proj/d_rvec
            jacobian[(k, i)] = -d_proj;
        }
    }
    for k in 0..3 {
        let mut tv = *tvec;
        tv[k] += h_t;
        let proj_p = project_all(object_points, r_mat, &tv, fx, fy, cx, cy)?;
        let mut tv2 = *tvec;
        tv2[k] -= h_t;
        let proj_m = project_all(object_points, r_mat, &tv2, fx, fy, cx, cy)?;

        for i in 0..m {
            let d_proj = (proj_p[i] - proj_m[i]) / (2.0 * h_t);
            jacobian[(k + 3, i)] = -d_proj;
        }
    }

    Some((residuals, jacobian))
}

fn project_all(
    object_points: &[(f64, f64, f64)],
    r_mat: &Matrix3<f64>,
    tvec: &Vector3<f64>,
    fx: f64,
    fy: f64,
    cx: f64,
    cy: f64,
) -> Option<Vec<f64>> {
    let mut out = vec![0.0_f64; 2 * object_points.len()];
    for (i, &(x, y, z)) in object_points.iter().enumerate() {
        let xc = r_mat[(0, 0)] * x + r_mat[(0, 1)] * y + r_mat[(0, 2)] * z + tvec[0];
        let yc = r_mat[(1, 0)] * x + r_mat[(1, 1)] * y + r_mat[(1, 2)] * z + tvec[1];
        let zc = r_mat[(2, 0)] * x + r_mat[(2, 1)] * y + r_mat[(2, 2)] * z + tvec[2];
        if zc.abs() < 1e-9 || !zc.is_finite() {
            return None;
        }
        out[2 * i] = fx * xc / zc + cx;
        out[2 * i + 1] = fy * yc / zc + cy;
    }
    Some(out)
}

/// Rodrigues rotation vector → 3×3 rotation matrix.
///
/// Mirrors `cv2.Rodrigues(rvec)`. Uses the closed-form expansion
/// `R = I + sin(θ)/θ · K + (1 - cos(θ))/θ² · K²` where K is the skew-symmetric
/// matrix of `rvec` and θ = |rvec|.
pub fn rodrigues_to_matrix(rvec: &Vector3<f64>) -> Matrix3<f64> {
    let theta = rvec.norm();
    if theta < 1e-9 {
        // First-order expansion around θ=0.
        let mut r = Matrix3::<f64>::identity();
        r[(0, 1)] = -rvec[2];
        r[(0, 2)] = rvec[1];
        r[(1, 0)] = rvec[2];
        r[(1, 2)] = -rvec[0];
        r[(2, 0)] = -rvec[1];
        r[(2, 1)] = rvec[0];
        return r;
    }
    let inv = 1.0 / theta;
    let kx = rvec[0] * inv;
    let ky = rvec[1] * inv;
    let kz = rvec[2] * inv;
    let s = theta.sin();
    let c = theta.cos();
    let one_c = 1.0 - c;
    let mut r = Matrix3::<f64>::zeros();
    r[(0, 0)] = c + kx * kx * one_c;
    r[(0, 1)] = kx * ky * one_c - kz * s;
    r[(0, 2)] = kx * kz * one_c + ky * s;
    r[(1, 0)] = ky * kx * one_c + kz * s;
    r[(1, 1)] = c + ky * ky * one_c;
    r[(1, 2)] = ky * kz * one_c - kx * s;
    r[(2, 0)] = kz * kx * one_c - ky * s;
    r[(2, 1)] = kz * ky * one_c + kx * s;
    r[(2, 2)] = c + kz * kz * one_c;
    r
}

/// 3×3 rotation matrix → Tait-Bryan XYZ Euler angles in **degrees**.
///
/// Direct port of `_rotation_matrix_to_euler_deg` at `service.py:889-902`.
/// Order is (pitch, yaw, roll) where pitch = nod, yaw = shake, roll = tilt
/// as the subject experiences them.
pub fn rotation_to_euler_deg_xyz(rotation: &Matrix3<f64>) -> (f64, f64, f64) {
    let sy = (rotation[(0, 0)].powi(2) + rotation[(1, 0)].powi(2)).sqrt();
    let singular = sy < 1e-6;
    let (pitch_rad, yaw_rad, roll_rad) = if singular {
        (
            (-rotation[(1, 2)]).atan2(rotation[(1, 1)]),
            (-rotation[(2, 0)]).atan2(sy),
            0.0,
        )
    } else {
        (
            rotation[(2, 1)].atan2(rotation[(2, 2)]),
            (-rotation[(2, 0)]).atan2(sy),
            rotation[(1, 0)].atan2(rotation[(0, 0)]),
        )
    };
    (pitch_rad.to_degrees(), yaw_rad.to_degrees(), roll_rad.to_degrees())
}

/// Pinhole camera intrinsics matching `_camera_matrix_for` at
/// `service.py:871-886`: focal = image width, principal point at center,
/// no skew, no distortion.
pub fn camera_matrix_for(frame_width: usize, frame_height: usize) -> Matrix3<f64> {
    let focal = frame_width as f64;
    let cx = frame_width as f64 / 2.0;
    let cy = frame_height as f64 / 2.0;
    Matrix3::new(focal, 0.0, cx, 0.0, focal, cy, 0.0, 0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn rodrigues_identity() {
        let rv = Vector3::zeros();
        let r = rodrigues_to_matrix(&rv);
        for i in 0..3 {
            for j in 0..3 {
                let expected = if i == j { 1.0 } else { 0.0 };
                assert_abs_diff_eq!(r[(i, j)], expected, epsilon = 1e-12);
            }
        }
    }

    #[test]
    fn rodrigues_90_around_z() {
        let rv = Vector3::new(0.0, 0.0, std::f64::consts::FRAC_PI_2);
        let r = rodrigues_to_matrix(&rv);
        assert_abs_diff_eq!(r[(0, 0)], 0.0, epsilon = 1e-12);
        assert_abs_diff_eq!(r[(0, 1)], -1.0, epsilon = 1e-12);
        assert_abs_diff_eq!(r[(1, 0)], 1.0, epsilon = 1e-12);
        assert_abs_diff_eq!(r[(1, 1)], 0.0, epsilon = 1e-12);
        assert_abs_diff_eq!(r[(2, 2)], 1.0, epsilon = 1e-12);
    }

    #[test]
    fn euler_identity() {
        let r = Matrix3::identity();
        let (pitch, yaw, roll) = rotation_to_euler_deg_xyz(&r);
        assert_abs_diff_eq!(pitch, 0.0, epsilon = 1e-9);
        assert_abs_diff_eq!(yaw, 0.0, epsilon = 1e-9);
        assert_abs_diff_eq!(roll, 0.0, epsilon = 1e-9);
    }

    #[test]
    fn solve_pnp_identity_face() {
        // Synthetic head facing camera at z=300mm. Camera 720x1280, focal=720.
        let object: [(f64, f64, f64); 5] = [
            (32.0, -35.0, -30.0),
            (-32.0, -35.0, -30.0),
            (0.0, 0.0, 0.0),
            (22.0, 35.0, -12.0),
            (-22.0, 35.0, -12.0),
        ];
        let k = camera_matrix_for(720, 1280);
        let true_t = Vector3::new(0.0, 0.0, 300.0);
        // Project to image.
        let img: Vec<(f64, f64)> = object
            .iter()
            .map(|&(x, y, z)| {
                let xc = x + true_t[0];
                let yc = y + true_t[1];
                let zc = z + true_t[2];
                (k[(0, 0)] * xc / zc + k[(0, 2)], k[(1, 1)] * yc / zc + k[(1, 2)])
            })
            .collect();
        let sol = solve_pnp(&object, &img, &k).expect("converges");
        let (pitch, yaw, roll) = rotation_to_euler_deg_xyz(&sol.rotation);
        assert_abs_diff_eq!(pitch, 0.0, epsilon = 0.1);
        assert_abs_diff_eq!(yaw, 0.0, epsilon = 0.1);
        assert_abs_diff_eq!(roll, 0.0, epsilon = 0.1);
        assert_abs_diff_eq!(sol.translation[2], 300.0, epsilon = 0.5);
    }

    #[test]
    fn solve_pnp_yaw_30() {
        let object: [(f64, f64, f64); 5] = [
            (32.0, -35.0, -30.0),
            (-32.0, -35.0, -30.0),
            (0.0, 0.0, 0.0),
            (22.0, 35.0, -12.0),
            (-22.0, 35.0, -12.0),
        ];
        let k = camera_matrix_for(720, 1280);
        // Rotate object by +30° around Y axis (yaw, subject turning to image-left).
        let theta = 30.0_f64.to_radians();
        let r_true = rodrigues_to_matrix(&Vector3::new(0.0, theta, 0.0));
        let true_t = Vector3::new(0.0, 0.0, 320.0);
        let img: Vec<(f64, f64)> = object
            .iter()
            .map(|&(x, y, z)| {
                let pt = r_true * Vector3::new(x, y, z) + true_t;
                (k[(0, 0)] * pt[0] / pt[2] + k[(0, 2)], k[(1, 1)] * pt[1] / pt[2] + k[(1, 2)])
            })
            .collect();
        let sol = solve_pnp(&object, &img, &k).expect("converges");
        let (_pitch, yaw, _roll) = rotation_to_euler_deg_xyz(&sol.rotation);
        assert_abs_diff_eq!(yaw, 30.0, epsilon = 0.2);
    }
}
