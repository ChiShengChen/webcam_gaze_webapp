# Gaze Benchmark Harness

Minimal accuracy + drift benchmark for the v1 (WebGazer) and v2 (custom)
pipelines. Both produce the same JSON schema so results compare 1:1.

## Tasks

| Task  | Targets               | Time per target | Total |
|-------|-----------------------|-----------------|-------|
| grid  | 5×5 = 25 dots         | 1 s settle + 1 s sample | ~50 s |
| drift | Centre + random every 30 s | 1 s settle + 1 s sample | 5 min |

Grid captures **static accuracy** (mean error per cell) and **precision**
(within-target sample std-dev). Drift captures **error vs time-since-calibration**.

## Run

```bash
# v1 (WebGazer)
cd webcam_gaze_webapp
npm install   # if you haven't already
npm run dev
# → open http://localhost:5173/benchmark.html

# v2
cd webcam_gaze_webapp/gaze_v2
npm install
npm run dev
# → open http://localhost:5174/benchmark.html
```

Workflow on each page:
1. **Start & calibrate** — opens camera, runs 9-point calibration
   (v1: click each dot 5×; v2: click once, worker auto-collects).
2. **Run grid (5×5)** — look at each yellow dot, do not click anything.
3. **Run drift (5 min)** — same, much longer; sit still and stay focused.
4. **Export JSON** — download the session log.

**Important during a task**: do not move the mouse or click. v2 uses mouse
events as auto-correction signals; any interaction during the task will
contaminate the model. The benchmark dot is `pointer-events: none` for the
same reason.

## JSON schema

```ts
interface SessionLog {
  pipeline: 'v1' | 'v2';
  screenW: number;            // browser viewport width in px
  screenH: number;
  startedAt: number;          // performance.now() at session start
  startedAtIso: string;       // wallclock ISO timestamp
  userAgent: string;
  notes: string;              // free-form, e.g. "afternoon, overhead light, head still"
  tasks: TaskLog[];
}

interface TaskLog {
  name: 'grid' | 'drift';
  params: { rows?, cols?, margin?, settleMs, sampleMs, durationMs?, intervalMs? };
  targets: TargetLog[];
}

interface TargetLog {
  index: number;
  x: number; y: number;       // target centre in screen px
  onsetMs: number;            // ms since session start when target appeared
  settleEndMs: number;        // sample window opens here
  endMs: number;              // sample window closes here
  samples: Sample[];          // collected only during [settleEndMs, endMs]
}

interface Sample {
  t: number;                  // ms since this target's sample window opened
  x: number; y: number;       // predicted gaze in screen px
  ok: boolean;                // false = pipeline produced no prediction this frame
}
```

## Compute key metrics

Drop JSON or CSV files into the same folder, then:

```bash
# v1 / v2 standalone harness (JSON)
python3 bench/analyze.py bench_v1_*.json bench_v2_*.json

# Integrated benchmark (CSV from gaze_result/)
python3 bench/analyze.py gaze_result/benchmark_*.csv

# Mix — comparing all pipelines on whatever each one ran
python3 bench/analyze.py gaze_result/benchmark_*.csv gaze_v2/bench_v2_*.json
```

The script auto-detects format from the file extension. For each file it prints:
- **Sweep / Grid**: per-target mean / worst angular error, RMS jitter, hit rate
- **Drift** (filename contains `_drift` for CSVs, or `name: 'drift'` for JSON):
  error vs minutes-since-first-target, drift rate (°/min linear fit)

Angular error assumes 50 cm viewing distance and 96 DPI screen; override with
`--dist-cm` and `--dpi`. (CSV files also carry their own `px_per_degree` from
the run, surfaced as a separate header-derived row in the output for reference.)

## What this benchmark does NOT cover

- Head-movement robustness (needs prescribed head poses + a head-pose oracle)
- Task-based usability (Fitts' / annotation time) — bigger UI, separate study
- Replay harness (same recorded webcam stream → both pipelines)

Add these once the basic numbers show a clear v1↔v2 gap and you know which
weakness to dig into.
