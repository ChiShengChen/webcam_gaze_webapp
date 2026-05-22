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


def region_label(x: float, y: float, screen_w: float, screen_h: float) -> str:
    """Classify a target by spatial region using a 3×3 partition of the
    viewport — corner / edge / center. Grid-agnostic on purpose (works for
    any sweep grid shape and for drift's free-form target positions)."""
    col_band = (
        "left" if x < screen_w / 3 else
        "right" if x >= 2 * screen_w / 3 else
        "mid"
    )
    row_band = (
        "top" if y < screen_h / 3 else
        "bottom" if y >= 2 * screen_h / 3 else
        "mid"
    )
    if row_band == "mid" and col_band == "mid":
        return "center"
    if row_band != "mid" and col_band != "mid":
        return "corner"
    return "edge"


def velocity_stats(
    per_target_streams: list[list[tuple[float, float, float]]],
    dist_cm: float,
    dpi: float,
) -> dict[str, float] | None:
    """Inter-sample velocity distribution in deg/s, computed within each
    target's sample stream (never across targets — the saccade between
    targets would dominate every percentile).

    All our samples come from windows the I-VT classifier labelled
    FIXATION, so the velocity here is *noise velocity inside a labelled
    fixation*. High values mean the pipeline is bouncing the cursor
    even when the user is holding still.

    Returns None when there aren't enough sample pairs to be informative.
    """
    velocities: list[float] = []
    for stream in per_target_streams:
        for i in range(1, len(stream)):
            t0, x0, y0 = stream[i - 1]
            t1, x1, y1 = stream[i]
            dt_s = (t1 - t0) / 1000.0
            if dt_s <= 0:
                continue
            d_px = math.hypot(x1 - x0, y1 - y0)
            v = px_to_deg(d_px, dist_cm, dpi) / dt_s
            velocities.append(v)
    if len(velocities) < 10:
        return None
    velocities.sort()
    n = len(velocities)
    return {
        "median": velocities[n // 2],
        "p95": velocities[min(n - 1, int(round(0.95 * (n - 1))))],
        "p99": velocities[min(n - 1, int(round(0.99 * (n - 1))))],
        "count": n,
    }


def print_region_breakdown(
    per_target: list[tuple[float, float, float]],
    screen_w: float, screen_h: float,
    dist_cm: float, dpi: float,
) -> None:
    """Print mean angular error grouped by 3×3 region.
    `per_target` items are (target_x, target_y, mean_error_px).
    Per-target mean — each target weights equally regardless of sample count."""
    buckets: dict[str, list[float]] = {"center": [], "edge": [], "corner": []}
    for tx, ty, err_px in per_target:
        buckets[region_label(tx, ty, screen_w, screen_h)].append(err_px)
    parts: list[str] = []
    # Stable order: center → edge → corner so the degradation gradient is
    # visually obvious in the printout.
    for name in ("center", "edge", "corner"):
        errs = buckets[name]
        if not errs:
            parts.append(f"{name}=—")
            continue
        mean_px = statistics.fmean(errs)
        parts.append(f"{name}={px_to_deg(mean_px, dist_cm, dpi):.2f}° (n={len(errs)})")
    print(f"  region:    {'  '.join(parts)}")


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

        # Saccade-velocity distribution within fixations. Streams are
        # (t_ms, x_px, y_px); the JSON's per-sample `t` is already in ms.
        streams: list[list[tuple[float, float, float]]] = []
        for tg in targets:
            stream = [(s["t"], s["x"], s["y"]) for s in tg["samples"] if s["ok"]]
            if len(stream) >= 2:
                streams.append(stream)
        vstats = velocity_stats(streams, dist_cm, dpi)
        if vstats:
            print(f"  velocity:  median = {vstats['median']:5.1f} °/s   "
                  f"p95 = {vstats['p95']:6.1f} °/s   "
                  f"p99 = {vstats['p99']:6.1f} °/s   "
                  f"(n={vstats['count']})")

        # Region breakdown: per-target mean error grouped by 3×3 viewport
        # zone. Only useful when targets span the screen (sweep tasks);
        # drift with 10 random targets typically has too few per zone.
        per_target_region_input: list[tuple[float, float, float]] = [
            (tg["x"], tg["y"], e)
            for tg, e, _ in per_target if e is not None
        ]
        if per_target_region_input:
            print_region_breakdown(
                per_target_region_input,
                log["screenW"], log["screenH"],
                dist_cm, dpi,
            )

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
    # Tuple layout: (t_ms, gaze_x, gaze_y, error_px, target_x, target_y).
    by_cell: dict[str, list[tuple[float, float, float, float, float, float]]] = {}
    for r in rows:
        cell = r["cell_index"]
        by_cell.setdefault(cell, []).append((
            float(r["timestamp_ms"]),
            float(r["gaze_x"]),
            float(r["gaze_y"]),
            float(r["error_px"]),
            float(r["target_x"]),
            float(r["target_y"]),
        ))

    target_errs_px = []
    target_jitters_px = []
    target_onsets_ms = []
    target_positions: list[tuple[float, float]] = []
    velocity_streams: list[list[tuple[float, float, float]]] = []
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
        target_positions.append((vals[0][4], vals[0][5]))
        if len(vals) >= 2:
            velocity_streams.append([(t, x, y) for t, x, y, *_ in vals])

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

    # Velocity within fixations (jitter speed) — useful for spotting
    # pipelines that look accurate on the mean but bounce between samples.
    vstats = velocity_stats(velocity_streams, dist_cm, dpi)
    if vstats:
        print(f"  velocity:  median = {vstats['median']:5.1f} °/s   "
              f"p95 = {vstats['p95']:6.1f} °/s   "
              f"p99 = {vstats['p99']:6.1f} °/s   "
              f"(n={vstats['count']})")

    # Region breakdown using viewport partitioning. Falls back gracefully
    # when the screen dimensions header is missing or unparseable.
    try:
        sw = float(meta.get("screen_width", "0"))
        sh = float(meta.get("screen_height", "0"))
    except ValueError:
        sw = sh = 0.0
    if sw > 0 and sh > 0 and target_errs_px:
        per_target_region_input = [
            (tx, ty, err) for (tx, ty), err in zip(target_positions, target_errs_px)
        ]
        print_region_breakdown(
            per_target_region_input, sw, sh, dist_cm, dpi,
        )

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
