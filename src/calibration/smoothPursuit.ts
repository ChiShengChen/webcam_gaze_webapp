/**
 * Smooth-pursuit calibration runner.
 *
 * Replaces the 9-point click calibration (~45 samples, sparse) with a
 * continuously moving target the user tracks with their eyes for ~18 s
 * (~500 samples at 30 Hz). The sample density is what lets a non-linear
 * regression head like KRR actually model the eye-to-screen mapping —
 * 45 samples with an RBF kernel barely exceeds linear ridge, 500 samples
 * genuinely lets the non-linearity breathe.
 *
 * Path: Lissajous with 3:2 frequency ratio. Gives a figure-eight-ish
 * curve that covers the full screen including corners. Amplitude is
 * 82 % of half-screen so the target never actually touches the edge
 * (easier on the user + keeps FaceMesh tracking stable).
 *
 * Phases:
 *   1. Countdown (~3 s): target stationary at centre, "3…2…1" overlay.
 *   2. Pursuit (durationMs): target moves along the Lissajous curve,
 *      samples recorded at ~30 Hz via `onSample(targetX, targetY)`.
 *   3. Ended: overlay torn down, `onDone` fires with accept/reject counts.
 *
 * Sample acceptance is delegated — `onSample` returns a boolean so the
 * engine can reject blinks / missing face / out-of-bounds frames. The
 * runner just counts.
 */

export interface SmoothPursuitConfig {
    durationMs: number;
    countdownMs: number;
    /** Minimum gap between onSample calls; 33 ms = ~30 Hz matches FaceMesh. */
    sampleIntervalMs: number;
    /** Lissajous x-frequency (cycles over the full duration). */
    cyclesX: number;
    /** Lissajous y-frequency. Pair 3:2 works well in 16:9. */
    cyclesY: number;
    /** Amplitude as fraction of half-screen (0..1). */
    amplitude: number;
}

const DEFAULT: SmoothPursuitConfig = {
    durationMs: 18000,
    countdownMs: 3000,
    sampleIntervalMs: 33,
    cyclesX: 3,
    cyclesY: 2,
    amplitude: 0.82,
};

export interface SmoothPursuitResult {
    totalCalls: number;
    accepted: number;
    rejected: number;
    aborted: boolean;
    elapsedMs: number;
}

type SampleFn = (x: number, y: number) => boolean;

const STYLE_ID = 'smooth-pursuit-overlay-style';

const CSS = `
#sp-overlay {
    position: fixed; inset: 0; z-index: 9500;
    background: #0a0a10;
    overflow: hidden;
}
#sp-overlay canvas {
    position: absolute; inset: 0; width: 100%; height: 100%;
    display: block;
}
#sp-hud {
    position: fixed; top: 16px; left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.78);
    color: #fff; padding: 8px 16px;
    border-radius: 20px; font-family: ui-monospace, monospace;
    font-size: 12px; z-index: 9501;
    display: flex; align-items: center; gap: 12px;
}
#sp-hud b { color: #9cf; }
#sp-hud .phase b.counting { color: #fd7; }
#sp-hud .phase b.tracking { color: #9f9; }
#sp-hud button {
    background: #633; color: #fff; border: 1px solid #844;
    padding: 4px 12px; border-radius: 14px; cursor: pointer; font-size: 12px;
}
#sp-countdown {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    color: #ffd700; font-size: 72px; font-weight: 700;
    font-family: system-ui, sans-serif;
    text-shadow: 0 0 24px rgba(255, 215, 0, 0.6);
    z-index: 9502; pointer-events: none;
}
#sp-instruct {
    position: fixed; top: 30%; left: 50%; transform: translateX(-50%);
    color: #ddd; font-size: 15px; font-family: system-ui, sans-serif;
    text-align: center; z-index: 9502; pointer-events: none;
    max-width: 520px; line-height: 1.45;
}
`;

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
}

export class SmoothPursuit {
    private readonly cfg: SmoothPursuitConfig;
    private readonly onSample: SampleFn;

    private running = false;
    private startMs = 0;
    private lastSampleMs = 0;
    private rafId = 0;
    private accepted = 0;
    private rejected = 0;
    private totalCalls = 0;

    private rootEl: HTMLDivElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private hud: HTMLDivElement | null = null;
    private countdownEl: HTMLDivElement | null = null;
    private instructEl: HTMLDivElement | null = null;

    constructor(onSample: SampleFn, cfg: Partial<SmoothPursuitConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };
        this.onSample = onSample;
    }

    start(onDone: (r: SmoothPursuitResult) => void): void {
        if (this.running) return;
        this.buildOverlay();
        this.running = true;
        this.startMs = performance.now();
        this.accepted = 0;
        this.rejected = 0;
        this.totalCalls = 0;
        this.lastSampleMs = 0;

        const finish = (aborted: boolean) => {
            this.teardown();
            onDone({
                totalCalls: this.totalCalls,
                accepted: this.accepted,
                rejected: this.rejected,
                aborted,
                elapsedMs: performance.now() - this.startMs,
            });
        };

        const abortBtn = this.hud!.querySelector<HTMLButtonElement>('button')!;
        abortBtn.onclick = () => {
            this.running = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            finish(true);
        };

        const loop = () => {
            if (!this.running) return;
            const now = performance.now();
            const elapsed = now - this.startMs;

            if (elapsed < this.cfg.countdownMs) {
                this.renderCountdown(elapsed);
            } else {
                const tRun = elapsed - this.cfg.countdownMs;
                if (tRun >= this.cfg.durationMs) {
                    this.running = false;
                    finish(false);
                    return;
                }
                this.renderPursuit(tRun);
                if (now - this.lastSampleMs >= this.cfg.sampleIntervalMs) {
                    const target = this.targetAt(tRun);
                    this.totalCalls++;
                    const ok = this.onSample(target.x, target.y);
                    if (ok) this.accepted++; else this.rejected++;
                    this.lastSampleMs = now;
                }
            }

            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    abort(): void {
        if (!this.running) return;
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.teardown();
    }

    private targetAt(tRunMs: number): { x: number; y: number } {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const t01 = Math.max(0, Math.min(1, tRunMs / this.cfg.durationMs));
        const wx = 2 * Math.PI * this.cfg.cyclesX;
        const wy = 2 * Math.PI * this.cfg.cyclesY;
        const amp = this.cfg.amplitude;
        return {
            x: W * 0.5 + W * 0.5 * amp * Math.sin(wx * t01),
            y: H * 0.5 + H * 0.5 * amp * Math.sin(wy * t01 + Math.PI / 2),
        };
    }

    private renderCountdown(elapsedMs: number): void {
        const remaining = Math.max(0, this.cfg.countdownMs - elapsedMs);
        const secs = Math.ceil(remaining / 1000);
        if (this.countdownEl) {
            this.countdownEl.textContent = secs > 0 ? String(secs) : '';
            this.countdownEl.style.display = 'block';
        }
        if (this.instructEl) this.instructEl.style.display = 'block';
        this.drawTarget(window.innerWidth / 2, window.innerHeight / 2, 'dim');
        this.updateHud('get ready', 'counting');
    }

    private renderPursuit(tRunMs: number): void {
        if (this.countdownEl) this.countdownEl.style.display = 'none';
        if (this.instructEl) this.instructEl.style.display = 'none';
        const { x, y } = this.targetAt(tRunMs);
        this.drawTarget(x, y, 'active');
        this.updateHud('tracking', 'tracking');
    }

    private updateHud(phase: string, cls: 'counting' | 'tracking'): void {
        if (!this.hud) return;
        const pEl = this.hud.querySelector<HTMLElement>('.phase b');
        if (pEl) {
            pEl.textContent = phase;
            pEl.className = cls;
        }
        const tEl = this.hud.querySelector<HTMLElement>('.elapsed b');
        if (tEl) {
            const tRun = Math.max(0, performance.now() - this.startMs - this.cfg.countdownMs);
            tEl.textContent = `${(Math.min(tRun, this.cfg.durationMs) / 1000).toFixed(1)}s / ${(this.cfg.durationMs / 1000).toFixed(0)}s`;
        }
        const sEl = this.hud.querySelector<HTMLElement>('.samples b');
        if (sEl) sEl.textContent = `${this.accepted} accepted · ${this.rejected} skipped`;
    }

    private drawTarget(x: number, y: number, state: 'dim' | 'active'): void {
        if (!this.canvas) return;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        if (this.canvas.width !== W * devicePixelRatio ||
            this.canvas.height !== H * devicePixelRatio) {
            this.canvas.width = Math.round(W * devicePixelRatio);
            this.canvas.height = Math.round(H * devicePixelRatio);
            this.canvas.style.width = `${W}px`;
            this.canvas.style.height = `${H}px`;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        }
        ctx.clearRect(0, 0, W, H);

        const pulse = (Math.sin(performance.now() / 300) + 1) / 2;
        const baseR = state === 'active' ? 18 : 14;
        const glowR = baseR + (state === 'active' ? 24 + pulse * 6 : 10);
        const color = state === 'active' ? '#ffd700' : 'rgba(255, 215, 0, 0.5)';

        const grad = ctx.createRadialGradient(x, y, baseR * 0.3, x, y, glowR);
        grad.addColorStop(0, 'rgba(255, 215, 0, 0.9)');
        grad.addColorStop(1, 'rgba(255, 215, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, baseR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    private buildOverlay(): void {
        ensureStyles();
        const root = document.createElement('div');
        root.id = 'sp-overlay';
        const canvas = document.createElement('canvas');
        root.appendChild(canvas);

        const hud = document.createElement('div');
        hud.id = 'sp-hud';
        hud.innerHTML = `
            <span class="phase">phase <b class="counting">get ready</b></span>
            <span class="elapsed">time <b>0.0s / ${(this.cfg.durationMs / 1000).toFixed(0)}s</b></span>
            <span class="samples">samples <b>0 accepted · 0 skipped</b></span>
            <button type="button">Abort</button>
        `;

        const instruct = document.createElement('div');
        instruct.id = 'sp-instruct';
        instruct.textContent =
            'Follow the yellow dot with your eyes only. Keep your head still. ' +
            'A short calibration warm-up starts now.';

        const countdown = document.createElement('div');
        countdown.id = 'sp-countdown';
        countdown.textContent = String(Math.ceil(this.cfg.countdownMs / 1000));

        document.body.appendChild(root);
        document.body.appendChild(hud);
        document.body.appendChild(instruct);
        document.body.appendChild(countdown);

        this.rootEl = root;
        this.canvas = canvas;
        this.hud = hud;
        this.instructEl = instruct;
        this.countdownEl = countdown;
    }

    private teardown(): void {
        this.rootEl?.remove();
        this.hud?.remove();
        this.instructEl?.remove();
        this.countdownEl?.remove();
        this.rootEl = this.canvas = null;
        this.hud = this.countdownEl = this.instructEl = null;
    }
}
