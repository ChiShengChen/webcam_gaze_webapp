/**
 * Integral image (summed-area table).
 *
 * Lets us compute the sum of any axis-aligned rectangle in O(1):
 *     sum(x0..x1, y0..y1) = I[y1,x1] - I[y0-1,x1] - I[y1,x0-1] + I[y0-1,x0-1]
 *
 * Also computes the sum-of-squares table so we can get variance in O(1).
 */

import type { GrayImage } from './image';

export interface IntegralImage {
    /** (width+1) * (height+1) — padded with a zero row/column. */
    sum: Float64Array;
    /** Same shape as sum, but storing sum of squared pixel values. */
    sqsum: Float64Array;
    width: number;  // original image width
    height: number; // original image height
    stride: number; // width + 1
}

export function buildIntegral(img: GrayImage): IntegralImage {
    const W = img.width;
    const H = img.height;
    const stride = W + 1;
    const sum = new Float64Array(stride * (H + 1));
    const sqsum = new Float64Array(stride * (H + 1));
    const d = img.data;

    for (let y = 0; y < H; y++) {
        let rowSum = 0;
        let rowSq = 0;
        const srcRow = y * W;
        const dstRow = (y + 1) * stride;
        const prevRow = y * stride;
        for (let x = 0; x < W; x++) {
            const v = d[srcRow + x];
            rowSum += v;
            rowSq += v * v;
            sum[dstRow + x + 1] = sum[prevRow + x + 1] + rowSum;
            sqsum[dstRow + x + 1] = sqsum[prevRow + x + 1] + rowSq;
        }
    }
    return { sum, sqsum, width: W, height: H, stride };
}

/** Sum of pixel values in the rectangle [x0,x1) × [y0,y1). */
export function rectSum(
    I: IntegralImage,
    x0: number,
    y0: number,
    x1: number,
    y1: number
): number {
    const s = I.stride;
    return (
        I.sum[y1 * s + x1] -
        I.sum[y0 * s + x1] -
        I.sum[y1 * s + x0] +
        I.sum[y0 * s + x0]
    );
}

/** Sum of squared pixel values in the rectangle. */
export function rectSqSum(
    I: IntegralImage,
    x0: number,
    y0: number,
    x1: number,
    y1: number
): number {
    const s = I.stride;
    return (
        I.sqsum[y1 * s + x1] -
        I.sqsum[y0 * s + x1] -
        I.sqsum[y1 * s + x0] +
        I.sqsum[y0 * s + x0]
    );
}

/** Mean and variance of a rectangle in O(1). */
export function rectStats(
    I: IntegralImage,
    x0: number,
    y0: number,
    x1: number,
    y1: number
): { mean: number; variance: number; n: number } {
    const n = (x1 - x0) * (y1 - y0);
    if (n <= 0) return { mean: 0, variance: 0, n: 0 };
    const s = rectSum(I, x0, y0, x1, y1);
    const sq = rectSqSum(I, x0, y0, x1, y1);
    const mean = s / n;
    const variance = sq / n - mean * mean;
    return { mean, variance, n };
}
