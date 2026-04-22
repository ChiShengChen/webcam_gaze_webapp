/**
 * Positioning coach — pre-calibration quality gate for FaceMesh mode.
 *
 * Runs before the calibration UI (9-dot or smooth-pursuit) to guard
 * against the "calibration runs fine but tracker is terrible" failure
 * mode. Four checks, each per-frame:
 *
 *   1. Face centred in the frame — FaceMesh loses landmarks as the face
 *      approaches the frame edge.
 *   2. Distance (via iris diameter) — too close: head movement dominates
 *      the signal; too far: iris resolution drops below jitter floor.
 *   3. Head tilt — roll / yaw / pitch each within ~17°. Extreme angles
 *      distort the geometric features more than KRR can absorb from a
 *      short calibration.
 *   4. Lighting — mean luminance in the usable range AND left/right
 *      symmetry above threshold. Side-lighting kills eye-corner
 *      localisation; over-/under-exposed frames starve the iris signal.
 *
 * Auto-proceeds when all four checks stay green for `holdMs` (default
 * 1.5 s). User can bypass with "Start anyway" if they've made peace with
 * the trade-offs.
 */

import type { FaceMeshGazeEngine } from '../gaze/engine';
import type { Features } from '../gaze/features';

export interface CoachConfig {
    /** All-green hold time before auto-proceeding. */
    holdMs: number;
    /** Iris radius normalised to frame width, lower bound (face too far). */
    minIrisRadius: number;
    /** Upper bound (face too close). */
    maxIrisRadius: number;
    /** Max face-centre distance from frame centre, each axis (normalised). */
    maxFaceOffset: number;
    /** Max absolute roll / yaw-proxy / pitch-proxy. Roll is radians;
     *  yaw/pitch are our cheap geometric proxies (see features.ts). */
    maxRollRad: number;
    maxYaw: number;
    maxPitch: number;
    /** Mean luminance range [minLuminance, maxLuminance] in [0, 255]. */
    minLuminance: number;
    maxLuminance: number;
    /** Minimum left/right luminance symmetry (0..1, 1 = perfectly symmetric). */
    minLightSymmetry: number;
}

const DEFAULT: CoachConfig = {
    holdMs: 1500,
    minIrisRadius: 0.0035,    // ~70 cm from a 640px-wide camera
    maxIrisRadius: 0.0090,    // ~35 cm
    maxFaceOffset: 0.18,
    maxRollRad: 0.30,         // ~17°
    maxYaw: 0.30,
    maxPitch: 0.30,
    minLuminance: 50,
    maxLuminance: 215,
    minLightSymmetry: 0.55,
};

export interface CoachResult {
    proceeded: boolean;       // true = gate passed, false = user cancelled
    autoStarted: boolean;     // true = auto-proceed fired; false = manual "Start anyway"
    elapsedMs: number;
}

interface CheckState {
    pass: boolean;
    detail: string;
}

interface Assessment {
    face: CheckState;
    distance: CheckState;
    tilt: CheckState;
    lighting: CheckState;
    allGreen: boolean;
    score: number;
}

const STYLE_ID = 'coach-overlay-style';

const CSS = `
#coach-overlay {
    position: fixed; inset: 0; z-index: 9400;
    background: rgba(8, 8, 12, 0.96);
    display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
    color: #ddd;
}
#coach-panel {
    max-width: 720px; width: calc(100% - 48px);
    background: #15151b; border: 1px solid #2a2a35;
    border-radius: 14px;
    padding: 22px 26px;
    display: flex; flex-direction: column; gap: 16px;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45);
}
#coach-panel h2 {
    margin: 0; font-size: 17px; font-weight: 600; color: #9cf;
    letter-spacing: 0.3px;
}
#coach-preview {
    width: 100%; aspect-ratio: 16 / 9;
    border-radius: 8px; background: #000;
    transform: scaleX(-1);
    object-fit: cover;
    border: 1px solid #2a2a35;
}
#coach-checks { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
#coach-checks .check {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; background: #1c1c24; border-radius: 7px;
    border-left: 3px solid #555;
}
#coach-checks .check.pass { border-left-color: #4c8; }
#coach-checks .check.fail { border-left-color: #d64; }
#coach-checks .check .icon {
    width: 18px; text-align: center; font-weight: 700;
}
#coach-checks .check.pass .icon { color: #4c8; }
#coach-checks .check.fail .icon { color: #d64; }
#coach-checks .check .label { flex: 0 0 120px; color: #eee; font-weight: 500; }
#coach-checks .check .detail { color: #999; font-family: ui-monospace, monospace; font-size: 12px; }

#coach-score {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; background: #1c1c24; border-radius: 7px;
}
#coach-score .bar { flex: 1; height: 10px; background: #2a2a35; border-radius: 5px; overflow: hidden; }
#coach-score .bar .fill {
    height: 100%; background: linear-gradient(to right, #d64, #fa4, #4c8);
    transition: width 120ms linear;
}
#coach-score .num { font-family: ui-monospace, monospace; font-size: 14px; color: #fff; min-width: 70px; text-align: right; }

#coach-status {
    font-size: 12px; font-family: ui-monospace, monospace;
    color: #888; text-align: center;
    min-height: 18px;
}
#coach-status.holding { color: #fd7; }
#coach-status.noface { color: #fa4; }

#coach-actions { display: flex; gap: 10px; justify-content: flex-end; }
#coach-actions button {
    padding: 8px 18px; border-radius: 8px; font-size: 13px;
    border: 1px solid #333; cursor: pointer;
    background: #2a2a35; color: #fff;
}
#coach-actions button.primary { background: #2a5; border-color: #2a5; }
#coach-actions button.primary:hover { filter: brightness(1.15); }
#coach-actions button:hover { background: #333; }
`;

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
}

function assess(features: Features | null, lum: LuminanceSample | null, cfg: CoachConfig): Assessment {
    // If we don't have a face yet, everything fails but we want readable details.
    if (!features) {
        const noFace: CheckState = { pass: false, detail: 'no face detected' };
        const noLight: CheckState = lum
            ? assessLighting(lum, cfg)
            : { pass: false, detail: 'sampling…' };
        return {
            face: noFace,
            distance: noFace,
            tilt: noFace,
            lighting: noLight,
            allGreen: false,
            score: 0,
        };
    }

    const face = assessFace(features, cfg);
    const distance = assessDistance(features, cfg);
    const tilt = assessTilt(features, cfg);
    const lighting = lum ? assessLighting(lum, cfg) : { pass: false, detail: 'sampling…' };

    const passed = [face, distance, tilt, lighting].filter(c => c.pass).length;
    return {
        face, distance, tilt, lighting,
        allGreen: passed === 4,
        score: Math.round((passed / 4) * 100),
    };
}

function assessFace(f: Features, cfg: CoachConfig): CheckState {
    // Face centre in the normalised image space; 0.5 is dead centre.
    const fb = f.faceBox;
    const cx = fb.x + fb.w / 2;
    const cy = fb.y + fb.h / 2;
    const offsetX = Math.abs(cx - 0.5);
    const offsetY = Math.abs(cy - 0.5);
    const pass = offsetX < cfg.maxFaceOffset && offsetY < cfg.maxFaceOffset;
    const dir: string[] = [];
    if (cx < 0.5 - cfg.maxFaceOffset) dir.push('move right');
    else if (cx > 0.5 + cfg.maxFaceOffset) dir.push('move left');
    if (cy < 0.5 - cfg.maxFaceOffset) dir.push('move down');
    else if (cy > 0.5 + cfg.maxFaceOffset) dir.push('move up');
    return {
        pass,
        detail: pass
            ? `centred (${cx.toFixed(2)}, ${cy.toFixed(2)})`
            : dir.length ? dir.join(' / ') : `off-centre (${cx.toFixed(2)}, ${cy.toFixed(2)})`,
    };
}

function assessDistance(f: Features, cfg: CoachConfig): CheckState {
    const irisRadius = f.vector[12]; // features.ts layout: index 12 = irisRadius
    if (irisRadius < cfg.minIrisRadius) {
        return { pass: false, detail: `too far (iris r=${irisRadius.toFixed(4)}) — move closer` };
    }
    if (irisRadius > cfg.maxIrisRadius) {
        return { pass: false, detail: `too close (iris r=${irisRadius.toFixed(4)}) — move back` };
    }
    return { pass: true, detail: `iris r=${irisRadius.toFixed(4)}` };
}

function assessTilt(f: Features, cfg: CoachConfig): CheckState {
    const yaw = f.vector[6];   // indices 6, 7, 8 per features.ts
    const pitch = f.vector[7];
    const roll = f.vector[8];
    const rollDeg = roll * 180 / Math.PI;
    const problems: string[] = [];
    if (Math.abs(roll) > cfg.maxRollRad) problems.push(`level head (${rollDeg.toFixed(0)}°)`);
    if (Math.abs(yaw) > cfg.maxYaw) problems.push('face camera');
    if (Math.abs(pitch) > cfg.maxPitch) problems.push(pitch > 0 ? 'lift chin' : 'lower chin');
    if (problems.length === 0) {
        return { pass: true, detail: `roll ${rollDeg.toFixed(0)}° · yaw ${yaw.toFixed(2)} · pitch ${pitch.toFixed(2)}` };
    }
    return { pass: false, detail: problems.join(' · ') };
}

function assessLighting(lum: LuminanceSample, cfg: CoachConfig): CheckState {
    if (lum.mean < cfg.minLuminance) return { pass: false, detail: `too dark (${lum.mean.toFixed(0)})` };
    if (lum.mean > cfg.maxLuminance) return { pass: false, detail: `too bright (${lum.mean.toFixed(0)})` };
    if (lum.symmetry < cfg.minLightSymmetry) return {
        pass: false,
        detail: `uneven light (L ${lum.leftMean.toFixed(0)} / R ${lum.rightMean.toFixed(0)})`,
    };
    return { pass: true, detail: `mean ${lum.mean.toFixed(0)} · sym ${(lum.symmetry * 100).toFixed(0)}%` };
}

// --- Lighting sampler (downscaled canvas read, ~5 Hz) ---

interface LuminanceSample {
    mean: number;
    leftMean: number;
    rightMean: number;
    symmetry: number;
}

const SAMPLE_W = 160;
const SAMPLE_H = 90;
const SAMPLE_INTERVAL_MS = 200;

class LightingSampler {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private lastSampleMs = 0;
    private last: LuminanceSample | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = SAMPLE_W;
        this.canvas.height = SAMPLE_H;
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('coach: cannot create 2d context for luminance sampler');
        this.ctx = ctx;
    }

    sample(video: HTMLVideoElement, nowMs: number): LuminanceSample | null {
        if (nowMs - this.lastSampleMs < SAMPLE_INTERVAL_MS) return this.last;
        if (video.videoWidth === 0 || video.videoHeight === 0) return this.last;
        this.lastSampleMs = nowMs;
        try {
            this.ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
            const data = this.ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
            let totalY = 0;
            let leftY = 0;
            let rightY = 0;
            const mid = SAMPLE_W / 2;
            for (let y = 0; y < SAMPLE_H; y++) {
                for (let x = 0; x < SAMPLE_W; x++) {
                    const i = (y * SAMPLE_W + x) * 4;
                    // Rec.601 luma.
                    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    totalY += lum;
                    if (x < mid) leftY += lum; else rightY += lum;
                }
            }
            const total = SAMPLE_W * SAMPLE_H;
            const meanY = totalY / total;
            const leftMeanY = leftY / (total / 2);
            const rightMeanY = rightY / (total / 2);
            const sym = Math.min(leftMeanY, rightMeanY) / Math.max(leftMeanY, rightMeanY, 1e-6);
            this.last = { mean: meanY, leftMean: leftMeanY, rightMean: rightMeanY, symmetry: sym };
        } catch {
            // CORS / frame not ready / etc — just skip this tick.
        }
        return this.last;
    }
}

// --- Main class ---

export class PositioningCoach {
    private readonly cfg: CoachConfig;
    private readonly engine: FaceMeshGazeEngine;
    private latestFeatures: Features | null = null;
    private running = false;
    private greenStartMs = 0;
    private startedMs = 0;
    private rafId = 0;
    private sampler = new LightingSampler();
    private onDone: ((r: CoachResult) => void) | null = null;
    private unsubFrame: (() => void) | null = null;

    private root: HTMLDivElement | null = null;
    private previewEl: HTMLVideoElement | null = null;
    private checkEls: Partial<Record<keyof Assessment, HTMLElement>> = {};
    private scoreFill: HTMLElement | null = null;
    private scoreNum: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;

    constructor(engine: FaceMeshGazeEngine, cfg: Partial<CoachConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };
        this.engine = engine;
    }

    start(onDone: (r: CoachResult) => void): void {
        if (this.running) return;
        this.onDone = onDone;
        this.running = true;
        this.startedMs = performance.now();
        this.greenStartMs = 0;

        this.buildOverlay();

        // Subscribe to FaceMesh frames; cache the latest Features.
        const handler = (f: Features) => { this.latestFeatures = f; };
        this.engine.onFrame(handler);
        // The engine has no off() today; leave handler registered, rely on
        // `running` flag inside the assess loop. Set unsubFrame so future
        // refactors can remove it cleanly.
        this.unsubFrame = () => { /* noop — engine lacks off() */ };

        const preview = this.previewEl!;
        this.engine.attachPreview(preview);

        this.loop();
    }

    abort(): void {
        this.finish(false, false);
    }

    private loop = (): void => {
        if (!this.running) return;
        const nowMs = performance.now();
        const video = this.engine.videoElement;
        const lum = video ? this.sampler.sample(video, nowMs) : null;
        const a = assess(this.latestFeatures, lum, this.cfg);

        this.renderCheck('face', '1. Face centred', a.face);
        this.renderCheck('distance', '2. Distance', a.distance);
        this.renderCheck('tilt', '3. Head tilt', a.tilt);
        this.renderCheck('lighting', '4. Lighting', a.lighting);
        if (this.scoreFill) this.scoreFill.style.width = `${a.score}%`;
        if (this.scoreNum) this.scoreNum.textContent = `${a.score} / 100`;

        if (!this.latestFeatures) {
            this.statusEl!.textContent = 'Looking for your face…';
            this.statusEl!.className = 'noface';
        } else if (a.allGreen) {
            if (this.greenStartMs === 0) this.greenStartMs = nowMs;
            const held = nowMs - this.greenStartMs;
            const pct = Math.min(100, (held / this.cfg.holdMs) * 100);
            this.statusEl!.textContent = `All green — auto-starting in ${Math.max(0, (this.cfg.holdMs - held) / 1000).toFixed(1)}s  [${'█'.repeat(Math.floor(pct / 5))}${'░'.repeat(20 - Math.floor(pct / 5))}]`;
            this.statusEl!.className = 'holding';
            if (held >= this.cfg.holdMs) {
                this.finish(true, true);
                return;
            }
        } else {
            this.greenStartMs = 0;
            this.statusEl!.textContent = 'Fix the red checks above, or press Start anyway.';
            this.statusEl!.className = '';
        }

        this.rafId = requestAnimationFrame(this.loop);
    };

    private renderCheck(key: keyof Assessment, label: string, c: CheckState): void {
        let el = this.checkEls[key];
        if (!el) return;
        el.className = `check ${c.pass ? 'pass' : 'fail'}`;
        el.innerHTML = `
            <span class="icon">${c.pass ? '✓' : '·'}</span>
            <span class="label">${label}</span>
            <span class="detail">${c.detail}</span>
        `;
    }

    private buildOverlay(): void {
        ensureStyles();
        const root = document.createElement('div');
        root.id = 'coach-overlay';
        root.innerHTML = `
            <div id="coach-panel">
                <h2>Positioning coach</h2>
                <video id="coach-preview" autoplay playsinline muted></video>
                <div id="coach-checks">
                    <div class="check" data-key="face"></div>
                    <div class="check" data-key="distance"></div>
                    <div class="check" data-key="tilt"></div>
                    <div class="check" data-key="lighting"></div>
                </div>
                <div id="coach-score">
                    <div class="bar"><div class="fill" style="width: 0%"></div></div>
                    <div class="num">0 / 100</div>
                </div>
                <div id="coach-status"></div>
                <div id="coach-actions">
                    <button type="button" class="cancel">Cancel</button>
                    <button type="button" class="primary override">Start anyway</button>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        this.root = root;
        this.previewEl = root.querySelector<HTMLVideoElement>('#coach-preview');
        this.scoreFill = root.querySelector<HTMLElement>('#coach-score .fill');
        this.scoreNum = root.querySelector<HTMLElement>('#coach-score .num');
        this.statusEl = root.querySelector<HTMLElement>('#coach-status');

        root.querySelectorAll<HTMLElement>('.check').forEach(el => {
            const k = el.dataset.key as keyof Assessment;
            if (k) this.checkEls[k] = el;
        });

        root.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => this.finish(false, false);
        root.querySelector<HTMLButtonElement>('.override')!.onclick = () => this.finish(true, false);
    }

    private finish(proceeded: boolean, autoStarted: boolean): void {
        if (!this.running) return;
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.root?.remove();
        this.root = null;
        this.unsubFrame?.();
        this.unsubFrame = null;
        const cb = this.onDone;
        this.onDone = null;
        cb?.({
            proceeded,
            autoStarted,
            elapsedMs: performance.now() - this.startedMs,
        });
    }
}
