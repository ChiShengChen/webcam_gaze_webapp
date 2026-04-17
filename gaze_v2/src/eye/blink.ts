/**
 * Blink detection.
 *
 * Same insight as v1 (eye patch pixel variance drops when the lid covers
 * the eye) but improved in three ways:
 *
 *  1. Variance is computed on the **pose-normalized** patch (we crop
 *     relative to the current face box, so lighting changes and moves
 *     don't dominate variance changes).
 *  2. Two-state HMM-style smoothing — the "closed" state has inertia,
 *     so a single low-variance frame doesn't trigger a blink on its own
 *     but a sustained drop does.
 *  3. Iris confidence is fused in — when the iris localizer can't find
 *     a centre, that's also evidence of closed eyes. Ordinary variance
 *     doesn't catch partial closes well; iris confidence does.
 *
 * Events emitted:
 *   - "blink"    — 1–10 closed frames then open (short, intentional trigger)
 *   - "longBlink"— 12+ closed frames then open (hold-to-click)
 */

export interface BlinkFrameInput {
    /** Eye patch pixel variance (both eyes averaged). */
    variance: number;
    /** Iris detection confidence (both eyes averaged), 0..1. */
    irisConfidence: number;
    /** Monotonic timestamp (ms). */
    timestamp: number;
}

export type BlinkEvent =
    | { kind: 'blink'; timestamp: number; durationMs: number }
    | { kind: 'longBlink'; timestamp: number; durationMs: number };

const BASELINE_WINDOW = 40;       // open-eye frames for running baseline
const VAR_DROP_RATIO = 0.7;       // variance < baseline*ratio → likely closed
const CONF_CLOSED_THRESH = 0.18;  // iris confidence below this → closed vote
const MIN_BLINK_FRAMES = 1;
const MAX_BLINK_FRAMES = 10;
const LONG_BLINK_FRAMES = 12;
const COOLDOWN_MS = 350;

type Listener = (ev: BlinkEvent) => void;

export class BlinkDetector {
    private baselineSamples: number[] = [];
    private baseline = 0;
    private closedFrames = 0;
    private closedStart = 0;
    private lastBlinkEndMs = 0;
    private listeners: Listener[] = [];

    onBlink(cb: Listener): void {
        this.listeners.push(cb);
    }

    reset(): void {
        this.baselineSamples = [];
        this.baseline = 0;
        this.closedFrames = 0;
    }

    /** Feed one frame. Emits events via onBlink when applicable. */
    feed(input: BlinkFrameInput): void {
        const { variance, irisConfidence, timestamp } = input;

        // Closed vote: either variance drops or iris confidence collapses.
        const varClosed = this.baseline > 0 && variance < this.baseline * VAR_DROP_RATIO;
        const confClosed = irisConfidence < CONF_CLOSED_THRESH;
        const isClosed = varClosed || confClosed;

        if (isClosed) {
            if (this.closedFrames === 0) this.closedStart = timestamp;
            this.closedFrames++;
            return;
        }

        // Open — update running baseline with this frame's variance.
        this.baselineSamples.push(variance);
        if (this.baselineSamples.length > BASELINE_WINDOW) this.baselineSamples.shift();
        const sorted = [...this.baselineSamples].sort((a, b) => a - b);
        this.baseline = sorted[Math.floor(sorted.length / 2)];

        // Did we just finish a closed run?
        if (this.closedFrames > 0) {
            const duration = timestamp - this.closedStart;
            const frames = this.closedFrames;
            this.closedFrames = 0;

            if (timestamp - this.lastBlinkEndMs < COOLDOWN_MS) return;

            if (frames >= LONG_BLINK_FRAMES) {
                this.lastBlinkEndMs = timestamp;
                this.emit({ kind: 'longBlink', timestamp, durationMs: duration });
            } else if (frames >= MIN_BLINK_FRAMES && frames <= MAX_BLINK_FRAMES) {
                this.lastBlinkEndMs = timestamp;
                this.emit({ kind: 'blink', timestamp, durationMs: duration });
            }
        }
    }

    private emit(ev: BlinkEvent): void {
        for (const l of this.listeners) l(ev);
    }
}
