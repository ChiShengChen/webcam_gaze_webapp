/**
 * Steady-state face tracker using NCC template matching.
 *
 * Once `bootstrapFace` gives us an initial face box we grab a template of
 * the face interior. Each subsequent frame we search a small window around
 * the last-known position and lock onto the best NCC match.
 *
 * Fast: at 30 fps with a 64×80 template and a 48-pixel search radius,
 * this is ~7 ms per frame on a 2020 laptop.
 *
 * Robustness: we periodically refresh the template to cope with slow
 * appearance drift (lighting changes, slight pose changes). If the best
 * score drops below `minScore`, we declare "lost" and signal a re-bootstrap.
 */

import type { GrayImage } from '../cv/image';
import { cropGray } from '../cv/image';
import { buildIntegral } from '../cv/integral';
import { makeTemplate, searchNCC, type Template } from '../cv/ncc';
import type { FaceBox } from './skinBootstrap';

export interface TrackerConfig {
    templateWidth: number;
    templateHeight: number;
    searchRadius: number;
    refreshEvery: number; // frames between template refresh
    minScore: number;     // NCC below this = tracking lost
}

const DEFAULT_CONFIG: TrackerConfig = {
    templateWidth: 64,
    templateHeight: 80,
    searchRadius: 40,
    refreshEvery: 30,
    minScore: 0.55,
};

export class FaceTracker {
    private template: Template | null = null;
    private box: FaceBox | null = null;
    private framesSinceRefresh = 0;
    private readonly cfg: TrackerConfig;

    constructor(cfg: Partial<TrackerConfig> = {}) {
        this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    }

    /** Has the tracker locked on? */
    get isLocked(): boolean {
        return this.template !== null && this.box !== null;
    }

    /** Current face box (may be stale if not updated this frame). */
    get currentBox(): FaceBox | null {
        return this.box;
    }

    /** Seed the tracker with a newly detected face box. */
    initialize(gray: GrayImage, faceBox: FaceBox): void {
        this.box = { ...faceBox };
        this.template = this.extractTemplate(gray, faceBox);
        this.framesSinceRefresh = 0;
    }

    /** Release the lock; caller should re-bootstrap. */
    reset(): void {
        this.template = null;
        this.box = null;
        this.framesSinceRefresh = 0;
    }

    /**
     * Update with a new frame. Returns the refined face box or null if
     * tracking was lost (caller should re-bootstrap).
     */
    update(gray: GrayImage): FaceBox | null {
        if (!this.template || !this.box) return null;

        const { cfg } = this;
        // Centre of the current template position in the new frame.
        const cx = this.box.x + this.box.width / 2;
        const cy = this.box.y + this.box.height / 2;
        const searchX = cx - cfg.templateWidth / 2 - cfg.searchRadius;
        const searchY = cy - cfg.templateHeight / 2 - cfg.searchRadius;
        const searchW = cfg.templateWidth + 2 * cfg.searchRadius;
        const searchH = cfg.templateHeight + 2 * cfg.searchRadius;

        const integral = buildIntegral(gray);
        const result = searchNCC(
            gray,
            integral,
            this.template,
            searchX,
            searchY,
            searchW,
            searchH,
            1
        );

        if (result.score < cfg.minScore) {
            this.reset();
            return null;
        }

        // Map template top-left back to full face box (they share centre).
        const newCx = result.x + cfg.templateWidth / 2;
        const newCy = result.y + cfg.templateHeight / 2;
        this.box = {
            x: newCx - this.box.width / 2,
            y: newCy - this.box.height / 2,
            width: this.box.width,
            height: this.box.height,
        };

        this.framesSinceRefresh++;
        if (this.framesSinceRefresh >= cfg.refreshEvery) {
            this.template = this.extractTemplate(gray, this.box);
            this.framesSinceRefresh = 0;
        }

        return this.box;
    }

    /**
     * Extract a centred sub-patch of the face box as the NCC template.
     * We deliberately grab the centre (not the full box) to avoid hair /
     * neck which change a lot as the head moves.
     */
    private extractTemplate(gray: GrayImage, box: FaceBox): Template {
        const { templateWidth: tw, templateHeight: th } = this.cfg;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const patch = cropGray(gray, cx - tw / 2, cy - th / 2, tw, th);
        return makeTemplate(patch, 0, 0, patch.width, patch.height);
    }
}
