#!/usr/bin/env python3
"""
Analyze gaze benchmark logs.

Supports two formats so v1/v2 (this repo's JSON harness) and the integrated
`src/benchmark/` (CSV + auto-saved to `gaze_result/`) can be compared
side-by-side:

  - .json — produced by bench/protocol.ts (BenchRun.toJSON). Has explicit
    grid + drift task structure with per-target sample windows.
  - .csv  — produced by src/benchmark/export.ts.buildCsv. Per-sample rows
    with (timestamp, target_x, target_y, gaze_x, gaze_y, error_px), plus
    a `# key,value` header block carrying overall metrics. Filename
    convention `benchmark_<engine>_<calib>[_drift].csv` lets us infer the
    task (sweep vs drift) from the path.

Usage:
    python3 bench/analyze.py file1.json file2.csv ...
    python3 bench/analyze.py --dist-cm 60 --dpi 110 *.json *.csv

Reports per-session:
  - Grid / sweep: mean / worst / per-cell angular error, RMS jitter,
    sample-loss rate, hit rate (CSV only).
  - Drift: angular error vs minutes-since-start, linear drift rate.

Compare two files by reading both numbers; no fancy plotting here.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path


def px_to_deg(px: float, dist_cm: float, dpi: float) -> float:
    """Convert a pixel distance to degrees of visual angle."""
    cm = px / dpi * 2.54
    return math.degrees(math.atan2(cm, dist_cm))


def summarize(log: dict, dist_cm: float, dpi: float) -> None:
    pipeline = log.get("pipeline", "?")
    notes = log.get("notes", "")
    print(f"\n=== {pipeline.upper()}  ({log.get('startedAtIso','')}) ===")
    if notes:
        print(f"notes: {notes}")
    print(f"screen: {log['screenW']}×{log['screenH']}  "
          f"(dist={dist_cm} cm, dpi={dpi}, "
          f"1°≈{dpi/2.54*dist_cm*math.tan(math.radians(1)):.0f} px)")

    for task in log.get("tasks", []):
        name = task["name"]
        targets = task["targets"]
        if not targets:
            continue
        print(f"\n— task: {name} ({len(targets)} targets)")

        all_errors_px = []
        per_target = []
        sample_total = 0
        sample_ok = 0
        for tg in targets:
            xs, ys = [], []
            for s in tg["samples"]:
                sample_total += 1
                if not s["ok"]:
                    continue
                sample_ok += 1
                xs.append(s["x"])
                ys.append(s["y"])
            if not xs:
                per_target.append((tg, None, None))
                continue
            mx = statistics.fmean(xs)
            my = statistics.fmean(ys)
            err_px = math.hypot(mx - tg["x"], my - tg["y"])
            jitter_px = math.hypot(
                statistics.pstdev(xs) if len(xs) > 1 else 0.0,
                statistics.pstdev(ys) if len(ys) > 1 else 0.0,
            )
            all_errors_px.append(err_px)
            per_target.append((tg, err_px, jitter_px))

        if all_errors_px:
            mean_px = statistics.fmean(all_errors_px)
            worst_px = max(all_errors_px)
            mean_jitter = statistics.fmean(
                j for _, _, j in per_target if j is not None
            )
            print(f"  accuracy:  mean = {mean_px:6.1f} px / "
                  f"{px_to_deg(mean_px, dist_cm, dpi):.2f}°   "
                  f"worst = {worst_px:6.1f} px / "
                  f"{px_to_deg(worst_px, dist_cm, dpi):.2f}°")
            print(f"  precision: jitter (RMS) = {mean_jitter:6.1f} px / "
                  f"{px_to_deg(mean_jitter, dist_cm, dpi):.2f}°")
        loss_pct = (1 - sample_ok / sample_total) * 100 if sample_total else 0
        print(f"  sample-loss: {loss_pct:.1f}% "
              f"({sample_total - sample_ok}/{sample_total})")

        if name == "drift" and all_errors_px:
            # Linear fit: error_deg vs minutes-since-onset
            xs = [tg["onsetMs"] / 60_000.0 for tg, e, _ in per_target if e is not None]
            ys = [px_to_deg(e, dist_cm, dpi) for _, e, _ in per_target if e is not None]
            if len(xs) >= 2:
                n = len(xs)
                mx, my = statistics.fmean(xs), statistics.fmean(ys)
                num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
                den = sum((x - mx) ** 2 for x in xs) or 1e-9
                slope = num / den
                print(f"  drift rate: {slope:+.3f} °/min")
                print(f"             t=0 → {ys[0]:.2f}°,  "
                      f"t={xs[-1]:.1f}min → {ys[-1]:.2f}°")


def parse_csv(path: Path) -> tuple[dict, list[dict]]:
    """Parse a gaze_result/ CSV: header `# key,value` block + per-sample rows.

    Returns (metadata_dict, [sample_row_dict]).
    Stops parsing samples at the `# --- per-cell summary ---` divider so the
    per-cell block doesn't contaminate the per-sample list. Lines starting
    with `#` after the first divider are skipped.
    """
    meta: dict[str, str] = {}
    samples: list[dict] = []
    in_samples = False
    header_cols: list[str] | None = None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# ---"):
            if "per-cell summary" in line:
                # We don't need the per-cell summary block — it's derivable.
                break
            # otherwise it's `# --- per-sample ---`; switch to samples mode.
            in_samples = True
            continue
        if line.startswith("#"):
            # Header metadata: `# key,value`.
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
        row = dict(zip(header_cols, parts))
        samples.append(row)
    return meta, samples


def summarize_csv(path: Path, dist_cm: float, dpi: float) -> None:
    meta, rows = parse_csv(path)
    if not rows:
        print(f"[{path}] no samples — skipping")
        return

    # Infer pipeline + task from filename (the canonical encoding used by
    # main.ts `runLabel`). Filename pattern:
    #   benchmark_<engine>_<calib>[-nocoach][_drift]_<timestamp>.csv
    stem = path.stem.replace("benchmark_", "", 1)
    is_drift = "_drift" in stem
    pipeline = "webgazer" if stem.startswith("webgazer") else (
        "facemesh" if stem.startswith("facemesh") else "?")

    print(f"\n=== {pipeline.upper()}  ({meta.get('benchmark_run_at','?')}) "
          f"[csv, {'drift' if is_drift else 'sweep'}] ===")
    print(f"screen: {meta.get('screen_width','?')}×{meta.get('screen_height','?')}  "
          f"grid={meta.get('grid','?')}  dwell={meta.get('dwell_ms','?')} ms  "
          f"px/deg={meta.get('px_per_degree','?')}")

    # Per-target aggregation: group by cell_index → mean error per visit.
    by_cell: dict[str, list[tuple[float, float, float, float]]] = {}
    for r in rows:
        cell = r["cell_index"]
        by_cell.setdefault(cell, []).append((
            float(r["timestamp_ms"]),
            float(r["gaze_x"]),
            float(r["gaze_y"]),
            float(r["error_px"]),
        ))

    target_errs_px = []
    target_jitters_px = []
    target_onsets_ms = []
    for cell, vals in by_cell.items():
        if not vals:
            continue
        errs = [v[3] for v in vals]
        xs = [v[1] for v in vals]
        ys = [v[2] for v in vals]
        ts = [v[0] for v in vals]
        target_errs_px.append(statistics.fmean(errs))
        jx = statistics.pstdev(xs) if len(xs) > 1 else 0.0
        jy = statistics.pstdev(ys) if len(ys) > 1 else 0.0
        target_jitters_px.append(math.hypot(jx, jy))
        target_onsets_ms.append(min(ts))

    if target_errs_px:
        mean_px = statistics.fmean(target_errs_px)
        worst_px = max(target_errs_px)
        mean_jit = statistics.fmean(target_jitters_px)
        print(f"  accuracy:  mean = {mean_px:6.1f} px / "
              f"{px_to_deg(mean_px, dist_cm, dpi):.2f}°   "
              f"worst = {worst_px:6.1f} px / "
              f"{px_to_deg(worst_px, dist_cm, dpi):.2f}°")
        print(f"  precision: jitter (RMS) = {mean_jit:6.1f} px / "
              f"{px_to_deg(mean_jit, dist_cm, dpi):.2f}°")

    # Header-line metrics (use the run's own px/deg so it matches the UI).
    if "mean_error_deg" in meta:
        print(f"  csv-header: mean = {meta['mean_error_deg']}°   "
              f"median = {meta.get('median_error_deg','?')}°   "
              f"hit-rate = {meta.get('hit_rate_pct','?')}%")
    # Throughput + tracking-loss arrived in a later schema version, so guard
    # the print so older CSVs don't get a noisy "— Hz / — %" line.
    if "sample_rate_hz" in meta or "tracking_loss_pct" in meta:
        rate = meta.get("sample_rate_hz", "—")
        loss = meta.get("tracking_loss_pct", "—")
        print(f"  throughput: {rate} Hz   tracking-loss = {loss}%")

    if is_drift and len(target_errs_px) >= 2:
        # Drift rate from per-target mean errors vs wall-clock.
        t0 = target_onsets_ms[0]
        xs = [(t - t0) / 60_000.0 for t in target_onsets_ms]
        ys = [px_to_deg(e, dist_cm, dpi) for e in target_errs_px]
        mx, my = statistics.fmean(xs), statistics.fmean(ys)
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = sum((x - mx) ** 2 for x in xs) or 1e-9
        slope = num / den
        print(f"  drift rate: {slope:+.3f} °/min")
        print(f"             t=0 → {ys[0]:.2f}°,  "
              f"t={xs[-1]:.1f}min → {ys[-1]:.2f}°")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+", type=Path)
    p.add_argument("--dist-cm", type=float, default=50.0,
                   help="Viewing distance (cm), default 50")
    p.add_argument("--dpi", type=float, default=96.0,
                   help="Screen pixel density (CSS px / inch), default 96")
    args = p.parse_args()

    for path in args.files:
        suffix = path.suffix.lower()
        try:
            if suffix == ".csv":
                summarize_csv(path, args.dist_cm, args.dpi)
            else:
                log = json.loads(path.read_text())
                summarize(log, args.dist_cm, args.dpi)
        except Exception as e:
            print(f"[{path}] failed to read: {e}", file=sys.stderr)
            continue
    return 0


if __name__ == "__main__":
    sys.exit(main())
