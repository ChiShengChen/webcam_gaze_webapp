/**
 * Online I-VT fixation classifier.
 *
 * Salvucci & Goldberg (2000), "Identifying Fixations and Saccades in
 * Eye-Tracking Protocols" — velocity threshold on instantaneous gaze speed.
 *
 * The canonical threshold is 40°/s. Without a device calibration step we
 * don't know the px→degree conversion for the current display, so the
 * threshold is parameterised in px/s with a reasonable default that works
 * on typical 13–16" laptop screens at arm's length. Callers can tune.
 *
 * Output per sample:
 *   - state: 'FIXATION' | 'SACCADE'
 *   - centroid: running mean (x, y) of the current fixation (null during saccade)
 *
 * A fixation ends the first time velocity exceeds threshold for
 * `saccadeHoldFrames` consecutive samples — a single noisy frame does not
 * break a fixation. Once broken, a new fixation starts accumulating as soon
 * as velocity drops back below threshold.
 */

export type GazeState = 'FIXATION' | 'SACCADE';

export interface IVTConfig {
    /** Velocity threshold in pixels/second. 40°/s at ~60 cm viewing distance
     *  on a 14" laptop ≈ 2000 px/s; we default lower to stay sensitive to
     *  small saccades. Tune per display if needed. */
    velocityThresholdPxPerSec: number;
    /** Consecutive above-threshold frames required to declare a saccade. */
    saccadeHoldFrames: number;
    /** Minimum samples before a fixation centroid is considered stable. */
    minFixationSamples: number;
}

const DEFAULT: IVTConfig = {
    velocityThresholdPxPerSec: 1200,
    saccadeHoldFrames: 2,
    minFixationSamples: 3,
};

export interface IVTResult {
    state: GazeState;
    centroid: { x: number; y: number } | null;
    /** Number of samples in the current fixation (0 if saccade). */
    fixationSamples: number;
}

export class FixationClassifier {
    private readonly cfg: IVTConfig;
    private lastX: number | null = null;
    private lastY: number | null = null;
    private lastT: number | null = null;

    private state: GazeState = 'SACCADE';
    private sumX = 0;
    private sumY = 0;
    private samples = 0;
    private aboveThresholdStreak = 0;

    constructor(cfg: Partial<IVTConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };
    }

    reset(): void {
        this.lastX = this.lastY = this.lastT = null;
        this.state = 'SACCADE';
        this.sumX = this.sumY = 0;
        this.samples = 0;
        this.aboveThresholdStreak = 0;
    }

    /** Feed one sample. Returns current classification. */
    feed(x: number, y: number, timestampSec: number): IVTResult {
        if (this.lastX === null || this.lastT === null) {
            this.lastX = x;
            this.lastY = y;
            this.lastT = timestampSec;
            return this.enterFixation(x, y);
        }

        const dt = Math.max(1e-6, timestampSec - this.lastT);
        const dx = x - this.lastX;
        const dy = y - (this.lastY ?? y);
        const velocity = Math.hypot(dx, dy) / dt;

        this.lastX = x;
        this.lastY = y;
        this.lastT = timestampSec;

        if (velocity > this.cfg.velocityThresholdPxPerSec) {
            this.aboveThresholdStreak++;
            if (this.aboveThresholdStreak >= this.cfg.saccadeHoldFrames) {
                this.state = 'SACCADE';
                this.sumX = this.sumY = 0;
                this.samples = 0;
            }
        } else {
            this.aboveThresholdStreak = 0;
            if (this.state === 'SACCADE') {
                return this.enterFixation(x, y);
            }
            this.sumX += x;
            this.sumY += y;
            this.samples++;
        }

        return this.result();
    }

    private enterFixation(x: number, y: number): IVTResult {
        this.state = 'FIXATION';
        this.sumX = x;
        this.sumY = y;
        this.samples = 1;
        return this.result();
    }

    private result(): IVTResult {
        if (this.state === 'SACCADE' || this.samples < this.cfg.minFixationSamples) {
            return { state: this.state, centroid: null, fixationSamples: this.samples };
        }
        return {
            state: 'FIXATION',
            centroid: { x: this.sumX / this.samples, y: this.sumY / this.samples },
            fixationSamples: this.samples,
        };
    }
}
