/**
 * Grayscale image abstraction and basic pixel utilities.
 *
 * We work in Uint8 grayscale throughout the CV pipeline. RGB webcam frames
 * are converted once per frame and everything downstream reads from a
 * single typed-array buffer — cache-friendly and compact.
 */

export interface GrayImage {
    width: number;
    height: number;
    data: Uint8Array; // length = width * height
}

export function createGray(width: number, height: number): GrayImage {
    return { width, height, data: new Uint8Array(width * height) };
}

/**
 * RGBA → grayscale using the standard luminance weights.
 * Destination can be pre-allocated and re-used across frames.
 */
export function rgbaToGray(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    out?: GrayImage
): GrayImage {
    const dst = out ?? createGray(width, height);
    const d = dst.data;
    const n = width * height;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
        // ITU-R BT.601: 0.299 R + 0.587 G + 0.114 B
        // Use integer coefficients (×1024) to stay in int land.
        d[i] = (rgba[j] * 306 + rgba[j + 1] * 601 + rgba[j + 2] * 117) >>> 10;
    }
    return dst;
}

/**
 * Clip a sub-rectangle into a smaller GrayImage.
 * Zero-copy is tempting but we return owned data to keep ownership simple.
 */
export function cropGray(
    src: GrayImage,
    x: number,
    y: number,
    w: number,
    h: number
): GrayImage {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(src.width, (x + w) | 0);
    const y1 = Math.min(src.height, (y + h) | 0);
    const outW = x1 - x0;
    const outH = y1 - y0;
    const out = createGray(outW, outH);
    for (let yy = 0; yy < outH; yy++) {
        const srcRow = (y0 + yy) * src.width + x0;
        const dstRow = yy * outW;
        out.data.set(src.data.subarray(srcRow, srcRow + outW), dstRow);
    }
    return out;
}

/** Variance of all pixels in a GrayImage. */
export function grayVariance(img: GrayImage): number {
    const d = img.data;
    const n = d.length;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i];
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) {
        const diff = d[i] - mean;
        v += diff * diff;
    }
    return v / n;
}

/** Grayscale mean over a rectangular region. */
export function meanGray(
    img: GrayImage,
    x: number,
    y: number,
    w: number,
    h: number
): number {
    let sum = 0;
    const x1 = x + w;
    const y1 = y + h;
    for (let yy = y; yy < y1; yy++) {
        const row = yy * img.width;
        for (let xx = x; xx < x1; xx++) sum += img.data[row + xx];
    }
    return sum / (w * h);
}
