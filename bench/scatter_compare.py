#!/usr/bin/env python3
"""
Side-by-side WebGazer / FaceMesh sample-scatter plot, aggregated over a
configurable rectangle of central cells of the sweep grid.

For each engine's sweep CSV, we collect per-sample (gaze_x - target_x,
gaze_y - target_y) offsets within the chosen cells, convert to degrees
via the header's px_per_degree, and render two panels at matched scale
with:

  - Translucent per-sample dots (the cloud).
  - A central crosshair at (0, 0) marking the target.
  - The centroid (mean offset) as a red marker — the accuracy component.
  - A dashed circle at the radial p95 — the precision component.

The figure visualises both halves of the accuracy / precision split that
Table 1 (mean error vs. v_p99 jitter velocity) reports numerically. The
default cell window is rows 2-4 x cols 6-10 (15 cells across the middle
of the 16x8 sweep grid), which gives both engines a moderate-difficulty
region without favouring the FaceMesh-good centre or the WebGazer-good
bottom-left.

Usage:
    python3 bench/scatter_compare.py \\
        gaze_result/benchmark_webgazer_pursuit_2026-06-08-04-47-22.csv \\
        gaze_result/benchmark_facemesh_pursuit_2026-06-08-04-55-19.csv \\
        --out paper/figures/scatter_compare.png
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches


def parse_csv(path: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Same parser as bench/analyze.py / bench/heatmap.py."""
    meta: dict[str, str] = {}
    rows: list[dict[str, str]] = []
    header_cols: list[str] | None = None
    in_samples = False
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# ---"):
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


def collect_offsets(
    path: Path,
    row_range: tuple[int, int],
    col_range: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray, float, str]:
    """Returns (dx_deg, dy_deg, pxdeg, label).

    dx_deg, dy_deg are per-sample (gaze - target) offsets in degrees,
    filtered to cells inside the given inclusive row/col ranges.
    """
    meta, rows = parse_csv(path)
    pxdeg = float(meta.get("px_per_degree", "45"))
    rmin, rmax = row_range
    cmin, cmax = col_range
    dx_list: list[float] = []
    dy_list: list[float] = []
    for r in rows:
        try:
            row = int(r["cell_row"])
            col = int(r["cell_col"])
            if not (rmin <= row <= rmax and cmin <= col <= cmax):
                continue
            tx = float(r["target_x"])
            ty = float(r["target_y"])
            gx = float(r["gaze_x"])
            gy = float(r["gaze_y"])
        except (KeyError, ValueError):
            continue
        dx_list.append((gx - tx) / pxdeg)
        dy_list.append((gy - ty) / pxdeg)
    stem = path.stem.replace("benchmark_", "", 1)
    if stem.startswith("webgazer"):
        label = "WebGazer"
    elif stem.startswith("facemesh"):
        label = "FaceMesh+KRR"
    else:
        label = "?"
    return np.asarray(dx_list), np.asarray(dy_list), pxdeg, label


def render(
    panels: list[tuple[np.ndarray, np.ndarray, str]],
    out_path: Path,
    axis_lim_deg: float,
    cell_range_text: str,
) -> None:
    fig, axes = plt.subplots(
        1, len(panels), figsize=(4.6 * len(panels), 4.6), sharex=True, sharey=True,
    )
    if len(panels) == 1:
        axes = [axes]

    for ax, (dx, dy, label) in zip(axes, panels):
        # Translucent scatter so density structure is visible without
        # individual points dominating.
        ax.scatter(dx, dy, s=4, alpha=0.15, color="#1f77b4", linewidths=0)

        # Crosshair at target.
        ax.axhline(0, color="#666666", lw=0.5, zorder=1)
        ax.axvline(0, color="#666666", lw=0.5, zorder=1)
        ax.plot(0, 0, marker="+", color="black", markersize=14,
                markeredgewidth=1.6, zorder=3)

        # Centroid (mean offset) — accuracy component.
        cx, cy = float(np.mean(dx)), float(np.mean(dy))
        ax.plot(cx, cy, marker="o", color="#d62728", markersize=8,
                markeredgecolor="white", markeredgewidth=1.2, zorder=4)

        # Radial p95 — precision component.
        radii = np.hypot(dx - cx, dy - cy)
        p95 = float(np.percentile(radii, 95))
        ax.add_patch(mpatches.Circle(
            (cx, cy), p95,
            fill=False, edgecolor="#d62728", linestyle="--",
            linewidth=1.2, zorder=2,
        ))

        # Summary text in the corner.
        mean_err = math.hypot(cx, cy)
        ax.text(
            0.02, 0.98,
            f"{label}\n"
            f"n = {len(dx)}\n"
            f"mean offset = {mean_err:.2f}°\n"
            f"radial p95 = {p95:.2f}°",
            transform=ax.transAxes,
            va="top", ha="left", fontsize=9,
            bbox=dict(boxstyle="round,pad=0.4",
                      facecolor="white", edgecolor="#cccccc"),
        )

        ax.set_xlim(-axis_lim_deg, axis_lim_deg)
        ax.set_ylim(axis_lim_deg, -axis_lim_deg)  # y inverted (screen coords)
        ax.set_aspect("equal", adjustable="box")
        ax.set_xlabel(r"horizontal offset (deg)")
        ax.set_ylabel(r"vertical offset (deg)")
        ax.set_title(label)
        ax.grid(True, color="#eeeeee", lw=0.5, zorder=0)

    fig.suptitle(
        f"Per-sample gaze offset relative to target, central cells {cell_range_text}",
        fontsize=11, y=1.02,
    )
    fig.tight_layout()
    fig.savefig(out_path, dpi=140, bbox_inches="tight")
    plt.close(fig)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+", type=Path,
                   help="Sweep CSVs to compare side-by-side (typically two).")
    p.add_argument("--rows", default="2-4",
                   help="Inclusive row range (e.g., '2-4'). Default 2-4.")
    p.add_argument("--cols", default="6-10",
                   help="Inclusive col range (e.g., '6-10'). Default 6-10.")
    p.add_argument("--axis-deg", type=float, default=20.0,
                   help="Half-extent of each axis in degrees. Default 20.")
    p.add_argument("--out", type=Path, required=True,
                   help="Output PNG path.")
    args = p.parse_args()

    rmin, rmax = (int(x) for x in args.rows.split("-"))
    cmin, cmax = (int(x) for x in args.cols.split("-"))

    panels: list[tuple[np.ndarray, np.ndarray, str]] = []
    for f in args.files:
        dx, dy, _, label = collect_offsets(f, (rmin, rmax), (cmin, cmax))
        if len(dx) == 0:
            print(f"warning: {f} has no samples in cells "
                  f"rows {rmin}-{rmax} cols {cmin}-{cmax}; skipping",
                  file=sys.stderr)
            continue
        panels.append((dx, dy, label))

    if not panels:
        print("error: no panels to render", file=sys.stderr)
        return 1

    cell_range_text = f"(rows {rmin}--{rmax}, cols {cmin}--{cmax})"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    render(panels, args.out, args.axis_deg, cell_range_text)
    print(f"wrote {args.out}  (panels: {', '.join(p[2] for p in panels)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
