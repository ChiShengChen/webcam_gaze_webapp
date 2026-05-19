/**
 * v2 benchmark entry.
 *
 * Boots the v2 worker pipeline (camera → CV → filtered gaze), runs 9-point
 * calibration via worker messages, then drives the shared bench protocol.
 *
 * Intentionally a thin sibling of main.ts — keep only what the benchmark needs.
 */

import { openCamera, type ActiveCamera } from './capture/camera';
import { FrameLoop } from './capture/frameLoop';
import type { InMessage, OutMessage } from './protocol';
import { BenchRun, downloadJson } from './bench/protocol';

const CALIB_POINTS_NORM: [number, number][] = [
    [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
    [0.08, 0.5],  [0.5, 0.5],  [0.92, 0.5],
    [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];

// ---------- DOM ----------
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const gridBtn = document.getElementById('grid-btn') as HTMLButtonElement;
const driftBtn = document.getElementById('drift-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const notesInput = document.getElementById('notes') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const calibLayer = document.getElementById('calib-layer')!;
const calibDot = document.getElementById('calib-dot') as HTMLElement;
const calibStatus = document.getElementById('calib-status')!;
const taskDot = document.getElementById('task-dot') as HTMLElement;
const gazeDot = document.getElementById('gaze-dot') as HTMLElement;
const previewCanvas = document.getElementById('preview') as HTMLCanvasElement;

// ---------- worker setup ----------
const offscreen = previewCanvas.transferControlToOffscreen();
const worker = new Worker(
    new URL('./worker/pipeline.worker.ts', import.meta.url),
    { type: 'module' },
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
    postToWorker({ type: 'resize', screenW: window.innerWidth, screenH: window.innerHeight });
});

// ---------- state ----------
let camera: ActiveCamera | null = null;
let frameLoop: FrameLoop | null = null;
let bench: BenchRun | null = null;
let calibrationDone = false;

// ---------- calibration state machine ----------
let calibActive = false;
let calibIndex = 0;
let calibResolve: (() => void) | null = null;

function placeCalibDot(i: number): void {
    const [nx, ny] = CALIB_POINTS_NORM[i];
    calibDot.style.left = `${nx * 100}%`;
    calibDot.style.top = `${ny * 100}%`;
    calibStatus.textContent = `Point ${i + 1} / ${CALIB_POINTS_NORM.length} — click while looking`;
}

function startCalibration(): Promise<void> {
    return new Promise((resolve) => {
        calibActive = true;
        calibIndex = 0;
        calibResolve = resolve;
        calibLayer.style.display = 'block';
        placeCalibDot(0);
        postToWorker({ type: 'startCalibration' });
    });
}

calibDot.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!calibActive) return;
    const rect = calibDot.getBoundingClientRect();
    postToWorker({
        type: 'calibrationTarget',
        screenX: rect.left + rect.width / 2,
        screenY: rect.top + rect.height / 2,
    });
});

function advanceCalibration(): void {
    if (!calibActive) return;
    calibIndex++;
    if (calibIndex >= CALIB_POINTS_NORM.length) {
        finishCalibration();
        return;
    }
    placeCalibDot(calibIndex);
}

function finishCalibration(): void {
    calibActive = false;
    calibLayer.style.display = 'none';
    calibrationDone = true;
    statusEl.textContent = 'Calibrated. Ready to run tasks.';
    gridBtn.disabled = false;
    driftBtn.disabled = false;
    calibResolve?.();
    calibResolve = null;
}

// ---------- worker messages ----------
worker.onmessage = (e: MessageEvent<OutMessage>) => {
    const msg = e.data;
    if (msg.type === 'frameStatus') {
        if (msg.filtered) {
            gazeDot.style.display = 'block';
            gazeDot.style.left = `${msg.filtered.x}px`;
            gazeDot.style.top = `${msg.filtered.y}px`;
            bench?.pushSample(msg.filtered.x, msg.filtered.y, true);
        } else {
            bench?.pushSample(0, 0, false);
        }
    } else if (msg.type === 'calibrationStatus') {
        if (msg.justFinished) {
            finishCalibration();
        } else if (msg.active && msg.pointIndex !== calibIndex && msg.pointProgress === 0) {
            advanceCalibration();
        }
    }
};

// ---------- start ----------
async function start(): Promise<void> {
    startBtn.disabled = true;
    statusEl.textContent = 'Opening camera…';
    try {
        camera = await openCamera({ width: 1280, height: 720, frameRate: 30 });
    } catch (err) {
        statusEl.textContent = 'Camera failed: ' + (err as Error).message;
        startBtn.disabled = false;
        return;
    }

    frameLoop = new FrameLoop(camera.video, async (tick) => {
        if (!camera) return;
        const bitmap = await createImageBitmap(camera.video);
        postToWorker({
            type: 'frame',
            bitmap,
            captureTime: tick.captureTime,
            frameIndex: tick.frameIndex,
        }, [bitmap]);
    });
    frameLoop.start();

    statusEl.textContent = 'Calibrating…';
    bench = new BenchRun('v2', notesInput.value);
    await startCalibration();
}

// ---------- tasks ----------
async function runGrid(): Promise<void> {
    if (!bench) return;
    setTaskButtonsEnabled(false);
    statusEl.textContent = 'Grid task running… look at each yellow dot.';
    await bench.runGrid(taskDot, (i, total) => {
        statusEl.textContent = `Grid ${i + 1} / ${total}`;
    });
    statusEl.textContent = 'Grid task done.';
    setTaskButtonsEnabled(true);
    exportBtn.disabled = false;
}

async function runDrift(): Promise<void> {
    if (!bench) return;
    setTaskButtonsEnabled(false);
    statusEl.textContent = 'Drift task running (~5 min)… look at each dot when it appears.';
    await bench.runDrift(taskDot, (i, total) => {
        statusEl.textContent = `Drift ${i + 1} / ${total}`;
    });
    statusEl.textContent = 'Drift task done.';
    setTaskButtonsEnabled(true);
    exportBtn.disabled = false;
}

function setTaskButtonsEnabled(on: boolean): void {
    gridBtn.disabled = !on || !calibrationDone;
    driftBtn.disabled = !on || !calibrationDone;
}

function exportJson(): void {
    if (!bench) return;
    downloadJson(bench.toJSON());
}

// ---------- wiring ----------
startBtn.addEventListener('click', start);
gridBtn.addEventListener('click', runGrid);
driftBtn.addEventListener('click', runDrift);
exportBtn.addEventListener('click', exportJson);
