/**
 * Pipeline worker — owns the full CV pipeline and the gaze model.
 *
 * Per frame:
 *   bitmap → RGBA → grayscale → face detect/track → eye ROI → iris → features
 *   → gaze model → One-Euro filter → post result
 *
 * Also:
 *   - Runs the 9-point calibration state machine
 *   - Runs auto-correction (click, hover-dwell) and feeds the model
 *   - Runs blink detection (short = click signal, long = UI click)
 *   - Draws debug overlay onto the (small) OffscreenCanvas
 */

import { rgbaToGray, grayVariance, type GrayImage, createGray } from '../cv/image';
import { bootstrapFace, type FaceBox } from '../face/skinBootstrap';
import { FaceTracker } from '../face/tracker';
import { extractEyes } from '../eye/roi';
import { locateIris, DEFAULT_IRIS_CONFIG, type IrisResult, type IrisConfig } from '../eye/iris';
import { BlinkDetector, type BlinkEvent } from '../eye/blink';
import { SessionEyeProfile } from '../eye/sessionProfile';
import { Calibration } from '../gaze/calibration';
import { GazeModel } from '../gaze/model';
import { AutoCorrector } from '../gaze/autoCorrect';
import type { RawGazeInputs } from '../gaze/features';
import { OneEuroFilter2D } from '../filter/oneEuro';
import type {
    InMessage,
    OutMessage,
    FrameStatusMsg,
    CalibrationStatusMsg,
    HeadDistance,
} from '../protocol';

// Head distance thresholds (face width / frame width).
// Derived empirically for a ~14" laptop webcam at arm's length.
const FACE_SCALE_TOO_CLOSE = 0.52;  // >52% of frame = too close
const FACE_SCALE_TOO_FAR = 0.18;    // <18% of frame = too far
// Off-centre: face centre too far from frame centre (axis fractions).
const OFFCENTER_X = 0.32;  // distance from 0.5 on x-axis
const OFFCENTER_Y = 0.28;  // distance from 0.5 on y-axis

function classifyHeadDistance(
    face: { x: number; y: number; width: number; height: number } | null,
    frameW: number,
    frameH: number
): { state: HeadDistance; scale: number } {
    if (!face) return { state: 'noFace', scale: 0 };
    const scale = face.width / frameW;
    if (scale > FACE_SCALE_TOO_CLOSE) return { state: 'tooClose', scale };
    if (scale < FACE_SCALE_TOO_FAR) return { state: 'tooFar', scale };
    const cxNorm = (face.x + face.width / 2) / frameW;
    const cyNorm = (face.y + face.height / 2) / frameH;
    if (Math.abs(cxNorm - 0.5) > OFFCENTER_X || Math.abs(cyNorm - 0.5) > OFFCENTER_Y) {
        return { state: 'offCenter', scale };
    }
    return { state: 'ok', scale };
}

// ---------- state ----------
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let canvasW = 0;
let canvasH = 0;
let screenW = 1280;
let screenH = 720;

let grayBuf: GrayImage | null = null;
let rgbaBuf: Uint8ClampedArray | null = null;
let processBuf: OffscreenCanvas | null = null;
let processCtx: OffscreenCanvasRenderingContext2D | null = null;

const tracker = new FaceTracker();
const calibration = new Calibration();
let gazeModel: GazeModel | null = null;
const autoCorrector = new AutoCorrector();
const blinkDetector = new BlinkDetector();
const gazeFilter = new OneEuroFilter2D({ minCutoff: 1.0, beta: 0.05 });
const eyeProfile = new SessionEyeProfile();
const irisConfig: IrisConfig = { ...DEFAULT_IRIS_CONFIG };
let lastProfilePost = 0;
const PROFILE_POST_INTERVAL_MS = 500;

let calibrationTarget: { x: number; y: number } | null = null;
let lastRawInputs: RawGazeInputs | null = null;
let lastIrisConfidence = 0;
let framesSinceBootstrap = 0;

// stats
let processed = 0;
let dropped = 0;
let windowStart = 0;
let windowFrames = 0;
let latencySum = 0;
let busy = false;
const STATS_INTERVAL_MS = 500;

function post(msg: OutMessage): void {
    (self as unknown as Worker).postMessage(msg);
}

// Auto-correction → model feedback.
autoCorrector.onCorrection((ev) => {
    if (!gazeModel) return;
    gazeModel.addCorrection(ev.inputs, ev.screenX, ev.screenY);
});

// Blink → post event.
blinkDetector.onBlink((ev: BlinkEvent) => {
    post({ type: 'blinkEvent', kind: ev.kind, durationMs: ev.durationMs });
});

// ---------- frame handling ----------

function ensureBuffers(w: number, h: number): void {
    if (!grayBuf || grayBuf.width !== w || grayBuf.height !== h) {
        grayBuf = createGray(w, h);
    }
    if (!processBuf || processBuf.width !== w || processBuf.height !== h) {
        processBuf = new OffscreenCanvas(w, h);
        processCtx = processBuf.getContext('2d', { willReadFrequently: true });
    }
    if (!rgbaBuf || rgbaBuf.length !== w * h * 4) {
        rgbaBuf = new Uint8ClampedArray(w * h * 4);
    }
    if (!ctx) return;
    if (canvasW !== w || canvasH !== h) {
        ctx.canvas.width = w;
        ctx.canvas.height = h;
        canvasW = w;
        canvasH = h;
    }
}

function buildInputs(face: FaceBox, frameW: number, frameH: number, irisL: IrisResult, irisR: IrisResult, pw: number, ph: number): RawGazeInputs {
    return {
        xL: irisL.x / pw,
        yL: irisL.y / ph,
        xR: irisR.x / pw,
        yR: irisR.y / ph,
        hx: (face.x + face.width / 2) / frameW,
        hy: (face.y + face.height / 2) / frameH,
        hs: face.width / frameW,
    };
}

function handleFrame(bitmap: ImageBitmap, captureTime: number): void {
    if (!ctx || !processCtx) {
        bitmap.close();
        return;
    }
    if (busy) {
        dropped++;
        bitmap.close();
        return;
    }
    busy = true;
    const frameStart = performance.now();

    const w = bitmap.width;
    const h = bitmap.height;
    ensureBuffers(w, h);

    // Grab pixel data via offscreen processing canvas (we don't want to
    // getImageData from the display canvas — that'd block other drawing).
    processCtx!.drawImage(bitmap, 0, 0);
    const imageData = processCtx!.getImageData(0, 0, w, h);
    const gray = rgbaToGray(imageData.data, w, h, grayBuf!);

    // ---------- face ----------
    let face: FaceBox | null = tracker.update(gray);
    if (!face) {
        framesSinceBootstrap++;
        // Don't try to bootstrap every single frame — it's expensive and we
        // want the previous state to stabilize. Retry roughly every 5 frames.
        if (framesSinceBootstrap >= 3) {
            framesSinceBootstrap = 0;
            const boxCandidate = bootstrapFace(imageData.data, w, h);
            if (boxCandidate) {
                tracker.initialize(gray, boxCandidate);
                face = boxCandidate;
            }
        }
    } else {
        framesSinceBootstrap = 0;
    }

    // ---------- draw background ----------
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    let irisConfidence = 0;
    let prediction: { x: number; y: number } | null = null;
    let filtered: { x: number; y: number } | null = null;
    let correctionEventKind: 'click' | 'hoverDwell' | null = null;

    if (face) {
        // Draw face box.
        ctx.lineWidth = 2;
        ctx.strokeStyle = tracker.isLocked ? '#4cf' : '#fa4';
        ctx.strokeRect(face.x, face.y, face.width, face.height);

        // ---------- eyes + iris (multi-scale, profile-guided) ----------
        const eyes = extractEyes(gray, face);
        // Feed the learned best-ratio as a preferred starting point; iris
        // locator will early-exit once that score is strong enough.
        irisConfig.preferredIndex =
            eyeProfile.snapshot.preferredRatioIndex >= 0
                ? eyeProfile.snapshot.preferredRatioIndex
                : undefined;
        const irisL = locateIris(eyes.left, irisConfig);
        const irisR = locateIris(eyes.right, irisConfig);
        irisConfidence = (irisL.confidence + irisR.confidence) / 2;
        lastIrisConfidence = irisConfidence;

        // Update per-session eye profile with this frame's measurements.
        const avgVariance = (grayVariance(eyes.left) + grayVariance(eyes.right)) / 2;
        // IPD = distance between the two iris centres in frame pixels.
        const leftIrisFrameX = eyes.leftOrigin.x + irisL.x;
        const leftIrisFrameY = eyes.leftOrigin.y + irisL.y;
        const rightIrisFrameX = eyes.rightOrigin.x + irisR.x;
        const rightIrisFrameY = eyes.rightOrigin.y + irisR.y;
        const ipdPx = Math.hypot(
            leftIrisFrameX - rightIrisFrameX,
            leftIrisFrameY - rightIrisFrameY
        );
        eyeProfile.update(
            irisL.ratioIndex,
            irisR.ratioIndex,
            irisConfidence,
            avgVariance,
            ipdPx
        );

        // Draw eye patch boxes + iris crosshairs.
        ctx.strokeStyle = '#4f4';
        ctx.strokeRect(eyes.leftOrigin.x, eyes.leftOrigin.y, eyes.left.width, eyes.left.height);
        ctx.strokeRect(eyes.rightOrigin.x, eyes.rightOrigin.y, eyes.right.width, eyes.right.height);

        drawCross(ctx, eyes.leftOrigin.x + irisL.x, eyes.leftOrigin.y + irisL.y, 6, irisL.confidence > 0.25 ? '#ff0' : '#888');
        drawCross(ctx, eyes.rightOrigin.x + irisR.x, eyes.rightOrigin.y + irisR.y, 6, irisR.confidence > 0.25 ? '#ff0' : '#888');

        // ---------- gaze inputs ----------
        const inputs = buildInputs(face, w, h, irisL, irisR, eyes.left.width, eyes.left.height);
        lastRawInputs = inputs;

        // ---------- calibration collection ----------
        if (calibration.isActive && calibrationTarget) {
            const res = calibration.feed(inputs, irisConfidence);
            if (res === 'point-done' || res === 'finished') {
                // Store the most recent finished point with its target.
                const finishedResult = calibration.results[calibration.results.length - 1];
                if (finishedResult && gazeModel) {
                    gazeModel.addCalibration(
                        finishedResult.median,
                        calibrationTarget.x,
                        calibrationTarget.y
                    );
                }
                if (res === 'finished') {
                    gazeModel?.refitAll();
                    post({
                        type: 'calibrationStatus',
                        active: false,
                        pointIndex: calibration.points.length,
                        totalPoints: calibration.points.length,
                        pointProgress: calibration.points.length,
                        pointTarget: calibration.points.length,
                        justFinished: true,
                    } as CalibrationStatusMsg);
                } else {
                    post({
                        type: 'calibrationStatus',
                        active: true,
                        pointIndex: calibration.currentIndex,
                        totalPoints: calibration.points.length,
                        pointProgress: 0,
                        pointTarget: 25,
                        justFinished: false,
                    } as CalibrationStatusMsg);
                }
                calibrationTarget = null;
            } else {
                post({
                    type: 'calibrationStatus',
                    active: true,
                    pointIndex: calibration.currentIndex,
                    totalPoints: calibration.points.length,
                    pointProgress: calibration.progress.collected,
                    pointTarget: calibration.progress.target,
                    justFinished: false,
                } as CalibrationStatusMsg);
            }
        }

        // ---------- prediction ----------
        if (gazeModel && gazeModel.isCalibrated) {
            prediction = gazeModel.predict(inputs);
            if (prediction) {
                const tsec = frameStart / 1000;
                filtered = gazeFilter.filter(prediction.x, prediction.y, tsec);
            }
        }

        // ---------- auto-correct frame push ----------
        autoCorrector.pushFrame({
            inputs,
            confidence: irisConfidence,
            prediction: filtered,
            timestamp: frameStart,
        });

        // ---------- blink (reuses variance computed for profile) ----------
        blinkDetector.feed({
            variance: avgVariance,
            irisConfidence,
            timestamp: frameStart,
        });
    }

    // Periodically post the session eye profile snapshot.
    if (frameStart - lastProfilePost > PROFILE_POST_INTERVAL_MS) {
        const snap = eyeProfile.snapshot;
        post({
            type: 'sessionProfile',
            samples: snap.samples,
            preferredRatioLabel: snap.preferredRatioLabel,
            medianVariance: snap.medianVariance,
            medianIpd: snap.medianIpd,
            smoothedConfidence: snap.smoothedConfidence,
            isWarm: snap.isWarm,
        });
        lastProfilePost = frameStart;
    }

    // Emit frame status + head distance classification.
    const hd = classifyHeadDistance(face, w, h);
    const status: FrameStatusMsg = {
        type: 'frameStatus',
        hasFace: !!face,
        faceBox: face ? { x: face.x, y: face.y, width: face.width, height: face.height } : null,
        irisConfidence,
        prediction,
        filtered,
        correctionEvent: correctionEventKind,
        faceScale: hd.scale,
        headDistance: hd.state,
    };
    post(status);

    // ---------- stats ----------
    processed++;
    windowFrames++;
    const now = performance.now();
    latencySum += now - captureTime;
    if (windowStart === 0) windowStart = now;
    const elapsed = now - windowStart;
    if (elapsed >= STATS_INTERVAL_MS) {
        post({
            type: 'stats',
            pipelineFps: (windowFrames * 1000) / elapsed,
            processedFrames: processed,
            droppedFrames: dropped,
            latencyMs: latencySum / windowFrames,
        });
        windowStart = now;
        windowFrames = 0;
        latencySum = 0;
    }

    busy = false;
}

function drawCross(
    c: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string
): void {
    c.strokeStyle = color;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x - size, y);
    c.lineTo(x + size, y);
    c.moveTo(x, y - size);
    c.lineTo(x, y + size);
    c.stroke();
}

// ---------- message dispatch ----------

self.onmessage = (e: MessageEvent<InMessage>) => {
    const msg = e.data;
    switch (msg.type) {
        case 'init':
            ctx = msg.canvas.getContext('2d');
            screenW = msg.screenW;
            screenH = msg.screenH;
            gazeModel = new GazeModel(screenW, screenH);
            eyeProfile.reset();
            processed = 0;
            dropped = 0;
            windowStart = 0;
            windowFrames = 0;
            latencySum = 0;
            break;
        case 'frame':
            handleFrame(msg.bitmap, msg.captureTime);
            break;
        case 'resize':
            screenW = msg.screenW;
            screenH = msg.screenH;
            if (gazeModel) {
                // Recreate to adjust clamp bounds (keeps calibration).
                const old = gazeModel;
                gazeModel = new GazeModel(screenW, screenH);
                // Recalibration on resize is out of scope; re-request if needed.
                void old;
            }
            break;
        case 'startCalibration':
            calibration.start();
            gazeModel?.clearCalibration();
            gazeFilter.reset();
            blinkDetector.reset();
            post({
                type: 'calibrationStatus',
                active: true,
                pointIndex: 0,
                totalPoints: calibration.points.length,
                pointProgress: 0,
                pointTarget: 25,
                justFinished: false,
            });
            break;
        case 'abortCalibration':
            calibration.abort();
            calibrationTarget = null;
            post({
                type: 'calibrationStatus',
                active: false,
                pointIndex: 0,
                totalPoints: calibration.points.length,
                pointProgress: 0,
                pointTarget: 0,
                justFinished: false,
            });
            break;
        case 'calibrationTarget':
            calibrationTarget = { x: msg.screenX, y: msg.screenY };
            break;
        case 'click':
            autoCorrector.pushClick(msg.x, msg.y, msg.timestamp);
            // Also feed as stable calibration anchor if we haven't calibrated
            // yet — a single click isn't enough, but lets the user bootstrap
            // by clicking a few spots before formal calibration.
            if (gazeModel && !gazeModel.isCalibrated && lastRawInputs && lastIrisConfidence > 0.25) {
                gazeModel.addCalibration(lastRawInputs, msg.x, msg.y);
                // Require at least 5 anchor clicks before enabling predictions.
                if (gazeModel.stats.stableSamples >= 5) {
                    gazeModel.refitAll();
                }
            }
            break;
        case 'cursor':
            autoCorrector.pushCursor(msg.x, msg.y, msg.timestamp);
            break;
        case 'stop':
            // Don't tear anything down — start/stop camera on main thread
            // can re-enter; we just let state persist.
            break;
    }
};
