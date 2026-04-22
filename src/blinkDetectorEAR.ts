/**
 * EAR-based blink detection for FaceMesh mode.
 *
 * Symmetric counterpart to src/blinkDetector.ts (which consumes WebGazer's
 * eye-patch variance). Here we consume the Eye Aspect Ratio from
 * MediaPipe FaceMesh landmarks — the canonical blink signal in the gaze
 * literature and strictly better than pixel variance because it is:
 *
 *   1. Scale-invariant (EAR normalises by eye width, so distance changes
 *      don't affect the threshold)
 *   2. Illumination-invariant (geometric ratio, not pixel intensity)
 *   3. Higher contrast between open and closed states (EAR ~0.28 → ~0.08)
 *
 * Public surface matches BlinkDetector so the calling code can pick one
 * without the rest of the app caring which it is.
 */

const EAR_CLOSED_THRESHOLD = 0.18;   // EAR below this suggests closed eye
const BLINK_MIN_FRAMES = 1;          // min consecutive closed frames
const BLINK_MAX_FRAMES = 15;         // max before treated as intentional
const BLINK_COOLDOWN_MS = 400;

export type BlinkCallback = (gazeX: number, gazeY: number) => void;

export class BlinkDetectorEAR {
    private closedFrames = 0;
    private lastBlinkTime = 0;
    private callbacks: BlinkCallback[] = [];
    private enabled = false;
    private lastGazeX = 0;
    private lastGazeY = 0;

    onBlink(cb: BlinkCallback): void {
        this.callbacks.push(cb);
    }

    offBlink(cb: BlinkCallback): void {
        this.callbacks = this.callbacks.filter(c => c !== cb);
    }

    updateGaze(x: number, y: number): void {
        this.lastGazeX = x;
        this.lastGazeY = y;
    }

    start(): void {
        this.enabled = true;
        this.closedFrames = 0;
    }

    stop(): void {
        this.enabled = false;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** Feed one frame's left/right eye aspect ratios from FaceMesh. */
    processEAR(leftEAR: number, rightEAR: number): void {
        if (!this.enabled) return;

        const meanEAR = (leftEAR + rightEAR) / 2;
        const isClosed = meanEAR < EAR_CLOSED_THRESHOLD;

        if (isClosed) {
            this.closedFrames++;
            return;
        }

        // Eye just reopened — check if the closed run was a valid blink.
        if (
            this.closedFrames >= BLINK_MIN_FRAMES &&
            this.closedFrames <= BLINK_MAX_FRAMES
        ) {
            const now = Date.now();
            if (now - this.lastBlinkTime > BLINK_COOLDOWN_MS) {
                this.lastBlinkTime = now;
                this.emitBlink();
            }
        }
        this.closedFrames = 0;
    }

    private emitBlink(): void {
        for (const cb of this.callbacks) {
            cb(this.lastGazeX, this.lastGazeY);
        }
    }
}
