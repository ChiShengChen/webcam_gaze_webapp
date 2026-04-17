/**
 * Eye ROI extraction.
 *
 * Given a face box, we know the two eyes sit at roughly 35%/65% across
 * and 38% down (anthropometric averages). We grab fixed-aspect patches
 * around those anchors and feed them to the iris localizer.
 *
 * The patches are large enough to survive small head movements between
 * frames (so the iris stays inside even if the face box is slightly off),
 * and small enough to keep iris localization cheap.
 */

import type { GrayImage } from '../cv/image';
import { cropGray } from '../cv/image';
import type { FaceBox } from '../face/skinBootstrap';

export interface EyePatches {
    /** Patch containing the viewer's left eye (right side of the image — front-facing cam is mirrored). */
    left: GrayImage;
    right: GrayImage;
    /** Where each patch sits in the full frame, for coordinate mapping back. */
    leftOrigin: { x: number; y: number };
    rightOrigin: { x: number; y: number };
    /** Interocular distance in frame pixels (useful for scaling / pose). */
    ipd: number;
}

// Anthropometric ratios (relative to face box).
const EYE_Y = 0.38;   // vertical centre of the eyes
const EYE_DX = 0.20;  // half the eye spacing (25%..65% → dx = 0.20 from centre)
const PATCH_W_RATIO = 0.30; // eye patch width as a fraction of face width
const PATCH_H_RATIO = 0.22; // eye patch height

export function extractEyes(gray: GrayImage, face: FaceBox): EyePatches {
    const cx = face.x + face.width / 2;
    const cy = face.y + face.height * EYE_Y;
    const dx = face.width * EYE_DX;

    const pw = Math.round(face.width * PATCH_W_RATIO);
    const ph = Math.round(face.height * PATCH_H_RATIO);

    // Front-facing webcams are mirrored: the viewer's "left eye" appears on
    // the right side of the frame. We return them in "viewer" orientation
    // so downstream code can stay in natural coordinates.
    const leftOx = Math.round(cx + dx - pw / 2);
    const leftOy = Math.round(cy - ph / 2);
    const rightOx = Math.round(cx - dx - pw / 2);
    const rightOy = Math.round(cy - ph / 2);

    const left = cropGray(gray, leftOx, leftOy, pw, ph);
    const right = cropGray(gray, rightOx, rightOy, pw, ph);

    return {
        left,
        right,
        leftOrigin: { x: leftOx, y: leftOy },
        rightOrigin: { x: rightOx, y: rightOy },
        ipd: 2 * dx,
    };
}
