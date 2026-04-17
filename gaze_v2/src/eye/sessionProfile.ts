/**
 * Session-level eye appearance profile.
 *
 * The CV pipeline modules are per-user agnostic — they run the same
 * algorithm regardless of who's in front of the camera. This module adds
 * a stateful layer that learns per-session:
 *
 *   - Which iris-radius ratio is the best fit for this user's eye size.
 *   - Running median eye-patch variance (open-eye baseline).
 *   - Running median IPD (interocular distance in pixels).
 *   - Iris confidence smoothed over time.
 *
 * The profile updates each frame and feeds hints back to the locator
 * (via `preferredIndex`) so it can early-exit the expensive multi-scale
 * search once the user's iris size is known.
 *
 * Reset happens on explicit demand (camera restart, big face box change)
 * — it should NOT auto-reset on transient tracking losses.
 */

export interface ProfileSnapshot {
    /** How many valid frames have contributed. */
    samples: number;
    /** Preferred iris ratio index, or -1 if unknown. */
    preferredRatioIndex: number;
    /** Label of the preferred ratio (small/medium/large). */
    preferredRatioLabel: string;
    /** Running median of eye-patch variance (both eyes averaged). */
    medianVariance: number;
    /** Running median of interocular distance in frame pixels. */
    medianIpd: number;
    /** Smoothed iris confidence. */
    smoothedConfidence: number;
    /** True when the profile has enough data to trust its stats. */
    isWarm: boolean;
}

const TALLY_SLOTS = 3; // matches DEFAULT_IRIS_CONFIG.ratios.length
const RATIO_LABELS = ['small', 'medium', 'large'];
const HISTORY_LEN = 120;
const WARM_UP_FRAMES = 30;
const MIN_CONFIDENCE = 0.2;
const CONF_EMA_ALPHA = 0.12;

export class SessionEyeProfile {
    private tally = new Int32Array(TALLY_SLOTS);
    private varianceHistory: number[] = [];
    private ipdHistory: number[] = [];
    private smoothedConfidence = 0;
    private validFrames = 0;

    reset(): void {
        this.tally.fill(0);
        this.varianceHistory = [];
        this.ipdHistory = [];
        this.smoothedConfidence = 0;
        this.validFrames = 0;
    }

    /**
     * Feed one frame's worth of measurements.
     * Ignores frames where either iris has low confidence — bad data
     * would poison the running baselines.
     */
    update(
        leftRatioIndex: number,
        rightRatioIndex: number,
        avgConfidence: number,
        avgVariance: number,
        ipdPixels: number
    ): void {
        // Always smooth confidence so the UI readout is stable.
        this.smoothedConfidence =
            CONF_EMA_ALPHA * avgConfidence + (1 - CONF_EMA_ALPHA) * this.smoothedConfidence;

        if (avgConfidence < MIN_CONFIDENCE) return;
        if (leftRatioIndex < 0 || rightRatioIndex < 0) return;

        if (leftRatioIndex < TALLY_SLOTS) this.tally[leftRatioIndex]++;
        if (rightRatioIndex < TALLY_SLOTS) this.tally[rightRatioIndex]++;

        this.varianceHistory.push(avgVariance);
        if (this.varianceHistory.length > HISTORY_LEN) this.varianceHistory.shift();

        if (ipdPixels > 0) {
            this.ipdHistory.push(ipdPixels);
            if (this.ipdHistory.length > HISTORY_LEN) this.ipdHistory.shift();
        }

        this.validFrames++;
    }

    /** Preferred ratio index — the most-voted-for slot. */
    get preferredRatioIndex(): number {
        if (this.validFrames < WARM_UP_FRAMES) return -1;
        let bestIdx = -1;
        let bestCount = 0;
        for (let i = 0; i < TALLY_SLOTS; i++) {
            if (this.tally[i] > bestCount) {
                bestCount = this.tally[i];
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    get snapshot(): ProfileSnapshot {
        const idx = this.preferredRatioIndex;
        return {
            samples: this.validFrames,
            preferredRatioIndex: idx,
            preferredRatioLabel: idx >= 0 ? RATIO_LABELS[idx] : 'unknown',
            medianVariance: median(this.varianceHistory),
            medianIpd: median(this.ipdHistory),
            smoothedConfidence: this.smoothedConfidence,
            isWarm: this.validFrames >= WARM_UP_FRAMES,
        };
    }
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}
