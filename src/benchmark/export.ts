/**
 * Benchmark exports — samples CSV (with per-row error + cell-level summary
 * rolled in) and a gazemap PNG.
 *
 * The "兩項" in the spec is:
 *   1. CSV — per-sample rows plus the per-cell summary appended at the end
 *      (under a clear `# --- per-cell summary ---` divider, so a spreadsheet
 *      can paste it as a second region and a script can split on the marker).
 *   2. PNG — gazemap rendering the grid, target crosshairs, per-sample dots
 *      colour-coded by error magnitude, and the per-cell centroid.
 */

export interface Sample {
    timestampMs: number;
    cellIndex: number;
    cellRow: number;
    cellCol: number;
    targetX: number;
    targetY: number;
    gazeX: number;
    gazeY: number;
    errorPx: number;
}

export interface CellStats {
    cellIndex: number;
    cellRow: number;
    cellCol: number;
    targetX: number;
    targetY: number;
    sampleCount: number;
    meanErrorPx: number;
    medianErrorPx: number;
    p95ErrorPx: number;
    centroidX: number;
    centroidY: number;
    /** Did the median sample land in the correct cell? */
    hit: boolean;
}

export interface OverallStats {
    totalSamples: number;
    cellsCovered: number;
    cellsTotal: number;
    meanErrorPx: number;
    medianErrorPx: number;
    hitRatePct: number;
    /** Screen size used for the run (for downstream visualisation). */
    screenWidth: number;
    screenHeight: number;
    /** Approximate px-per-degree assumption used for the degree readouts. */
    pxPerDegree: number;
    meanErrorDeg: number;
    medianErrorDeg: number;
    /** Grid shape + dwell used — embedded so `?fast=1` / `?rows=…`
     *  debug runs can be told apart from full 16×8 runs when two CSVs
     *  are compared after the fact. */
    gridRows: number;
    gridCols: number;
    dwellMs: number;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const a = [...values].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const a = [...values].sort((x, y) => x - y);
    const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
    return a[idx];
}

export function computeCellStats(
    samples: Sample[],
    rows: number,
    cols: number,
    screenW: number,
    screenH: number,
    pxPerDegree: number,
    dwellMs: number
): { cells: CellStats[]; overall: OverallStats } {
    const byCell = new Map<number, Sample[]>();
    for (const s of samples) {
        if (!byCell.has(s.cellIndex)) byCell.set(s.cellIndex, []);
        byCell.get(s.cellIndex)!.push(s);
    }

    const cellW = screenW / cols;
    const cellH = screenH / rows;
    const cells: CellStats[] = [];
    for (const [cellIndex, arr] of byCell) {
        const errors = arr.map(s => s.errorPx);
        const cx = arr.reduce((acc, s) => acc + s.gazeX, 0) / arr.length;
        const cy = arr.reduce((acc, s) => acc + s.gazeY, 0) / arr.length;
        const first = arr[0];
        const hitCol = Math.floor(cx / cellW);
        const hitRow = Math.floor(cy / cellH);
        const hit = hitCol === first.cellCol && hitRow === first.cellRow;

        cells.push({
            cellIndex,
            cellRow: first.cellRow,
            cellCol: first.cellCol,
            targetX: first.targetX,
            targetY: first.targetY,
            sampleCount: arr.length,
            meanErrorPx: errors.reduce((a, b) => a + b, 0) / errors.length,
            medianErrorPx: median(errors),
            p95ErrorPx: percentile(errors, 95),
            centroidX: cx,
            centroidY: cy,
            hit,
        });
    }
    cells.sort((a, b) => a.cellIndex - b.cellIndex);

    const allErrors = samples.map(s => s.errorPx);
    const hits = cells.filter(c => c.hit).length;
    const meanPx = allErrors.length ? allErrors.reduce((a, b) => a + b, 0) / allErrors.length : 0;
    const medianPx = median(allErrors);
    const overall: OverallStats = {
        totalSamples: samples.length,
        cellsCovered: cells.length,
        cellsTotal: rows * cols,
        meanErrorPx: meanPx,
        medianErrorPx: medianPx,
        hitRatePct: cells.length ? (hits / cells.length) * 100 : 0,
        screenWidth: screenW,
        screenHeight: screenH,
        pxPerDegree,
        meanErrorDeg: meanPx / pxPerDegree,
        medianErrorDeg: medianPx / pxPerDegree,
        gridRows: rows,
        gridCols: cols,
        dwellMs,
    };
    return { cells, overall };
}

export function buildCsv(
    samples: Sample[],
    cells: CellStats[],
    overall: OverallStats
): string {
    const header = [
        'timestamp_ms',
        'cell_index',
        'cell_row',
        'cell_col',
        'target_x',
        'target_y',
        'gaze_x',
        'gaze_y',
        'error_px',
    ].join(',');

    const rows = samples.map(s => [
        s.timestampMs.toFixed(2),
        s.cellIndex,
        s.cellRow,
        s.cellCol,
        s.targetX.toFixed(2),
        s.targetY.toFixed(2),
        s.gazeX.toFixed(2),
        s.gazeY.toFixed(2),
        s.errorPx.toFixed(2),
    ].join(','));

    const summaryHeader = [
        'cell_index',
        'cell_row',
        'cell_col',
        'target_x',
        'target_y',
        'sample_count',
        'mean_error_px',
        'median_error_px',
        'p95_error_px',
        'centroid_x',
        'centroid_y',
        'hit',
    ].join(',');
    const summaryRows = cells.map(c => [
        c.cellIndex,
        c.cellRow,
        c.cellCol,
        c.targetX.toFixed(2),
        c.targetY.toFixed(2),
        c.sampleCount,
        c.meanErrorPx.toFixed(2),
        c.medianErrorPx.toFixed(2),
        c.p95ErrorPx.toFixed(2),
        c.centroidX.toFixed(2),
        c.centroidY.toFixed(2),
        c.hit ? 1 : 0,
    ].join(','));

    const meta = [
        `# benchmark_run_at,${new Date().toISOString()}`,
        `# screen_width,${overall.screenWidth}`,
        `# screen_height,${overall.screenHeight}`,
        `# px_per_degree,${overall.pxPerDegree}`,
        `# grid,${overall.gridCols}x${overall.gridRows}`,
        `# dwell_ms,${overall.dwellMs}`,
        `# total_samples,${overall.totalSamples}`,
        `# cells_covered,${overall.cellsCovered}/${overall.cellsTotal}`,
        `# mean_error_px,${overall.meanErrorPx.toFixed(2)}`,
        `# median_error_px,${overall.medianErrorPx.toFixed(2)}`,
        `# mean_error_deg,${overall.meanErrorDeg.toFixed(2)}`,
        `# median_error_deg,${overall.medianErrorDeg.toFixed(2)}`,
        `# hit_rate_pct,${overall.hitRatePct.toFixed(2)}`,
    ].join('\n');

    return [
        meta,
        '',
        '# --- per-sample ---',
        header,
        ...rows,
        '',
        '# --- per-cell summary ---',
        summaryHeader,
        ...summaryRows,
        '',
    ].join('\n');
}

/** Colour ramp green → yellow → red for error magnitude in [0, maxPx]. */
function errorColor(errorPx: number, maxPx: number): string {
    const t = Math.max(0, Math.min(1, errorPx / maxPx));
    const r = t < 0.5 ? Math.round(255 * (t * 2)) : 255;
    const g = t < 0.5 ? 255 : Math.round(255 * (1 - (t - 0.5) * 2));
    return `rgba(${r}, ${g}, 80, 0.75)`;
}

export function renderGazemap(
    samples: Sample[],
    cells: CellStats[],
    rows: number,
    cols: number,
    screenW: number,
    screenH: number
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = screenW;
    canvas.height = screenH;
    const ctx = canvas.getContext('2d')!;

    // Background.
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(0, 0, screenW, screenH);

    // Grid.
    const cellW = screenW / cols;
    const cellH = screenH / rows;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < cols; c++) {
        const x = Math.round(c * cellW) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, screenH);
    }
    for (let r = 1; r < rows; r++) {
        const y = Math.round(r * cellH) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(screenW, y);
    }
    ctx.stroke();

    // Target crosshairs.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.2;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cx = (c + 0.5) * cellW;
            const cy = (r + 0.5) * cellH;
            ctx.beginPath();
            ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
            ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
            ctx.stroke();
        }
    }

    // Scale error colours against p95 so outliers don't squash the ramp.
    const allErrors = samples.map(s => s.errorPx);
    const maxErr = Math.max(40, percentile(allErrors, 95));

    // Per-sample dots.
    for (const s of samples) {
        ctx.fillStyle = errorColor(s.errorPx, maxErr);
        ctx.beginPath();
        ctx.arc(s.gazeX, s.gazeY, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Cell centroids + target-to-centroid vector.
    for (const c of cells) {
        ctx.strokeStyle = c.hit ? 'rgba(80, 220, 120, 0.9)' : 'rgba(240, 120, 60, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c.targetX, c.targetY);
        ctx.lineTo(c.centroidX, c.centroidY);
        ctx.stroke();

        ctx.fillStyle = c.hit ? 'rgba(80, 220, 120, 0.95)' : 'rgba(240, 120, 60, 0.95)';
        ctx.beginPath();
        ctx.arc(c.centroidX, c.centroidY, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // Legend.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(12, 12, 220, 64);
    ctx.fillStyle = '#fff';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(`samples: ${samples.length}`, 20, 30);
    ctx.fillText(`cells: ${cells.length}/${rows * cols}`, 20, 46);
    ctx.fillText(`error ramp: 0 → ${Math.round(maxErr)} px (p95)`, 20, 62);

    return canvas;
}

export function downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function downloadCanvasPng(filename: string, canvas: HTMLCanvasElement): void {
    canvas.toBlob(blob => {
        if (blob) downloadBlob(filename, blob);
    }, 'image/png');
}

export function tsStamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * POST a blob to the dev-mode save endpoint (vite.config.ts middleware)
 * so the file lands in `gaze_result/` automatically with a mode-tagged
 * filename. Returns `{ok: false}` silently in production builds (the
 * endpoint simply doesn't exist) so callers can still fall back to the
 * manual download buttons.
 */
export async function autoSaveToServer(
    filename: string,
    blob: Blob
): Promise<{ ok: boolean; path?: string; error?: string }> {
    try {
        const res = await fetch(
            `/__benchmark/save?filename=${encodeURIComponent(filename)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': blob.type || 'application/octet-stream' },
                body: blob,
            }
        );
        if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status}` };
        }
        const j = (await res.json().catch(() => ({}))) as { path?: string };
        return { ok: true, path: j.path };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
}
