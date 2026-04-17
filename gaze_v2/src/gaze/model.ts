/**
 * Dual-model gaze regression.
 *
 * `M_stable`  — trained only from explicit 9-point calibration. Never updated
 *               by implicit signals. Serves as the anchor we can always fall
 *               back to when auto-correction goes wrong.
 *
 * `M_adaptive` — starts as a copy of `M_stable`. Gets incremental updates from
 *               implicit signals (mouse clicks, hovers, pursuit). This is the
 *               model we predict with in steady state.
 *
 * Health check: if the adaptive model's error on the stable-model samples
 * exceeds `divergenceThresh`, reset adaptive = stable. This prevents a
 * cascade where a few bad implicit samples pull the model off true gaze
 * and all subsequent samples get labelled from the bad predictions.
 */

import { FEATURE_DIM, buildFeatures, type RawGazeInputs } from './features';
import { fitRidge, predictRidge, type RidgeFit } from '../math/ridge';

const CALIB_WEIGHT = 1.0;
const CORRECTION_WEIGHT = 0.35;
const MAX_CORRECTIONS = 200;       // sliding window size
const ADAPTIVE_LAMBDA = 1e-3;      // ridge regularisation
const STABLE_LAMBDA = 5e-4;        // slightly less regularisation with curated data
const DIVERGENCE_THRESH_PX = 140;  // if adaptive predicts calibration samples this far off → reset

interface Sample {
    features: Float64Array; // length D
    targetX: number;
    targetY: number;
    weight: number;
}

function buildMatrices(samples: Sample[]): {
    X: Float64Array;
    yX: Float64Array;
    yY: Float64Array;
    w: Float64Array;
    n: number;
} {
    const n = samples.length;
    const D = FEATURE_DIM;
    const X = new Float64Array(n * D);
    const yX = new Float64Array(n);
    const yY = new Float64Array(n);
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        X.set(samples[i].features, i * D);
        yX[i] = samples[i].targetX;
        yY[i] = samples[i].targetY;
        w[i] = samples[i].weight;
    }
    return { X, yX, yY, w, n };
}

export class GazeModel {
    private stableSamples: Sample[] = [];
    private correctionSamples: Sample[] = []; // sliding window
    private stable: RidgeFit | null = null;
    private adaptive: RidgeFit | null = null;
    private readonly screenW: number;
    private readonly screenH: number;

    constructor(screenW: number, screenH: number) {
        this.screenW = screenW;
        this.screenH = screenH;
    }

    get isCalibrated(): boolean {
        return this.stable !== null;
    }

    get stats(): { stableSamples: number; correctionSamples: number } {
        return {
            stableSamples: this.stableSamples.length,
            correctionSamples: this.correctionSamples.length,
        };
    }

    /** Add a calibration sample. Call refit() after all points collected. */
    addCalibration(inputs: RawGazeInputs, screenX: number, screenY: number): void {
        this.stableSamples.push({
            features: buildFeatures(inputs),
            targetX: screenX,
            targetY: screenY,
            weight: CALIB_WEIGHT,
        });
    }

    /** Add an implicit correction sample. Caller provides inputs + target. */
    addCorrection(inputs: RawGazeInputs, screenX: number, screenY: number): void {
        this.correctionSamples.push({
            features: buildFeatures(inputs),
            targetX: screenX,
            targetY: screenY,
            weight: CORRECTION_WEIGHT,
        });
        while (this.correctionSamples.length > MAX_CORRECTIONS) {
            this.correctionSamples.shift();
        }
        this.refitAdaptive();
        this.maybeHealthCheck();
    }

    /** Discard all calibration state. */
    clearCalibration(): void {
        this.stableSamples = [];
        this.correctionSamples = [];
        this.stable = null;
        this.adaptive = null;
    }

    /** Refit both models from current samples. Call after 9-point finish. */
    refitAll(): void {
        this.refitStable();
        this.refitAdaptive();
    }

    private refitStable(): void {
        if (this.stableSamples.length < 4) {
            this.stable = null;
            return;
        }
        const { X, yX, yY, w, n } = buildMatrices(this.stableSamples);
        this.stable = fitRidge(X, yX, yY, w, n, FEATURE_DIM, STABLE_LAMBDA);
    }

    private refitAdaptive(): void {
        const combined = [...this.stableSamples, ...this.correctionSamples];
        if (combined.length < 4) {
            this.adaptive = this.stable;
            return;
        }
        const { X, yX, yY, w, n } = buildMatrices(combined);
        this.adaptive = fitRidge(X, yX, yY, w, n, FEATURE_DIM, ADAPTIVE_LAMBDA);
    }

    /**
     * Compare the adaptive model's predictions on the stable calibration
     * samples to their true screen targets. If mean error is too large, we
     * assume implicit corrections have poisoned the model — reset.
     */
    private maybeHealthCheck(): void {
        if (!this.adaptive || this.stableSamples.length < 4) return;
        let sumErr = 0;
        for (const s of this.stableSamples) {
            const p = predictRidge(this.adaptive, s.features);
            const dx = p.x - s.targetX;
            const dy = p.y - s.targetY;
            sumErr += Math.sqrt(dx * dx + dy * dy);
        }
        const avg = sumErr / this.stableSamples.length;
        if (avg > DIVERGENCE_THRESH_PX) {
            console.warn(
                `[GazeModel] adaptive diverged (avg err ${avg.toFixed(0)}px), resetting to stable`
            );
            this.correctionSamples = [];
            this.adaptive = this.stable;
        }
    }

    /** Predict screen coordinates using the adaptive model. */
    predict(inputs: RawGazeInputs): { x: number; y: number } | null {
        const fit = this.adaptive ?? this.stable;
        if (!fit) return null;
        const f = buildFeatures(inputs);
        const p = predictRidge(fit, f);
        // Clamp to a reasonable range (allow a bit of overshoot so the cursor
        // can "stick" to edges without hard clipping).
        const margin = 40;
        return {
            x: Math.max(-margin, Math.min(this.screenW + margin, p.x)),
            y: Math.max(-margin, Math.min(this.screenH + margin, p.y)),
        };
    }
}
