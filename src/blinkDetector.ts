import webgazer from 'webgazer';

/**
 * Blink detection using Eye Aspect Ratio (EAR) from MediaPipe FaceMesh landmarks.
 *
 * EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
 *
 * MediaPipe FaceMesh eye landmarks used:
 *   Right eye: 33(outer), 160(upper1), 158(upper2), 133(inner), 153(lower2), 144(lower1)
 *   Left eye:  362(outer), 385(upper1), 387(upper2), 263(inner), 373(lower2), 380(lower1)
 */

// FaceMesh landmark indices for EAR calculation
const RIGHT_EYE = { p1: 33, p2: 160, p3: 158, p4: 133, p5: 153, p6: 144 };
const LEFT_EYE  = { p1: 362, p2: 385, p3: 387, p4: 263, p5: 373, p6: 380 };

const EAR_THRESHOLD = 0.2;           // Below this = eye closed
const BLINK_MIN_FRAMES = 2;          // Minimum consecutive closed frames to count as blink
const BLINK_MAX_FRAMES = 10;         // Maximum frames — longer = intentional close, not blink
const BLINK_COOLDOWN_MS = 400;       // Ignore blinks within this window after last blink

export type BlinkCallback = (gazeX: number, gazeY: number) => void;

function dist(a: number[], b: number[]): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function computeEAR(positions: number[][], eye: typeof RIGHT_EYE): number {
    const p1 = positions[eye.p1];
    const p2 = positions[eye.p2];
    const p3 = positions[eye.p3];
    const p4 = positions[eye.p4];
    const p5 = positions[eye.p5];
    const p6 = positions[eye.p6];
    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 1;

    const vertical1 = dist(p2, p6);
    const vertical2 = dist(p3, p5);
    const horizontal = dist(p1, p4);
    if (horizontal === 0) return 1;

    return (vertical1 + vertical2) / (2 * horizontal);
}

export class BlinkDetector {
    private closedFrames = 0;
    private lastBlinkTime = 0;
    private callbacks: BlinkCallback[] = [];
    private enabled = false;
    private pollTimer: number | null = null;
    private lastGazeX = 0;
    private lastGazeY = 0;

    /** Register a blink callback */
    onBlink(cb: BlinkCallback): void {
        this.callbacks.push(cb);
    }

    /** Remove a specific callback */
    offBlink(cb: BlinkCallback): void {
        this.callbacks = this.callbacks.filter(c => c !== cb);
    }

    /** Update latest gaze position (called from gaze listener) */
    updateGaze(x: number, y: number): void {
        this.lastGazeX = x;
        this.lastGazeY = y;
    }

    /** Start polling for blinks */
    start(): void {
        if (this.enabled) return;
        this.enabled = true;
        this.poll();
    }

    /** Stop polling */
    stop(): void {
        this.enabled = false;
        if (this.pollTimer !== null) {
            cancelAnimationFrame(this.pollTimer);
            this.pollTimer = null;
        }
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    private poll = (): void => {
        if (!this.enabled) return;

        try {
            const tracker = (webgazer as any).getTracker();
            if (tracker) {
                const positions: number[][] | null = tracker.getPositions();
                if (positions && positions.length >= 468) {
                    this.processFrame(positions);
                }
            }
        } catch {
            // tracker not ready yet
        }

        this.pollTimer = requestAnimationFrame(this.poll);
    };

    private processFrame(positions: number[][]): void {
        const earLeft = computeEAR(positions, LEFT_EYE);
        const earRight = computeEAR(positions, RIGHT_EYE);
        const ear = (earLeft + earRight) / 2;

        if (ear < EAR_THRESHOLD) {
            this.closedFrames++;
        } else {
            // Eyes just opened — check if it was a valid blink
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

    private emitBlink(): void {
        for (const cb of this.callbacks) {
            cb(this.lastGazeX, this.lastGazeY);
        }
    }
}
