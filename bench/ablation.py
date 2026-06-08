#!/usr/bin/env python3
"""
Aggregate §6 ablation runs into a two-panel figure + summary table.

Reads CSVs whose filenames carry the ablation tag emitted by
[src/main.ts](../src/main.ts) `runLabel`:

    benchmark_facemesh_pursuit_abl-oneB0.015_<stamp>.csv
    benchmark_facemesh_pursuit_abl-k-linear_<stamp>.csv
    ...

Plus the unsuffixed default-config run as the baseline:

    benchmark_facemesh_pursuit_<stamp>.csv         # default

Groups runs by sweep dimension (One-Euro beta, KRR kernel) and produces:

  - Panel (a): accuracy (mean angular error, °) vs precision
               (within-fixation v_p99, °/s), across One-Euro beta values.
               This is the §5.4 accuracy-precision tradeoff turned into a
               Pareto curve. Default (beta=0.007) marked.
  - Panel (b): bar chart of mean angular error per kernel.

Usage:
    python3 bench/ablation.py \
        --baseline gaze_result/benchmark_facemesh_pursuit_2026-06-08-04-55-19.csv \
        --abl-dir   gaze_result \
        --out       paper/figures/ablation.png
"""

from __future__ import annotations

import argparse
import math
import re
import statistics
import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt


# ---------------------------------------------------------------------
# CSV parsing — duplicated from bench/analyze.py to keep the script
# self-contained (no project package).
# ---------------------------------------------------------------------

def parse_csv(path: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
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


def within_fixation_v_p99(rows: list[dict[str, str]], pxdeg: float) -> float | None:
    """Within-cell inter-sample velocity, p99 in deg/s.

    Mirrors bench/analyze.py.velocity_stats but grouped by cell_index so
    saccades between cells don't dominate the percentile."""
    by_cell: dict[str, list[tuple[float, float, float]]] = {}
    for r in rows:
        try:
            cell = r["cell_index"]
            t = float(r["timestamp_ms"])
            x = float(r["gaze_x"])
            y = float(r["gaze_y"])
        except (KeyError, ValueError):
            continue
        by_cell.setdefault(cell, []).append((t, x, y))
    vs: list[float] = []
    for stream in by_cell.values():
        stream.sort()
        for i in range(1, len(stream)):
            t0, x0, y0 = stream[i - 1]
            t1, x1, y1 = stream[i]
            dt_s = (t1 - t0) / 1000.0
            if dt_s <= 0:
                continue
            d_deg = math.hypot(x1 - x0, y1 - y0) / pxdeg
            vs.append(d_deg / dt_s)
    if len(vs) < 10:
        return None
    vs.sort()
    return vs[min(len(vs) - 1, int(round(0.99 * (len(vs) - 1))))]


def classify(stem: str) -> dict[str, str | float]:
    """Pull the ablation tag(s) out of a CSV filename.

    Filename pattern:
        benchmark_facemesh_pursuit[_drift][_abl-<tags>]_<stamp>.csv
    where <tags> is a `-` separated list among:
        oneM<x>   One-Euro minCutoff = <x>
        oneB<x>   One-Euro beta = <x>
        k-<name>  KRR kernel = <name>

    Returns a dict with the parsed knob values (defaults when missing) so
    every CSV can be filed into the right ablation panel.
    """
    out: dict[str, str | float] = {
        "minCutoff": 1.0,
        "beta": 0.007,
        "kernel": "rbf",
    }
    m = re.search(r"_abl-([A-Za-z0-9\-\.]+?)_\d{4}-", stem)
    if not m:
        return out
    for tag in m.group(1).split("-"):
        if tag.startswith("oneM"):
            try:
                v = float(tag[4:])
                # Known artifact of the URL parser bug: Number(null)===0
                # passed the v>0 check and emitted 'oneM0' even though
                # ?onemin was absent. Treat 0 as default-was-meant.
                if v > 0:
                    out["minCutoff"] = v
            except ValueError: pass
        elif tag.startswith("oneB"):
            try:
                v = float(tag[4:])
                # Same artifact as above: 'oneB0' is emitted when
                # ?onebeta was absent. Treat as default 0.007.
                if v > 0:
                    out["beta"] = v
            except ValueError: pass
        elif tag.startswith("k"):
            # 'k-linear' arrives as ['k', 'linear'] after the outer split;
            # rejoin by checking adjacent tag.
            pass  # handled below
    # The kernel tag has an internal hyphen ('k-linear') which the outer
    # split breaks; re-scan the raw tag string for the kernel marker.
    km = re.search(r"k-(rbf|linear|poly2)", m.group(1))
    if km:
        out["kernel"] = km.group(1)
    return out


# ---------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------

def load_run(path: Path) -> dict:
    meta, rows = parse_csv(path)
    pxdeg = float(meta.get("px_per_degree", "45"))
    cls = classify(path.stem)
    mean_deg = float(meta.get("mean_error_deg", "nan"))
    inf_p95 = float(meta.get("inference_latency_p95_ms", "nan"))
    v_p99 = within_fixation_v_p99(rows, pxdeg)
    return {
        "path": path,
        "minCutoff": cls["minCutoff"],
        "beta": cls["beta"],
        "kernel": cls["kernel"],
        "mean_deg": mean_deg,
        "inf_p95_ms": inf_p95,
        "v_p99": v_p99,
        "n_samples": len(rows),
    }


def find_runs(baseline: Path, abl_dir: Path) -> list[dict]:
    """Collect baseline + all ablation runs under abl_dir.

    Filters to FaceMesh sweep runs only (ablation does not touch
    WebGazer; drift runs are a separate protocol)."""
    runs: list[dict] = []
    runs.append(load_run(baseline))
    for p in sorted(abl_dir.glob("benchmark_facemesh_pursuit_abl-*.csv")):
        if "_drift_" in p.name:
            continue
        runs.append(load_run(p))
    return runs


# ---------------------------------------------------------------------
# Figure
# ---------------------------------------------------------------------

def render(runs: list[dict], out_path: Path) -> None:
    # Split: One-Euro sweep = runs that keep default kernel='rbf' and
    # default minCutoff=1.0, varying beta.
    beta_runs = [r for r in runs if r["kernel"] == "rbf" and r["minCutoff"] == 1.0]
    beta_runs.sort(key=lambda r: r["beta"])
    # Kernel sweep = runs that keep default beta=0.007 and minCutoff=1.0,
    # varying kernel.
    kernel_runs = [r for r in runs if r["minCutoff"] == 1.0 and r["beta"] == 0.007]
    # Preserve a stable order for kernels.
    kernel_order = {"rbf": 0, "linear": 1, "poly2": 2}
    kernel_runs.sort(key=lambda r: kernel_order.get(str(r["kernel"]), 99))

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4))

    # --- Panel (a): One-Euro β sweep — accuracy vs precision Pareto ---
    ax = axes[0]
    if beta_runs:
        xs = [r["mean_deg"] for r in beta_runs]
        ys = [r["v_p99"] for r in beta_runs if r["v_p99"] is not None]
        if len(xs) == len(ys):
            ax.plot(xs, ys, "o-", color="#1f77b4", lw=1.3, markersize=8)
            for r, x, y in zip(beta_runs, xs, ys):
                annot = rf"$\beta={r['beta']:g}$"
                if abs(r["beta"] - 0.007) < 1e-9:
                    annot += "\n(default)"
                ax.annotate(annot, (x, y),
                            xytext=(7, 4), textcoords="offset points",
                            fontsize=9, color="#1f77b4")
        else:
            ax.text(0.5, 0.5, "insufficient samples for v_p99",
                    transform=ax.transAxes, ha="center", va="center",
                    color="#888888")
    else:
        ax.text(0.5, 0.5, "no β-sweep runs found",
                transform=ax.transAxes, ha="center", va="center",
                color="#888888")
    ax.set_xlabel("mean angular error (°)  — accuracy →")
    ax.set_ylabel("within-fixation $v_{p99}$ (°/s)  — precision →")
    ax.set_title("(a)  One-Euro $\\beta$ sweep — accuracy / precision Pareto")
    ax.grid(True, color="#eeeeee", lw=0.5)
    ax.invert_xaxis()
    ax.invert_yaxis()

    # --- Panel (b): KRR kernel — bar chart of mean error per kernel ---
    ax = axes[1]
    if kernel_runs:
        labels = [str(r["kernel"]) for r in kernel_runs]
        vals = [r["mean_deg"] for r in kernel_runs]
        colors = ["#2ca02c" if k == "rbf" else "#1f77b4" for k in labels]
        bars = ax.bar(labels, vals, color=colors)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2, v + 0.2,
                    f"{v:.2f}°", ha="center", va="bottom", fontsize=10)
        ax.set_ylim(0, max(vals) * 1.18)
        ax.set_xlabel("KRR kernel")
        ax.set_ylabel("mean angular error (°)")
        ax.set_title("(b)  KRR kernel comparison")
        ax.grid(True, axis="y", color="#eeeeee", lw=0.5)
    else:
        ax.text(0.5, 0.5, "no kernel-sweep runs found",
                transform=ax.transAxes, ha="center", va="center",
                color="#888888")

    fig.suptitle(
        "§6 ablation, FaceMesh+KRR on sweep task, single user",
        fontsize=11, y=1.02,
    )
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=140, bbox_inches="tight")
    plt.close(fig)


def print_summary(runs: list[dict]) -> None:
    print(f"{'kernel':<8} {'minCutoff':>10} {'beta':>8} "
          f"{'mean°':>8} {'p95 ms':>8} {'v_p99 °/s':>11} {'N':>6}  file")
    for r in sorted(runs, key=lambda r: (r["kernel"], r["minCutoff"], r["beta"])):
        vp99 = f"{r['v_p99']:.1f}" if r["v_p99"] is not None else "—"
        print(f"{r['kernel']:<8} {r['minCutoff']:>10.3f} {r['beta']:>8.3f} "
              f"{r['mean_deg']:>8.2f} {r['inf_p95_ms']:>8.1f} "
              f"{vp99:>11} {r['n_samples']:>6}  {r['path'].name}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--baseline", type=Path, required=True,
                   help="Default-config FaceMesh sweep CSV (beta=0.007, kernel=rbf).")
    p.add_argument("--abl-dir", type=Path, required=True,
                   help="Directory holding benchmark_facemesh_pursuit_abl-* CSVs.")
    p.add_argument("--out", type=Path, required=True,
                   help="Output PNG path for the 2-panel ablation figure.")
    args = p.parse_args()

    runs = find_runs(args.baseline, args.abl_dir)
    if not runs:
        print("error: no runs found", file=sys.stderr)
        return 1

    print_summary(runs)
    print()
    render(runs, args.out)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
