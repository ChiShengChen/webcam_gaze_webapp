/**
 * Iris / pupil centre localization.
 *
 * Three fused techniques:
 *
 *   (1) Integral-image darkness centroid — cheap, gets us a good seed.
 *   (2) Radial symmetry refinement over a small window around the seed.
 *   (3) Sub-pixel parabolic interpolation on the final response peak.
 *
 * This is purposely simpler than Daugman's full integro-differential
 * operator (which we'd want if we also need iris radius). For eye-
 * cursor control we only need the centre, and darkness centroid +
 * radial symmetry gives sub-pixel accuracy on clean webcam eye patches.
 */

import type { GrayImage } from '../cv/image';
import { buildIntegral, rectSum } from '../cv/integral';

export interface IrisResult {
    /** Centre in patch-local pixel coordinates (sub-pixel accurate). */
    x: number;
    y: number;
    /** Confidence in [0, 1]; low = noisy or degenerate detection. */
    confidence: number;
    /** Which radius-ratio pair produced this result (index into config list). */
    ratioIndex: number;
    /** Raw response score at the chosen centre — useful for session learning. */
    rawScore: number;
}

/** A single (inner, outer) radius pair expressed as fractions of patch width. */
export interface RadiusRatio {
    inner: number;
    outer: number;
}

export interface IrisConfig {
    /**
     * Candidate radius pairs tried each frame. Result with the highest
     * ring-differential response wins. More pairs = better coverage of
     * different eye sizes / distances but higher per-frame cost.
     */
    ratios: RadiusRatio[];
    /** Optional hint: evaluate this index first and early-exit if strong. */
    preferredIndex?: number;
    /** If the preferred candidate's score exceeds this, skip the others. */
    earlyExitScore: number;
}

export const DEFAULT_IRIS_CONFIG: IrisConfig = {
    ratios: [
        { inner: 0.06, outer: 0.13 },  // small / distant iris
        { inner: 0.08, outer: 0.18 },  // medium (most adults at laptop distance)
        { inner: 0.11, outer: 0.22 },  // large / close iris
    ],
    earlyExitScore: 25,
};

/**
 * Weighted darkness centroid over the middle band of the patch.
 *
 * The iris is the darkest roughly-circular region in an eye patch. We
 * weight each pixel by `max(0, T - value)` for some threshold T so only
 * genuinely dark pixels contribute. The centroid is the iris centre.
 */
function darknessCentroid(img: GrayImage): { x: number; y: number; mass: number } {
    const W = img.width;
    const H = img.height;
    // Restrict to vertical middle 60% — excludes eyebrows/lashes at top,
    // lower lid shadow at bottom.
    const y0 = Math.floor(H * 0.2);
    const y1 = Math.ceil(H * 0.85);
    // And horizontal middle 80% — excludes canthus bone shadows.
    const x0 = Math.floor(W * 0.1);
    const x1 = Math.ceil(W * 0.9);

    // Estimate background (mean) then threshold at 0.6 * mean so only
    // the iris / pupil pixels contribute.
    let bgSum = 0;
    let bgN = 0;
    for (let y = y0; y < y1; y++) {
        const row = y * W;
        for (let x = x0; x < x1; x++) {
            bgSum += img.data[row + x];
            bgN++;
        }
    }
    const bgMean = bgN > 0 ? bgSum / bgN : 128;
    const threshold = bgMean * 0.65;

    let sx = 0;
    let sy = 0;
    let mass = 0;
    for (let y = y0; y < y1; y++) {
        const row = y * W;
        for (let x = x0; x < x1; x++) {
            const v = img.data[row + x];
            if (v >= threshold) continue;
            const w = threshold - v;
            sx += x * w;
            sy += y * w;
            mass += w;
        }
    }
    if (mass <= 0) return { x: W / 2, y: H / 2, mass: 0 };
    return { x: sx / mass, y: sy / mass, mass };
}

/**
 * Radial symmetry refinement: for each candidate centre in a small window
 * around the seed, score how much darker the ring [rMin, rMax] is than
 * the outer ring. The iris is a disc of darkness surrounded by lighter
 * sclera, so the correct centre maximises this differential.
 *
 * Implemented via integral image and square rings (not true circles) — the
 * ~5% bias from squareness is well below the sub-pixel noise floor.
 */
function radialRefine(
    img: GrayImage,
    seedX: number,
    seedY: number,
    rInner: number,
    rOuter: number,
    searchRadius: number
): { x: number; y: number; score: number; response: Float32Array; rx: number; ry: number; rw: number; rh: number } {
    const W = img.width;
    const H = img.height;
    const integral = buildIntegral(img);

    const rx = Math.max(rOuter, Math.floor(seedX - searchRadius));
    const ry = Math.max(rOuter, Math.floor(seedY - searchRadius));
    const rxEnd = Math.min(W - rOuter - 1, Math.ceil(seedX + searchRadius));
    const ryEnd = Math.min(H - rOuter - 1, Math.ceil(seedY + searchRadius));
    const rw = rxEnd - rx + 1;
    const rh = ryEnd - ry + 1;

    const response = new Float32Array(rw * rh);
    const innerArea = (2 * rInner + 1) * (2 * rInner + 1);
    const outerArea = (2 * rOuter + 1) * (2 * rOuter + 1);
    const ringArea = outerArea - innerArea;
    if (ringArea <= 0 || innerArea <= 0) {
        return { x: seedX, y: seedY, score: 0, response, rx, ry, rw, rh };
    }

    let bestScore = -Infinity;
    let bestX = seedX;
    let bestY = seedY;

    for (let y = ry; y <= ryEnd; y++) {
        for (let x = rx; x <= rxEnd; x++) {
            const inSum = rectSum(
                integral,
                x - rInner,
                y - rInner,
                x + rInner + 1,
                y + rInner + 1
            );
            const outSum = rectSum(
                integral,
                x - rOuter,
                y - rOuter,
                x + rOuter + 1,
                y + rOuter + 1
            );
            const innerMean = inSum / innerArea;
            const ringMean = (outSum - inSum) / ringArea;
            // Score: how much darker the inner disc is than the surrounding ring.
            const score = ringMean - innerMean;
            response[(y - ry) * rw + (x - rx)] = score;
            if (score > bestScore) {
                bestScore = score;
                bestX = x;
                bestY = y;
            }
        }
    }
    return { x: bestX, y: bestY, score: bestScore, response, rx, ry, rw, rh };
}

/**
 * Sub-pixel interpolation: fit a 1D parabola to the three samples around
 * the peak along x and y independently. Offset = (L - R) / (2*(L - 2M + R)).
 */
function subpixel(
    response: Float32Array,
    rw: number,
    rh: number,
    peakX: number,
    peakY: number
): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    if (peakX > 0 && peakX < rw - 1) {
        const L = response[peakY * rw + (peakX - 1)];
        const M = response[peakY * rw + peakX];
        const R = response[peakY * rw + (peakX + 1)];
        const denom = L - 2 * M + R;
        if (Math.abs(denom) > 1e-6) dx = (L - R) / (2 * denom);
    }
    if (peakY > 0 && peakY < rh - 1) {
        const U = response[(peakY - 1) * rw + peakX];
        const M = response[peakY * rw + peakX];
        const D = response[(peakY + 1) * rw + peakX];
        const denom = U - 2 * M + D;
        if (Math.abs(denom) > 1e-6) dy = (U - D) / (2 * denom);
    }
    // Clamp small offsets to [-1, 1].
    if (dx > 1) dx = 1;
    if (dx < -1) dx = -1;
    if (dy > 1) dy = 1;
    if (dy < -1) dy = -1;
    return { dx, dy };
}

export function locateIris(patch: GrayImage, config: IrisConfig = DEFAULT_IRIS_CONFIG): IrisResult {
    const W = patch.width;
    const H = patch.height;
    if (W < 20 || H < 12) {
        return { x: W / 2, y: H / 2, confidence: 0, ratioIndex: -1, rawScore: 0 };
    }

    // (1) Seed via darkness centroid — shared across all radius candidates
    // since it doesn't depend on radius.
    const seed = darknessCentroid(patch);
    const lowMass = seed.mass < 100;
    const searchRadius = Math.max(4, Math.round(W * 0.1));

    // Order: preferred first so we can early-exit; then the rest in order.
    const order: number[] = [];
    const pref = config.preferredIndex;
    if (pref !== undefined && pref >= 0 && pref < config.ratios.length) {
        order.push(pref);
    }
    for (let i = 0; i < config.ratios.length; i++) {
        if (!order.includes(i)) order.push(i);
    }

    // (2) Evaluate each candidate ratio pair; keep the best-scoring one.
    let best: {
        ratioIndex: number;
        score: number;
        refined: ReturnType<typeof radialRefine>;
    } | null = null;

    for (const i of order) {
        const r = config.ratios[i];
        const rInner = Math.max(2, Math.round(W * r.inner));
        const rOuter = Math.max(rInner + 2, Math.round(W * r.outer));
        if (rOuter * 2 + 1 >= Math.min(W, H)) continue; // too big for this patch
        const refined = radialRefine(patch, seed.x, seed.y, rInner, rOuter, searchRadius);
        if (!best || refined.score > best.score) {
            best = { ratioIndex: i, score: refined.score, refined };
        }
        // Early exit if preferred result is already strong enough.
        if (i === pref && refined.score >= config.earlyExitScore) break;
    }

    if (!best) {
        return { x: W / 2, y: H / 2, confidence: 0, ratioIndex: -1, rawScore: 0 };
    }

    // (3) Sub-pixel parabola fit on the winning response map.
    const peakX = best.refined.x - best.refined.rx;
    const peakY = best.refined.y - best.refined.ry;
    const { dx, dy } = subpixel(
        best.refined.response,
        best.refined.rw,
        best.refined.rh,
        peakX,
        peakY
    );

    let conf = Math.max(0, Math.min(1, best.refined.score / 40));
    if (lowMass) conf *= 0.3;

    return {
        x: best.refined.x + dx,
        y: best.refined.y + dy,
        confidence: conf,
        ratioIndex: best.ratioIndex,
        rawScore: best.refined.score,
    };
}
