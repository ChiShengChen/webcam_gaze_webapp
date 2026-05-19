/**
 * Benchmark state machine — two modes:
 *
 *  - 'sweep' (default): row-major dwell-per-cell Z-pattern, no idle gap.
 *    Tests static accuracy at every grid position.
 *
 *  - 'drift': random-subset cell visits with a long idle gap between each
 *    presentation. Targets the model's wall-clock degradation since
 *    calibration — the idle gap is the whole point. Without it we're
 *    just measuring random-order sweep.
 *
 * Subscribes to the GazeController's snapped stream (what the user actually
 * sees) and logs every sample during a cell's dwell window against the
 * target centre. When all visits are done, emits a result the caller can
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

export type BenchmarkTask = 'sweep' | 'drift';

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
    /** 'sweep' = row-major all cells, no idle. 'drift' = random subset,
     *  with `idleMs` between presentations (drift signal lives in the
     *  wall-clock gap, not the cell positions). */
    task: BenchmarkTask;
    /** Idle window (no target shown, no samples collected) between cell
     *  presentations. Sweep mode keeps it at 0. Drift mode defaults to
     *  28 s so a 2 s dwell + 28 s idle = 30 s per visit, matching the
     *  drift protocols used in eye-tracking literature. */
    idleMs: number;
    /** Number of target presentations in drift mode. The cell sequence
     *  is a uniformly-drawn-without-replacement subset of size
     *  `driftVisits` over `rows*cols` cells. Sweep mode ignores this. */
    driftVisits: number;
}

const DEFAULT: BenchmarkConfig = {
    rows: 8,
    cols: 16,
    dwellMs: 3000,
    warmupMs: 500,
    requireFixation: true,
    pxPerDegree: 45,
    runLabel: 'run',
    task: 'sweep',
    idleMs: 0,
    driftVisits: 10,
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

/**
 * Phase of the per-visit state machine.
 *   - 'showing': target visible, samples being collected (after warmup).
 *   - 'idle': no target shown, no samples collected (drift-mode gap).
 * Sweep mode never enters 'idle' because `idleMs` is 0 by default.
 */
type Phase = 'showing' | 'idle';

export class Benchmark {
    private readonly cfg: BenchmarkConfig;
    private overlay: OverlayHandles | null = null;
    private running = false;
    private samples: Sample[] = [];
    /** Index into `cellOrder` (which target presentation we're on). */
    private visitIndex = 0;
    /** Current grid-cell index, derived from cellOrder[visitIndex]. */
    private cellIndex = 0;
    /** Pre-computed sequence of grid cells to visit. Sweep mode = identity
     *  permutation [0..N-1]; drift mode = random subset of size
     *  `cfg.driftVisits`. Stored so the same plan is reused if we ever
     *  add replay. */
    private cellOrder: number[] = [];
    private phaseStartMs = 0;
    private phase: Phase = 'showing';
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
            // only log samples once a target is actually being shown, the
            // user has settled (past warm-up) and the classifier says they
            // are fixating. Drift idle phase explicitly skips all logging.
            if (this.phase !== 'showing') return;
            const inWarmup = (t - this.phaseStartMs) < this.cfg.warmupMs;
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
        this.visitIndex = 0;
        this.cellOrder = buildCellOrder(this.cfg);
        this.cellIndex = this.cellOrder[0] ?? 0;
        this.phase = 'showing';
        this.phaseStartMs = performance.now();

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
        const phaseElapsed = now - this.phaseStartMs;
        const totalVisits = this.cellOrder.length;

        // Phase-dependent progress + target visualisation.
        let row: number, col: number, progress: number;
        if (this.phase === 'showing') {
            row = Math.floor(this.cellIndex / this.cfg.cols);
            col = this.cellIndex % this.cfg.cols;
            progress = Math.min(1, phaseElapsed / this.cfg.dwellMs);
        } else {
            // Idle: no target drawn (drawFrame skips highlight when row<0).
            row = -1;
            col = -1;
            progress = Math.min(1, phaseElapsed / Math.max(1, this.cfg.idleMs));
        }

        // HUD text.
        const hud = this.overlay.cellLabel.parentElement!;
        hud.querySelector('#bench-cell-idx')!.textContent = String(this.visitIndex + 1);
        hud.querySelector('#bench-cell-total')!.textContent = String(totalVisits);
        hud.querySelector('#bench-cell-row')!.textContent =
            this.phase === 'showing' ? String(row) : '—';
        hud.querySelector('#bench-cell-col')!.textContent =
            this.phase === 'showing' ? String(col) : '—';
        hud.querySelector('#bench-dwell')!.textContent =
            `${(phaseElapsed / 1000).toFixed(1)}s`;
        hud.querySelector('#bench-count')!.textContent = String(this.cellSampleCount);

        const stateEl = hud.querySelector<HTMLElement>('#bench-state')!;
        if (this.phase === 'idle') {
            stateEl.textContent = 'idle (look away)';
            stateEl.className = 'waiting';
        } else if (phaseElapsed < this.cfg.warmupMs) {
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

        // Phase transitions.
        if (this.phase === 'showing' && phaseElapsed >= this.cfg.dwellMs) {
            if (this.visitIndex + 1 >= totalVisits) {
                this.finish();
                return;
            }
            if (this.cfg.idleMs > 0) {
                this.phase = 'idle';
                this.phaseStartMs = now;
            } else {
                this.advanceToNextVisit(now);
            }
        } else if (this.phase === 'idle' && phaseElapsed >= this.cfg.idleMs) {
            this.advanceToNextVisit(now);
        }

        this.rafId = requestAnimationFrame(this.loop);
    };

    private advanceToNextVisit(now: number): void {
        this.visitIndex++;
        this.cellIndex = this.cellOrder[this.visitIndex] ?? this.cellIndex;
        this.phase = 'showing';
        this.phaseStartMs = now;
        this.cellSampleCount = 0;
    }

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

/**
 * Pick which grid cells to visit (and in what order).
 *
 *   - sweep: identity [0..N-1] — row-major coverage of every cell.
 *   - drift: shuffle [0..N-1] (Fisher–Yates), take the first `driftVisits`.
 *            Falls back to sweep length when the requested visit count
 *            exceeds the grid.
 */
function buildCellOrder(cfg: BenchmarkConfig): number[] {
    const total = cfg.rows * cfg.cols;
    const all: number[] = [];
    for (let i = 0; i < total; i++) all.push(i);
    if (cfg.task !== 'drift') return all;

    // Fisher–Yates partial shuffle.
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    const k = Math.max(1, Math.min(cfg.driftVisits, total));
    return all.slice(0, k);
}
