/**
 * One-Euro filter.
 *
 * Casiez, G., Roussel, N., Vogel, D. (2012)
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in
 *  Interactive Systems." CHI 2012.
 *
 * Better than a moving average for gaze: adapts its cutoff frequency to
 * the signal's instantaneous speed — low cutoff when still (heavy smoothing,
 * minimal jitter on fixations), high cutoff when fast (preserves saccades).
 *
 * Two tuning knobs:
 *   minCutoff — cutoff at zero speed (lower = smoother but laggier)
 *   beta      — how much cutoff increases with speed (higher = more
 *               responsive to saccades)
 */

function lowPass(hat: number, raw: number, alpha: number): number {
    return alpha * raw + (1 - alpha) * hat;
}

function alphaFromCutoff(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
}

export interface OneEuroConfig {
    minCutoff: number;
    beta: number;
    dCutoff: number;
}

const DEFAULT: OneEuroConfig = {
    minCutoff: 1.0,
    beta: 0.007,
    dCutoff: 1.0,
};

export class OneEuroFilter {
    private xHat: number | null = null;
    private dxHat = 0;
    private lastT: number | null = null;
    private readonly cfg: OneEuroConfig;

    constructor(cfg: Partial<OneEuroConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };
    }

    reset(): void {
        this.xHat = null;
        this.dxHat = 0;
        this.lastT = null;
    }

    filter(value: number, timestampSec: number): number {
        if (this.xHat === null || this.lastT === null) {
            this.xHat = value;
            this.lastT = timestampSec;
            return value;
        }
        const dt = Math.max(1e-6, timestampSec - this.lastT);
        const dxRaw = (value - this.xHat) / dt;
        const alphaD = alphaFromCutoff(this.cfg.dCutoff, dt);
        this.dxHat = lowPass(this.dxHat, dxRaw, alphaD);
        const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(this.dxHat);
        const alpha = alphaFromCutoff(cutoff, dt);
        this.xHat = lowPass(this.xHat, value, alpha);
        this.lastT = timestampSec;
        return this.xHat;
    }
}

export class OneEuroFilter2D {
    private fx: OneEuroFilter;
    private fy: OneEuroFilter;
    constructor(cfg: Partial<OneEuroConfig> = {}) {
        this.fx = new OneEuroFilter(cfg);
        this.fy = new OneEuroFilter(cfg);
    }
    reset(): void {
        this.fx.reset();
        this.fy.reset();
    }
    filter(x: number, y: number, timestampSec: number): { x: number; y: number } {
        return {
            x: this.fx.filter(x, timestampSec),
            y: this.fy.filter(y, timestampSec),
        };
    }
}
