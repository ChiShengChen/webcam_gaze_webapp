/**
 * Frame-by-frame driver that fires exactly once per new video frame.
 *
 * Why not requestAnimationFrame: rAF runs at the display refresh rate (60+ Hz)
 * regardless of the camera. A 30 fps camera would be polled twice per frame,
 * wasting CPU and producing duplicate captures. requestVideoFrameCallback
 * (https://wicg.github.io/video-rvfc/) fires on each newly decoded video
 * frame, so we process each frame exactly once.
 */

export interface FrameTick {
    /** Monotonic time the frame was captured, ms. */
    captureTime: number;
    /** Media time within the video (for videos/recordings). */
    mediaTime: number;
    /** Monotonic sequence index. */
    frameIndex: number;
}

export type FrameHandler = (tick: FrameTick) => void | Promise<void>;

// requestVideoFrameCallback is not in lib.dom.d.ts yet in all TS versions.
interface VideoFrameCallbackMetadata {
    presentationTime: number;
    expectedDisplayTime: number;
    width: number;
    height: number;
    mediaTime: number;
    presentedFrames: number;
}
interface VideoFrameCapableElement extends HTMLVideoElement {
    requestVideoFrameCallback(
        callback: (now: number, metadata: VideoFrameCallbackMetadata) => void
    ): number;
    cancelVideoFrameCallback(handle: number): void;
}

export class FrameLoop {
    private running = false;
    private handle: number | null = null;
    private frameIndex = 0;

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly onFrame: FrameHandler
    ) {}

    start(): void {
        if (this.running) return;
        const v = this.video as VideoFrameCapableElement;
        if (typeof v.requestVideoFrameCallback !== 'function') {
            throw new Error(
                'requestVideoFrameCallback not supported in this browser'
            );
        }
        this.running = true;
        this.frameIndex = 0;
        this.scheduleNext();
    }

    stop(): void {
        this.running = false;
        if (this.handle !== null) {
            const v = this.video as VideoFrameCapableElement;
            v.cancelVideoFrameCallback(this.handle);
            this.handle = null;
        }
    }

    private scheduleNext(): void {
        if (!this.running) return;
        const v = this.video as VideoFrameCapableElement;
        this.handle = v.requestVideoFrameCallback((_now, metadata) => {
            if (!this.running) return;
            const tick: FrameTick = {
                captureTime: metadata.presentationTime,
                mediaTime: metadata.mediaTime,
                frameIndex: this.frameIndex++,
            };
            // Fire-and-forget: a slow handler must not stall frame capture.
            Promise.resolve(this.onFrame(tick)).catch((err) =>
                console.error('[FrameLoop] handler error:', err)
            );
            this.scheduleNext();
        });
    }
}
