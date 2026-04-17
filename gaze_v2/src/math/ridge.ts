/**
 * Ridge regression via the closed-form normal equations.
 *
 *   w = (XᵀX + λI)⁻¹ Xᵀy
 *
 * We solve it without needing a general matrix inverse: because XᵀX is small
 * (d × d where d = feature dimension, typically 10–30), we use a
 * Gauss-Jordan solve of the d × d system. Cost is O(d³) once per re-fit.
 *
 * Two design decisions worth explaining:
 *
 *  1. We model x and y screen coordinates **independently** (two weight
 *     vectors). Eye features → screen is cleanly separable and it halves the
 *     matrix size versus a multi-output formulation.
 *
 *  2. We support per-sample weights. Calibration samples get weight 1,
 *     implicit correction samples get a smaller weight (typically 0.2-0.5)
 *     so that bad auto-correction can never dominate explicit calibration.
 *
 * No dependencies. Plain Float64Array row-major storage.
 */

export interface RidgeFit {
    weightsX: Float64Array; // length = d
    weightsY: Float64Array;
    dim: number;
    nSamples: number;
}

/**
 * Solve A · v = b in place using Gauss-Jordan with partial pivoting.
 * A is d × d row-major; on return, `A` is destroyed and `b` contains `v`.
 * Returns false if the system is singular.
 */
function solveGJ(A: Float64Array, b: Float64Array, d: number): boolean {
    for (let i = 0; i < d; i++) {
        // Pivot: find row with largest |A[row, i]| in rows i..d-1.
        let pivotRow = i;
        let pivotVal = Math.abs(A[i * d + i]);
        for (let r = i + 1; r < d; r++) {
            const v = Math.abs(A[r * d + i]);
            if (v > pivotVal) {
                pivotVal = v;
                pivotRow = r;
            }
        }
        if (pivotVal < 1e-12) return false;
        if (pivotRow !== i) {
            for (let c = 0; c < d; c++) {
                const tmp = A[i * d + c];
                A[i * d + c] = A[pivotRow * d + c];
                A[pivotRow * d + c] = tmp;
            }
            const tmp = b[i];
            b[i] = b[pivotRow];
            b[pivotRow] = tmp;
        }
        // Normalize pivot row.
        const pv = A[i * d + i];
        for (let c = 0; c < d; c++) A[i * d + c] /= pv;
        b[i] /= pv;
        // Eliminate other rows.
        for (let r = 0; r < d; r++) {
            if (r === i) continue;
            const factor = A[r * d + i];
            if (factor === 0) continue;
            for (let c = 0; c < d; c++) {
                A[r * d + c] -= factor * A[i * d + c];
            }
            b[r] -= factor * b[i];
        }
    }
    return true;
}

/**
 * Fit ridge regression for both x and y targets.
 *
 * `features` is an N×d row-major matrix; rows are per-sample feature vectors.
 * `targetsX`/`targetsY` are length-N.
 * `weights` is length-N (use 1s for unweighted).
 * `lambda` is the L2 regularisation strength.
 */
export function fitRidge(
    features: Float64Array,
    targetsX: Float64Array,
    targetsY: Float64Array,
    weights: Float64Array,
    n: number,
    d: number,
    lambda: number
): RidgeFit {
    // Compute XᵀWX (d×d) and XᵀWy (d).
    const AtA = new Float64Array(d * d);
    const Atbx = new Float64Array(d);
    const Atby = new Float64Array(d);

    for (let i = 0; i < n; i++) {
        const w = weights[i];
        if (w === 0) continue;
        const base = i * d;
        // Accumulate AtA += w * xᵢ xᵢᵀ
        for (let r = 0; r < d; r++) {
            const wr = w * features[base + r];
            Atbx[r] += wr * targetsX[i];
            Atby[r] += wr * targetsY[i];
            for (let c = r; c < d; c++) {
                AtA[r * d + c] += wr * features[base + c];
            }
        }
    }
    // Symmetrise the lower triangle and add the ridge penalty on the diagonal.
    for (let r = 0; r < d; r++) {
        for (let c = r + 1; c < d; c++) AtA[c * d + r] = AtA[r * d + c];
        AtA[r * d + r] += lambda;
    }

    // Solve (XᵀWX + λI) wx = XᵀWyx, then similarly for y.
    // We need two solves with the same LHS; easiest is to copy AtA and
    // run Gauss-Jordan twice.
    const lhsCopy = new Float64Array(AtA); // reused for y solve
    const weightsX = new Float64Array(Atbx); // mutated by solveGJ
    const weightsY = new Float64Array(Atby);
    if (!solveGJ(AtA, weightsX, d)) {
        weightsX.fill(0);
    }
    if (!solveGJ(lhsCopy, weightsY, d)) {
        weightsY.fill(0);
    }
    return { weightsX, weightsY, dim: d, nSamples: n };
}

/** Apply a fitted model to a single feature vector. */
export function predictRidge(
    fit: RidgeFit,
    features: Float64Array,
    offset = 0
): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    const d = fit.dim;
    for (let i = 0; i < d; i++) {
        const f = features[offset + i];
        sx += f * fit.weightsX[i];
        sy += f * fit.weightsY[i];
    }
    return { x: sx, y: sy };
}
