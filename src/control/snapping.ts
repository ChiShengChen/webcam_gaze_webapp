/**
 * Magnetic snapping to gaze targets.
 *
 * UI elements marked with `data-gaze-target="true"` attract the displayed
 * cursor when the snapped gaze falls within their attraction radius AND
 * there is a clear winner (no rival target within a contested distance).
 *
 * This is a display-layer helper, not a gaze-stream transform: the raw /
 * snapped / dwell-click streams are unaffected. Only the rendered cursor
 * position is pulled, so small UI targets become hittable without
 * distorting the gaze data used for analytics.
 *
 * Pull geometry: linear interpolation from gaze to target centre, weighted
 * by `strength` ∈ [0, 1]. Callers can ease `strength` over time (120 ms
 * ease-out) for a smooth visual pull.
 */

export interface SnapConfig {
    /** Max distance (px) at which a target attracts the cursor. */
    attractRadius: number;
    /** If another target's centre is within this distance of the winner's,
     *  treat the choice as ambiguous and don't snap. */
    contestedRadius: number;
}

const DEFAULT: SnapConfig = {
    attractRadius: 80,
    contestedRadius: 60,
};

interface Target {
    el: Element;
    cx: number;
    cy: number;
    distToGaze: number;
}

function collectTargets(): Target[] {
    const nodes = document.querySelectorAll<HTMLElement>('[data-gaze-target="true"]');
    const out: Target[] = [];
    for (const el of Array.from(nodes)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        out.push({
            el,
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            distToGaze: 0,
        });
    }
    return out;
}

export interface SnapResult {
    x: number;
    y: number;
    /** The target the cursor is snapped to, if any. */
    target: Element | null;
}

/**
 * Find the dominant gaze target near (x, y) and compute the pulled cursor
 * position. `strength` controls how far toward the target centre we pull
 * (0 = no pull, 1 = fully on target).
 */
export function computeSnap(
    x: number,
    y: number,
    strength: number,
    cfg: Partial<SnapConfig> = {}
): SnapResult {
    const c = { ...DEFAULT, ...cfg };
    const targets = collectTargets();
    if (targets.length === 0) return { x, y, target: null };

    for (const t of targets) {
        t.distToGaze = Math.hypot(t.cx - x, t.cy - y);
    }
    targets.sort((a, b) => a.distToGaze - b.distToGaze);

    const winner = targets[0];
    if (winner.distToGaze > c.attractRadius) return { x, y, target: null };

    if (targets.length > 1) {
        const runnerUp = targets[1];
        const rivalDist = Math.hypot(winner.cx - runnerUp.cx, winner.cy - runnerUp.cy);
        if (rivalDist < c.contestedRadius) return { x, y, target: null };
    }

    const s = Math.max(0, Math.min(1, strength));
    return {
        x: x + (winner.cx - x) * s,
        y: y + (winner.cy - y) * s,
        target: winner.el,
    };
}

/**
 * Ease-out pull strength: reaches 1 at `durationMs` after entering a target.
 * Returns 0 when no target is currently attracting.
 */
export class SnapStrength {
    private enteredAt: number | null = null;
    private currentTarget: Element | null = null;
    private readonly durationMs: number;

    constructor(durationMs = 120) {
        this.durationMs = durationMs;
    }

    update(target: Element | null, nowMs: number): number {
        if (target !== this.currentTarget) {
            this.currentTarget = target;
            this.enteredAt = target ? nowMs : null;
        }
        if (!this.enteredAt || !target) return 0;
        const t = Math.min(1, (nowMs - this.enteredAt) / this.durationMs);
        return 1 - (1 - t) * (1 - t);
    }
}
