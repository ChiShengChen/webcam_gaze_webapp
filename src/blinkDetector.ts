/**
 * Blink detection using eye patch pixel analysis.
 *
 * Instead of EAR (which doesn't work well with FaceMesh),
 * we analyze the raw eye patch images that WebGazer extracts each frame.
 *
 * Open eyes → high contrast pixels (pupil, iris, sclera) → high variance
 * Closed eyes → uniform eyelid skin → low variance
 *
 * Uses adaptive threshold: blink = variance drops below baseline * ratio.
 */

const VARIANCE_DROP_RATIO = 0.75;    // Blink when variance < baseline * ratio (~25% drop)
const BASELINE_WINDOW = 30;          // Frames for running baseline
const BLINK_MIN_FRAMES = 1;          // Min consecutive low-variance frames
const BLINK_MAX_FRAMES = 15;         // Max frames (longer = intentional close)
const BLINK_COOLDOWN_MS = 400;       // Cooldown between blinks

export type BlinkCallback = (gazeX: number, gazeY: number) => void;

/** Compute grayscale pixel variance of an ImageData patch */
function patchVariance(patch: ImageData): number {
    const data = patch.data; // RGBA
    const len = data.length / 4;
    if (len === 0) return 0;

    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
        // Grayscale: 0.299R + 0.587G + 0.114B
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += gray;
    }
    const mean = sum / len;

    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const diff = gray - mean;
        variance += diff * diff;
    }
    return variance / len;
}

export class BlinkDetector {
    private closedFrames = 0;
    private lastBlinkTime = 0;
    private callbacks: BlinkCallback[] = [];
    private enabled = false;
    private lastGazeX = 0;
    private lastGazeY = 0;

    // Adaptive baseline
    private varianceHistory: number[] = [];
    private baseline = 0;
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
        if (this.enabled) return;
        this.enabled = true;
        this.varianceHistory = [];
        this.baseline = 0;
    }

    stop(): void {
        this.enabled = false;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Called from gaze listener with eye patch data each frame.
     * No more rAF polling — we process exactly when WebGazer has new data.
     */
    processEyePatches(leftPatch: ImageData | null, rightPatch: ImageData | null): void {
        if (!this.enabled || !leftPatch || !rightPatch) return;

        const varL = patchVariance(leftPatch);
        const varR = patchVariance(rightPatch);
        const avgVar = (varL + varR) / 2;

        const threshold = this.baseline * VARIANCE_DROP_RATIO;
        const isClosed = this.baseline > 0 && avgVar < threshold;

        if (isClosed) {
            this.closedFrames++;
        } else {
            // Eyes open — update baseline
            this.updateBaseline(avgVar);

            // Check if just finished a valid blink
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
    }

    private updateBaseline(variance: number): void {
        this.varianceHistory.push(variance);
        if (this.varianceHistory.length > BASELINE_WINDOW) {
            this.varianceHistory.shift();
        }
        const sorted = [...this.varianceHistory].sort((a, b) => a - b);
        this.baseline = sorted[Math.floor(sorted.length / 2)];
    }

    private emitBlink(): void {
        for (const cb of this.callbacks) {
            cb(this.lastGazeX, this.lastGazeY);
        }
    }
}
