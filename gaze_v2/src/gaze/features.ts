/**
 * Feature vector construction for gaze regression.
 *
 * Raw inputs per frame:
 *   - left iris centre in **normalized eye-patch coordinates** (0..1)
 *   - right iris centre in normalized coordinates
 *   - head pose signal: face box centre in normalized frame coordinates,
 *     plus face size (proxy for distance to camera)
 *
 * We output a fixed-dimensional polynomial expansion that lets ridge
 * regression learn a smooth nonlinear mapping. The polynomial terms
 * capture the slight nonlinearity between iris offset and screen angle
 * (for a perfect pinhole eye it would be tan-shaped); the head-pose
 * terms let the model compensate for head translation and small rotation.
 *
 * Feature layout (D = 19):
 *   [1,
 *    xL, yL, xR, yR,
 *    xL², yL², xR², yR²,
 *    xL·yL, xR·yR,
 *    xL·xR, yL·yR,                 ← eye-correlation terms
 *    hx, hy, hs,                   ← head centre & size
 *    xL·hx, yL·hy, xR·hx]           ← pose × iris interactions
 *
 * 19 dimensions is small enough that ridge regression stays well-
 * conditioned even with only ~50 calibration samples, but rich enough
 * to express the nonlinearity we care about.
 */

export const FEATURE_DIM = 19;

export interface RawGazeInputs {
    /** Iris centre in left-eye patch coords, normalised to 0..1. */
    xL: number;
    yL: number;
    /** Iris centre in right-eye patch coords. */
    xR: number;
    yR: number;
    /** Face-box centre in frame coords, normalised to 0..1. */
    hx: number;
    hy: number;
    /** Face-box width over frame width (proxy for distance / scale). */
    hs: number;
}

/**
 * Build one feature row. If `out`/`offset` given, writes in place (useful
 * when building a big N×D training matrix); otherwise allocates a new row.
 */
export function buildFeatures(
    inputs: RawGazeInputs,
    out?: Float64Array,
    offset = 0
): Float64Array {
    const { xL, yL, xR, yR, hx, hy, hs } = inputs;
    // Centre iris coords at 0 so linear terms are signed — improves
    // conditioning vs. 0..1 which has no negative magnitudes.
    const cL = xL - 0.5;
    const rL = yL - 0.5;
    const cR = xR - 0.5;
    const rR = yR - 0.5;
    const cH = hx - 0.5;
    const rH = hy - 0.5;
    const sH = hs - 0.3; // centre around a plausible mean face size

    const dst = out ?? new Float64Array(FEATURE_DIM);
    let i = offset;
    dst[i++] = 1;
    dst[i++] = cL;
    dst[i++] = rL;
    dst[i++] = cR;
    dst[i++] = rR;
    dst[i++] = cL * cL;
    dst[i++] = rL * rL;
    dst[i++] = cR * cR;
    dst[i++] = rR * rR;
    dst[i++] = cL * rL;
    dst[i++] = cR * rR;
    dst[i++] = cL * cR;
    dst[i++] = rL * rR;
    dst[i++] = cH;
    dst[i++] = rH;
    dst[i++] = sH;
    dst[i++] = cL * cH;
    dst[i++] = rL * rH;
    dst[i++] = cR * cH;
    return dst;
}
