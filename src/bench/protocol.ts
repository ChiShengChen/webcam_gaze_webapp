/**
 * Benchmark protocol shared by v1 and v2 entries.
 *
 * Pure: no gaze-library dependency, no DOM mutation outside the host element
 * passed in. Caller wires its own pipeline by pushing gaze samples into the
 * BenchRun via `pushSample(x, y, ok)`.
 *
 * Two tasks:
 *   - "grid"   — 5×5 grid, settle 1.0s then sample 1.0s per cell
 *   - "drift"  — fixed-centre baseline then random target every 30s for 5 min
 *
 * Output JSON is intentionally simple so v1/v2 produce comparable files.
 */

export type Pipeline = 'v1' | 'v2';

export interface Sample {
    t: number;   // ms since target onset
    x: number;   // screen px
    y: number;
    ok: boolean; // false when pipeline produced no prediction this frame
}

export interface TargetLog {
    index: number;
    x: number;
    y: number;
    onsetMs: number;       // ms since session start
    settleEndMs: number;
    endMs: number;
    samples: Sample[];
}

export interface TaskLog {
    name: 'grid' | 'drift';
    params: Record<string, number>;
    targets: TargetLog[];
}

export interface SessionLog {
    pipeline: Pipeline;
    screenW: number;
    screenH: number;
    startedAt: number;       // performance.now() at session start
    startedAtIso: string;
    userAgent: string;
    notes: string;
    tasks: TaskLog[];
}

// ----------------------------------------------------------------------------
// Task configs
// ----------------------------------------------------------------------------

const GRID_ROWS = 5;
const GRID_COLS = 5;
const GRID_MARGIN = 0.08;     // fraction of screen
const GRID_SETTLE_MS = 1000;
const GRID_SAMPLE_MS = 1000;

const DRIFT_DURATION_MS = 5 * 60 * 1000;   // 5 minutes
const DRIFT_INTERVAL_MS = 30 * 1000;
const DRIFT_SETTLE_MS = 1000;
const DRIFT_SAMPLE_MS = 1000;

// ----------------------------------------------------------------------------
// BenchRun: shared driver
// ----------------------------------------------------------------------------

export class BenchRun {
    readonly session: SessionLog;
    private currentTarget: TargetLog | null = null;
    private windowOpen = false;
    private windowOpenAt = 0;

    constructor(pipeline: Pipeline, notes = '') {
        this.session = {
            pipeline,
            screenW: window.innerWidth,
            screenH: window.innerHeight,
            startedAt: performance.now(),
            startedAtIso: new Date().toISOString(),
            userAgent: navigator.userAgent,
            notes,
            tasks: [],
        };
    }

    /** Pipeline pushes gaze samples here. Called every frame. */
    pushSample(x: number, y: number, ok: boolean): void {
        if (!this.currentTarget || !this.windowOpen) return;
        const t = performance.now() - this.windowOpenAt;
        this.currentTarget.samples.push({ t, x, y, ok });
    }

    private openWindow(): void {
        this.windowOpen = true;
        this.windowOpenAt = performance.now();
    }

    private closeWindow(): void {
        this.windowOpen = false;
    }

    /** Run grid task; resolves when finished. */
    async runGrid(dot: HTMLElement, onTarget?: (i: number, total: number) => void): Promise<TaskLog> {
        const task: TaskLog = {
            name: 'grid',
            params: {
                rows: GRID_ROWS,
                cols: GRID_COLS,
                margin: GRID_MARGIN,
                settleMs: GRID_SETTLE_MS,
                sampleMs: GRID_SAMPLE_MS,
            },
            targets: [],
        };
        this.session.tasks.push(task);

        const positions = gridPositions(GRID_ROWS, GRID_COLS, GRID_MARGIN);
        for (let i = 0; i < positions.length; i++) {
            const [x, y] = positions[i];
            onTarget?.(i, positions.length);
            await this.runTarget(task, dot, i, x, y, GRID_SETTLE_MS, GRID_SAMPLE_MS);
        }
        dot.style.display = 'none';
        return task;
    }

    /** Run drift task; resolves when finished. */
    async runDrift(dot: HTMLElement, onTarget?: (i: number, total: number) => void): Promise<TaskLog> {
        const task: TaskLog = {
            name: 'drift',
            params: {
                durationMs: DRIFT_DURATION_MS,
                intervalMs: DRIFT_INTERVAL_MS,
                settleMs: DRIFT_SETTLE_MS,
                sampleMs: DRIFT_SAMPLE_MS,
            },
            targets: [],
        };
        this.session.tasks.push(task);

        const totalTargets = Math.floor(DRIFT_DURATION_MS / DRIFT_INTERVAL_MS);
        const start = performance.now();
        // First target = centre baseline.
        const cx = this.session.screenW / 2;
        const cy = this.session.screenH / 2;
        onTarget?.(0, totalTargets);
        await this.runTarget(task, dot, 0, cx, cy, DRIFT_SETTLE_MS, DRIFT_SAMPLE_MS);
        const idleAfter = DRIFT_INTERVAL_MS - DRIFT_SETTLE_MS - DRIFT_SAMPLE_MS;
        if (idleAfter > 0) await sleep(idleAfter);

        for (let i = 1; i < totalTargets; i++) {
            if (performance.now() - start >= DRIFT_DURATION_MS) break;
            const [x, y] = randomTarget(this.session.screenW, this.session.screenH, GRID_MARGIN);
            onTarget?.(i, totalTargets);
            await this.runTarget(task, dot, i, x, y, DRIFT_SETTLE_MS, DRIFT_SAMPLE_MS);
            const remain = DRIFT_INTERVAL_MS - DRIFT_SETTLE_MS - DRIFT_SAMPLE_MS;
            if (remain > 0) await sleep(remain);
        }
        dot.style.display = 'none';
        return task;
    }

    private async runTarget(
        task: TaskLog,
        dot: HTMLElement,
        index: number,
        x: number,
        y: number,
        settleMs: number,
        sampleMs: number,
    ): Promise<void> {
        const onsetMs = performance.now() - this.session.startedAt;
        placeDot(dot, x, y);
        const target: TargetLog = {
            index,
            x,
            y,
            onsetMs,
            settleEndMs: onsetMs + settleMs,
            endMs: onsetMs + settleMs + sampleMs,
            samples: [],
        };
        task.targets.push(target);

        this.currentTarget = target;
        await sleep(settleMs);
        this.openWindow();
        await sleep(sampleMs);
        this.closeWindow();
        this.currentTarget = null;
    }

    toJSON(): SessionLog {
        return this.session;
    }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function gridPositions(rows: number, cols: number, margin: number): [number, number][] {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const fx = margin + ((1 - 2 * margin) * c) / (cols - 1);
            const fy = margin + ((1 - 2 * margin) * r) / (rows - 1);
            out.push([fx * W, fy * H]);
        }
    }
    return out;
}

function randomTarget(W: number, H: number, margin: number): [number, number] {
    const fx = margin + Math.random() * (1 - 2 * margin);
    const fy = margin + Math.random() * (1 - 2 * margin);
    return [fx * W, fy * H];
}

function placeDot(dot: HTMLElement, x: number, y: number): void {
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.display = 'block';
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export function downloadJson(log: SessionLog): void {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const t = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `bench_${log.pipeline}_${t}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
