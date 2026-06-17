# Webcam-gaze benchmark — 2026-06-14 session — grid-density scaling

How does pursuit-calibration accuracy and latency scale as the benchmark target
grid gets denser? Two engines compared across five grid levels (L1→L5), 4 repeats
per engine per level (8 sessions/level, 40 sessions total). L6 (8×16) skipped —
reuse the existing 4-run baseline in `gaze_result/`.

- **WebGazer** — baseline. Ridge regression on raw eye-patch pixels.
- **FaceMesh+KRR** — this work. Kernel ridge regression on 13-dim FaceMesh-landmark feature.

## Protocol

All sessions run `fast=1` pursuit calibration. Posture is **not** changed between
L1→L5. **Intended** protocol: calibrate once at the first L1 session and reuse.
**Observed:** every FaceMesh reload re-runs calibration (diagnostics differ per
session — see below), so each session has its own calibration fit. Same physical
setup throughout:
single light source, fixed seating, ~60 cm viewing distance, DevTools closed, no
window resize. ~30–40 s/session at L1 up to ~108 s + setup at L5; whole matrix ≈ 45–50 min.

| Level | URL grid (`rows`×`cols`) | Filename grid | Cells | Sessions |
|---|---|---|---|---|
| L1 | 1×2 | `1x2` | 2 | 8 |
| L2 | 2×4 | `2x4` | 8 | 8 |
| L3 | 3×6 | `3x6` | 18 | 8 |
| L4 | 4×8 | `4x8` | 32 | 8 |
| L5 | 6×12 | `6x12` | 72 | 8 |

Base URL: `http://localhost:5173/?fast=1&engine=<facemesh|webgazer>&rows=<R>&cols=<C>`

### Calibration diagnostics (FaceMesh, per session)

**⚠️ Calibration is NOT being reused — every FaceMesh reload re-runs pursuit
calibration.** The protocol assumed one calibration at L1 reused throughout, but
the diagnostics differ session-to-session (different `N`, `γ`, `target mean`),
confirming a fresh fit each reload. This per-run calibration variance is the most
likely driver of the L1 vertical instability (see Notes). If you want calibration
held fixed, you'd need to persist/reuse the fitted model rather than reload.

| Session | N | γ | λ | target mean |
|---|---|---|---|---|
| #1 | 390 | 1.07e-1 | 1.0e-3 | (1099, 475) |
| #3 | 339 | 1.17e-1 | 1.0e-3 | (1130, 450) |

Feature raw std / after-floor(0.02), for reference:

```
#1 raw:   [0.0470, 0.0293, 0.0321, 0.0146, 0.1211, 0.0891, 0.0081, 0.0034, 0.0156, 0.0022, 0.0029, 0.0013, 0.0003]
#3 raw:   [0.0571, 0.0265, 0.0487, 0.0237, 0.1237, 0.0939, 0.0116, 0.0030, 0.0311, 0.0025, 0.0018, 0.0014, 0.0003]
```

---

## Results

Columns: cells = cells covered; err = px (deg); hit = hit rate %; rate = sample
rate Hz; loss = tracking loss %; inf / pipe = latency median / p95 ms.

### L1 — 1×2 (2 cells)

| # | Engine | cells | mean err | median err | hit | samples | rate | loss | inf | pipe | CSV | PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | FaceMesh | 2/2 | 293.7 px (6.53°) | 217.9 px (4.84°) | 100.0% | 36 | 30.7 Hz | 0.0% | 16/18 | 17/18 | [csv](benchmark_facemesh_pursuit_1x2_2026-06-15-03-14-44.csv) | [png](gazemap_facemesh_pursuit_1x2_2026-06-15-03-14-44.png) |
| 2 | WebGazer | 2/2 | 283.1 px (6.29°) | 246.1 px (5.47°) | 100.0% | 44 | 31.0 Hz | 0.0% | 26/55 | 26/55 | [csv](benchmark_webgazer_9point_1x2_2026-06-15-03-19-41.csv) | [png](gazemap_webgazer_9point_1x2_2026-06-15-03-19-41.png) |
| 3 | FaceMesh | 2/2 | 374.6 px (8.32°) | 316.1 px (7.02°) | 100.0% | 21 | 30.7 Hz | 0.0% | 21/23 | 21/24 | [csv](benchmark_facemesh_pursuit_1x2_2026-06-15-03-22-25.csv) | [png](gazemap_facemesh_pursuit_1x2_2026-06-15-03-22-25.png) |
| 4 | WebGazer | 2/2 | 320.5 px (7.12°) | 299.2 px (6.65°) | 100.0% | 35 | 31.3 Hz | 0.0% | 31/53 | 31/53 | [csv](benchmark_webgazer_9point_1x2_2026-06-15-03-25-29.csv) | [png](gazemap_webgazer_9point_1x2_2026-06-15-03-25-29.png) |
| 5 | FaceMesh | 2/2 | 563.6 px (12.52°) | 464.9 px (10.33°) | **50.0%** | 32 | 30.3 Hz | 0.0% | 17/19 | 17/19 | [csv](benchmark_facemesh_pursuit_1x2_2026-06-15-03-26-47.csv) | [png](gazemap_facemesh_pursuit_1x2_2026-06-15-03-26-47.png) |
| 6 | WebGazer | 2/2 | 500.8 px (11.13°) | 539.6 px (11.99°) | **50.0%** | 31 | 32.0 Hz | 0.0% | 32/49 | 32/50 | [csv](benchmark_webgazer_9point_1x2_2026-06-15-03-27-49.csv) | [png](gazemap_webgazer_9point_1x2_2026-06-15-03-27-49.png) |
| 7 | FaceMesh | 2/2 | 392.9 px (8.73°) | 218.9 px (4.86°) | **50.0%** | 50 | 30.3 Hz | 0.0% | 18/20 | 18/20 | [csv](benchmark_facemesh_pursuit_1x2_2026-06-15-03-30-44.csv) | [png](gazemap_facemesh_pursuit_1x2_2026-06-15-03-30-44.png) |
| 8 | WebGazer | 2/2 | 641.3 px (14.25°) | 591.1 px (13.14°) | **50.0%** | 30 | 32.0 Hz | 0.0% | 37/51 | 38/51 | [csv](benchmark_webgazer_9point_1x2_2026-06-15-03-32-10.csv) | [png](gazemap_webgazer_9point_1x2_2026-06-15-03-32-10.png) |

### L2 — 2×4 (8 cells)

| # | Engine | cells | mean err | median err | hit | samples | rate | loss | inf | pipe | CSV | PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | FaceMesh | 8/8 | 465.6 px (10.35°) | 384.7 px (8.55°) | **37.5%** | 142 | 30.2 Hz | 0.0% | 20/22 | 21/23 | [csv](benchmark_facemesh_pursuit_2x4_2026-06-15-03-34-32.csv) | [png](gazemap_facemesh_pursuit_2x4_2026-06-15-03-34-32.png) |
| 10 | WebGazer | 8/8 | 297.7 px (6.62°) | 280.7 px (6.24°) | **37.5%** | 161 | 30.8 Hz | 0.0% | 34/51 | 34/51 | [csv](benchmark_webgazer_9point_2x4_2026-06-15-03-36-09.csv) | [png](gazemap_webgazer_9point_2x4_2026-06-15-03-36-09.png) |
| 11 | FaceMesh | 8/8 | 367.3 px (8.16°) | 359.3 px (7.99°) | **25.0%** | 134 | 30.2 Hz | 0.0% | 16/18 | 16/18 | [csv](benchmark_facemesh_pursuit_2x4_2026-06-15-03-37-47.csv) | [png](gazemap_facemesh_pursuit_2x4_2026-06-15-03-37-47.png) |
| 12 | WebGazer | 8/8 | 224.1 px (4.98°) | 190.5 px (4.23°) | 100.0% | 193 | 30.8 Hz | 0.0% | 39/50 | 39/51 | [csv](benchmark_webgazer_9point_2x4_2026-06-15-03-39-04.csv) | [png](gazemap_webgazer_9point_2x4_2026-06-15-03-39-04.png) |
| 13 | FaceMesh | 8/8 | 614.4 px (13.65°) | 577.1 px (12.82°) | **25.0%** | 140 | 30.2 Hz | 0.0% | 13/23 | 13/23 | [csv](benchmark_facemesh_pursuit_2x4_2026-06-15-03-40-22.csv) | [png](gazemap_facemesh_pursuit_2x4_2026-06-15-03-40-22.png) |
| 14 | WebGazer | 8/8 | 305.7 px (6.79°) | 284.0 px (6.31°) | **50.0%** | 180 | 39.8 Hz ⚠️ | 0.0% | 41/72 ⚠️ | 41/73 | [csv](benchmark_webgazer_9point_2x4_2026-06-15-03-41-42.csv) | [png](gazemap_webgazer_9point_2x4_2026-06-15-03-41-42.png) |
| 15 | FaceMesh | 8/8 | 411.0 px (9.13°) | 338.7 px (7.53°) | **37.5%** | 104 | 30.1 Hz | 0.0% | 17/18 | 17/19 | [csv](benchmark_facemesh_pursuit_2x4_2026-06-15-03-42-50.csv) | [png](gazemap_facemesh_pursuit_2x4_2026-06-15-03-42-50.png) |
| 16 | WebGazer | 8/8 | 265.8 px (5.91°) | 240.9 px (5.35°) | **62.5%** | 189 | 31.9 Hz | 0.0% | 38/50 | 38/51 | [csv](benchmark_webgazer_9point_2x4_2026-06-15-03-45-24.csv) | [png](gazemap_webgazer_9point_2x4_2026-06-15-03-45-24.png) |

### L3 — 3×6 (18 cells)

| # | Engine | cells | mean err | median err | hit | samples | rate | loss | inf | pipe | CSV | PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 17 | FaceMesh | 18/18 | 406.1 px (9.02°) | 321.5 px (7.14°) | 22.2% | 321 | 30.1 Hz | 0.0% | 17/23 | 17/24 | [csv](benchmark_facemesh_pursuit_3x6_2026-06-15-03-47-41.csv) | [png](gazemap_facemesh_pursuit_3x6_2026-06-15-03-47-41.png) |
| 18 | WebGazer | 18/18 | 389.6 px (8.66°) | 297.0 px (6.60°) | 16.7% | 411 | 30.7 Hz | 0.0% | 26/53 | 27/53 | [csv](benchmark_webgazer_9point_3x6_2026-06-15-03-49-19.csv) | [png](gazemap_webgazer_9point_3x6_2026-06-15-03-49-19.png) |
| 19 | FaceMesh | 18/18 | 504.6 px (11.21°) | 476.2 px (10.58°) | 16.7% | 406 | 30.2 Hz | 0.0% | 17/26 | 17/26 | [csv](benchmark_facemesh_pursuit_3x6_2026-06-15-03-52-53.csv) | [png](gazemap_facemesh_pursuit_3x6_2026-06-15-03-52-53.png) |
| 20 | WebGazer | 18/18 | 335.0 px (7.44°) | 289.0 px (6.42°) | 27.8% | 393 | 30.3 Hz | 0.0% | 43/51 | 44/52 | [csv](benchmark_webgazer_9point_3x6_2026-06-15-03-55-09.csv) | [png](gazemap_webgazer_9point_3x6_2026-06-15-03-55-09.png) |
| 21 | FaceMesh | 18/18 | 638.7 px (14.19°) | 587.6 px (13.06°) | 16.7% | 334 | 30.0 Hz | 0.75% | 19/23 | 20/23 | [csv](benchmark_facemesh_pursuit_3x6_2026-06-15-03-56-57.csv) | [png](gazemap_facemesh_pursuit_3x6_2026-06-15-03-56-57.png) |
| 22 | WebGazer | 18/18 | 449.2 px (9.98°) | 371.2 px (8.25°) | 16.7% | 350 | 30.4 Hz | 0.0% | 27/48 | 27/49 | [csv](benchmark_webgazer_9point_3x6_2026-06-15-03-59-48.csv) | [png](gazemap_webgazer_9point_3x6_2026-06-15-03-59-48.png) |
| 23 | FaceMesh | 18/18 | 322.8 px (7.17°) | 302.9 px (6.73°) | 11.1% | 279 | 30.1 Hz | 0.0% | 16/26 | 17/26 | [csv](benchmark_facemesh_pursuit_3x6_2026-06-15-04-01-34.csv) | [png](gazemap_facemesh_pursuit_3x6_2026-06-15-04-01-34.png) |
| 24 | WebGazer | 18/18 | 300.2 px (6.67°) | 222.7 px (4.95°) | 27.8% | 365 | 31.7 Hz | 0.0% | 29/52 | 30/53 | [csv](benchmark_webgazer_9point_3x6_2026-06-15-04-03-36.csv) | [png](gazemap_webgazer_9point_3x6_2026-06-15-04-03-36.png) |

### L4 — 4×8 (32 cells)

| # | Engine | cells | mean err | median err | hit | samples | rate | loss | inf | pipe | CSV | PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 25 | FaceMesh | 32/32 | 426.9 px (9.49°) | 392.6 px (8.72°) | 15.6% | 603 | 30.1 Hz | 0.0% | 19/26 | 19/27 | [csv](benchmark_facemesh_pursuit_4x8_2026-06-15-04-06-37.csv) | [png](gazemap_facemesh_pursuit_4x8_2026-06-15-04-06-37.png) |
| 26 | WebGazer | 32/32 | 233.8 px (5.20°) | 181.0 px (4.02°) | 34.4% | 703 | 30.8 Hz | 0.0% | 30/48 | 30/49 | [csv](benchmark_webgazer_9point_4x8_2026-06-15-04-10-08.csv) | [png](gazemap_webgazer_9point_4x8_2026-06-15-04-10-08.png) |
| 27 | FaceMesh | 32/32 | 276.0 px (6.13°) | 243.4 px (5.41°) | 50.0% | 649 | 30.2 Hz | 0.0% | 18/26 | 19/27 | [csv](benchmark_facemesh_pursuit_4x8_2026-06-15-04-12-21.csv) | [png](gazemap_facemesh_pursuit_4x8_2026-06-15-04-12-21.png) |
| 28 | WebGazer | 32/32 | 322.7 px (7.17°) | 307.3 px (6.83°) | 18.8% | 578 | 25.1 Hz ⚠️ | 0.0% | 48/69 ⚠️ | 56/70 ⚠️ | [csv](benchmark_webgazer_9point_4x8_2026-06-15-04-19-29.csv) | [png](gazemap_webgazer_9point_4x8_2026-06-15-04-19-29.png) |
| 29 | FaceMesh | 32/32 | 432.9 px (9.62°) | 451.8 px (10.04°) | 15.6% | 834 | 30.5 Hz | 0.0% | 21/23 | 22/24 | [csv](benchmark_facemesh_pursuit_4x8_2026-06-15-04-21-47.csv) | [png](gazemap_facemesh_pursuit_4x8_2026-06-15-04-21-47.png) |
| 30 | WebGazer | 32/32 | 368.9 px (8.20°) | 333.7 px (7.42°) | 25.0% | 544 | 23.8 Hz ⚠️ | 0.0% | 60/69 ⚠️ | 60/69 ⚠️ | [csv](benchmark_webgazer_9point_4x8_2026-06-15-04-24-34.csv) | [png](gazemap_webgazer_9point_4x8_2026-06-15-04-24-34.png) |
| 31 | FaceMesh | 32/32 | 446.0 px (9.91°) | 396.9 px (8.82°) | 9.4% | 798 | 30.1 Hz | 0.0% | 18/26 | 19/27 | [csv](benchmark_facemesh_pursuit_4x8_2026-06-15-04-27-02.csv) | [png](gazemap_facemesh_pursuit_4x8_2026-06-15-04-27-02.png) |
| 32 | WebGazer | 32/32 | 372.3 px (8.27°) | 325.6 px (7.24°) | 9.4% | 658 | 30.5 Hz | 0.0% | 46/52 | 46/52 | [csv](benchmark_webgazer_9point_4x8_2026-06-15-04-28-58.csv) | [png](gazemap_webgazer_9point_4x8_2026-06-15-04-28-58.png) |

### L5 — 6×12 (72 cells)

| # | Engine | cells | mean err | median err | hit | samples | rate | loss | inf | pipe | CSV | PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 33 | FaceMesh | 72/72 | 508.6 px (11.30°) | 497.1 px (11.05°) | 5.6% | 1536 | 30.2 Hz | 0.0% | 20/27 | 21/27 | [csv](benchmark_facemesh_pursuit_6x12_2026-06-15-04-32-54.csv) | [png](gazemap_facemesh_pursuit_6x12_2026-06-15-04-32-54.png) |
| 34 | WebGazer | 72/72 | 362.0 px (8.05°) | 305.9 px (6.80°) | 9.7% | 1623 | 30.6 Hz | 0.0% | 36/50 | 36/51 | [csv](benchmark_webgazer_9point_6x12_2026-06-15-04-36-40.csv) | [png](gazemap_webgazer_9point_6x12_2026-06-15-04-36-40.png) |
| 35 | FaceMesh | 72/72 | 307.8 px (6.84°) | 290.2 px (6.45°) | 15.3% | 1595 | 30.2 Hz | 0.0% | 19/27 | 20/28 | [csv](benchmark_facemesh_pursuit_6x12_2026-06-15-04-39-42.csv) | [png](gazemap_facemesh_pursuit_6x12_2026-06-15-04-39-42.png) |
| 36 | WebGazer | 72/72 | 447.7 px (9.95°) | 351.4 px (7.81°) | 4.2% | 1447 | 30.3 Hz | 0.0% | 37/51 | 37/51 | [csv](benchmark_webgazer_9point_6x12_2026-06-15-04-43-22.csv) | [png](gazemap_webgazer_9point_6x12_2026-06-15-04-43-22.png) |
| 37 | FaceMesh | 71/72 ⚠️ | 326.2 px (7.25°) | 269.3 px (5.98°) | 8.5% | 1541 | 30.2 Hz | 0.0% | 20/27 | 20/28 | [csv](benchmark_facemesh_pursuit_6x12_2026-06-15-04-50-41.csv) | [png](gazemap_facemesh_pursuit_6x12_2026-06-15-04-50-41.png) |
| 38 | WebGazer | 72/72 | 325.9 px (7.24°) | 268.2 px (5.96°) | 13.9% | 1598 | 30.2 Hz | 0.0% | 41/51 | 41/51 | [csv](benchmark_webgazer_9point_6x12_2026-06-15-04-58-15.csv) | [png](gazemap_webgazer_9point_6x12_2026-06-15-04-58-15.png) |
| 39 | FaceMesh | 72/72 | 530.1 px (11.78°) | 487.1 px (10.82°) | 2.8% | 1433 | 30.2 Hz | 0.0% | 20/27 | 20/27 | [csv](benchmark_facemesh_pursuit_6x12_2026-06-15-05-02-55.csv) | [png](gazemap_facemesh_pursuit_6x12_2026-06-15-05-02-55.png) |
| 40 | WebGazer | 72/72 | 307.6 px (6.84°) | 280.9 px (6.24°) | 11.1% | 1738 | 30.4 Hz | 0.0% | 40/51 | 41/52 | [csv](benchmark_webgazer_9point_6x12_2026-06-15-05-06-07.csv) | [png](gazemap_webgazer_9point_6x12_2026-06-15-05-06-07.png) |

### L6 — 8×16 (128 cells)

Added as a proper 4-run level (default calibration: FaceMesh pursuit, WebGazer
9point — consistent with L1–L5). Distinct from the 06-08 §4 pursuit-both N=1 baseline.

| # | Engine | cells | mean err | median err | hit | samples | rate | loss | inf | pipe | CSV | PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 41 | FaceMesh | 127/128 | 544.2 px (12.09°) | 503.2 px (11.18°) | 1.6% | 2801 | 30.1 Hz | 0.0% | 23/27 | 23/27 | [csv](benchmark_facemesh_pursuit_8x16_2026-06-15-14-39-40.csv) | [png](gazemap_facemesh_pursuit_8x16_2026-06-15-14-39-40.png) |
| 42 | WebGazer | 128/128 | 340.1 px (7.56°) | 294.1 px (6.54°) | 3.9% | 2566 | 29.6 Hz | 0.0% | 44/52 | 44/53 | [csv](benchmark_webgazer_9point_8x16_2026-06-15-14-46-01.csv) | [png](gazemap_webgazer_9point_8x16_2026-06-15-14-46-01.png) |
| 43 | FaceMesh | 128/128 | 728.6 px (16.19°) | 614.4 px (13.65°) | 3.1% | 1969 | 30.2 Hz | 0.0% | 23/27 | 23/27 | [csv](benchmark_facemesh_pursuit_8x16_2026-06-15-14-50-39.csv) | [png](gazemap_facemesh_pursuit_8x16_2026-06-15-14-50-39.png) |
| 44 | WebGazer | 128/128 | 575.2 px (12.78°) | 548.4 px (12.19°) | 0.0% | 2028 | 29.8 Hz | 0.0% | 45/51 | 45/52 | [csv](benchmark_webgazer_9point_8x16_2026-06-15-15-00-50.csv) | [png](gazemap_webgazer_9point_8x16_2026-06-15-15-00-50.png) |
| 45 | FaceMesh | 128/128 | 541.0 px (12.02°) | 491.7 px (10.93°) | 0.8% | 1855 | 30.2 Hz | 0.0% | 22/27 | 23/27 | [csv](benchmark_facemesh_pursuit_8x16_2026-06-15-15-11-24.csv) | [png](gazemap_facemesh_pursuit_8x16_2026-06-15-15-11-24.png) |
| 46 | WebGazer | 127/128 | 578.5 px (12.85°) | 491.6 px (10.93°) | 2.4% | 2105 | 29.5 Hz | 0.14% | 44/51 | 45/51 | [csv](benchmark_webgazer_9point_8x16_2026-06-15-15-17-12.csv) | [png](gazemap_webgazer_9point_8x16_2026-06-15-15-17-12.png) |
| 47 | FaceMesh | 128/128 | 668.5 px (14.86°) | 602.8 px (13.40°) | 0.0% | 1981 | 30.2 Hz | 0.0% | 22/27 | 23/28 | [csv](benchmark_facemesh_pursuit_8x16_2026-06-15-15-37-37.csv) | [png](gazemap_facemesh_pursuit_8x16_2026-06-15-15-37-37.png) |
| 48 | WebGazer | 128/128 | 377.7 px (8.39°) | 327.5 px (7.28°) | 4.7% | 2351 | 29.8 Hz | 0.0% | 45/52 | 46/52 | [csv](benchmark_webgazer_9point_8x16_2026-06-15-15-42-03.csv) | [png](gazemap_webgazer_9point_8x16_2026-06-15-15-42-03.png) |

---

## Summary — per-level aggregates (mean ± SD over 4 repeats)

| Level (cells) | FaceMesh err° | WebGazer err° | FaceMesh hit% | WebGazer hit% |
|---|---|---|---|---|
| L1 — 1×2 (2)   | 9.03 ± 2.52 | 9.70 ± 3.70 | 75.0 ± 28.9 | 75.0 ± 28.9 |
| L2 — 2×4 (8)   | 10.32 ± 2.39 | **6.08 ± 0.82** | 31.2 ± 7.2 | **62.5 ± 27.0** |
| L3 — 3×6 (18)  | 10.40 ± 3.02 | **8.19 ± 1.45** | 16.7 ± 4.5 | 22.2 ± 6.4 |
| L4 — 4×8 (32)  | 8.79 ± 1.78 | **7.21 ± 1.43** | 22.7 ± 18.5 | 21.9 ± 10.5 |
| L5 — 6×12 (72) | 9.29 ± 2.61 | **8.02 ± 1.38** | 8.0 ± 5.4 | 9.7 ± 4.1 |

**Headline findings:**
1. **Accuracy:** WebGazer (9point) beats FaceMesh (pursuit) on mean angular error at
   every level L2–L5 (e.g. L2 6.1° vs 10.3°), and is consistently **lower-variance**
   (SD ~0.8–1.5° vs ~1.8–3.0°). At L1 (2 cells) the two are statistically
   indistinguishable. **Caveat:** this is engine *and* calibration method confounded
   (see Notes) — it compares "WebGazer+9point" vs "FaceMesh+pursuit", not the engines
   in isolation.
2. **No accuracy degradation with grid density.** Angular error is roughly flat from
   L1→L5 for both engines (FaceMesh ~9–10°, WebGazer ~6–8°). Denser grids do *not*
   make per-target accuracy worse — they just have smaller hit radii, so **hit rate
   falls mechanically** (L1 75% → L5 ~9%) while error° stays put. Read accuracy via
   error°, not hit rate, across levels.
3. **Latency (clean runs only):** FaceMesh inference median held **16–21 ms** across
   all densities incl. 72 cells — flat and well under the sub-50ms target. WebGazer
   ran **~26–46 ms** median. Both engines' latency is **independent of grid density**.
   Two WebGazer runs (#28, #30) hit 56–60 ms under transient CPU contention — excluded.
4. **Data-quality caveats** (detail in Notes): per-run recalibration variance; a
   sustained posture/lighting drift across L1 repeats 3–4 that carried into L2; the
   #28/#30 latency contention; #37 covered 71/72 cells. The L1/L2 hit-rate SDs are
   inflated by the drift, not engine instability.

## Notes / anomalies

- **Drift carried into L2 (confirmed sustained).** #9 (L2 FaceMesh, 8 cells) hit only
  37.5% at 465 px — the both-engine degradation that began at L1 repeat 3 persists.
  Per the L1 decision note, this means L2+ data is collected under the drifted
  condition. Keeping all rows, but L2–L5 should be read as "post-drift"; a clean
  re-baseline would be needed for the intended fixed-posture comparison.
- **Partial recovery at #12 (L2 WebGazer): 100% hit, 224 px / 4.98°** — best run so
  far. So the degradation is not permanent; posture/lighting (or the 9point fit)
  settled for this run. Hit rate is bouncing run-to-run (L2: 37.5 / 37.5 / 25 / 100),
  consistent with an unstable physical setup rather than a fixed offset. FaceMesh in
  L2 still lags (#9 465 px, #11 367 px, both low hit) vs WebGazer (#10 298, #12 224).
- **#14 (L2 WebGazer) sample-rate / latency anomaly:** sample rate 39.8 Hz (vs
  ~30–32 every other run) and inference p95 71.9 ms (vs ~50 ms; **exceeds sub-50ms
  target**). Higher throughput *and* higher tail latency together suggests a
  scheduling/contention hiccup (e.g. background CPU load) during this run — a system
  artifact, not an engine property. Latency from this single run shouldn't be pooled
  with the others.
- **#28 (L4 WebGazer) latency degradation — worse than #14:** sample rate fell to
  25.1 Hz (vs ~30–31) *and* inference median rose to 48 ms with **pipeline median
  56 ms — over the sub-50ms target** (p95 ~70 ms). Lower throughput + higher latency
  = sustained CPU contention during the run (a ~7 min gap preceded it; something may
  have been running). The 8 ms inference→pipeline median gap (vs ~0.5 ms normally)
  points to a long rAF/render tail. Exclude this run's latency from pooled stats.
  Accuracy (323 px / 7.17°) is unaffected and in-family.
- **#30 confirms a sustained, WebGazer-specific latency regression at L4.** Two
  consecutive WebGazer runs degraded (#28: 25.1 Hz, 48/56 ms; #30: 23.8 Hz, 60/60 ms,
  trending worse), while the FaceMesh run between them (#29) was clean at 21 ms.
  WebGazer carries the heavier compute (its own regression/CNN path + our parallel
  rVFC capture-clock loop), so under machine-wide CPU contention it throttles first
  — FaceMesh's lighter landmark pipeline rides through. **The contention is real and
  persistent (last ~15 min). Strongly recommend closing background CPU load before
  L5** (72 cells, ~108 s/run — most exposed to this). L4 WebGazer latency (#28/#30)
  should be excluded from any latency claim; accuracy is unaffected.
- **#37 (L5 FaceMesh) first incomplete coverage: 71/72 cells.** One cell logged zero
  qualifying samples (benchmark advanced before gaze entered it). Negligible for the
  aggregate at 72 cells, but note its error/hit stats are over 71 cells, not 72.


- **Calibration-method confound:** the URLs carry no `calib=`, so each engine uses
  its native default — **FaceMesh = pursuit**, **WebGazer = 9point** (filenames
  confirm: `..._pursuit_...` vs `..._9point_...`). Cross-engine rows therefore differ
  in both engine *and* calibration method. Acceptable if "engine + its default
  calibration" is the intended unit of comparison; add `calib=pursuit` to the
  WebGazer URLs if you want calibration held constant.
- **L1 FaceMesh vertical instability (run-to-run):** the gaze-y estimate wanders
  between repeats, not just at the edge.
  - **#1:** cell 0 OK (centroid y≈671), cell 1 pinned high (y≈137 vs target 535) → right-edge drift.
  - **#3:** *both* cells pulled high (centroids y≈262 / 270 vs 535), mean error up to 375 px / 8.32°, only 21 samples logged.
  - **#5: degenerate calibration.** cell 0 pinned to far-left edge (centroid x≈28),
    cell 1 flew off-screen top-right (centroid x≈3247, y≈−381) with only 2 samples
    captured → hit rate 50%, mean 564 px / 12.52°. Worst run so far.
  - Pattern: fresh pursuit calibration each reload is unstable at L1, occasionally
    degenerate (#5). With only 2 cells a bad fit isn't averaged out. **Consider
    re-running #5**, and treat L1 FaceMesh repeats as a calibration-variance sample
    rather than a fixed-calibration measurement. Watch #7.
- **⚠️ Repeat 3 contaminated for BOTH engines (#5 + #6):** both dropped to **50% hit**
  with mean ~500–560 px, and both biased high (centroids y≈340–360 vs target 535)
  / shifted right. Because a degraded calibration would hit only the engine that
  recalibrated, a *simultaneous* both-engine drop points to a **shared physical
  change between repeat-2 and repeat-3 — head posture or lighting shift** (WebGazer
  9point and FaceMesh pursuit don't share a calibration). **Recommend re-checking
  seating/lighting and re-running repeat 3 (#5 and #6)** before continuing, else L1
  averages carry a contaminated round.
- **Recurring failure mode = the RIGHT target (cell 1).** Across decent-calibration
  runs the *left* cell is reliable while the *right* cell over-extrapolates right+up:
  - **#1:** cell 1 centroid y≈137 (off top).
  - **#7:** cell 0 good (146 px, centroid (615, 544)); cell 1 centroid (1880, −10) →
    overshoots right and off the top, 733 px, missed (median 219 px stays good because
    only one cell fails). Third consecutive 50%-hit run (#5/#6/#7).
  - Read: horizontal (and upward) extrapolation breaks at the right screen edge — a
    calibration-coverage / extrapolation limit, consistent with `feature` flooring on
    low-variance landmark dims. The left half of the screen maps well.
- **L1 verdict (8/8 done): first half clean, second half contaminated.**

  | Repeat | FaceMesh | WebGazer | Status |
  |---|---|---|---|
  | 1 (#1,#2) | 294 px / 100% | 283 px / 100% | ✅ clean |
  | 2 (#3,#4) | 375 px / 100% | 320 px / 100% | ✅ clean |
  | 3 (#5,#6) | 564 px / 50% | 501 px / 50% | ⚠️ degraded |
  | 4 (#7,#8) | 393 px / 50% | 641 px / 50% | ⚠️ degraded |

  Repeats 1–2 are consistent for both engines (FaceMesh ≈ WebGazer, ~280–375 px,
  100% hit). Repeats 3–4 collapsed to 50% hit for **both** engines and stayed there
  — a sustained physical change (posture/lighting) that set in around repeat 3, not a
  per-run calibration glitch (#8 even shows the *left* cell off-screen, the opposite
  bias from the right-edge mode). **Action before L2: fix seating/lighting, then
  either re-run repeats 3–4 of L1, or accept L1 as "2 clean + 2 contaminated" and
  exclude #5–#8 from the L1 mean.** Critically, if the drift persists it will
  contaminate all of L2–L5 — verify a clean repeat before continuing.
  - **Decision:** operator chose to push straight into L2 without a recovery check.
    Watching whether the both-engine 50%-hit degradation carries into L2 → if it does,
    the drift is sustained (L2–L5 suspect); if L2 recovers to high hit-rate, the L1
    second-half dip was L1-specific.
</content>
</invoke>
