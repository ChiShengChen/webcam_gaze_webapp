/**
 * Benchmark state machine — 16×8 Z-pattern sweep, 3 s dwell per cell.
 *
 * Subscribes to the GazeController's snapped stream (what the user actually
 * sees) and logs every sample during a cell's dwell window against the
 * target centre. When all cells are done, emits a result the caller can
 * feed into export.ts (CSV + gazemap PNG).
 *
 * Dev-mode only — see main.ts for the gating. The overlay hides the rest
 * of the UI chrome so the user isn't distracted by buttons during the run.
 */

import type { GazeController } from '../control/controller';
import {
    createOverlay,
    drawFrame,
    sizeCanvas,
    type OverlayHandles,
} from './overlay';
import {
    autoSaveToServer,
    buildCsv,
    canvasToPngBlob,
    computeCellStats,
    downloadBlob,
    downloadCanvasPng,
    renderGazemap,
    tsStamp,
    type CellStats,
    type OverallStats,
    type Sample,
} from './export';

export interface BenchmarkConfig {
    rows: number;
    cols: number;
    dwellMs: number;
    /** Optional pre-run diagnostics string (e.g. KRR fit stats) shown in
     *  the summary panel alongside the gazemap. Lets the user inspect
     *  calibration internals without opening DevTools mid-run. */
    getFitDiagnostics?: () => string;
    /** Ignore samples for the first N ms of each cell so the saccade
     *  into the new target does not pollute the fixation statistics. */
    warmupMs: number;
    /** Also drop samples that the I-VT classifier flags as SACCADE —
     *  the `snapped` stream emits filtered raw gaze during saccades,
     *  which would otherwise be counted against whichever cell happens
     *  to be active. */
    requireFixation: boolean;
    /** Approximate screen pixels per degree of visual angle, used only
     *  for the degree readout in the summary. Default is a reasonable
     *  14-inch laptop at ~55 cm; pass `pxPerDegree` or the URL flag
     *  `?pxperdeg=N` to override. */
    pxPerDegree: number;
    /** Short identifier for this run, embedded in auto-save filenames
     *  so multiple engine/calibration modes produced in the same dev
     *  session don't overwrite one another. Typically encoded from the
     *  URL flags (e.g. "facemesh_pursuit"). */
    runLabel: string;
    /** Cells are ordered row-major (each row left-to-right, top-down). */
}

const DEFAULT: BenchmarkConfig = {
    rows: 8,
    cols: 16,
    dwellMs: 3000,
    warmupMs: 500,
    requireFixation: true,
    pxPerDegree: 45,
    runLabel: 'run',
};

export interface BenchmarkResult {
    samples: Sample[];
    cells: CellStats[];
    overall: OverallStats;
    rows: number;
    cols: number;
    screenWidth: number;
    screenHeight: number;
}

export class Benchmark {
    private readonly cfg: BenchmarkConfig;
    private overlay: OverlayHandles | null = null;
    private running = false;
    private samples: Sample[] = [];
    private cellIndex = 0;
    private cellStartMs = 0;
    private lastGaze: { x: number; y: number } | null = null;
    private lastState: 'FIXATION' | 'SACCADE' = 'SACCADE';
    private cellSampleCount = 0;
    private screenW = 0;
    private screenH = 0;
    private rafId = 0;
    private resizeHandler: (() => void) | null = null;
    private onCompleteCb: ((r: BenchmarkResult | null) => void) | null = null;

    constructor(gazeController: GazeController, cfg: Partial<BenchmarkConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };

        // Register once. The listener is cheap when !running.
        gazeController.onSnapped((x, y, state, t) => {
            if (!this.running) return;
            this.lastGaze = { x, y };
            this.lastState = state;
            // Always track gaze so the overlay cursor keeps drawing, but
            // only log samples once the user has settled (past warm-up) and
            // the classifier says they are fixating.
            const inWarmup = (t - this.cellStartMs) < this.cfg.warmupMs;
            if (inWarmup) return;
            if (this.cfg.requireFixation && state !== 'FIXATION') return;
            this.recordSample(x, y, t);
            this.cellSampleCount++;
        });
    }

    get isRunning(): boolean {
        return this.running;
    }

    /** Start the benchmark. `onDone` fires on completion (null on abort). */
    start(onDone: (result: BenchmarkResult | null) => void): void {
        if (this.running) return;
        this.onCompleteCb = onDone;

        this.screenW = window.innerWidth;
        this.screenH = window.innerHeight;
        this.samples = [];
        this.cellIndex = 0;
        this.cellStartMs = performance.now();

        this.overlay = createOverlay();
        this.overlay.root.classList.add('active');
        sizeCanvas(this.overlay.canvas);
        this.overlay.abortBtn.addEventListener('click', () => this.abort());

        this.resizeHandler = () => {
            if (!this.overlay || !this.running) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            // Mid-run resize (most commonly: opening/closing DevTools) means
            // cells from before the resize were in a different coordinate
            // system than cells after it — the error numbers become
            // meaningless. Abort immediately and tell the user to redo the
            // run rather than silently poison the CSV.
            if (Math.abs(w - this.screenW) > 8 || Math.abs(h - this.screenH) > 8) {
                console.warn('[Benchmark] viewport resized mid-run:',
                    `${this.screenW}x${this.screenH} -> ${w}x${h}. Aborting.`);
                alert(
                    'Benchmark aborted — the browser viewport changed size during the run ' +
                    `(${this.screenW}×${this.screenH} → ${w}×${h}). ` +
                    'This invalidates the data because target cell positions use the viewport size. ' +
                    '\n\nMost common cause: opening/closing DevTools mid-run. ' +
                    'Please re-run with DevTools already open (or closed) and keep the window size fixed.'
                );
                this.abort();
                return;
            }
            sizeCanvas(this.overlay.canvas);
        };
        window.addEventListener('resize', this.resizeHandler);

        this.running = true;
        this.loop();
    }

    abort(): void {
        if (!this.running) return;
        this.stop(null);
    }

    private recordSample(x: number, y: number, timestampMs: number): void {
        const row = Math.floor(this.cellIndex / this.cfg.cols);
        const col = this.cellIndex % this.cfg.cols;
        const cellW = this.screenW / this.cfg.cols;
        const cellH = this.screenH / this.cfg.rows;
        const tx = (col + 0.5) * cellW;
        const ty = (row + 0.5) * cellH;
        const error = Math.hypot(x - tx, y - ty);

        this.samples.push({
            timestampMs,
            cellIndex: this.cellIndex,
            cellRow: row,
            cellCol: col,
            targetX: tx,
            targetY: ty,
            gazeX: x,
            gazeY: y,
            errorPx: error,
        });
    }

    private loop = (): void => {
        if (!this.running || !this.overlay) return;

        const now = performance.now();
        const dwellElapsed = now - this.cellStartMs;
        const progress = Math.min(1, dwellElapsed / this.cfg.dwellMs);

        const row = Math.floor(this.cellIndex / this.cfg.cols);
        const col = this.cellIndex % this.cfg.cols;

        // HUD text.
        const hud = this.overlay.cellLabel.parentElement!;
        hud.querySelector('#bench-cell-idx')!.textContent = String(this.cellIndex + 1);
        hud.querySelector('#bench-cell-total')!.textContent = String(this.cfg.rows * this.cfg.cols);
        hud.querySelector('#bench-cell-row')!.textContent = String(row);
        hud.querySelector('#bench-cell-col')!.textContent = String(col);
        hud.querySelector('#bench-dwell')!.textContent =
            `${(dwellElapsed / 1000).toFixed(1)}s`;
        hud.querySelector('#bench-count')!.textContent = String(this.cellSampleCount);

        const stateEl = hud.querySelector<HTMLElement>('#bench-state')!;
        const inWarmup = dwellElapsed < this.cfg.warmupMs;
        if (inWarmup) {
            stateEl.textContent = 'settling';
            stateEl.className = 'settling';
        } else if (this.cfg.requireFixation && this.lastState !== 'FIXATION') {
            stateEl.textContent = 'waiting for fixation';
            stateEl.className = 'waiting';
        } else {
            stateEl.textContent = 'collecting';
            stateEl.className = 'collecting';
        }

        drawFrame(this.overlay.canvas, {
            rows: this.cfg.rows,
            cols: this.cfg.cols,
            activeRow: row,
            activeCol: col,
            dwellProgress: progress,
            recentGaze: this.lastGaze,
        });

        if (dwellElapsed >= this.cfg.dwellMs) {
            this.cellIndex++;
            if (this.cellIndex >= this.cfg.rows * this.cfg.cols) {
                this.finish();
                return;
            }
            this.cellStartMs = now;
            this.cellSampleCount = 0;
        }

        this.rafId = requestAnimationFrame(this.loop);
    };

    private finish(): void {
        const { cells, overall } = computeCellStats(
            this.samples,
            this.cfg.rows,
            this.cfg.cols,
            this.screenW,
            this.screenH,
            this.cfg.pxPerDegree,
            this.cfg.dwellMs
        );
        const result: BenchmarkResult = {
            samples: this.samples,
            cells,
            overall,
            rows: this.cfg.rows,
            cols: this.cfg.cols,
            screenWidth: this.screenW,
            screenHeight: this.screenH,
        };
        this.showSummary(result);
        this.stop(result);
    }

    private stop(result: BenchmarkResult | null): void {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;

        // Keep overlay alive if we have a summary to show; destroy otherwise.
        if (!result && this.overlay) {
            this.overlay.destroy();
            this.overlay = null;
        }

        const cb = this.onCompleteCb;
        this.onCompleteCb = null;
        cb?.(result);
    }

    private showSummary(result: BenchmarkResult): void {
        if (!this.overlay) return;
        const o = this.overlay;

        // Hide the live overlay; show the summary panel.
        o.root.classList.remove('active');
        o.summary.style.display = 'flex';

        const gazemapCanvas = renderGazemap(
            result.samples,
            result.cells,
            result.rows,
            result.cols,
            result.screenWidth,
            result.screenHeight
        );
        const img = o.summary.querySelector<HTMLImageElement>('#sum-preview')!;
        img.src = gazemapCanvas.toDataURL('image/png');

        o.summary.querySelector('#sum-cells')!.textContent =
            `${result.overall.cellsCovered} / ${result.overall.cellsTotal}`;
        o.summary.querySelector('#sum-mean')!.textContent =
            `${result.overall.meanErrorPx.toFixed(1)} px`;
        o.summary.querySelector('#sum-median')!.textContent =
            `${result.overall.medianErrorPx.toFixed(1)} px`;
        o.summary.querySelector('#sum-hit')!.textContent =
            `${result.overall.hitRatePct.toFixed(1)} %`;
        o.summary.querySelector('#sum-mean-deg')!.textContent =
            `${result.overall.meanErrorDeg.toFixed(2)} °`;
        o.summary.querySelector('#sum-median-deg')!.textContent =
            `${result.overall.medianErrorDeg.toFixed(2)} °`;
        o.summary.querySelector('#sum-samples')!.textContent =
            String(result.overall.totalSamples);
        o.summary.querySelector('#sum-ppd')!.textContent =
            String(result.overall.pxPerDegree);

        // Populate diagnostics panel if the engine provided a dump.
        const diagEl = o.summary.querySelector<HTMLElement>('#sum-diagnostics');
        if (diagEl) {
            const diag = this.cfg.getFitDiagnostics?.();
            if (diag) {
                diagEl.textContent = diag;
                diagEl.style.display = 'block';
            } else {
                diagEl.style.display = 'none';
            }
        }

        const stamp = tsStamp();
        const csv = buildCsv(result.samples, result.cells, result.overall);
        const csvBlob = new Blob([csv], { type: 'text/csv' });
        const csvName = `benchmark_${this.cfg.runLabel}_${stamp}.csv`;
        const pngName = `gazemap_${this.cfg.runLabel}_${stamp}.png`;
        const csvBtn = o.summary.querySelector<HTMLButtonElement>('#sum-download-csv')!;
        csvBtn.onclick = () => downloadBlob(csvName, csvBlob);
        const pngBtn = o.summary.querySelector<HTMLButtonElement>('#sum-download-png')!;
        pngBtn.onclick = () => downloadCanvasPng(pngName, gazemapCanvas);
        const closeBtn = o.summary.querySelector<HTMLButtonElement>('#sum-close')!;
        closeBtn.onclick = () => {
            o.destroy();
            this.overlay = null;
        };

        // Auto-save to gaze_result/ via the dev-server middleware. Silent
        // no-op in production builds (the endpoint doesn't exist); in
        // that case the user can still fall back to the download buttons.
        const saveStatusEl = o.summary.querySelector<HTMLElement>('#sum-save-status');
        if (saveStatusEl) saveStatusEl.textContent = 'saving CSV + PNG to gaze_result/…';
        void (async () => {
            const savedPaths: string[] = [];
            const errs: string[] = [];
            const csvRes = await autoSaveToServer(csvName, csvBlob);
            if (csvRes.ok && csvRes.path) savedPaths.push(csvRes.path);
            else if (csvRes.error) errs.push(`csv: ${csvRes.error}`);

            const pngBlob = await canvasToPngBlob(gazemapCanvas);
            if (pngBlob) {
                const pngRes = await autoSaveToServer(pngName, pngBlob);
                if (pngRes.ok && pngRes.path) savedPaths.push(pngRes.path);
                else if (pngRes.error) errs.push(`png: ${pngRes.error}`);
            }

            if (saveStatusEl) {
                if (savedPaths.length > 0 && errs.length === 0) {
                    saveStatusEl.textContent = `✓ saved to ${savedPaths.join(' + ')}`;
                    saveStatusEl.style.color = '#9f9';
                } else if (savedPaths.length > 0) {
                    saveStatusEl.textContent = `partial save: ${savedPaths.join(', ')} · errors: ${errs.join('; ')}`;
                    saveStatusEl.style.color = '#fd7';
                } else {
                    saveStatusEl.textContent = `auto-save unavailable (${errs.join('; ')}) — use Download buttons`;
                    saveStatusEl.style.color = '#fa7';
                }
            }
        })();
    }
}
