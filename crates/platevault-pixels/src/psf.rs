// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Elliptical Gaussian PSF fitting by Levenberg-Marquardt (R7, R8).
//!
//! The model is `C + A exp(-(a dx² + 2 b dx dy + c dy²))` with `dx = x - x0`
//! and `dy = y - y0`. The quadratic form avoids the angle degeneracy of round
//! stars; widths and the major-axis angle come from its eigen-decomposition.

use crate::measure::MAX_FIT_ITERATIONS;

const PARAMETERS: usize = 7;
const INITIAL_DAMPING: f64 = 1e-3;
const MAX_DAMPING: f64 = 1e12;
const CONVERGED_RELATIVE_CHANGE: f64 = 1e-10;

/// One valid sample at its pixel center.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FitSample {
    pub x: f64,
    pub y: f64,
    pub value: f64,
}

/// The fitted model parameters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Gaussian {
    pub amplitude: f64,
    pub x: f64,
    pub y: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub background: f64,
}

/// Shape of a fitted Gaussian: sigmas of the major and minor axes and the
/// major-axis angle from +x toward +y in `[0, 180)` degrees.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shape {
    pub sigma_major: f64,
    pub sigma_minor: f64,
    pub angle_deg: f64,
}

/// Why a fit has no result.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FitError {
    NoConvergence,
    Degenerate,
}

impl Gaussian {
    /// A model from its shape, as cutouts rebuild it from a star record.
    pub(crate) fn from_shape(
        amplitude: f64,
        x: f64,
        y: f64,
        shape: Shape,
        background: f64,
    ) -> Self {
        let (sin, cos) = shape.angle_deg.to_radians().sin_cos();
        let major = 1.0 / (2.0 * shape.sigma_major * shape.sigma_major);
        let minor = 1.0 / (2.0 * shape.sigma_minor * shape.sigma_minor);
        Self {
            amplitude,
            x,
            y,
            a: major * cos * cos + minor * sin * sin,
            b: (major - minor) * cos * sin,
            c: major * sin * sin + minor * cos * cos,
            background,
        }
    }

    fn vector(&self) -> [f64; PARAMETERS] {
        [self.amplitude, self.x, self.y, self.a, self.b, self.c, self.background]
    }

    const fn from_vector(values: [f64; PARAMETERS]) -> Self {
        Self {
            amplitude: values[0],
            x: values[1],
            y: values[2],
            a: values[3],
            b: values[4],
            c: values[5],
            background: values[6],
        }
    }

    /// The model value and its gradient at (x, y).
    fn evaluate_with_gradient(&self, x: f64, y: f64) -> (f64, [f64; PARAMETERS]) {
        let dx = x - self.x;
        let dy = y - self.y;
        let q = self.a * dx * dx + 2.0 * self.b * dx * dy + self.c * dy * dy;
        let g = (-q).exp();
        let ag = self.amplitude * g;
        let value = self.background + ag;
        let gradient = [
            g,
            ag * 2.0 * (self.a * dx + self.b * dy),
            ag * 2.0 * (self.b * dx + self.c * dy),
            -ag * dx * dx,
            -2.0 * ag * dx * dy,
            -ag * dy * dy,
            1.0,
        ];
        (value, gradient)
    }

    pub(crate) fn evaluate(&self, x: f64, y: f64) -> f64 {
        let dx = x - self.x;
        let dy = y - self.y;
        self.background
            + self.amplitude
                * (-(self.a * dx * dx + 2.0 * self.b * dx * dy + self.c * dy * dy)).exp()
    }

    /// Widths and angle, or `None` when the quadratic form is not positive
    /// definite.
    pub(crate) fn shape(&self) -> Option<Shape> {
        let mean = f64::midpoint(self.a, self.c);
        let spread = (((self.a - self.c) / 2.0).powi(2) + self.b * self.b).sqrt();
        let small = mean - spread;
        let large = mean + spread;
        if !(small > 0.0 && large.is_finite()) {
            return None;
        }
        // 0.5 atan2(2b, a - c) is the axis of the larger eigenvalue (the
        // minor axis); the major axis is perpendicular to it.
        let minor_axis = 0.5 * (2.0 * self.b).atan2(self.a - self.c);
        let angle_deg = (minor_axis.to_degrees() + 90.0).rem_euclid(180.0);
        Some(Shape {
            sigma_major: 1.0 / (2.0 * small).sqrt(),
            sigma_minor: 1.0 / (2.0 * large).sqrt(),
            angle_deg,
        })
    }
}

fn chi_square(model: &Gaussian, samples: &[FitSample]) -> f64 {
    samples
        .iter()
        .map(|sample| {
            let residual = sample.value - model.evaluate(sample.x, sample.y);
            residual * residual
        })
        .sum()
}

/// Solves `matrix * x = rhs` by Gaussian elimination with partial pivoting.
#[allow(clippy::needless_range_loop)]
fn solve(
    mut matrix: [[f64; PARAMETERS]; PARAMETERS],
    mut rhs: [f64; PARAMETERS],
) -> Option<[f64; PARAMETERS]> {
    for column in 0..PARAMETERS {
        let pivot = (column..PARAMETERS)
            .max_by(|a, b| matrix[*a][column].abs().total_cmp(&matrix[*b][column].abs()))?;
        if matrix[pivot][column].abs() < 1e-300 || !matrix[pivot][column].is_finite() {
            return None;
        }
        matrix.swap(column, pivot);
        rhs.swap(column, pivot);
        for row in column + 1..PARAMETERS {
            let factor = matrix[row][column] / matrix[column][column];
            for k in column..PARAMETERS {
                matrix[row][k] -= factor * matrix[column][k];
            }
            rhs[row] -= factor * rhs[column];
        }
    }
    let mut solution = [0.0; PARAMETERS];
    for row in (0..PARAMETERS).rev() {
        let tail: f64 = (row + 1..PARAMETERS).map(|k| matrix[row][k] * solution[k]).sum();
        solution[row] = (rhs[row] - tail) / matrix[row][row];
    }
    solution.iter().all(|value| value.is_finite()).then_some(solution)
}

/// Fits the model to `samples` from `initial`. Converges when an accepted
/// step changes chi-square by less than 1e-10 relative, or when no step can
/// reduce it further.
#[allow(clippy::needless_range_loop)]
pub fn fit(samples: &[FitSample], initial: Gaussian) -> Result<Gaussian, FitError> {
    if samples.len() <= PARAMETERS {
        return Err(FitError::Degenerate);
    }
    let mut model = initial;
    let mut chi2 = chi_square(&model, samples);
    let mut damping = INITIAL_DAMPING;
    for _ in 0..MAX_FIT_ITERATIONS {
        let mut normal = [[0.0; PARAMETERS]; PARAMETERS];
        let mut gradient = [0.0; PARAMETERS];
        for sample in samples {
            let (value, jacobian) = model.evaluate_with_gradient(sample.x, sample.y);
            let residual = sample.value - value;
            for row in 0..PARAMETERS {
                gradient[row] += jacobian[row] * residual;
                for column in 0..=row {
                    normal[row][column] += jacobian[row] * jacobian[column];
                }
            }
        }
        for row in 0..PARAMETERS {
            for column in row + 1..PARAMETERS {
                normal[row][column] = normal[column][row];
            }
        }
        loop {
            let mut damped = normal;
            for (index, row) in damped.iter_mut().enumerate() {
                row[index] += damping * normal[index][index].max(1e-12);
            }
            let step = solve(damped, gradient);
            let candidate = step.map(|step| {
                let mut values = model.vector();
                for (value, delta) in values.iter_mut().zip(step) {
                    *value += delta;
                }
                Gaussian::from_vector(values)
            });
            let candidate_chi2 =
                candidate.map_or(f64::INFINITY, |candidate| chi_square(&candidate, samples));
            if candidate_chi2.is_finite() && candidate_chi2 < chi2 {
                let change = (chi2 - candidate_chi2) / chi2.max(f64::MIN_POSITIVE);
                model = candidate.unwrap_or(model);
                chi2 = candidate_chi2;
                damping = (damping / 10.0).max(1e-12);
                if change < CONVERGED_RELATIVE_CHANGE {
                    return validated(model);
                }
                break;
            }
            damping *= 10.0;
            if damping > MAX_DAMPING {
                return validated(model);
            }
        }
    }
    Err(FitError::NoConvergence)
}

fn validated(model: Gaussian) -> Result<Gaussian, FitError> {
    if model.amplitude > 0.0
        && model.vector().iter().all(|value| value.is_finite())
        && model.shape().is_some()
    {
        Ok(model)
    } else {
        Err(FitError::Degenerate)
    }
}
