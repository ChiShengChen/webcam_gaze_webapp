/**
 * Image-gaze capture mode — produces GazeMedSeg-format fixation annotations
 * from this project's webcam gaze, so they can be swapped in for the EyeLink
 * gaze that GazeMedSeg (Zhong et al., MICCAI 2024) released for Kvasir-SEG.
 *
 * Protocol (mirrors GazeMedSeg's free-viewing collection): each image is shown
 * full-screen; the annotator free-views it for `viewMs` (default 8 s, ≈ their
 * 8.8 s/image) or presses Space to advance. Gaze is classified online by the
 * controller's I-VT classifier; each fixation episode (a run of FIXATION state)
 * is recorded as one row.
 *
 * Output CSV columns match `kvasir_fixation.csv` exactly so their
 * `generate_gaze_annotation_kvasir.ipynb` notebook consumes it unchanged:
 *   IMAGE, CURRENT_FIX_INDEX, CURRENT_FIX_X, CURRENT_FIX_Y,
 *   CURRENT_FIX_DURATION, CURRENT_FIX_PUPIL, CURRENT_FIX_START,
 *   IMAGE_HEIGHT, IMAGE_WIDTH
 * X/Y are normalised 0..1 to the displayed image rectangle (their convention);
 * DURATION and START are in ms; PUPIL is a dummy (the notebook ignores it).
 *
 * The capture taps `GazeController.onSnapped`, which already emits the I-VT
 * state and, during fixations, the running centroid — so a fixation row is just
 * "centroid at the last FIXATION sample, duration = last − first FIXATION time".
 */

import type { GazeController } from '../control/controller';

export interface ImageGazeConfig {
    /** Free-view duration per image before auto-advance (ms). */
    viewMs: number;
    /** Drop fixations shorter than this (ms); GazeMedSeg's min is 50 ms. */
    minFixationMs: number;
    /** Manifest URL (JSON array of image filenames under imageBase). */
    manifestUrl: string;
    /** Base path the filenames are served from. */
    imageBase: string;
    /** Optional cap on number of images (pilot runs). null = all. */
    limit: number | null;
    /** Batch this run: 1-based part index out of `parts` equal chunks of the
     *  full manifest. null = no batching (whole manifest, subject to limit). */
    part: number | null;
    /** Number of equal batches the manifest is split into. */
    parts: number;
}

const DEFAULT: ImageGazeConfig = {
    viewMs: 6000,
    minFixationMs: 50,
    manifestUrl: '/kvasir/manifest.json',
    imageBase: '/kvasir/images/',
    limit: null,
    part: null,
    parts: 4,
};

interface FixRow {
    image: string;
    index: number;
    x: number;        // normalised 0..1
    y: number;        // normalised 0..1
    durationMs: number;
    startMs: number;  // from image onset
    imgW: number;
    imgH: number;
}

const STYLE_ID = 'img-gaze-style';
const CSS = `
#ig-overlay { position: fixed; inset: 0; z-index: 9600; background: #15171c;
  display: flex; align-items: center; justify-content: center; }
#ig-img { max-width: 92vw; max-height: 88vh; display: block;
  box-shadow: 0 0 0 1px #3a3f4b; }
#ig-hud { position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 9601; color: #cdd3df; font: 13px/1.4 ui-monospace, monospace;
  background: rgba(0,0,0,.55); padding: 6px 12px; border-radius: 6px;
  text-align: center; pointer-events: none; }
#ig-hud b { color: #9f9; }
#ig-bar { position: fixed; left: 0; bottom: 0; height: 4px; background: #fd7;
  z-index: 9601; width: 0; transition: width .1s linear; }
#ig-start { position: fixed; inset: 0; z-index: 9602; background: #11131a;
  color: #e8ecf4; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; text-align: center; font-family: system-ui, sans-serif; }
#ig-start h2 { margin: 0; font-size: 22px; }
#ig-start p { margin: 0; max-width: 560px; color: #aab2c2; line-height: 1.5; }
#ig-start button { font-size: 16px; padding: 10px 26px; border-radius: 8px;
  border: 0; background: #fd7; color: #1a1a1a; font-weight: 600; cursor: pointer; }
`;

export class ImageGazeCapture {
    private readonly cfg: ImageGazeConfig;
    private readonly controller: GazeController;
    private images: string[] = [];
    private rows: FixRow[] = [];
    private idx = 0;
    private batchLabel = '';
    private curName = '';
    private lastGazeMs = 0;

    // current-image state
    private imgEl!: HTMLImageElement;
    private imgOnsetMs = 0;
    private advanceTimer: number | null = null;
    private fixIndex = 0;

    // current open fixation
    private fix: { sumGate: boolean; lastX: number; lastY: number; startMs: number; lastMs: number } | null = null;
    private inFixation = false;

    private overlay!: HTMLDivElement;
    private hud!: HTMLDivElement;
    private bar!: HTMLDivElement;
    private rafId = 0;
    private onDone: ((csv: string, rows: number, images: number) => void) | null = null;
    private snappedHandler: (x: number, y: number, state: 'FIXATION' | 'SACCADE', t: number) => void;

    constructor(controller: GazeController, cfg: Partial<ImageGazeConfig> = {}) {
        this.controller = controller;
        this.cfg = { ...DEFAULT, ...cfg };
        this.snappedHandler = (x, y, state, t) => this.onGaze(x, y, state, t);
    }

    async start(onDone: (csv: string, rows: number, images: number) => void): Promise<void> {
        this.onDone = onDone;
        const all: string[] = await fetch(this.cfg.manifestUrl).then(r => r.json());
        if (this.cfg.part) {
            // Equal contiguous batches; the last part absorbs any remainder.
            const n = this.cfg.parts;
            const p = Math.min(Math.max(1, this.cfg.part), n);
            const chunk = Math.ceil(all.length / n);
            const start = (p - 1) * chunk;
            const end = p === n ? all.length : Math.min(all.length, start + chunk);
            this.images = all.slice(start, end);
            this.batchLabel = ` (part ${p}/${n}, images ${start + 1}–${end})`;
        } else {
            this.images = this.cfg.limit ? all.slice(0, this.cfg.limit) : all;
        }
        this.injectStyle();
        this.showStartScreen();
    }

    private injectStyle(): void {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID; s.textContent = CSS;
        document.head.appendChild(s);
    }

    private showStartScreen(): void {
        const s = document.createElement('div');
        s.id = 'ig-start';
        s.innerHTML = `
            <h2>Image gaze capture — ${this.images.length} images${this.batchLabel}</h2>
            <p>Look <b>naturally at the lesion / region of interest</b> in each image,
            the way you would describe it. Each image shows for
            ${(this.cfg.viewMs / 1000).toFixed(0)} s; press <b>Space</b> to advance early,
            <b>Esc</b> to stop and export what you have.</p>
            <button id="ig-go">Start</button>`;
        document.body.appendChild(s);
        (s.querySelector('#ig-go') as HTMLButtonElement).addEventListener('click', () => {
            s.remove();
            this.beginCapture();
        });
    }

    private beginCapture(): void {
        this.overlay = document.createElement('div');
        this.overlay.id = 'ig-overlay';
        this.imgEl = document.createElement('img');
        this.imgEl.id = 'ig-img';
        this.overlay.appendChild(this.imgEl);

        this.hud = document.createElement('div');
        this.hud.id = 'ig-hud';
        this.bar = document.createElement('div');
        this.bar.id = 'ig-bar';

        document.body.append(this.overlay, this.hud, this.bar);

        this.controller.onSnapped(this.snappedHandler);
        window.addEventListener('keydown', this.onKey);
        this.loadImage(0);
        this.tickBar();
    }

    private onKey = (e: KeyboardEvent): void => {
        if (e.code === 'Space') { e.preventDefault(); this.advance(); }
        else if (e.code === 'Escape') { e.preventDefault(); this.finish(); }
    };

    private loadImage(i: number): void {
        this.idx = i;
        this.closeFixation();           // safety
        this.fix = null; this.inFixation = false; this.fixIndex = 0;
        this.controller.reset();        // fresh I-VT per image

        const name = this.images[i];
        this.curName = name;
        this.imgEl.onload = () => {
            this.imgOnsetMs = performance.now();
            this.renderHud();
            if (this.advanceTimer) clearTimeout(this.advanceTimer);
            this.advanceTimer = window.setTimeout(() => this.advance(), this.cfg.viewMs);
        };
        this.imgEl.src = this.cfg.imageBase + name;
    }

    /** Top HUD: progress + per-image fixation count + a green/grey dot that
     *  signals gaze is currently arriving (liveness without showing position,
     *  so the viewer can't chase a cursor). */
    private renderHud(): void {
        const live = performance.now() - this.lastGazeMs < 300;
        const dot = live ? '<span style="color:#9f9">&#9679; tracking</span>'
                         : '<span style="color:#e88">&#9679; no gaze</span>';
        this.hud.innerHTML = `image <b>${this.idx + 1}</b> / ${this.images.length}`
            + ` &nbsp;·&nbsp; ${this.curName} &nbsp;·&nbsp; ${this.fixIndex} fix &nbsp;·&nbsp; ${dot}`;
    }

    private advance(): void {
        this.closeFixation();
        if (this.idx + 1 >= this.images.length) { this.finish(); return; }
        this.loadImage(this.idx + 1);
    }

    /** Assemble fixations from the I-VT state stream. */
    private onGaze(x: number, y: number, state: 'FIXATION' | 'SACCADE', tMs: number): void {
        this.lastGazeMs = performance.now();   // liveness for the HUD dot
        if (state === 'FIXATION') {
            if (!this.inFixation) {
                this.inFixation = true;
                this.fix = { sumGate: true, lastX: x, lastY: y, startMs: tMs, lastMs: tMs };
            } else if (this.fix) {
                this.fix.lastX = x;       // controller already feeds the running centroid
                this.fix.lastY = y;
                this.fix.lastMs = tMs;
            }
        } else {
            this.closeFixation();
        }
    }

    private closeFixation(): void {
        const f = this.fix;
        this.inFixation = false;
        this.fix = null;
        if (!f) return;
        const durationMs = f.lastMs - f.startMs;
        if (durationMs < this.cfg.minFixationMs) return;

        const rect = this.imgEl.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const nx = (f.lastX - rect.left) / rect.width;
        const ny = (f.lastY - rect.top) / rect.height;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;   // gaze off the image

        this.fixIndex++;
        this.rows.push({
            image: this.images[this.idx],
            index: this.fixIndex,
            x: nx, y: ny,
            durationMs: Math.round(durationMs),
            startMs: Math.round(f.startMs - this.imgOnsetMs),
            imgW: this.imgEl.naturalWidth,
            imgH: this.imgEl.naturalHeight,
        });
    }

    private tickBar = (): void => {
        const elapsed = performance.now() - this.imgOnsetMs;
        const frac = Math.max(0, Math.min(1, elapsed / this.cfg.viewMs));
        this.bar.style.width = `${frac * 100}%`;
        this.renderHud();
        this.rafId = requestAnimationFrame(this.tickBar);
    };

    private finish(): void {
        if (this.advanceTimer) clearTimeout(this.advanceTimer);
        cancelAnimationFrame(this.rafId);
        window.removeEventListener('keydown', this.onKey);
        this.overlay?.remove(); this.hud?.remove(); this.bar?.remove();

        const imagesCovered = new Set(this.rows.map(r => r.image)).size;
        this.onDone?.(this.toCsv(), this.rows.length, imagesCovered);
    }

    private toCsv(): string {
        const header = 'IMAGE,CURRENT_FIX_INDEX,CURRENT_FIX_X,CURRENT_FIX_Y,' +
            'CURRENT_FIX_DURATION,CURRENT_FIX_PUPIL,CURRENT_FIX_START,IMAGE_HEIGHT,IMAGE_WIDTH';
        const lines = this.rows.map(r =>
            [r.image, r.index, r.x.toFixed(10), r.y.toFixed(10),
             r.durationMs, 0, r.startMs, r.imgH.toFixed(1), r.imgW.toFixed(1)].join(','));
        return [header, ...lines].join('\n') + '\n';
    }
}
