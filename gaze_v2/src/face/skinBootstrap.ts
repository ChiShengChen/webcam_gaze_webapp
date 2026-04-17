/**
 * Face bootstrap using YCbCr skin-colour segmentation.
 *
 * Classical approach: skin pixels cluster tightly in Cb/Cr even across
 * ethnicities (the variation is mostly luminance). We threshold in that
 * sub-space, keep the largest connected component, and assume it's the face.
 *
 * Inputs: raw RGBA from the camera frame.
 * Output: a best-guess face bounding box, or null if nothing plausible found.
 *
 * This is intentionally simple — it's a cold-start detector. Once tracking
 * is live we rely on NCC and rarely need this again.
 */

export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Standard skin ranges in YCbCr (Chai & Ngan 1999; Vezhnevets et al. 2003).
const CB_LOW = 77;
const CB_HIGH = 127;
const CR_LOW = 133;
const CR_HIGH = 173;

/**
 * Build a binary skin mask from an RGBA buffer.
 * Returns a Uint8Array (0 or 1) of length width*height.
 */
export function skinMask(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
): Uint8Array {
    const mask = new Uint8Array(width * height);
    for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        // RGB → YCbCr (ITU-R BT.601)
        // Y  =  0.299  R + 0.587  G + 0.114  B
        // Cb = -0.168736R - 0.331264G + 0.5     B + 128
        // Cr =  0.5     R - 0.418688G - 0.081312B + 128
        const cb = (-0.168736 * r - 0.331264 * g + 0.5 * b + 128) | 0;
        const cr = (0.5 * r - 0.418688 * g - 0.081312 * b + 128) | 0;
        mask[p] = cb >= CB_LOW && cb <= CB_HIGH && cr >= CR_LOW && cr <= CR_HIGH ? 1 : 0;
    }
    return mask;
}

/**
 * Find the largest connected component in a binary mask using two-pass
 * union-find labeling. Returns the bounding box, or null if no blob exists.
 */
export function largestComponentBBox(
    mask: Uint8Array,
    width: number,
    height: number,
    minPixels: number
): FaceBox | null {
    const labels = new Int32Array(mask.length);
    const parent: number[] = [0]; // parent[0] unused (0 = background)
    let nextLabel = 1;

    const find = (x: number): number => {
        let r = x;
        while (parent[r] !== r) r = parent[r];
        while (parent[x] !== r) {
            const next = parent[x];
            parent[x] = r;
            x = next;
        }
        return r;
    };
    const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };

    // First pass: provisional labels.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (mask[idx] === 0) continue;
            const left = x > 0 ? labels[idx - 1] : 0;
            const up = y > 0 ? labels[idx - width] : 0;
            if (left === 0 && up === 0) {
                labels[idx] = nextLabel;
                parent[nextLabel] = nextLabel;
                nextLabel++;
            } else if (left !== 0 && up === 0) {
                labels[idx] = left;
            } else if (left === 0 && up !== 0) {
                labels[idx] = up;
            } else {
                labels[idx] = Math.min(left, up);
                if (left !== up) union(left, up);
            }
        }
    }

    // Second pass: flatten labels and accumulate bounding boxes.
    interface Acc { minX: number; minY: number; maxX: number; maxY: number; count: number }
    const byRoot = new Map<number, Acc>();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (labels[idx] === 0) continue;
            const root = find(labels[idx]);
            let acc = byRoot.get(root);
            if (!acc) {
                acc = { minX: x, minY: y, maxX: x, maxY: y, count: 0 };
                byRoot.set(root, acc);
            }
            if (x < acc.minX) acc.minX = x;
            if (x > acc.maxX) acc.maxX = x;
            if (y < acc.minY) acc.minY = y;
            if (y > acc.maxY) acc.maxY = y;
            acc.count++;
        }
    }

    let best: Acc | null = null;
    for (const acc of byRoot.values()) {
        if (acc.count < minPixels) continue;
        if (!best || acc.count > best.count) best = acc;
    }
    if (!best) return null;
    return {
        x: best.minX,
        y: best.minY,
        width: best.maxX - best.minX + 1,
        height: best.maxY - best.minY + 1,
    };
}

/**
 * End-to-end bootstrap: try to find a face in a camera frame.
 * Returns the best face box or null.
 */
export function bootstrapFace(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
): FaceBox | null {
    const mask = skinMask(rgba, width, height);
    const minPixels = Math.floor(width * height * 0.01); // face ≥ 1% of frame
    const blob = largestComponentBBox(mask, width, height, minPixels);
    if (!blob) return null;

    // Sanity filter: face aspect ratio is roughly 0.6-1.4 (taller than wide
    // or slightly wider). Reject crazy shapes that are obviously not a face.
    const ratio = blob.width / blob.height;
    if (ratio < 0.4 || ratio > 1.8) return null;

    // Shrink the box slightly — skin mask tends to bleed into neck/ears.
    const shrinkX = blob.width * 0.05;
    const shrinkY = blob.height * 0.08;
    return {
        x: blob.x + shrinkX,
        y: blob.y + shrinkY,
        width: blob.width - 2 * shrinkX,
        height: blob.height - 2 * shrinkY,
    };
}
