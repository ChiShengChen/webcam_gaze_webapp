/**
 * MediaPipe FaceMesh wrapper — 478 landmarks incl. 10 iris points.
 *
 * Loads the UMD bundle from jsDelivr at runtime instead of using an ESM
 * import, because the @mediapipe/face_mesh package breaks Vite's dep
 * pre-bundling in subtle ways (same class of problem that surfaced as
 * `z2 is not a function` in WebGazer 3.5.3). Loading via <script> gives
 * us the exact pre-built bundle Google ships, with binary assets resolved
 * through the CDN's directory layout.
 */

declare global {
    interface Window {
        FaceMesh?: new (config: { locateFile?: (file: string, prefix?: string) => string }) => FaceMeshInstance;
    }
}

interface NormalizedLandmark {
    x: number; // [0, 1] — normalized to image width
    y: number; // [0, 1]
    z: number; // scaled to width
    visibility?: number;
}

interface FaceMeshResults {
    multiFaceLandmarks?: NormalizedLandmark[][];
    image?: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;
}

interface FaceMeshInstance {
    setOptions(options: {
        maxNumFaces?: number;
        refineLandmarks?: boolean;
        minDetectionConfidence?: number;
        minTrackingConfidence?: number;
    }): void;
    onResults(cb: (results: FaceMeshResults) => void): void;
    send(input: { image: HTMLVideoElement | HTMLCanvasElement }): Promise<void>;
    initialize?(): Promise<void>;
    close(): Promise<void>;
}

const MEDIAPIPE_VERSION = '0.4.1633559619';
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MEDIAPIPE_VERSION}`;

let loadPromise: Promise<void> | null = null;

function loadFaceMeshScript(): Promise<void> {
    if (window.FaceMesh) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${MEDIAPIPE_CDN}/face_mesh.js`;
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load MediaPipe FaceMesh from CDN'));
        document.head.appendChild(s);
    });
    return loadPromise;
}

export interface FaceLandmarks {
    /** Normalized [0,1] landmarks. `length === 478` when refineLandmarks is on. */
    points: { x: number; y: number; z: number }[];
    /** Image-space size we resolved against, for converting back to px. */
    imageWidth: number;
    imageHeight: number;
    /** Monotonic timestamp in ms. */
    timestamp: number;
}

type LandmarkListener = (r: FaceLandmarks) => void;

export class FaceMeshEngine {
    private fm: FaceMeshInstance | null = null;
    private listeners: LandmarkListener[] = [];
    private latestResult: FaceLandmarks | null = null;
    private initPromise: Promise<void> | null = null;

    async init(): Promise<void> {
        if (this.fm) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.doInit();
        return this.initPromise;
    }

    private async doInit(): Promise<void> {
        await loadFaceMeshScript();
        const FaceMeshCtor = window.FaceMesh;
        if (!FaceMeshCtor) throw new Error('window.FaceMesh missing after script load');

        this.fm = new FaceMeshCtor({
            locateFile: (file: string) => `${MEDIAPIPE_CDN}/${file}`,
        });
        this.fm.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });
        this.fm.onResults((results: FaceMeshResults) => {
            const faces = results.multiFaceLandmarks;
            if (!faces || faces.length === 0 || !results.image) return;
            const w = (results.image as HTMLVideoElement).videoWidth
                ?? (results.image as HTMLCanvasElement).width;
            const h = (results.image as HTMLVideoElement).videoHeight
                ?? (results.image as HTMLCanvasElement).height;
            const out: FaceLandmarks = {
                points: faces[0].map(p => ({ x: p.x, y: p.y, z: p.z })),
                imageWidth: w,
                imageHeight: h,
                timestamp: performance.now(),
            };
            this.latestResult = out;
            for (const l of this.listeners) l(out);
        });

        if (this.fm.initialize) await this.fm.initialize();
    }

    async process(video: HTMLVideoElement): Promise<void> {
        if (!this.fm) return;
        await this.fm.send({ image: video });
    }

    onLandmarks(cb: LandmarkListener): void {
        this.listeners.push(cb);
    }

    get latest(): FaceLandmarks | null {
        return this.latestResult;
    }

    async close(): Promise<void> {
        if (!this.fm) return;
        await this.fm.close();
        this.fm = null;
    }
}

/** Canonical landmark indices we care about (refineLandmarks = true). */
export const LM = {
    // Left eye (subject's left = frame right due to mirroring; we treat
    // "left" as the eye on the subject's left anatomically).
    LEFT_EYE_OUTER: 33,
    LEFT_EYE_INNER: 133,
    LEFT_EYE_TOP: 159,
    LEFT_EYE_BOTTOM: 145,
    LEFT_IRIS_CENTER: 468,
    LEFT_IRIS_RIGHT: 469,
    LEFT_IRIS_TOP: 470,
    LEFT_IRIS_LEFT: 471,
    LEFT_IRIS_BOTTOM: 472,

    // Right eye.
    RIGHT_EYE_OUTER: 263,
    RIGHT_EYE_INNER: 362,
    RIGHT_EYE_TOP: 386,
    RIGHT_EYE_BOTTOM: 374,
    RIGHT_IRIS_CENTER: 473,
    RIGHT_IRIS_RIGHT: 474,
    RIGHT_IRIS_TOP: 475,
    RIGHT_IRIS_LEFT: 476,
    RIGHT_IRIS_BOTTOM: 477,

    // Head pose anchors.
    NOSE_TIP: 1,
    CHIN: 152,
    LEFT_MOUTH: 61,
    RIGHT_MOUTH: 291,
    FOREHEAD: 10,
} as const;
