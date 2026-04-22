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
 */
export class GazeKRR {
    private rx = new KernelRidgeRegression();
    private ry = new KernelRidgeRegression();
    private _fitted = false;
    private _gamma = 0;

    fit(features: number[][], targets: { x: number; y: number }[], lambda = 1e-3): void {
        if (features.length !== targets.length) {
            throw new Error('GazeKRR: features/targets length mismatch');
        }
        const gamma = medianHeuristicGamma(features);
        const yx = targets.map(t => t.x);
        const yy = targets.map(t => t.y);
        this.rx.fit(features, yx, { gamma, lambda });
        this.ry.fit(features, yy, { gamma, lambda });
        this._fitted = true;
        this._gamma = gamma;
    }

    predict(x: number[]): { x: number; y: number } {
        return { x: this.rx.predict(x), y: this.ry.predict(x) };
    }

    get isFitted(): boolean {
        return this._fitted;
    }

    get stats(): { gamma: number; support: number } {
        return { gamma: this._gamma, support: this.rx.supportCount };
    }
}
