/**
 * FaceMeshGazeEngine — drop-in replacement for the WebGazer pipeline.
 *
 * Owns: camera (getUserMedia), MediaPipe FaceMesh inference loop, per-
 * frame feature extraction, calibration sample buffer, and a KRR gaze
 * predictor. Emits gaze estimates via `onGaze(cb)`; the main thread feeds
 * those into the shared GazeController exactly like WebGazer's output.
 *
 * Calibration API mirrors WebGazer's `recordScreenPosition(x, y)`:
 * the host UI captures a click, this engine stashes the latest feature
 * vector against the click coordinates, and once enough samples are in,
 * `refit()` fits the KRR model.
 */

import { FaceMeshEngine } from './landmarks';
import { extractFeatures, type Features } from './features';
import { GazeKRR } from './regression';

export interface EngineConfig {
    videoWidth: number;
    videoHeight: number;
    /** Minimum calibration samples before we attempt to fit. */
    minSamples: number;
    /** Ridge regularisation strength. */
    lambda: number;
}

const DEFAULT: EngineConfig = {
    videoWidth: 640,
    videoHeight: 480,
    minSamples: 20,
    // λ=1e-3 under-regularised dense pursuit samples so badly that α
    // blew up and predictions flew off-screen. λ=1e-1 suppressed the
    // blow-up but over-shrank α so every prediction collapsed toward
    // the (now centred) target mean. With standardisation + std
    // flooring + target centring in GazeKRR, ill-conditioning is
    // handled at the preprocessing layer and λ can stay small.
    lambda: 1e-3,
};

const BLINK_EAR_THRESHOLD = 0.15;

type GazeListener = (x: number, y: number) => void;
type FrameListener = (features: Features, timestamp: number) => void;

interface CalibSample {
    features: number[];
    target: { x: number; y: number };
}

export class FaceMeshGazeEngine {
    private readonly cfg: EngineConfig;
    private readonly fm = new FaceMeshEngine();
    private readonly krr = new GazeKRR();

    private video: HTMLVideoElement | null = null;
    private stream: MediaStream | null = null;

    private running = false;
    private lastFeatures: number[] | null = null;
    private calibSamples: CalibSample[] = [];
    private gazeListeners: GazeListener[] = [];
    private frameListeners: FrameListener[] = [];
    private loopHandle: number | null = null;

    constructor(cfg: Partial<EngineConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };

        this.fm.onLandmarks((r) => {
            const feats = extractFeatures(r);
            if (!feats) return;
            this.lastFeatures = feats.vector;
            for (const l of this.frameListeners) l(feats, r.timestamp);
            if (this.krr.isFitted) {
                const p = this.krr.predict(feats.vector);
                for (const l of this.gazeListeners) l(p.x, p.y);
            }
        });
    }

    /** Open camera and start the FaceMesh loop. */
    async begin(): Promise<void> {
        if (this.running) return;

        this.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: this.cfg.videoWidth },
                height: { ideal: this.cfg.videoHeight },
                facingMode: 'user',
            },
            audio: false,
        });

        this.video = document.createElement('video');
        this.video.playsInline = true;
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.srcObject = this.stream;
        // Keep it out of flow but still rendered so the browser decodes frames.
        Object.assign(this.video.style, {
            position: 'fixed', left: '-9999px', top: '0',
            width: '320px', height: '180px', pointerEvents: 'none',
        });
        document.body.appendChild(this.video);

        await new Promise<void>((resolve, reject) => {
            if (!this.video) return reject(new Error('no video element'));
            const ok = () => resolve();
            const fail = () => reject(new Error('video play failed'));
            this.video.onloadedmetadata = ok;
            this.video.onerror = fail;
            this.video.play().catch(fail);
        });

        await this.fm.init();
        this.running = true;
        this.loop();
    }

    stop(): void {
        this.running = false;
        if (this.loopHandle !== null) {
            if ('cancelVideoFrameCallback' in HTMLVideoElement.prototype && this.video) {
                (this.video as HTMLVideoElement & {
                    cancelVideoFrameCallback: (h: number) => void;
                }).cancelVideoFrameCallback(this.loopHandle);
            } else {
                cancelAnimationFrame(this.loopHandle);
            }
            this.loopHandle = null;
        }
        if (this.stream) {
            for (const t of this.stream.getTracks()) t.stop();
            this.stream = null;
        }
        if (this.video) {
            this.video.remove();
            this.video = null;
        }
        void this.fm.close();
    }

    /** Register a gaze-prediction listener. Called per processed frame
     *  after the KRR is fitted. */
    onGaze(cb: GazeListener): void {
        this.gazeListeners.push(cb);
    }

    /** Register a per-frame features listener. Fires for every FaceMesh
     *  result regardless of calibration state — useful for blink
     *  detection (EAR is ready long before the KRR is fitted) and for
     *  quality gates during calibration. */
    onFrame(cb: FrameListener): void {
        this.frameListeners.push(cb);
    }

    /** Attach the live camera stream to an external preview element.
     *  Needed because the engine's own <video> is hidden. */
    attachPreview(el: HTMLVideoElement): void {
        if (!this.stream) return;
        el.srcObject = this.stream;
        el.play().catch(() => { /* preview failures are non-fatal */ });
    }

    /** Expose the internal video element so quality-check code (e.g.
     *  the positioning coach) can sample pixels for lighting analysis
     *  without having to open its own getUserMedia stream. */
    get videoElement(): HTMLVideoElement | null {
        return this.video;
    }

    /** Record a calibration sample against the user's latest fixation
     *  (i.e. against whatever FaceMesh feature vector we have from the
     *  most recent frame). Returns false and silently skips if
     *  features aren't ready or the eye aspect ratio suggests a blink —
     *  those samples would teach the model that "eyes closed → look
     *  here", which is worse than no sample at all. */
    recordSample(screenX: number, screenY: number): boolean {
        if (!this.lastFeatures) return false;
        // Feature indices 4 and 5 are left/right eye aspect ratio; ~0.15
        // is a standard blink threshold. Skip the sample if either eye
        // is closed far enough that the iris signal is unreliable.
        const earL = this.lastFeatures[4];
        const earR = this.lastFeatures[5];
        if (earL < BLINK_EAR_THRESHOLD || earR < BLINK_EAR_THRESHOLD) return false;
        this.calibSamples.push({
            features: this.lastFeatures.slice(),
            target: { x: screenX, y: screenY },
        });
        return true;
    }

    /** Fit / refit the KRR from all accumulated calibration samples. */
    refit(): boolean {
        if (this.calibSamples.length < this.cfg.minSamples) return false;
        const X = this.calibSamples.map(s => s.features);
        const targets = this.calibSamples.map(s => s.target);
        this.krr.fit(X, targets, this.cfg.lambda);
        return true;
    }

    async clearData(): Promise<void> {
        this.calibSamples = [];
        // Re-create KRR to drop fitted state. Easier than adding a reset().
        (this as unknown as { krr: GazeKRR }).krr = new GazeKRR();
    }

    get isCalibrated(): boolean {
        return this.krr.isFitted;
    }

    get sampleCount(): number {
        return this.calibSamples.length;
    }

    get stats(): { gamma: number; support: number; samples: number } {
        const s = this.krr.isFitted ? this.krr.stats : { gamma: 0, support: 0 };
        return { ...s, samples: this.calibSamples.length };
    }

    /** Last KRR fit's diagnostic dump — shown in the benchmark summary so
     *  the user can see per-feature std / gamma / lambda without
     *  opening DevTools. Empty string if never fitted. */
    get fitDiagnostics(): string {
        return this.krr.isFitted ? this.krr.diagnostics : '';
    }

    // --- Internals ---

    private loop = (): void => {
        if (!this.running || !this.video) return;
        void this.fm.process(this.video);
        // requestVideoFrameCallback is ideal (runs exactly once per decoded
        // frame, skips duplicates), but is unavailable on older Safari. Fall
        // back to rAF there.
        const rVFC = (this.video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
        }).requestVideoFrameCallback;
        if (rVFC) {
            this.loopHandle = rVFC.call(this.video, () => this.loop());
        } else {
            this.loopHandle = requestAnimationFrame(() => this.loop());
        }
    };
}
