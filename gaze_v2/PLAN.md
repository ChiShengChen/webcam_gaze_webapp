# Gaze Tracker v2 — First-Principles Rebuild

> A ground-up redesign of the webcam gaze tracker, replacing WebGazer with a
> custom pipeline focused on **accuracy**, **stability**, and **implicit
> on-the-fly auto-correction** so users can control the cursor with their eyes
> comfortably and precisely.

---

## 1. Why Rebuild

The current WebGazer-based pipeline has fundamental issues that cannot be
patched away:

| Problem | Root cause |
|---|---|
| Red dot drifts several cm from true gaze within seconds | Ridge regression over raw eye pixels has no head-pose compensation — any small head movement shifts every input feature |
| Calibration decays quickly | No online adaptation; the model is frozen after 9-point setup |
| Blinks don't move FaceMesh landmarks, so EAR fails | TF.js FaceMesh is trained to predict a stable 3D face mesh and "hallucinates" open eyes |
| 15–30 fps face processing | Full-frame FaceMesh inference is too heavy |
| Jitter even with Kalman | Raw pupil signal is noisy at webcam resolution; smoothing alone trades accuracy for latency |

Conclusion: the limitation is **architectural**, not tunable. We rebuild from
first principles with a gaze-specific pipeline instead of an off-the-shelf
face-mesh regressor.

---

## 2. Goals

**Primary**
- Steady-state accuracy ≤ **2°** of visual angle (≈ 1.5 cm at 45 cm from a 14" laptop)
- **Drift < 0.5°** per minute without user intervention
- **Sub-50 ms** end-to-end latency (capture → screen dot)
- Reliable **blink detection** (> 95% recall, < 1% false positive per minute)

**Secondary**
- Runs at ≥ 30 fps on a 2020-era MacBook
- No external ML framework dependency in the hot path (no WebGazer, no TF.js,
  no ONNX runtime for the main loop)
- Degrades gracefully when the face leaves the frame

**Non-goals**
- Head-free operation at > 1 m distance (webcam geometry makes this unrealistic)
- Multi-user tracking
- Mobile devices (v1 targets desktop webcam users)

---

## 3. Architecture

```
┌──────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────────┐
│  Camera  │──▶│ Face locate  │──▶│   Eye ROI     │──▶│ Iris / pupil   │
│  stream  │   │  & track     │   │  extraction   │   │  localization  │
└──────────┘   └──────────────┘   └───────────────┘   └───────┬────────┘
                                                              │
                                                              ▼
┌──────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────────┐
│  Cursor  │◀──│  Smoothing   │◀──│ Gaze mapping  │◀──│ Head-pose      │
│          │   │  (OneEuro)   │   │  + auto-corr  │   │  normalization │
└──────────┘   └──────────────┘   └───────┬───────┘   └────────────────┘
                                          │
                          ┌───────────────┴───────────────┐
                          │                               │
                          ▼                               ▼
                ┌──────────────────┐            ┌──────────────────┐
                │ Explicit calib   │            │ Implicit online  │
                │ (9-point once)   │            │ correction       │
                └──────────────────┘            └──────────────────┘
```

Each stage is a pure function `Frame → Intermediate`, so any layer can be
swapped or unit-tested in isolation.

---

## 4. Component Design

### 4.1 Camera capture
- `getUserMedia` at the highest resolution the device advertises (ideal
  `1280×720` — iris width scales with resolution and is the accuracy ceiling).
- Use `HTMLVideoElement.requestVideoFrameCallback` (not `rAF`) so we process
  each frame once and skip duplicates — a 30 fps camera under 60 fps rAF
  wastes half of our budget otherwise.
- All pixel reads happen on an `OffscreenCanvas` on a `Worker`, so the main
  thread stays free for UI and cursor rendering.

### 4.2 Face localization
Classical first-principles face detection is a solved but involved problem.
Rather than ship a full Viola-Jones implementation, we use a two-tier strategy:

**Bootstrap (first frame / re-acquisition)**
- Skin-colour segmentation in YCbCr space (Cb ∈ [77,127], Cr ∈ [133,173]) →
  largest connected component → bounding box.
- Symmetry search: scan horizontal rows inside the box, find two dark blobs
  spaced at a ratio consistent with eye geometry (≈ 0.3–0.4 × face width).
- If that fails, fall back to a single 300 KB pre-trained MediaPipe BlazeFace
  ONNX file — loaded only as a **cold-start helper**, never in the steady-state
  hot path.

**Steady-state tracking**
- Once we have the face box, track it with normalized cross-correlation (NCC)
  template matching on a Gaussian image pyramid. NCC is ~1000× cheaper than
  a neural net and robust to illumination changes.
- Re-detect every N frames (configurable, default 60) to avoid template drift.

### 4.3 Eye ROI extraction
Given a tracked face box, we know the two eye centres are at roughly
(0.35, 0.38) and (0.65, 0.38) of the box. We crop fixed-aspect patches around
those anchors. Patches are **affine-warped** to a canonical 60×36 size
using the current head-pose estimate (see 4.5), so downstream stages always
see an upright, normalized eye.

### 4.4 Iris / pupil centre localization
This is where we get our precision. Three techniques, each more accurate and
more expensive — we fuse them:

1. **Integral-image darkness centroid** (cheap, ~0.1 ms)
   - Compute integral image of the eye patch.
   - Iris is the darkest circular region; a radial integrator finds its centre.

2. **Daugman integro-differential operator** (medium, ~2 ms)
   - For each candidate centre `(x,y)` and radius `r`, compute the gradient of
     the integral around the circle. The iris boundary maximises this gradient.
   - We restrict the search to a small window around the centroid from (1).

3. **Sub-pixel refinement via parabolic fit** (~0.05 ms)
   - Fit a 2D parabola to the 3×3 gradient neighbourhood around the best
     integer peak. Gives us sub-pixel iris centre coordinates.

Total: < 3 ms per eye, sub-pixel accurate, zero ML dependencies.

### 4.5 Head-pose estimation
We compute a 6-DOF pose (rotation + translation) of the head relative to the
camera. Without this, any nod or turn propagates directly into gaze error.

- Landmarks needed: two outer eye corners, two inner eye corners, nose tip,
  mouth corners, chin — 8 points total. Found using corner detection
  (Harris on grey patches around known face-box anchors).
- 3D model: generic anthropometric head points (public domain values, ≈ 10 lines
  of constants). No scan needed.
- Solve: Lightweight **POSIT** or **EPnP** implementation (~200 LoC, pure JS).
  Runs in < 1 ms.
- Output: rotation `R` (3×3) and translation `t` (3×1). Used to (a) warp eye
  patches into a canonical frontal frame, and (b) feed the gaze mapping stage.

### 4.6 Gaze mapping
Given iris centres in the head-normalized eye patch plus head pose, we want
screen coordinates. We support two regression models:

1. **Polynomial mapping** (fast, what we start with)
   - Features: `[1, x_L, y_L, x_R, y_R, x_L², y_L², x_R², y_R², x_L·y_L, ...]`
     plus head-pose terms `[tx, ty, tz, yaw, pitch]`.
   - Fit via ridge regression on calibration data.
   - Closed-form, trains in < 1 ms, evaluates in < 0.01 ms.

2. **Local weighted regression (LOESS)** (more accurate, if (1) is insufficient)
   - For each prediction, fit a local linear model weighted by Gaussian
     distance to the stored calibration points.
   - Adapts naturally to non-linear eye-to-screen geometry.

We begin with (1), add (2) only if validation shows we need it.

### 4.7 Explicit calibration
- Same 9-point UI as v1 — familiar to users and enough to seed the model.
- But we **collect per-click** at least 30 stable samples (filter out blinks
  and saccades), use the median position, and reject samples where head pose
  differs by more than 5° from the session median.
- Calibration takes ~20 s instead of feeling like "click a bunch of dots".

### 4.8 Implicit online correction — the key innovation
The user doesn't want to re-calibrate. We exploit **free supervision** that
naturally occurs during use:

| Signal | How it helps |
|---|---|
| **Mouse clicks** | When the user clicks `(mx, my)`, their gaze was almost certainly there immediately before the click. Use a 150–350 ms pre-click window of iris samples as a labelled pair `(iris → (mx,my))`. |
| **Mouse hovers** with dwell | If the cursor dwells on a point for > 500 ms and predicted gaze is within 5° of the cursor, assume the user is looking at the cursor — soft-label. |
| **UI element snap** | When predicted gaze falls on a button / link / text field and the user then clicks it, that's a high-confidence label. |
| **Smooth pursuit** | If the cursor and predicted gaze move in correlated paths for > 1 s, assume tracking — soft-label. |
| **Saccade physics** | Reject predictions that imply gaze velocity > 900°/s (biologically impossible) — the tracker is confused, fall back to last known position. |

Each signal becomes a weighted `(features, target)` tuple added to a
**sliding window** of 200 recent samples. The ridge model is re-fit every
N frames (cheap, closed-form). We cap per-signal contributions so mouse
confusion can never dominate explicit calibration.

To prevent runaway drift when correction is wrong, we maintain **two models**:
- `M_stable` — only updated by explicit calibration.
- `M_adaptive` — updated by implicit signals.
- Predict with `M_adaptive`. When its error (measured on holdout samples from
  `M_stable`) exceeds a threshold, reset to `M_stable`.

### 4.9 Smoothing
- **One-Euro filter** on final screen coordinates. Two tunable parameters
  (`min_cutoff`, `beta`) trade jitter for latency much more gracefully than
  Kalman with constant-velocity assumptions — gaze is bursty, not smooth.
- Separate filter states for fixation mode vs. pursuit mode, switched based on
  instantaneous velocity.

### 4.10 Blink detection
The current eye-patch variance method works but is noisy. v2 improvement:
- Normalise the eye patch by head pose **first** (so variance isn't dominated
  by lighting/angle changes).
- Use a **two-state HMM**: states `open` / `closed`, emission likelihoods
  from (variance, iris-detection-confidence, pupil-radius-if-found). More
  robust than a fixed threshold.
- Blink events are also gaze-control signals: long blink (> 400 ms) = click,
  short blink = ignore.

---

## 5. Dependency Policy

**Allowed**
- Browser platform APIs (`getUserMedia`, `OffscreenCanvas`, WebWorkers,
  `requestVideoFrameCallback`)
- Vite + TypeScript for build
- One exception: a cold-start face detector (< 500 KB) if skin-colour bootstrap
  proves unreliable. Loaded lazily, only used until template tracking locks on.

**Forbidden in the hot path**
- WebGazer, TensorFlow.js, ONNX Runtime, OpenCV.js, MediaPipe runtime
- Any library we haven't read and understood

Everything else — image processing, linear algebra (3×3 SVD, pseudo-inverse
for ridge regression), corner detection, pose solving — is **written from
scratch**, ≈ 2–3 k LoC total. All the maths is textbook, well-documented,
testable.

---

## 6. Implementation Phases

### Phase 0 — Skeleton (1 day)
- New Vite sub-app under `gaze_v2/` with its own `package.json`, `index.html`,
  `src/`.
- Webcam capture + fps counter + frame display in a worker. Nothing clever.
- **Exit criterion**: 30 fps sustained with raw video displayed.

### Phase 1 — Eye localization (3 days)
- Skin-colour face bootstrap.
- NCC face tracker.
- Fixed-anchor eye ROI extraction (no pose normalization yet).
- Visual overlay showing the eye patches in real time.
- **Exit criterion**: Eye patches stay locked during natural head movement.

### Phase 2 — Iris centre (3 days)
- Integral-image centroid + Daugman refinement + sub-pixel fit.
- Overlay a crosshair on each iris.
- **Exit criterion**: Crosshairs visually track pupil movement stably,
  including during small saccades, with < 1 px jitter.

### Phase 3 — Calibration + naive mapping (2 days)
- 9-point UI.
- Ridge regression fit without head pose (polynomial features only).
- **Exit criterion**: Within-session accuracy < 3° immediately after
  calibration with head still.

### Phase 4 — Head pose (4 days)
- Corner detection for 8 anchor points.
- POSIT / EPnP solver.
- Eye patch affine warp to canonical pose.
- Augment mapping features with pose.
- **Exit criterion**: Accuracy < 2° with natural head movement (±10° yaw/pitch).

### Phase 5 — Online correction (3 days)
- Dual model (stable / adaptive).
- Mouse click, hover, pursuit signals wired up.
- Health monitor that resets adaptive when it diverges.
- **Exit criterion**: Drift < 0.5° per minute, measured against a ground-truth
  cursor-following task.

### Phase 6 — Filtering, blink HMM, polish (2 days)
- One-Euro filter with pursuit/fixation mode switch.
- HMM blink detector with blink log panel (parity with v1).
- Click-on-long-blink.
- **Exit criterion**: Feels usable for 5+ minutes of continuous eye cursoring
  without manual recalibration.

### Phase 7 — A/B comparison against v1 (1 day)
- Same task in both versions, log timing + error.
- Data-driven decision on whether to replace v1 or keep both.

Total: roughly **three weeks** of focused work.

---

## 7. File Structure

```
gaze_v2/
├── PLAN.md                  ← this file
├── package.json
├── index.html
├── src/
│   ├── main.ts              # UI entry, mode switching, cursor rendering
│   ├── capture/
│   │   ├── camera.ts        # getUserMedia wrapper
│   │   └── frameLoop.ts     # requestVideoFrameCallback driver
│   ├── worker/
│   │   └── pipeline.worker.ts  # full pipeline, runs off main thread
│   ├── cv/
│   │   ├── integral.ts      # integral image
│   │   ├── ncc.ts           # template matching
│   │   ├── corners.ts       # Harris/Shi-Tomasi
│   │   ├── daugman.ts       # integro-differential iris operator
│   │   ├── morphology.ts    # dilate/erode for skin mask
│   │   └── pyramid.ts       # Gaussian pyramid
│   ├── face/
│   │   ├── skinBootstrap.ts # cold-start face detector
│   │   └── tracker.ts       # NCC face tracker + re-detect
│   ├── eye/
│   │   ├── roi.ts           # eye patch extraction
│   │   ├── iris.ts          # iris localization pipeline
│   │   └── blinkHMM.ts      # two-state blink detector
│   ├── pose/
│   │   ├── model3d.ts       # anthropometric head points
│   │   ├── posit.ts         # POSIT solver
│   │   └── normalize.ts     # affine warp to canonical pose
│   ├── gaze/
│   │   ├── features.ts      # feature vector construction
│   │   ├── ridge.ts         # ridge regression (closed form)
│   │   ├── loess.ts         # local weighted regression (phase 5+)
│   │   ├── calibration.ts   # 9-point + sample quality filter
│   │   ├── autoCorrect.ts   # implicit online update engine
│   │   └── dualModel.ts     # stable + adaptive manager
│   ├── filter/
│   │   └── oneEuro.ts       # One-Euro smoother
│   └── math/
│       ├── mat.ts           # small fixed-size matrix ops
│       └── ridgeSolver.ts   # QR / pseudo-inverse
└── test/
    ├── iris.bench.html      # visual iris-tracking test bed
    ├── pose.bench.html      # head-pose overlay
    └── gaze.eval.html       # accuracy / drift measurement harness
```

---

## 8. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Skin-colour face detection fails under bad lighting | Lazy-load the 500 KB ONNX face detector as a fallback. Document the trade-off. |
| Iris localization noise dominates final accuracy | Move to higher-res capture (1280×720 minimum). If still poor, prototype a tiny CNN iris regressor trained on open datasets. |
| POSIT is unstable with only 8 points | Pin rotation with EPnP, add anchor weights based on corner detection confidence. |
| Implicit corrections pull the model wrong when user looks away while moving the mouse | The dual-model health check detects divergence and resets; per-signal caps prevent any one signal from dominating. |
| "First principles" balloons the LoC beyond what one person can maintain | Ruthless scoping: only the listed modules, each with a unit test, each ~200 LoC. |

**Open questions to resolve during Phase 0**
1. Does `requestVideoFrameCallback` expose per-frame timestamps on Safari?
2. How much does transferring ImageData to a worker cost? (If > 5 ms, we
   process on main thread with OffscreenCanvas instead.)
3. Should calibration be abandoned in favour of a pure implicit-only mode?
   (Decide after Phase 5 data.)

---

## 9. Success Criteria (end of Phase 7)

A user can:
- Calibrate in < 30 s.
- Move the cursor to any 40×40 px button on a 1440×900 display using only
  gaze, and click it with a long blink, in < 2 s median time, with
  > 80% first-attempt accuracy.
- Work for 5 minutes without re-calibrating.
- Turn their head ±15° without losing tracking.

If we hit this bar, v2 replaces v1. If not, the plan is self-documenting about
what went wrong and where to iterate.
