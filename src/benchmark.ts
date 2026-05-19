/**
 * v1 (WebGazer) benchmark entry.
 *
 * Workflow:
 *   1. Start camera + WebGazer.
 *   2. 9-point calibration (click each dot 5×, same as main app).
 *   3. Run grid task and/or drift task.
 *   4. Export JSON.
 */

import webgazer from 'webgazer';
import { BenchRun, downloadJson } from './bench/protocol';

const CLICKS_PER_DOT = 5;
const CALIB_POINTS_NORM: [number, number][] = [
    [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
    [0.08, 0.5],  [0.5, 0.5],  [0.92, 0.5],
    [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];

// ---------- DOM refs ----------
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const gridBtn = document.getElementById('grid-btn') as HTMLButtonElement;
const driftBtn = document.getElementById('drift-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const notesInput = document.getElementById('notes') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const calibLayer = document.getElementById('calib-layer')!;
const taskDot = document.getElementById('task-dot') as HTMLElement;
const gazeDot = document.getElementById('gaze-dot') as HTMLElement;

// ---------- state ----------
let bench: BenchRun | null = null;
let calibrationDone = false;
let lastGaze: { x: number; y: number; ok: boolean } = { x: 0, y: 0, ok: false };

// ---------- gaze listener ----------
function onGaze(data: { x: number; y: number } | null): void {
    if (data) {
        lastGaze = { x: data.x, y: data.y, ok: true };
        gazeDot.style.display = 'block';
        gazeDot.style.left = `${data.x}px`;
        gazeDot.style.top = `${data.y}px`;
    } else {
        lastGaze = { x: lastGaze.x, y: lastGaze.y, ok: false };
    }
    bench?.pushSample(lastGaze.x, lastGaze.y, lastGaze.ok);
}

// ---------- calibration ----------
function buildCalibrationDots(): HTMLDivElement[] {
    calibLayer.innerHTML = '';
    return CALIB_POINTS_NORM.map(([nx, ny], i) => {
        const dot = document.createElement('div');
        dot.className = 'calib-dot';
        dot.style.left = `${nx * 100}%`;
        dot.style.top = `${ny * 100}%`;
        dot.dataset.clicks = '0';
        dot.dataset.index = String(i);
        calibLayer.appendChild(dot);
        return dot;
    });
}

async function runCalibration(): Promise<void> {
    statusEl.textContent = 'Calibration: click each dot 5× while looking at it.';
    calibLayer.style.display = 'block';
    const dots = buildCalibrationDots();

    return new Promise((resolve) => {
        let remaining = dots.length;
        for (const dot of dots) {
            dot.addEventListener('click', () => {
                const n = (parseInt(dot.dataset.clicks!, 10) || 0) + 1;
                dot.dataset.clicks = String(n);
                dot.style.opacity = String(0.3 + 0.7 * Math.min(1, n / CLICKS_PER_DOT));
                if (n >= CLICKS_PER_DOT) {
                    dot.classList.add('done');
                    dot.style.pointerEvents = 'none';
                    remaining--;
                    if (remaining === 0) {
                        calibLayer.style.display = 'none';
                        calibrationDone = true;
                        statusEl.textContent = 'Calibrated. Ready to run tasks.';
                        gridBtn.disabled = false;
                        driftBtn.disabled = false;
                        resolve();
                    }
                }
            });
        }
    });
}

// ---------- start ----------
async function start(): Promise<void> {
    startBtn.disabled = true;
    statusEl.textContent = 'Starting WebGazer…';
    bench = new BenchRun('v1', notesInput.value);

    webgazer.setGazeListener(onGaze)
        .saveDataAcrossSessions(false);
    await webgazer.begin();
    webgazer.showVideoPreview(false).showPredictionPoints(false);

    await runCalibration();
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
