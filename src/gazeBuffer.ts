/**
 * GazeBuffer — rolling buffer of recent gaze samples with GazeMedSeg-style
 * aggregation for SAM prompting.
 *
 * Why this exists
 * ---------------
 * Webcam gaze is noisy at the single-sample level (~2° visual angle).
 * Feeding only the most-recent (x, y) into SAM amplifies the noise into
 * unstable mask output. Zhong et al. (MICCAI 2024, "Weakly-supervised
 * Medical Image Segmentation with Gaze Annotations") demonstrate that
 * Gaussian heatmap aggregation over a fixation window suppresses jitter
 * while preserving the peak location. We adopt the same idea on the
 * streaming side: accumulate the last ~500 ms of samples, splat them onto
 * a Gaussian heatmap, and take the peak as the SAM prompt.
 *
 * Filtering follows GazeMedSeg's two rules (their dataset README):
 *   - drop samples outside the image bounds
 *   - require minimum cumulative dwell duration (50 ms) before a prompt
 *     is considered valid (a stand-in for their "remove fixations <50 ms"
 *     rule in our streaming context)
 *
 * Coordinates throughout are in *image* space (not screen space). The
 * caller is responsible for the screen→image transform.
 */

export interface GazeSample {
    x: number;       // image-space px
    y: number;
    t: number;       // performance.now() ms
}

export interface GazeBufferConfig {
    /** How far back the prompt window looks. */
    windowMs?: number;
    /** Samples older than this are GC'd. */
    staleMs?: number;
    /** Minimum cumulative dwell before computePrompt() returns non-null. */
    minDwellMs?: number;
    /** Heatmap σ as a fraction of max(imageWidth, imageHeight). */
    sigmaFrac?: number;
    /** Heatmap grid resolution (square). */
    gridSize?: number;
}

const DEFAULT_CONFIG: Required<GazeBufferConfig> = {
    windowMs: 500,
    staleMs: 1500,
    minDwellMs: 50,
    sigmaFrac: 0.02,
    gridSize: 128,
};

export class GazeBuffer {
    private samples: GazeSample[] = [];
    private readonly cfg: Required<GazeBufferConfig>;

    constructor(config: GazeBufferConfig = {}) {
        this.cfg = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Push a new gaze sample.
     *
     * Filtering applied here (GazeMedSeg rule):
     *   - Out-of-bounds samples (x < 0, x >= imgW, etc.) are dropped.
     *
     * The <50 ms duration filter is applied at computePrompt() time
     * (we can't know the duration of an in-flight sample yet).
     */
    push(x: number, y: number, imgW: number, imgH: number): void {
        if (x < 0 || x >= imgW || y < 0 || y >= imgH) return;

        const now = performance.now();
        this.samples.push({ x, y, t: now });

        // GC: drop samples older than staleMs so the buffer stays bounded.
        const cutoff = now - this.cfg.staleMs;
        while (this.samples.length > 0 && this.samples[0].t < cutoff) {
            this.samples.shift();
        }
    }

    /**
     * Compute a SAM-ready prompt point by Gaussian-heatmap aggregation
     * over the last windowMs of samples (Zhong et al., MICCAI 2024).
     *
     * Returns null when there isn't enough stable data (the second
     * GazeMedSeg filter: cumulative dwell < minDwellMs).
     */
    computePrompt(imgW: number, imgH: number): { x: number; y: number } | null {
        const now = performance.now();
        const windowStart = now - this.cfg.windowMs;
        const recent = this.samples.filter((s) => s.t >= windowStart);

        if (recent.length < 2) return null;
        const dwell = recent[recent.length - 1].t - recent[0].t;
        if (dwell < this.cfg.minDwellMs) return null;

        const GRID = this.cfg.gridSize;
        const heat = new Float32Array(GRID * GRID);
        const longSide = Math.max(imgW, imgH);
        const sigmaImagePx = longSide * this.cfg.sigmaFrac;
        const sigmaGrid = (sigmaImagePx / longSide) * GRID;
        const inv2s2 = 1 / (2 * sigmaGrid * sigmaGrid);
        const support = Math.ceil(sigmaGrid * 3); // 3σ truncation

        for (const s of recent) {
            const cx = (s.x / imgW) * GRID;
            const cy = (s.y / imgH) * GRID;
            const x0 = Math.max(0, Math.floor(cx - support));
            const x1 = Math.min(GRID - 1, Math.ceil(cx + support));
            const y0 = Math.max(0, Math.floor(cy - support));
            const y1 = Math.min(GRID - 1, Math.ceil(cy + support));
            for (let y = y0; y <= y1; y++) {
                const dy = y - cy;
                const row = y * GRID;
                for (let x = x0; x <= x1; x++) {
                    const dx = x - cx;
                    heat[row + x] += Math.exp(-(dx * dx + dy * dy) * inv2s2);
                }
            }
        }

        let bestI = 0;
        let bestV = -1;
        for (let i = 0; i < heat.length; i++) {
            if (heat[i] > bestV) {
                bestV = heat[i];
                bestI = i;
            }
        }

        const px = ((bestI % GRID) + 0.5) / GRID * imgW;
        const py = (Math.floor(bestI / GRID) + 0.5) / GRID * imgH;
        return { x: px, y: py };
    }

    /** How many samples are currently buffered (after GC). */
    size(): number {
        return this.samples.length;
    }

    /**
     * Drop everything. Call when switching images / videos / sessions —
     * old fixations on different content must not bleed into the new
     * prompt.
     */
    reset(): void {
        this.samples = [];
    }
}
