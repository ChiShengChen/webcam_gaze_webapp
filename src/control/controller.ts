/**
 * Gaze controller — three output streams built on the One-Euro filter and
 * the I-VT fixation classifier.
 *
 *   raw          One-Euro filtered gaze. For analytics / heatmap.
 *   snapped      Fixation centroid during FIXATION, filtered gaze during
 *                SACCADE. For the visible cursor dot.
 *   dwell_click  CustomEvent fired when the fixation centroid stays inside
 *                a data-gaze-target element for `dwellMs` with ≤ `dwellRadius`
 *                drift. For eye-selection UI.
 *
 * A mode subscribes only to the streams it needs: the heatmap uses `raw`,
 * the cursor uses `snapped`, and interactive modes (Label / Video / future
 * Control) subscribe to `dwell_click`.
 */

import { OneEuroFilter2D, type OneEuroConfig } from './oneEuroFilter';
import { FixationClassifier, type IVTConfig } from './fixationClassifier';

export interface DwellClickEvent {
    target: HTMLElement;
    x: number;
    y: number;
    timestamp: number;
}

export interface ControllerConfig {
    oneEuro: Partial<OneEuroConfig>;
    ivt: Partial<IVTConfig>;
    /** Dwell duration in milliseconds before firing a dwell-click. */
    dwellMs: number;
    /** Max centroid drift inside a target before dwell resets (px). */
    dwellRadius: number;
    /** Cooldown per target after activation (ms). */
    dwellCooldownMs: number;
}

const DEFAULT: ControllerConfig = {
    oneEuro: {},
    ivt: {},
    dwellMs: 600,
    dwellRadius: 60,
    dwellCooldownMs: 800,
};

type RawListener = (x: number, y: number, timestampMs: number) => void;
type SnappedListener = (
    x: number,
    y: number,
    state: 'FIXATION' | 'SACCADE',
    timestampMs: number
) => void;
type DwellListener = (ev: DwellClickEvent) => void;

export class GazeController {
    private readonly cfg: ControllerConfig;
    private readonly filter: OneEuroFilter2D;
    private readonly ivt: FixationClassifier;

    private rawListeners: RawListener[] = [];
    private snappedListeners: SnappedListener[] = [];
    private dwellListeners: DwellListener[] = [];

    private dwellTarget: HTMLElement | null = null;
    private dwellAnchor: { x: number; y: number } | null = null;
    private dwellStartMs = 0;
    private lastDwellFireAt = new WeakMap<HTMLElement, number>();

    constructor(cfg: Partial<ControllerConfig> = {}) {
        this.cfg = { ...DEFAULT, ...cfg };
        this.filter = new OneEuroFilter2D(this.cfg.oneEuro);
        this.ivt = new FixationClassifier(this.cfg.ivt);
    }

    onRaw(l: RawListener): void { this.rawListeners.push(l); }
    onSnapped(l: SnappedListener): void { this.snappedListeners.push(l); }
    onDwellClick(l: DwellListener): void { this.dwellListeners.push(l); }

    reset(): void {
        this.filter.reset();
        this.ivt.reset();
        this.resetDwell();
    }

    /** Feed one raw gaze sample. `timestampMs` = performance.now() or Date.now(). */
    push(rawX: number, rawY: number, timestampMs: number): void {
        const tSec = timestampMs / 1000;
        const filtered = this.filter.filter(rawX, rawY, tSec);
        for (const l of this.rawListeners) l(filtered.x, filtered.y, timestampMs);

        const cls = this.ivt.feed(filtered.x, filtered.y, tSec);
        const centroid = cls.centroid ?? filtered;
        for (const l of this.snappedListeners) {
            l(centroid.x, centroid.y, cls.state, timestampMs);
        }

        this.updateDwell(centroid.x, centroid.y, cls.state, timestampMs);
    }

    private updateDwell(
        x: number,
        y: number,
        state: 'FIXATION' | 'SACCADE',
        nowMs: number
    ): void {
        if (state !== 'FIXATION') {
            this.resetDwell();
            return;
        }

        const el = this.targetAt(x, y);
        if (!el) {
            this.resetDwell();
            return;
        }

        const lastFire = this.lastDwellFireAt.get(el) ?? 0;
        if (nowMs - lastFire < this.cfg.dwellCooldownMs) return;

        if (el !== this.dwellTarget) {
            this.dwellTarget = el;
            this.dwellAnchor = { x, y };
            this.dwellStartMs = nowMs;
            return;
        }

        if (this.dwellAnchor) {
            const drift = Math.hypot(x - this.dwellAnchor.x, y - this.dwellAnchor.y);
            if (drift > this.cfg.dwellRadius) {
                this.dwellAnchor = { x, y };
                this.dwellStartMs = nowMs;
                return;
            }
        }

        if (nowMs - this.dwellStartMs >= this.cfg.dwellMs) {
            this.lastDwellFireAt.set(el, nowMs);
            this.resetDwell();
            for (const l of this.dwellListeners) {
                l({ target: el, x, y, timestamp: nowMs });
            }
        }
    }

    private targetAt(x: number, y: number): HTMLElement | null {
        const hit = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!hit) return null;
        return hit.closest<HTMLElement>('[data-gaze-target="true"]');
    }

    private resetDwell(): void {
        this.dwellTarget = null;
        this.dwellAnchor = null;
        this.dwellStartMs = 0;
    }

    /** Dwell progress 0..1 for the currently-tracked target, for UI rings. */
    dwellProgress(nowMs: number): { target: HTMLElement; progress: number } | null {
        if (!this.dwellTarget || !this.dwellStartMs) return null;
        const p = Math.min(1, (nowMs - this.dwellStartMs) / this.cfg.dwellMs);
        return { target: this.dwellTarget, progress: p };
    }
}
