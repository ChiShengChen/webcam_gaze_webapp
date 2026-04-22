/**
 * Benchmark overlay — full-screen canvas + HUD for the Z-pattern sweep.
 *
 * Draws the 16×8 grid (16 cols × 8 rows, per the spec), highlights the
 * current target cell with a dwell-progress fill, and surfaces a minimal
 * HUD (progress text + abort button). All visuals live on a single canvas
 * so frame-to-frame redraws are cheap.
 */

export interface OverlayHandles {
    root: HTMLDivElement;
    canvas: HTMLCanvasElement;
    cellLabel: HTMLSpanElement;
    abortBtn: HTMLButtonElement;
    summary: HTMLDivElement;
    destroy: () => void;
}

const STYLE_ID = 'benchmark-overlay-style';

const CSS = `
#benchmark-overlay {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(8, 8, 12, 0.94);
    display: none;
}
#benchmark-overlay.active { display: block; }
#benchmark-overlay canvas {
    position: absolute; inset: 0; width: 100%; height: 100%;
    display: block;
}
#benchmark-hud {
    position: fixed; top: 18px; left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    color: #fff; padding: 10px 18px;
    border-radius: 24px; font-family: ui-monospace, monospace;
    font-size: 13px; letter-spacing: 0.3px;
    display: flex; align-items: center; gap: 14px;
    z-index: 10001;
}
#benchmark-hud .cell-label b { color: #9cf; }
#benchmark-hud button {
    background: #633; color: #fff; border: 1px solid #844;
    padding: 5px 12px; border-radius: 14px; cursor: pointer; font-size: 12px;
}
#benchmark-hud button:hover { background: #744; }
#benchmark-summary {
    position: fixed; inset: 0; display: none;
    align-items: center; justify-content: center;
    z-index: 10002; background: rgba(0, 0, 0, 0.9);
    color: #ddd; font-family: system-ui, sans-serif;
    padding: 24px;
}
#benchmark-summary .panel {
    max-width: 880px; width: 100%;
    background: #15151b; border: 1px solid #333;
    border-radius: 10px; padding: 20px 24px;
    display: flex; flex-direction: column; gap: 14px;
}
#benchmark-summary h2 { margin: 0; font-size: 18px; color: #9cf; }
#benchmark-summary .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 13px; }
#benchmark-summary .metrics div { background: #1e1e26; padding: 10px; border-radius: 6px; }
#benchmark-summary .metrics b { display: block; color: #fff; font-size: 16px; margin-top: 3px; }
#benchmark-summary .preview { max-width: 100%; border-radius: 6px; border: 1px solid #333; }
#benchmark-summary .actions { display: flex; gap: 10px; flex-wrap: wrap; }
#benchmark-summary .actions button {
    background: #2a5; color: #fff; border: none; padding: 8px 16px;
    border-radius: 6px; cursor: pointer; font-size: 13px;
}
#benchmark-summary .actions button.secondary { background: #444; }
#benchmark-summary .actions button:hover { filter: brightness(1.15); }
`;

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
}

export function createOverlay(): OverlayHandles {
    ensureStyles();

    const root = document.createElement('div');
    root.id = 'benchmark-overlay';

    const canvas = document.createElement('canvas');
    root.appendChild(canvas);

    const hud = document.createElement('div');
    hud.id = 'benchmark-hud';
    hud.innerHTML = `
        <span class="cell-label">Cell <b id="bench-cell-idx">0</b> / <b id="bench-cell-total">0</b></span>
        <span class="cell-coord">row <b id="bench-cell-row">0</b>, col <b id="bench-cell-col">0</b></span>
        <span class="cell-progress"><b id="bench-dwell">0.0s</b></span>
        <button type="button">Abort</button>
    `;
    const abortBtn = hud.querySelector('button')!;

    const summary = document.createElement('div');
    summary.id = 'benchmark-summary';
    summary.innerHTML = `
        <div class="panel">
            <h2>Benchmark complete</h2>
            <div class="metrics">
                <div>cells covered<b id="sum-cells">0 / 0</b></div>
                <div>mean error<b id="sum-mean">— px</b></div>
                <div>median error<b id="sum-median">— px</b></div>
                <div>hit rate<b id="sum-hit">— %</b></div>
            </div>
            <img id="sum-preview" class="preview" alt="gazemap preview" />
            <div class="actions">
                <button id="sum-download-csv">Download CSV</button>
                <button id="sum-download-png">Download gazemap PNG</button>
                <button id="sum-close" class="secondary">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(root);
    document.body.appendChild(hud);
    document.body.appendChild(summary);

    const cellLabel = hud.querySelector<HTMLSpanElement>('.cell-label')!;

    function destroy(): void {
        root.remove();
        hud.remove();
        summary.remove();
    }

    return { root, canvas, cellLabel, abortBtn, summary, destroy };
}

/** Resize the overlay canvas to match the viewport (in device pixels). */
export function sizeCanvas(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export interface DrawFrameArgs {
    rows: number;
    cols: number;
    activeRow: number;
    activeCol: number;
    dwellProgress: number;
    recentGaze: { x: number; y: number } | null;
}

/** Redraw grid + current cell highlight + live gaze marker. */
export function drawFrame(canvas: HTMLCanvasElement, a: DrawFrameArgs): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const cellW = w / a.cols;
    const cellH = h / a.rows;

    // Grid lines (subtle).
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < a.cols; c++) {
        const x = Math.round(c * cellW) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
    }
    for (let r = 1; r < a.rows; r++) {
        const y = Math.round(r * cellH) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Active cell backing.
    const ax = a.activeCol * cellW;
    const ay = a.activeRow * cellH;
    ctx.fillStyle = 'rgba(255, 215, 0, 0.06)';
    ctx.fillRect(ax, ay, cellW, cellH);

    // Active cell border + progress fill (fills bottom-up as dwell advances).
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ax + 1, ay + 1, cellW - 2, cellH - 2);

    const p = Math.max(0, Math.min(1, a.dwellProgress));
    const fillH = cellH * p;
    ctx.fillStyle = 'rgba(255, 215, 0, 0.22)';
    ctx.fillRect(ax, ay + (cellH - fillH), cellW, fillH);

    // Target crosshair at cell centre.
    const cx = ax + cellW / 2;
    const cy = ay + cellH / 2;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
    ctx.stroke();

    // Live gaze mark (so the user can confirm the tracker still works).
    if (a.recentGaze) {
        ctx.fillStyle = 'rgba(240, 80, 80, 0.85)';
        ctx.beginPath();
        ctx.arc(a.recentGaze.x, a.recentGaze.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}
