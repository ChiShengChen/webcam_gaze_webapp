/**
 * Kernel Ridge Regression with RBF kernel.
 *
 * Per-user, fits in closed form from calibration samples. A strict
 * generalisation of the linear ridge regression WebGazer uses — anywhere
 * ridge works, KRR with a suitable kernel works at least as well, and
 * KRR captures the non-linear mapping from eye features to screen
 * coordinates that ridge cannot.
 *
 *   α = (K + λI)⁻¹ y,   K_ij = exp(-γ ‖x_i − x_j‖²)
 *   ŷ(x) = Σ α_i · k(x_i, x)
 *
 * We solve via Cholesky decomposition (K + λI is symmetric positive
 * definite for λ > 0). For the calibration sizes we expect (tens to low
 * hundreds of samples) the O(N³) factorisation costs sub-10 ms and
 * inference is O(N·d) per prediction.
 */

/** Solve A x = b where A is symmetric positive definite, in place on `a`. */
function cholSolve(a: number[][], b: number[]): number[] {
    const n = a.length;
    const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    // Cholesky: A = L L^T
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = a[i][j];
            for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
            if (i === j) {
                if (sum <= 0) throw new Error('Cholesky failed: matrix not positive definite');
                L[i][i] = Math.sqrt(sum);
            } else {
                L[i][j] = sum / L[j][j];
            }
        }
    }

    // Solve L·y = b (forward substitution)
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        let sum = b[i];
        for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
        y[i] = sum / L[i][i];
    }
    // Solve L^T·x = y (back substitution)
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = y[i];
        for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
        x[i] = sum / L[i][i];
    }
    return x;
}

/** Lower bound for per-feature std after z-score normalisation.
 *
 *  Diagnostics showed that iris dx/dy std during pursuit calibration
 *  lands around 0.04 — just below the previous 0.05 floor. The floor
 *  was meant to dampen near-constant noise features (head pose at
 *  ~0.005 std) without clobbering the real iris signal; we misjudged
 *  where to put it. Dropping to 0.02 keeps head-pose features
 *  reasonably damped but lets iris features (0.04) retain a 2× lead
 *  over the noise floor so they actually drive the RBF distance.
 *  Quantisation noise floor of the FaceMesh iris landmarks at
 *  1280x720 is ~0.01, so 0.02 stays above it with margin. */
const STD_FLOOR = 0.02;

function sqEuclid(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
    }
    return s;
}

/** Median of pairwise squared distances — canonical γ heuristic for RBF. */
export function medianHeuristicGamma(X: number[][]): number {
    const n = X.length;
    if (n < 2) return 1;
    const d: number[] = [];
    const cap = Math.min(n, 200); // sub-sample for large N
    for (let i = 0; i < cap; i++) {
        for (let j = i + 1; j < cap; j++) {
            d.push(sqEuclid(X[i], X[j]));
        }
    }
    d.sort((a, b) => a - b);
    const med = d[Math.floor(d.length / 2)];
    return med > 0 ? 1 / med : 1;
}

export interface KrrConfig {
    gamma?: number;
    lambda: number;
}

export class KernelRidgeRegression {
    private alpha: number[] = [];
    private supports: number[][] = [];
    private gamma = 1;
    private fitted = false;

    fit(X: number[][], y: number[], cfg: KrrConfig): void {
        const n = X.length;
        if (n !== y.length) throw new Error('KRR: X and y length mismatch');
        if (n === 0) throw new Error('KRR: empty training set');

        this.gamma = cfg.gamma ?? medianHeuristicGamma(X);
        this.supports = X.map(row => row.slice());

        const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                const k = Math.exp(-this.gamma * sqEuclid(X[i], X[j]));
                A[i][j] = A[j][i] = k;
            }
            A[i][i] += cfg.lambda;
        }
        this.alpha = cholSolve(A, y.slice());
        this.fitted = true;
    }

    predict(x: number[]): number {
        if (!this.fitted) return 0;
        let sum = 0;
        for (let i = 0; i < this.supports.length; i++) {
            sum += this.alpha[i] * Math.exp(-this.gamma * sqEuclid(this.supports[i], x));
        }
        return sum;
    }

    get isFitted(): boolean {
        return this.fitted;
    }

    get supportCount(): number {
        return this.supports.length;
    }
}

/**
 * Decoupled x/y predictor — two independent KRRs sharing the same feature
 * space. Standard setup for gaze regression; the two screen axes have
 * different geometry so sharing a model would waste capacity.
 *
 * Wraps KernelRidgeRegression with two preprocessing steps that matter a
 * lot for RBF kernels:
 *
 *   1. Per-dimension z-score standardisation of the feature vector.
 *      Without this, a single high-variance feature (e.g. face centre
 *      position, range [0,1]) dominates the kernel distance and drowns
 *      out a useful-but-small feature (e.g. iris radius, range ~0.007).
 *      Standardising first makes the RBF treat every dimension on the
 *      same footing.
 *
 *   2. Target centring (y − mean, add mean back on predict). KRR without
 *      centring collapses predictions toward 0 under heavy regularisation
 *      — in our case, that pulled the cursor to the top-left corner of
 *      the screen. With centring it collapses to the target mean (≈
 *      screen centre), which is a much more honest "I don't know" output.
 */
export class GazeKRR {
    private rx = new KernelRidgeRegression();
    private ry = new KernelRidgeRegression();
    private _fitted = false;
    private _gamma = 0;
    private _lambda = 0;
    private _lastDiagnostics = '';
    private _rawStds: number[] = [];
    private featMean: number[] = [];
    private featStd: number[] = [];
    private targetMeanX = 0;
    private targetMeanY = 0;

    fit(features: number[][], targets: { x: number; y: number }[], lambda = 1e-2): void {
        if (features.length !== targets.length) {
            throw new Error('GazeKRR: features/targets length mismatch');
        }
        if (features.length === 0) {
            throw new Error('GazeKRR: empty training set');
        }

        // Feature z-score statistics.
        const d = features[0].length;
        this.featMean = new Array(d).fill(0);
        this.featStd = new Array(d).fill(1);
        const rawStds = new Array(d).fill(0);
        for (let j = 0; j < d; j++) {
            let sum = 0;
            for (const f of features) sum += f[j];
            this.featMean[j] = sum / features.length;
            let sqsum = 0;
            for (const f of features) {
                const diff = f[j] - this.featMean[j];
                sqsum += diff * diff;
            }
            const variance = sqsum / features.length;
            rawStds[j] = Math.sqrt(variance);
            // Floor matters. If the user keeps their head still during
            // pursuit calibration, head-pose features barely move, so
            // their raw std is tiny. Dividing by a tiny std turns any
            // inference-time jitter into a huge standardised swing —
            // low-variance features end up dominating the RBF kernel,
            // which is exactly backwards. Flooring at 0.05 caps the
            // amplification; features that really do vary (iris dx/dy
            // at std ~0.2) are unaffected.
            this.featStd[j] = Math.max(rawStds[j], STD_FLOOR);
        }
        const Xstd = features.map(f => this.standardise(f));

        // One-line diagnostics so a failing calibration is debuggable from
        // the browser console without having to edit code. Indices match
        // the layout in src/gaze/features.ts.
        console.log('[GazeKRR] fit: N=' + features.length,
            'gamma=' + medianHeuristicGamma(Xstd).toExponential(2),
            'lambda=' + lambda.toExponential(2),
            'feature_raw_std=' + rawStds.map(v => v.toFixed(4)).join(','),
            'floored_std=' + this.featStd.map(v => v.toFixed(4)).join(','));

        // Target centring — fit on residuals, add mean back in predict().
        this.targetMeanX = targets.reduce((a, t) => a + t.x, 0) / targets.length;
        this.targetMeanY = targets.reduce((a, t) => a + t.y, 0) / targets.length;
        const yx = targets.map(t => t.x - this.targetMeanX);
        const yy = targets.map(t => t.y - this.targetMeanY);

        const gamma = medianHeuristicGamma(Xstd);
        this.rx.fit(Xstd, yx, { gamma, lambda });
        this.ry.fit(Xstd, yy, { gamma, lambda });
        this._fitted = true;
        this._gamma = gamma;
        this._lambda = lambda;
        this._rawStds = rawStds;
        this._lastDiagnostics =
            `N=${features.length}  γ=${gamma.toExponential(2)}  λ=${lambda.toExponential(1)}\n` +
            `feature raw std: [${rawStds.map(v => v.toFixed(4)).join(', ')}]\n` +
            `feature after floor (${STD_FLOOR}): [${this.featStd.map(v => v.toFixed(4)).join(', ')}]\n` +
            `target mean: (${this.targetMeanX.toFixed(0)}, ${this.targetMeanY.toFixed(0)})`;
    }

    predict(x: number[]): { x: number; y: number } {
        if (!this._fitted) return { x: 0, y: 0 };
        const xStd = this.standardise(x);
        return {
            x: this.rx.predict(xStd) + this.targetMeanX,
            y: this.ry.predict(xStd) + this.targetMeanY,
        };
    }

    private standardise(f: number[]): number[] {
        const out = new Array(f.length);
        for (let j = 0; j < f.length; j++) {
            out[j] = (f[j] - this.featMean[j]) / this.featStd[j];
        }
        return out;
    }

    get isFitted(): boolean {
        return this._fitted;
    }

    get stats(): { gamma: number; support: number } {
        return { gamma: this._gamma, support: this.rx.supportCount };
    }

    /** Human-readable fit diagnostics, populated on the last fit().
     *  Used by the benchmark summary so the user can inspect feature
     *  std / gamma / lambda without opening DevTools mid-run. */
    get diagnostics(): string {
        return this._lastDiagnostics;
    }

    /** Per-feature raw std and floored std — machine-readable companion
     *  to `diagnostics`. Useful for programmatic feature selection. */
    get featureStats(): { rawStd: number[]; flooredStd: number[]; mean: number[] } {
        return {
            rawStd: this._rawStds.slice(),
            flooredStd: this.featStd.slice(),
            mean: this.featMean.slice(),
        };
    }

    /** Expose lambda for introspection. */
    get lambda(): number {
        return this._lambda;
    }
}
