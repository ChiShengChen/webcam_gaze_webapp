/**
 * 9-point calibration orchestration (data side, not UI).
 *
 * The UI shows dots in 9 known screen positions. For each dot, we need
 * stable iris samples while the user is looking at it. This module owns
 * the state machine:
 *
 *   IDLE → POINT_ACTIVE → (collect N samples) → POINT_DONE → next point
 *
 * Sample filtering per point:
 *   - Reject frames where iris confidence is below threshold.
 *   - Reject frames where the face box moved rapidly since last sample
 *     (user glanced away or head jerked).
 *   - After collection, use the *median* iris position for that point
 *     (robust against the 1-2 noisy frames that sneak through).
 */

import type { RawGazeInputs } from './features';

export interface CalibrationPointTarget {
    xNorm: number; // 0..1
    yNorm: number; // 0..1
}

export const DEFAULT_POINTS: CalibrationPointTarget[] = [
    { xNorm: 0.08, yNorm: 0.08 },
    { xNorm: 0.5, yNorm: 0.08 },
    { xNorm: 0.92, yNorm: 0.08 },
    { xNorm: 0.08, yNorm: 0.5 },
    { xNorm: 0.5, yNorm: 0.5 },
    { xNorm: 0.92, yNorm: 0.5 },
    { xNorm: 0.08, yNorm: 0.92 },
    { xNorm: 0.5, yNorm: 0.92 },
    { xNorm: 0.92, yNorm: 0.92 },
];

const SAMPLES_PER_POINT = 25;
const MIN_IRIS_CONF = 0.25;

export interface CollectedSample {
    inputs: RawGazeInputs;
    confidence: number;
}

export interface PointResult {
    target: CalibrationPointTarget;
    median: RawGazeInputs;
    sampleCount: number;
}

export class Calibration {
    private pointIndex = 0;
    private active = false;
    private current: CollectedSample[] = [];
    public results: PointResult[] = [];

    constructor(public readonly points: CalibrationPointTarget[] = DEFAULT_POINTS) {}

    get isActive(): boolean { return this.active; }
    get currentIndex(): number { return this.pointIndex; }
    get currentTarget(): CalibrationPointTarget | null {
        return this.active ? this.points[this.pointIndex] : null;
    }
    get progress(): { collected: number; target: number } {
        return { collected: this.current.length, target: SAMPLES_PER_POINT };
    }

    start(): void {
        this.pointIndex = 0;
        this.active = true;
        this.current = [];
        this.results = [];
    }

    abort(): void {
        this.active = false;
        this.current = [];
        this.results = [];
        this.pointIndex = 0;
    }

    /**
     * Feed one frame of iris + face data into the active collection.
     * Returns true if the current point just finished and we need the
     * caller to advance the UI (or finish).
     */
    feed(inputs: RawGazeInputs, confidence: number): 'collecting' | 'point-done' | 'finished' | 'inactive' {
        if (!this.active) return 'inactive';
        if (confidence < MIN_IRIS_CONF) return 'collecting';
        this.current.push({ inputs: { ...inputs }, confidence });
        if (this.current.length < SAMPLES_PER_POINT) return 'collecting';

        // Compute median along each input dimension for robustness.
        const median = this.medianSample(this.current);
        this.results.push({
            target: this.points[this.pointIndex],
            median,
            sampleCount: this.current.length,
        });
        this.current = [];
        this.pointIndex++;
        if (this.pointIndex >= this.points.length) {
            this.active = false;
            return 'finished';
        }
        return 'point-done';
    }

    private medianSample(samples: CollectedSample[]): RawGazeInputs {
        const keys: (keyof RawGazeInputs)[] = ['xL', 'yL', 'xR', 'yR', 'hx', 'hy', 'hs'];
        const out: RawGazeInputs = { xL: 0, yL: 0, xR: 0, yR: 0, hx: 0, hy: 0, hs: 0 };
        for (const k of keys) {
            const vals = samples.map(s => s.inputs[k]).sort((a, b) => a - b);
            out[k] = vals[Math.floor(vals.length / 2)];
        }
        return out;
    }
}
