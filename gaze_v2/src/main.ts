/**
 * Gaze Tracker v2 — main thread entry.
 *
 * Responsibilities:
 *  - Camera open/close
 *  - Frame → worker marshalling
 *  - UI rendering (cursor, calibration dots, HUD)
 *  - Mouse events → worker (for auto-correction)
 *  - Receiving predictions/events from worker
 *
 * All CV + gaze math runs in the worker — this file is just glue.
 */

import { openCamera, type ActiveCamera } from './capture/camera';
import { FrameLoop } from './capture/frameLoop';
import type { InMessage, OutMessage } from './protocol';

// ---------- DOM refs ----------
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const calibBtn = document.getElementById('calib-btn') as HTMLButtonElement;
const abortCalibBtn = document.getElementById('abort-calib-btn') as HTMLButtonElement;
const captureFpsEl = document.getElementById('capture-fps')!;
const pipelineFpsEl = document.getElementById('pipeline-fps')!;
const droppedEl = document.getElementById('dropped')!;
const faceStateEl = document.getElementById('face-state')!;
const irisConfEl = document.getElementById('iris-conf')!;
const modelStateEl = document.getElementById('model-state')!;
const blinkLogEl = document.getElementById('blink-log')!;
const displayCanvas = document.getElementById('display') as HTMLCanvasElement;
const gazeCursor = document.getElementById('gaze-cursor')!;
const calibOverlay = document.getElementById('calib-overlay')!;
const calibDot = document.getElementById('calib-dot')!;
const calibStatus = document.getElementById('calib-status')!;
const headWarning = document.getElementById('head-warning')!;
const headWarningText = document.getElementById('head-warning-text')!;
const profileIrisEl = document.getElementById('profile-iris')!;
const profileIpdEl = document.getElementById('profile-ipd')!;
const profileVarEl = document.getElementById('profile-var')!;

// ---------- worker + canvas setup ----------
const offscreen = displayCanvas.transferControlToOffscreen();
const worker = new Worker(
    new URL('./worker/pipeline.worker.ts', import.meta.url),
    { type: 'module' }
);

function postToWorker(msg: InMessage, transfer: Transferable[] = []): void {
    worker.postMessage(msg, transfer);
}

postToWorker({
    type: 'init',
    canvas: offscreen,
    screenW: window.innerWidth,
    screenH: window.innerHeight,
}, [offscreen]);

window.addEventListener('resize', () => {
    postToWorker({
        type: 'resize',
        screenW: window.innerWidth,
        screenH: window.innerHeight,
    });
});

// ---------- capture state ----------
let camera: ActiveCamera | null = null;
let frameLoop: FrameLoop | null = null;

let captureWindowStart = 0;
let captureFramesInWindow = 0;
const CAPTURE_WINDOW_MS = 500;

// ---------- mouse signals → worker ----------
document.addEventListener('click', (e) => {
    // Ignore clicks on UI chrome so they don't pollute the corrector.
    const t = e.target as HTMLElement;
    if (t.closest('#controls, #hud, .blink-entry, #blink-log, #calib-dot, #calib-overlay button')) return;
    postToWorker({ type: 'click', x: e.clientX, y: e.clientY, timestamp: performance.now() });
});

document.addEventListener('mousemove', (e) => {
    postToWorker({ type: 'cursor', x: e.clientX, y: e.clientY, timestamp: performance.now() });
});

// ---------- calibration state machine (UI side) ----------
const CALIB_POINTS_NORM: [number, number][] = [
    [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
    [0.08, 0.5],  [0.5, 0.5],  [0.92, 0.5],
    [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];
let calibIndex = 0;
let calibActive = false;

function placeCalibDot(index: number): void {
    const [nx, ny] = CALIB_POINTS_NORM[index];
    const x = window.innerWidth * nx;
    const y = window.innerHeight * ny;
    calibDot.style.left = `${x}px`;
    calibDot.style.top = `${y}px`;
    calibStatus.textContent = `Point ${index + 1} / ${CALIB_POINTS_NORM.length} — look at the dot and click it`;
}

function startCalibration(): void {
    calibActive = true;
    calibIndex = 0;
    calibOverlay.style.display = 'block';
    placeCalibDot(0);
    postToWorker({ type: 'startCalibration' });
}

function abortCalibration(): void {
    calibActive = false;
    calibOverlay.style.display = 'none';
    postToWorker({ type: 'abortCalibration' });
}

function advanceCalibration(): void {
    if (!calibActive) return;
    calibIndex++;
    if (calibIndex >= CALIB_POINTS_NORM.length) {
        calibActive = false;
        calibOverlay.style.display = 'none';
        modelStateEl.textContent = 'calibrated ✓';
        return;
    }
    placeCalibDot(calibIndex);
}

// Clicking the calibration dot: tell worker the current target & advance.
calibDot.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!calibActive) return;
    const rect = calibDot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    postToWorker({ type: 'calibrationTarget', screenX: cx, screenY: cy });
});

abortCalibBtn.addEventListener('click', abortCalibration);

// ---------- worker messages → UI ----------
worker.onmessage = (e: MessageEvent<OutMessage>) => {
    const msg = e.data;
    switch (msg.type) {
        case 'stats':
            pipelineFpsEl.textContent = msg.pipelineFps.toFixed(1);
            droppedEl.textContent = String(msg.droppedFrames);
            break;
        case 'frameStatus':
            faceStateEl.textContent = msg.hasFace ? 'locked' : 'searching';
            faceStateEl.style.color = msg.hasFace ? '#4f4' : '#fa4';
            irisConfEl.textContent = msg.irisConfidence.toFixed(2);
            updateHeadWarning(msg.headDistance);
            if (msg.filtered) {
                gazeCursor.style.display = 'block';
                gazeCursor.style.left = `${msg.filtered.x}px`;
                gazeCursor.style.top = `${msg.filtered.y}px`;
            } else {
                gazeCursor.style.display = 'none';
            }
            break;
        case 'calibrationStatus':
            if (msg.justFinished) {
                advanceCalibration();
                modelStateEl.textContent = 'calibrated ✓';
            } else if (msg.active) {
                const pct = Math.floor((msg.pointProgress / msg.pointTarget) * 100);
                calibStatus.textContent = `Point ${msg.pointIndex + 1} / ${msg.totalPoints}  —  collecting ${pct}%`;
                if (msg.pointProgress === 0 && msg.pointIndex !== calibIndex) {
                    advanceCalibration();
                }
            }
            break;
        case 'sessionProfile':
            profileIrisEl.textContent = msg.isWarm
                ? `${msg.preferredRatioLabel} (${msg.samples})`
                : `warming up… ${msg.samples}`;
            profileIrisEl.style.color = msg.isWarm ? '#9f9' : '#fa4';
            profileIpdEl.textContent = msg.medianIpd > 0 ? msg.medianIpd.toFixed(0) : '—';
            profileVarEl.textContent = msg.medianVariance > 0 ? msg.medianVariance.toFixed(0) : '—';
            break;
        case 'blinkEvent':
            logBlink(msg.kind, msg.durationMs);
            if (msg.kind === 'longBlink') {
                // Long blink = click at current gaze position.
                simulateGazeClick();
            }
            break;
    }
};

// ---------- head distance warning ----------
// Hysteresis so short flickers don't toggle the banner rapidly.
let warningState: 'ok' | 'warn' = 'ok';
let warningLastChange = 0;
const WARNING_MIN_HOLD_MS = 350;

function updateHeadWarning(state: import('./protocol').HeadDistance): void {
    const now = performance.now();
    let text = '';
    let wantWarn = false;
    switch (state) {
        case 'tooClose':
            text = 'Too close — move your head back';
            wantWarn = true;
            break;
        case 'tooFar':
            text = 'Too far — move closer to the camera';
            wantWarn = true;
            break;
        case 'offCenter':
            text = 'Off centre — re-centre your face in the camera';
            wantWarn = true;
            break;
        case 'noFace':
            text = 'No face detected — sit in front of the camera';
            wantWarn = true;
            break;
        case 'ok':
            wantWarn = false;
            break;
    }
    const newState = wantWarn ? 'warn' : 'ok';
    if (newState !== warningState && now - warningLastChange > WARNING_MIN_HOLD_MS) {
        warningState = newState;
        warningLastChange = now;
        headWarning.classList.toggle('visible', wantWarn);
    }
    if (wantWarn && warningState === 'warn') {
        headWarningText.textContent = text;
    }
}

// ---------- blink log ----------
let blinkCount = 0;
function logBlink(kind: 'blink' | 'longBlink', durationMs: number): void {
    blinkCount++;
    const entry = document.createElement('div');
    entry.className = 'blink-entry';
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    const icon = kind === 'longBlink' ? '⭘' : '◦';
    entry.textContent = `${icon} #${blinkCount}  ${timeStr}  (${durationMs.toFixed(0)} ms)`;
    blinkLogEl.prepend(entry);
    while (blinkLogEl.children.length > 20) {
        blinkLogEl.removeChild(blinkLogEl.lastChild!);
    }
}

// ---------- gaze click simulation ----------
function simulateGazeClick(): void {
    const rect = gazeCursor.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // Briefly flash the cursor.
    gazeCursor.classList.add('flash');
    setTimeout(() => gazeCursor.classList.remove('flash'), 200);
    // Dispatch a synthetic click at the gaze position so downstream listeners
    // (and the auto-correction click handler) fire.
    const el = document.elementFromPoint(x, y);
    el?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
    }));
}

// ---------- start / stop camera ----------
async function start(): Promise<void> {
    startBtn.disabled = true;
    try {
        camera = await openCamera({ width: 1280, height: 720, frameRate: 30 });
        console.log('[main] camera:', camera.settings);

        frameLoop = new FrameLoop(camera.video, async (tick) => {
            if (!camera) return;
            const bitmap = await createImageBitmap(camera.video);
            postToWorker({
                type: 'frame',
                bitmap,
                captureTime: tick.captureTime,
                frameIndex: tick.frameIndex,
            }, [bitmap]);

            const now = performance.now();
            if (captureWindowStart === 0) captureWindowStart = now;
            captureFramesInWindow++;
            const elapsed = now - captureWindowStart;
            if (elapsed >= CAPTURE_WINDOW_MS) {
                captureFpsEl.textContent = ((captureFramesInWindow * 1000) / elapsed).toFixed(1);
                captureWindowStart = now;
                captureFramesInWindow = 0;
            }
        });
        frameLoop.start();
        stopBtn.disabled = false;
        calibBtn.disabled = false;
    } catch (err) {
        console.error('[main] start failed:', err);
        alert('Camera failed: ' + (err as Error).message);
        startBtn.disabled = false;
    }
}

function stop(): void {
    frameLoop?.stop();
    frameLoop = null;
    camera?.stop();
    camera = null;
    gazeCursor.style.display = 'none';
    calibBtn.disabled = true;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    captureFpsEl.textContent = '—';
    pipelineFpsEl.textContent = '—';
    droppedEl.textContent = '0';
    captureWindowStart = 0;
    captureFramesInWindow = 0;
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
calibBtn.addEventListener('click', startCalibration);
