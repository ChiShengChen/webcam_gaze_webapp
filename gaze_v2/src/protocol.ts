/**
 * Main ↔ Worker message protocol.
 *
 * The main thread owns the UI (cursor, calibration dots, mouse events) and
 * the worker owns the CV pipeline. These types are the only coupling between
 * the two sides — keep them tight and explicit so adding new signals is
 * clearly scoped.
 */

// --------------- Main → Worker ---------------

export interface InitMsg {
    type: 'init';
    canvas: OffscreenCanvas;
    screenW: number;
    screenH: number;
}

export interface FrameMsg {
    type: 'frame';
    bitmap: ImageBitmap;
    captureTime: number;
    frameIndex: number;
}

export interface StartCalibrationMsg {
    type: 'startCalibration';
}

export interface AbortCalibrationMsg {
    type: 'abortCalibration';
}

/**
 * The UI tells the worker "the dot is now at (screenX, screenY) — collect
 * samples for this target". Sent when the user starts looking at a point.
 */
export interface CalibrationTargetMsg {
    type: 'calibrationTarget';
    screenX: number;
    screenY: number;
}

/** User clicked somewhere on screen — feed as auto-correction signal. */
export interface ClickMsg {
    type: 'click';
    x: number;
    y: number;
    timestamp: number;
}

/** Cursor moved — feed for hover-dwell / pursuit tracking. */
export interface CursorMsg {
    type: 'cursor';
    x: number;
    y: number;
    timestamp: number;
}

/** User changed screen dimensions (resize). */
export interface ResizeMsg {
    type: 'resize';
    screenW: number;
    screenH: number;
}

/** Stop the pipeline (camera released separately on the main thread). */
export interface StopMsg {
    type: 'stop';
}

export type InMessage =
    | InitMsg
    | FrameMsg
    | StartCalibrationMsg
    | AbortCalibrationMsg
    | CalibrationTargetMsg
    | ClickMsg
    | CursorMsg
    | ResizeMsg
    | StopMsg;

// --------------- Worker → Main ---------------

export interface StatsMsg {
    type: 'stats';
    pipelineFps: number;
    processedFrames: number;
    droppedFrames: number;
    latencyMs: number;
}

export type HeadDistance = 'ok' | 'tooClose' | 'tooFar' | 'offCenter' | 'noFace';

/**
 * Per-frame status of the CV pipeline. Always posted, even when no face
 * or no prediction, so the UI can show "no face" / "calibrate first".
 */
export interface FrameStatusMsg {
    type: 'frameStatus';
    hasFace: boolean;
    faceBox: { x: number; y: number; width: number; height: number } | null;
    irisConfidence: number;
    /** Raw + filtered gaze prediction in screen pixels, or null. */
    prediction: { x: number; y: number } | null;
    filtered: { x: number; y: number } | null;
    /** Whether auto-correction hover just happened this frame. */
    correctionEvent: 'click' | 'hoverDwell' | null;
    /** Face size in frame (width / frame width). Useful for distance feedback. */
    faceScale: number;
    /** Classified head distance state for user feedback. */
    headDistance: HeadDistance;
}

export interface CalibrationStatusMsg {
    type: 'calibrationStatus';
    active: boolean;
    /** 0-based index of the current point being collected. */
    pointIndex: number;
    totalPoints: number;
    /** How many samples collected for the current point. */
    pointProgress: number;
    pointTarget: number;
    /** Emitted once when calibration finishes. */
    justFinished: boolean;
}

export interface BlinkEventMsg {
    type: 'blinkEvent';
    kind: 'blink' | 'longBlink';
    durationMs: number;
}

/**
 * Session-learned per-user eye profile. Posted periodically (not every
 * frame — it changes slowly) so the UI can show "iris: medium / ipd: 180px"
 * without spamming messages.
 */
export interface SessionProfileMsg {
    type: 'sessionProfile';
    samples: number;
    preferredRatioLabel: string;
    medianVariance: number;
    medianIpd: number;
    smoothedConfidence: number;
    isWarm: boolean;
}

export type OutMessage =
    | StatsMsg
    | FrameStatusMsg
    | CalibrationStatusMsg
    | BlinkEventMsg
    | SessionProfileMsg;
