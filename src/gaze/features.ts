/**
 * Feature extraction from MediaPipe FaceMesh landmarks.
 *
 * The single biggest upgrade over WebGazer v1 is that we have *iris*
 * landmarks directly (indices 468-477 when `refineLandmarks: true`),
 * instead of having to infer iris position from raw pixel patches. Feeding
 * the iris offset from the eye centre as a normalised feature gives the
 * regression head a clean, scale-invariant signal.
 *
 * The v0 feature vector is intentionally small (13 dims) — rich enough to
 * beat ridge-over-pixels with a modest KRR, cheap enough to compute in
 * fractions of a millisecond, and easy to debug. It can grow later without
 * changing the consumer (we pass a single `number[]` into KRR).
 *
 *   0-1   left iris dx/dy relative to left eye corner midpoint, scaled
 *         by eye width — this is the "where is the iris looking" signal
 *   2-3   right iris dx/dy (same construction)
 *   4     left eye aspect ratio (drops on blink; also a pose cue)
 *   5     right eye aspect ratio
 *   6     head yaw approximation (face horizontal asymmetry)
 *   7     head pitch approximation (nose vs eye-chin line)
 *   8     head roll (angle of inter-ocular line)
 *   9-10  face centre in normalised image coords
 *  11-12  inter-ocular distance (coarse distance cue) + mean iris radius
 */

import { LM, type FaceLandmarks } from './landmarks';

type P = { x: number; y: number; z: number };

function dist(a: P, b: P): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function mid(a: P, b: P): P {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Angle of the line from `a` to `b` relative to horizontal, in radians. */
function lineAngle(a: P, b: P): number {
    return Math.atan2(b.y - a.y, b.x - a.x);
}

export interface Features {
    vector: number[];
    /** For debugging / display — iris centres in normalised image coords. */
    irisLeft: P;
    irisRight: P;
    /** Face bounding box derived from eye corners + chin + forehead. */
    faceBox: { x: number; y: number; w: number; h: number };
    /** Mean eye aspect ratio (blink detection hint for calibration gating). */
    meanEAR: number;
}

const FEATURE_DIM = 13;

export function extractFeatures(landmarks: FaceLandmarks): Features | null {
    const pts = landmarks.points;
    if (pts.length < 478) return null; // need refineLandmarks iris points

    const lOuter = pts[LM.LEFT_EYE_OUTER];
    const lInner = pts[LM.LEFT_EYE_INNER];
    const lTop = pts[LM.LEFT_EYE_TOP];
    const lBot = pts[LM.LEFT_EYE_BOTTOM];
    const lIris = pts[LM.LEFT_IRIS_CENTER];
    const lIrisR = pts[LM.LEFT_IRIS_RIGHT];
    const lIrisL = pts[LM.LEFT_IRIS_LEFT];

    const rOuter = pts[LM.RIGHT_EYE_OUTER];
    const rInner = pts[LM.RIGHT_EYE_INNER];
    const rTop = pts[LM.RIGHT_EYE_TOP];
    const rBot = pts[LM.RIGHT_EYE_BOTTOM];
    const rIris = pts[LM.RIGHT_IRIS_CENTER];
    const rIrisR = pts[LM.RIGHT_IRIS_RIGHT];
    const rIrisL = pts[LM.RIGHT_IRIS_LEFT];

    const nose = pts[LM.NOSE_TIP];
    const chin = pts[LM.CHIN];
    const lMouth = pts[LM.LEFT_MOUTH];
    const rMouth = pts[LM.RIGHT_MOUTH];
    const forehead = pts[LM.FOREHEAD];

    // Iris positions relative to eye-corner midpoint, scaled by eye width.
    const lEyeMid = mid(lOuter, lInner);
    const lEyeW = dist(lOuter, lInner) || 1e-6;
    const lDx = (lIris.x - lEyeMid.x) / lEyeW;
    const lDy = (lIris.y - lEyeMid.y) / lEyeW;

    const rEyeMid = mid(rOuter, rInner);
    const rEyeW = dist(rOuter, rInner) || 1e-6;
    const rDx = (rIris.x - rEyeMid.x) / rEyeW;
    const rDy = (rIris.y - rEyeMid.y) / rEyeW;

    // Eye aspect ratio — vertical/horizontal eye span.
    const lEAR = dist(lTop, lBot) / lEyeW;
    const rEAR = dist(rTop, rBot) / rEyeW;
    const meanEAR = (lEAR + rEAR) / 2;

    // Head pose, approximated from landmark geometry (cheap substitute for
    // solvePnP; good enough as a conditioning feature).
    // Yaw: relative distances from nose to left/right eye outer corners.
    const dNoseL = dist(nose, lOuter);
    const dNoseR = dist(nose, rOuter);
    const ipd = (dNoseL + dNoseR) || 1e-6;
    const yaw = (dNoseR - dNoseL) / ipd;
    // Pitch: vertical placement of nose between forehead and chin.
    const headH = chin.y - forehead.y || 1e-6;
    const noseRel = (nose.y - forehead.y) / headH; // 0 = top, 1 = bottom
    const pitch = noseRel - 0.5;
    // Roll: angle of inter-ocular line (left outer → right outer).
    const roll = lineAngle(lOuter, rOuter);

    // Face bounding box from eye corners + forehead + chin + mouth span.
    const xs = [lOuter.x, lInner.x, rOuter.x, rInner.x, lMouth.x, rMouth.x];
    const ys = [forehead.y, chin.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const faceCx = (minX + maxX) / 2;
    const faceCy = (minY + maxY) / 2;

    // Inter-ocular distance (normalised by image width, which is 1.0 in
    // normalised landmark space) doubles as a distance cue.
    const interOcular = dist(lIris, rIris);
    // Iris radius (average of left + right horizontal radii).
    const lIrisR_px = dist(lIrisL, lIrisR) / 2;
    const rIrisR_px = dist(rIrisL, rIrisR) / 2;
    const irisRadius = (lIrisR_px + rIrisR_px) / 2;

    const vector: number[] = [
        lDx, lDy,              // 0-1
        rDx, rDy,              // 2-3
        lEAR, rEAR,            // 4-5
        yaw, pitch, roll,      // 6-8
        faceCx, faceCy,        // 9-10
        interOcular, irisRadius, // 11-12
    ];

    if (vector.length !== FEATURE_DIM) {
        throw new Error(`features: expected ${FEATURE_DIM} dims, got ${vector.length}`);
    }

    return {
        vector,
        irisLeft: lIris,
        irisRight: rIris,
        faceBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        meanEAR,
    };
}

export { FEATURE_DIM };
