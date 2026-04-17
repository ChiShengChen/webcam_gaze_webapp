/**
 * Normalized cross-correlation (NCC) for template matching.
 *
 * NCC(x,y) = Σ (I(x+u,y+v) - mean_I) * (T(u,v) - mean_T)
 *           / ( N * std_I * std_T )
 *
 * Range is [-1, 1]; 1 = perfect match. Robust to uniform illumination
 * changes (because both sides are mean-centred and variance-normalised).
 *
 * We use the integral image of `I` to compute mean/std of every candidate
 * window in O(1), so the whole search costs O(searchArea * templateArea).
 * For a 40×40 template in a 120×120 search window that's ~230k ops — fast.
 *
 * Template is pre-processed once into `(Tn, sumTnSq)` where Tn is mean-
 * centred and sumTnSq is the sum of Tn² (so we only divide at the end).
 */

import type { GrayImage } from './image';
import { buildIntegral, rectSum, rectSqSum, type IntegralImage } from './integral';

export interface Template {
    width: number;
    height: number;
    /** Mean-centred float values (template - meanT), length = w*h. */
    centred: Float32Array;
    /** Σ (T - meanT)² — pre-computed denominator contribution. */
    normSq: number;
}

export function makeTemplate(img: GrayImage, x: number, y: number, w: number, h: number): Template {
    const centred = new Float32Array(w * h);
    let sum = 0;
    for (let yy = 0; yy < h; yy++) {
        const srcRow = (y + yy) * img.width + x;
        const dstRow = yy * w;
        for (let xx = 0; xx < w; xx++) {
            const v = img.data[srcRow + xx];
            centred[dstRow + xx] = v;
            sum += v;
        }
    }
    const mean = sum / (w * h);
    let normSq = 0;
    for (let i = 0; i < centred.length; i++) {
        centred[i] -= mean;
        normSq += centred[i] * centred[i];
    }
    return { width: w, height: h, centred, normSq };
}

export interface NCCResult {
    x: number;       // top-left of best window
    y: number;
    score: number;   // NCC in [-1, 1]
}

/**
 * Search for the template in `img` within the rectangle
 * [searchX, searchX + searchW) × [searchY, searchY + searchH).
 * Returns the best-scoring top-left position and its NCC score.
 */
export function searchNCC(
    img: GrayImage,
    integral: IntegralImage | null,
    template: Template,
    searchX: number,
    searchY: number,
    searchW: number,
    searchH: number,
    stride = 1
): NCCResult {
    const I = integral ?? buildIntegral(img);
    const tw = template.width;
    const th = template.height;
    const n = tw * th;
    const tNormSq = template.normSq;

    const x0 = Math.max(0, searchX | 0);
    const y0 = Math.max(0, searchY | 0);
    const x1 = Math.min(img.width - tw, (searchX + searchW) | 0);
    const y1 = Math.min(img.height - th, (searchY + searchH) | 0);

    let bestScore = -Infinity;
    let bestX = x0;
    let bestY = y0;

    for (let y = y0; y <= y1; y += stride) {
        for (let x = x0; x <= x1; x += stride) {
            // O(1) window mean & variance via integral image.
            const s = rectSum(I, x, y, x + tw, y + th);
            const sq = rectSqSum(I, x, y, x + tw, y + th);
            const mean = s / n;
            const variance = sq - s * s / n; // N * var
            if (variance <= 1e-6) continue;
            const iStd = Math.sqrt(variance);

            // Cross term Σ I·T, then NCC = (Σ I·T - n*meanI*meanT) / (std_I*std_T*n).
            // Because template is already mean-centred, meanT = 0 and the
            // numerator simplifies to Σ (I - meanI) * T_centred.
            let cross = 0;
            for (let yy = 0; yy < th; yy++) {
                const imgRow = (y + yy) * img.width + x;
                const tplRow = yy * tw;
                for (let xx = 0; xx < tw; xx++) {
                    cross += (img.data[imgRow + xx] - mean) * template.centred[tplRow + xx];
                }
            }
            const denom = Math.sqrt(tNormSq) * iStd;
            const score = denom > 0 ? cross / denom : 0;
            if (score > bestScore) {
                bestScore = score;
                bestX = x;
                bestY = y;
            }
        }
    }
    return { x: bestX, y: bestY, score: bestScore };
}
