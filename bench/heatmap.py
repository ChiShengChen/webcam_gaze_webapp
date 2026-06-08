#!/usr/bin/env python3
"""
Per-cell gaze-error heatmaps from gaze_result/ CSVs.

For each input CSV, group per-sample rows by (cell_row, cell_col), compute
the mean error in degrees per cell, and render a grid heatmap matching the
benchmark's grid shape. Writes a PNG next to each CSV named
`heatmap_<csv-stem>.png`.

The grid shape and px_per_degree are read from the CSV header block. Empty
cells (no samples) are shaded grey — relevant for drift runs where only a
random subset of cells is visited.

Usage:
    python3 bench/heatmap.py file1.csv file2.csv ...
    python3 bench/heatmap.py --vmax 20 *.csv     # cap colour scale at 20°
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt


def parse_csv(path: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Parse a gaze_result/ CSV: header `# key,value` block + per-sample rows.

    Mirrors bench/analyze.py.parse_csv so the two scripts stay in sync. We
    duplicate the parser instead of importing because analyze.py isn't a
    package and shelling out to it would lose the per-sample data we need
    for the per-cell aggregation."""
    meta: dict[str, str] = {}
    rows: list[dict[str, str]] = []
    header_cols: list[str] | None = None
    in_samples = False
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# ---"):
            # `# --- per-cell summary ---` (if ever added) would be derivable
            # from samples; stop reading rows there.
            if "per-cell summary" in line:
                break
            in_samples = True
            continue
        if line.startswith("#"):
            body = line.lstrip("#").strip()
            if "," in body:
                k, _, v = body.partition(",")
                meta[k.strip()] = v.strip()
            continue
        if not in_samples:
            continue
        if header_cols is None:
            header_cols = [c.strip() for c in line.split(",")]
            continue
        parts = line.split(",")
        if len(parts) != len(header_cols):
            continue
        rows.append(dict(zip(header_cols, parts)))
    return meta, rows


def infer_label(stem: str) -> str:
    """Engine + task label from filename (matches main.ts runLabel)."""
    stem = stem.replace("benchmark_", "", 1)
    engine = (
        "WebGazer"
        if stem.startswith("webgazer")
        else ("FaceMesh+KRR" if stem.startswith("facemesh") else "?")
    )
    task = "drift" if "_drift" in stem else "sweep"
    return f"{engine} / {task}"


def make_heatmap(path: Path, vmax: float | None, out_dir: Path) -> Path:
    meta, rows = parse_csv(path)
    if not rows:
        raise RuntimeError(f"{path}: no samples")

    # Grid header is encoded as `colsxrows` in main.ts (matches src/benchmark/export.ts).
    grid = meta.get("grid", "")
    try:
        cols_s, rows_s = grid.split("x")
        cols = int(cols_s)
        n_rows = int(rows_s)
    except (ValueError, AttributeError):
        raise RuntimeError(f"{path}: can't parse grid header '{grid}'")
    pxdeg = float(meta.get("px_per_degree", "45"))

    # Per-cell mean error matrix (degrees).
    err_sum = np.zeros((n_rows, cols))
    err_n = np.zeros((n_rows, cols))
    for r in rows:
        try:
            row = int(r["cell_row"])
            col = int(r["cell_col"])
            err_px = float(r["error_px"])
        except (KeyError, ValueError):
            continue
        if 0 <= row < n_rows and 0 <= col < cols:
            err_sum[row, col] += err_px
            err_n[row, col] += 1
    with np.errstate(divide="ignore", invalid="ignore"):
        mean_px = np.where(err_n > 0, err_sum / err_n, np.nan)
    mean_deg = mean_px / pxdeg

    # Render.
    cell_w = max(8.0, cols * 0.7)
    cell_h = max(4.5, n_rows * 0.75)
    fig, ax = plt.subplots(figsize=(cell_w, cell_h))
    cmap = plt.cm.viridis.copy()
    cmap.set_bad("#cccccc")  # empty cells shown in neutral grey
    masked = np.ma.masked_invalid(mean_deg)
    scale_max = vmax if vmax is not None else max(float(np.nanmax(mean_deg)), 1.0)
    im = ax.imshow(
        masked,
        cmap=cmap,
        origin="upper",
        vmin=0,
        vmax=scale_max,
        aspect="equal",
    )

    # Annotate each cell with its value (or "—" if empty). White on the dark
    # half of the scale, black on the light half, so labels stay readable
    # at both ends.
    for i in range(n_rows):
        for j in range(cols):
            if np.isnan(mean_deg[i, j]):
                ax.text(j, i, "—", ha="center", va="center",
                        fontsize=8, color="#666666")
                continue
            text = f"{mean_deg[i, j]:.1f}"
            norm_val = mean_deg[i, j] / scale_max if scale_max else 0
            color = "white" if norm_val < 0.55 else "black"
            ax.text(j, i, text, ha="center", va="center",
                    fontsize=8, color=color)

    ax.set_xticks(range(cols))
    ax.set_yticks(range(n_rows))
    ax.set_xticklabels(range(cols), fontsize=7)
    ax.set_yticklabels(range(n_rows), fontsize=7)
    ax.set_xlabel("cell column (0 = left)")
    ax.set_ylabel("cell row (0 = top)")
    label = infer_label(path.stem)
    run_at = meta.get("benchmark_run_at", "?")
    mean_deg_header = meta.get("mean_error_deg", "?")
    median_deg_header = meta.get("median_error_deg", "?")
    ax.set_title(
        f"{label}  —  mean error per cell (°)\n"
        f"grid {cols}×{n_rows}   overall mean {mean_deg_header}°   "
        f"median {median_deg_header}°   {run_at}",
        fontsize=10,
    )
    fig.colorbar(im, ax=ax, shrink=0.85, label="mean error (°)")
    fig.tight_layout()

    out_path = out_dir / f"heatmap_{path.stem.replace('benchmark_', '', 1)}.png"
    fig.savefig(out_path, dpi=140, bbox_inches="tight")
    plt.close(fig)
    return out_path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+", type=Path)
    p.add_argument(
        "--vmax",
        type=float,
        default=None,
        help="Cap colour scale at this value (degrees). Default: per-file "
        "max. Pass a common value across runs to make heatmaps directly "
        "comparable.",
    )
    p.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Where to write PNGs (default: alongside each CSV).",
    )
    args = p.parse_args()
    for path in args.files:
        out_dir = args.out_dir or path.parent
        out = make_heatmap(path, args.vmax, out_dir)
        print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
