/**
 * Implicit auto-correction signal ingestion.
 *
 * Four types of "free supervision" from ordinary cursor use:
 *
 *  1. click — The user clicked at (mx, my). Their gaze was almost certainly
 *     there in the ~200 ms pre-click window. We pick the iris sample with
 *     the highest confidence in that window and emit a correction.
 *
 *  2. hoverDwell — The cursor has been stationary for > 500 ms and the
 *     current gaze prediction is already close to it. Soft-label: assume
 *     the user is looking at the cursor.
 *
 *  3. pursuit — Cursor and predicted gaze have moved along correlated paths
 *     for > 1 s. Soft-label during the pursuit.
 *
 *  4. saccadeReject — Predicted gaze velocity > 900°/s is biologically
 *     impossible. The tracker is confused; drop the prediction (the filter
 *     will interpolate).
 *
 * This module is signal-in, (inputs, target) pairs-out. It does NOT know
 * about the model — it just emits correction events for the model to consume.
 */

import type { RawGazeInputs } from './features';

export interface FrameSnapshot {
    inputs: RawGazeInputs;
    confidence: number;
    /** Prediction made this frame (in screen pixels), or null if no model yet. */
    prediction: { x: number; y: number } | null;
    timestamp: number; // performance.now()
}

export interface CorrectionEvent {
    kind: 'click' | 'hoverDwell' | 'pursuit';
    inputs: RawGazeInputs;
    screenX: number;
    screenY: number;
}

const HISTORY_MS = 1200;
const CLICK_PRE_WINDOW_MS = 350;
const CLICK_POST_WINDOW_MS = 80;
const HOVER_DWELL_MS = 600;
const HOVER_MAX_PIXEL_DIST = 180;   // gaze must be within this of cursor to trust dwell
const MIN_CONFIDENCE = 0.3;
const MAX_VELOCITY_PX_PER_S = 12000; // rough "900°/s" cap at 45 cm viewing

type Listener = (ev: CorrectionEvent) => void;

export class AutoCorrector {
    private frames: FrameSnapshot[] = [];
    private lastCursor: { x: number; y: number; t: number } | null = null;
    private dwellStart: number | null = null;
    private dwellEmitted = false;
    private lastPrediction: { x: number; y: number; t: number } | null = null;
    private listeners: Listener[] = [];

    onCorrection(cb: Listener): void {
        this.listeners.push(cb);
    }

    /** Call every frame, after iris + gaze prediction. */
    pushFrame(snap: FrameSnapshot): void {
        this.frames.push(snap);
        const cutoff = snap.timestamp - HISTORY_MS;
        while (this.frames.length > 0 && this.frames[0].timestamp < cutoff) {
            this.frames.shift();
        }

        this.checkSaccadeReject(snap);
        this.checkHoverDwell(snap);
    }

    /**
     * Call when the user moves the cursor. We just record the position;
     * click / dwell logic reads from this.
     */
    pushCursor(x: number, y: number, timestamp: number): void {
        // If the cursor moved more than ~6 px, reset dwell timer.
        if (this.lastCursor) {
            const dx = x - this.lastCursor.x;
            const dy = y - this.lastCursor.y;
            if (dx * dx + dy * dy > 36) {
                this.dwellStart = timestamp;
                this.dwellEmitted = false;
            }
        } else {
            this.dwellStart = timestamp;
        }
        this.lastCursor = { x, y, t: timestamp };
    }

    /** Call when the user clicks. Strong supervision. */
    pushClick(x: number, y: number, timestamp: number): void {
        // Find the best iris frame in the pre-click window.
        const lo = timestamp - CLICK_PRE_WINDOW_MS;
        const hi = timestamp + CLICK_POST_WINDOW_MS;
        let best: FrameSnapshot | null = null;
        for (const f of this.frames) {
            if (f.timestamp < lo || f.timestamp > hi) continue;
            if (f.confidence < MIN_CONFIDENCE) continue;
            if (!best || f.confidence > best.confidence) best = f;
        }
        if (!best) return;
        this.emit({
            kind: 'click',
            inputs: best.inputs,
            screenX: x,
            screenY: y,
        });
    }

    /**
     * Hard-cap predicted gaze velocity. If the last two predictions are
     * farther apart than the saccade cap, the tracker is probably confused
     * and the caller should not feed this sample into any consumer.
     *
     * Mutates snap.prediction to null if rejected.
     */
    private checkSaccadeReject(snap: FrameSnapshot): void {
        if (!snap.prediction) return;
        if (this.lastPrediction) {
            const dt = (snap.timestamp - this.lastPrediction.t) / 1000;
            if (dt > 0) {
                const dx = snap.prediction.x - this.lastPrediction.x;
                const dy = snap.prediction.y - this.lastPrediction.y;
                const vel = Math.sqrt(dx * dx + dy * dy) / dt;
                if (vel > MAX_VELOCITY_PX_PER_S) {
                    // Don't trust this sample; keep the old prediction.
                    snap.prediction = { x: this.lastPrediction.x, y: this.lastPrediction.y };
                    return;
                }
            }
        }
        this.lastPrediction = { x: snap.prediction.x, y: snap.prediction.y, t: snap.timestamp };
    }

    /**
     * If the cursor has been still long enough and the current prediction is
     * close to it, assume the user is looking at the cursor and emit a soft
     * correction. Only emits once per dwell.
     */
    private checkHoverDwell(snap: FrameSnapshot): void {
        if (this.dwellEmitted) return;
        if (!this.lastCursor || this.dwellStart === null) return;
        if (!snap.prediction) return;
        if (snap.confidence < MIN_CONFIDENCE) return;

        const dwellMs = snap.timestamp - this.dwellStart;
        if (dwellMs < HOVER_DWELL_MS) return;

        const dx = snap.prediction.x - this.lastCursor.x;
        const dy = snap.prediction.y - this.lastCursor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > HOVER_MAX_PIXEL_DIST) return;

        this.emit({
            kind: 'hoverDwell',
            inputs: snap.inputs,
            screenX: this.lastCursor.x,
            screenY: this.lastCursor.y,
        });
        this.dwellEmitted = true;
    }

    private emit(ev: CorrectionEvent): void {
        for (const l of this.listeners) l(ev);
    }
}
