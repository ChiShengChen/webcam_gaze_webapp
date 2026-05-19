#!/usr/bin/env python3
"""
Analyze gaze benchmark JSON logs.

Usage:
    python3 bench/analyze.py file1.json [file2.json ...]
    python3 bench/analyze.py --dist-cm 60 --dpi 110 file1.json

Reports per-session:
  - Grid: mean / worst / per-cell angular error, precision (RMS jitter),
    sample-loss rate.
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


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+", type=Path)
    p.add_argument("--dist-cm", type=float, default=50.0,
                   help="Viewing distance (cm), default 50")
    p.add_argument("--dpi", type=float, default=96.0,
                   help="Screen pixel density (CSS px / inch), default 96")
    args = p.parse_args()

    for path in args.files:
        try:
            log = json.loads(path.read_text())
        except Exception as e:
            print(f"[{path}] failed to read: {e}", file=sys.stderr)
            continue
        summarize(log, args.dist_cm, args.dpi)
    return 0


if __name__ == "__main__":
    sys.exit(main())
