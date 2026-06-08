# Webcam Gaze Tracker, Gaze Label Tool & Video Annotation Tool

A web application that uses your webcam to track your eye gaze in real-time, featuring:
- **Gaze-based Image Labeling** powered by SAM (Segment Anything Model)
- **Video Annotation Mode** for recording gaze and audio commentary on videos

Built with WebGazer.js, ONNX Runtime Web, and Vite.

## Demo

### Gaze Tracker


https://github.com/user-attachments/assets/1917dd53-f225-4207-8f77-b37d2857f804



> *The red dot follows your gaze in real-time. The heatmap in the top-right corner shows gaze distribution.*

### Video Mode




https://github.com/user-attachments/assets/f2640ecf-6b47-4f8c-9892-7400ec1e0405




> *Gaze tracking on video playback with real-time visualization, AOI definition, and analysis tools.*

## Features

### Gaze Tracker Mode
- Real-time eye gaze tracking using webcam
- 9-point calibration system for improved accuracy
- Visual gaze indicator (red dot follows your gaze)
- **Real-time gaze heatmap** - visualizes where you look most frequently
- Video preview to ensure proper face positioning

### Label Mode
- **Gaze-based image labeling** - look at objects and press Space to segment
- **SAM (Segment Anything Model)** integration via ONNX Runtime Web
- **Multi-label support** - create and manage multiple label categories with custom colors
- **Color customization** - pick colors when creating labels, or change them anytime
- **Label deselection** - prevent accidental segmentation by deselecting the current label
- **Real-time segmentation masks** with color-coded visualization
- **Export formats**:
  - COCO JSON (standard format for instance segmentation)
  - YOLO TXT (bounding box format for object detection)

### Video Mode
- **Video annotation with gaze tracking** - watch videos while your gaze is recorded
- **Audio commentary recording** - record verbal descriptions via microphone
- **Real-time gaze visualization** - cyan dot shows where you're looking on the video
- **Timeline heatmap** - visualizes gaze density across video duration
- **Frame-accurate timestamps** - gaze points include frame numbers and timestamps
- **Export formats**:
  - JSON (gaze annotations with timestamps, coordinates, and metadata)
  - WebM (audio recording)

### Gaze Analysis (Research Tools)
- **Fixation Detection** - I-DT (Dispersion-Threshold) algorithm for identifying fixations
- **Area of Interest (AOI)** - define rectangular AOIs on the video by drawing
- **Dwell Time Statistics** - total dwell time, fixation count, and percentage per AOI
- **First Fixation Metrics** - Time to First Fixation (TTFF), entry count per AOI
- **Scanpath Analysis** - path length, mean saccade amplitude, AOI visit sequence
- **Scanpath Visualization** - overlay showing fixation circles (size = duration) and saccade lines
- **Configurable Parameters**:
  - Dispersion threshold (default: 0.03, ~1-2° visual angle)
  - Minimum fixation duration (default: 100ms)
- **Export formats**:
  - CSV files (fixations, dwell time, first fixation, scanpath metrics)

## Prerequisites

- Node.js (v16 or higher)
- A webcam
- A modern browser (Chrome, Firefox, or Edge recommended)

## Installation

```bash
# Clone or navigate to the project directory
cd webcam_gaze_webapp

# Install dependencies
npm install
```

## Usage

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open your browser and navigate to `http://localhost:5173/`

3. Click the **"Start Calibration"** button

4. Allow camera access when prompted by the browser

5. Click on each of the 9 yellow calibration dots. Each dot will turn green after clicking.

6. Once all dots are clicked, calibration is complete. A red dot will appear and follow your gaze.

7. The **Gaze Heatmap** will appear in the top-right corner, showing where you look most frequently.

### Heatmap Controls

| Button | Function |
|--------|----------|
| **Hide/Show** | Toggle heatmap visibility |
| **Clear** | Reset heatmap data |

### Label Mode Usage

1. Complete gaze calibration first (in Gaze Tracker mode)
2. Click **"Label Mode"** button at the top of the page
3. **Upload an image** using the file input
4. **Add labels** with custom name and color (e.g., "car", "person", "tree")
5. **Select a label** from the list (current label is shown above the list)
6. **Look at the object** you want to segment
7. Press **Space** to trigger segmentation
8. The mask will appear with the label's color
9. Repeat for all objects
10. **Export** annotations in COCO JSON or YOLO TXT format

### Label Mode Controls

| Control | Function |
|---------|----------|
| **Space** | Segment object at current gaze position |
| **Color Picker** | Choose color when adding a new label |
| **Label Color Box** | Click to change an existing label's color |
| **Deselect** | Deselect current label (prevents accidental segmentation) |
| **Undo** | Remove last segmentation |
| **Export COCO** | Download annotations in COCO JSON format |
| **Export YOLO** | Download annotations in YOLO TXT format |

### Video Mode Usage

1. Complete gaze calibration first (in Gaze Tracker mode)
2. Click **"Video Mode"** button at the top of the page
3. **Upload a video** (MP4, WebM, or other supported formats)
4. Click **"Connect Microphone"** and allow microphone access
5. Click **"Play & Record"** to start:
   - Video begins playing
   - Gaze tracking starts recording
   - Audio recording begins (if microphone connected)
6. **Watch the video** - your gaze position is tracked in real-time
7. **Speak your observations** - audio is recorded for later review
8. Click **"Stop Recording"** when finished
9. **Review the timeline** - shows gaze density across video duration
10. **Export** your data:
    - **Export Gaze JSON** - download gaze annotations
    - **Export Audio** - download audio recording (WebM)

### Video Mode Controls

| Control | Function |
|---------|----------|
| **Connect Microphone** | Enable audio recording (shows waveform visualizer) |
| **Play & Record** | Start video playback and gaze/audio recording |
| **Stop Recording** | End recording session |
| **Export Gaze JSON** | Download gaze data with timestamps and coordinates |
| **Export Audio** | Download recorded audio as WebM file |

### Video Mode Export Format (JSON)

```json
{
  "videoName": "example.mp4",
  "videoDuration": 120.5,
  "videoWidth": 1920,
  "videoHeight": 1080,
  "frameRate": 30,
  "totalGazePoints": 3615,
  "recordingDuration": 120.5,
  "gazePoints": [
    {
      "timestamp": 1.533,
      "frameNumber": 46,
      "x": 0.523,
      "y": 0.341,
      "screenX": 1004,
      "screenY": 368
    }
  ],
  "hasAudio": true
}
```

| Field | Description |
|-------|-------------|
| `timestamp` | Time in video (seconds) |
| `frameNumber` | Estimated frame number |
| `x`, `y` | Normalized coordinates (0-1) relative to video |
| `screenX`, `screenY` | Absolute screen coordinates |

### Gaze Analysis Usage

1. After recording gaze data in Video Mode, define **Areas of Interest (AOI)**:
   - Enter an AOI name in the input field
   - Choose a color
   - Click **"Draw Rectangle"**
   - Click and drag on the video to draw the AOI boundary
2. Repeat for all AOIs you want to analyze
3. Adjust analysis parameters if needed:
   - **Dispersion threshold**: Maximum spread for fixation detection (default: 0.03)
   - **Min fixation duration**: Minimum time to count as fixation (default: 100ms)
4. Click **"Run Analysis"** to process the gaze data
5. View results in expandable sections:
   - **Fixation Summary**: Total count, duration, mean fixation time
   - **Dwell Time Statistics**: Time spent in each AOI
   - **First Fixation Metrics**: TTFF and entry count per AOI
   - **Scanpath Metrics**: Path analysis and AOI visit sequence
6. Click **"Show Scanpath"** to visualize fixations and saccades on the video
7. Click **"Export Analysis (CSV)"** to download analysis results

### Analysis Controls

| Control | Function |
|---------|----------|
| **Draw Rectangle** | Start AOI drawing mode |
| **Run Analysis** | Execute fixation detection and compute metrics |
| **Show Scanpath** | Toggle scanpath visualization overlay |
| **Export Analysis** | Download 4 CSV files with analysis results |

### Analysis Export Formats (CSV)

The analysis export generates 4 CSV files:

**1. Fixations CSV** (`_fixations.csv`)
| Column | Description |
|--------|-------------|
| `id` | Fixation ID |
| `start_time_s` | Start time in seconds |
| `end_time_s` | End time in seconds |
| `duration_ms` | Duration in milliseconds |
| `x`, `y` | Normalized coordinates (0-1) |
| `aoi` | AOI name (or "outside") |

**2. Dwell Time CSV** (`_dwell_time.csv`)
| Column | Description |
|--------|-------------|
| `aoi_name` | Area of Interest name |
| `total_dwell_ms` | Total dwell time in milliseconds |
| `fixation_count` | Number of fixations in AOI |
| `mean_duration_ms` | Mean fixation duration |
| `percent_total` | Percentage of total viewing time |

**3. First Fixation CSV** (`_first_fixation.csv`)
| Column | Description |
|--------|-------------|
| `aoi_name` | Area of Interest name |
| `ttff_ms` | Time to First Fixation in milliseconds |
| `first_duration_ms` | Duration of first fixation |
| `entry_count` | Number of times gaze entered AOI |

**4. Scanpath CSV** (`_scanpath.csv`)
| Metric | Description |
|--------|-------------|
| `total_length` | Total scanpath length (normalized units) |
| `fixation_count` | Number of fixations |
| `mean_saccade_amplitude` | Average saccade distance |
| `aoi_sequence` | Sequence of AOI visits (e.g., "A → B → A → C") |

## Modes & URL Flags

The defaults (`http://localhost:5173/`) keep the legacy WebGazer + 9-dot behaviour so nothing breaks. The v2 stack (MediaPipe FaceMesh + iris + kernel ridge regression + smooth-pursuit calibration + positioning coach) is opt-in via query-string flags, which also lets you A/B compare any combination.

### Gaze engine — `?engine=`

| Value | Pipeline |
|---|---|
| *(default)* | **WebGazer** — TF.js FaceMesh + raw eye-pixel patches + linear ridge regression. |
| `facemesh` | **v2 engine** — MediaPipe FaceMesh (478 landmarks incl. 10 iris pts) + 13-dim hand-crafted feature vector + kernel ridge regression per user. |

### Calibration — `?calib=`

| Value | Flow |
|---|---|
| *(default for WebGazer)* | **9-dot × 5-click** = 45 samples. |
| *(default for FaceMesh)* | **Smooth-pursuit** — 18 s following a moving Lissajous dot with your eyes only, no clicks. ~500 samples, the density KRR needs to model the non-linear eye-to-screen map. Blinks auto-rejected (EAR < 0.15). |
| `9point` | Force 9-dot for whichever engine is active. |
| `pursuit` | Force smooth-pursuit for whichever engine is active. |

### Positioning coach — `?coach=`

| Value | Behaviour |
|---|---|
| *(default for FaceMesh)* | **On.** Pre-calibration quality gate: face centering, distance (from iris diameter), head tilt (roll/yaw/pitch), lighting (mean luminance + left/right symmetry). Auto-proceeds after all four stay green for 1.5 s; "Start anyway" bypasses. |
| `0` | Skip the coach — useful when running the same user through A/B comparisons and you don't want the gate to stall. |

WebGazer mode never shows the coach (it doesn't expose the landmarks the coach reads).

### Dev-mode benchmark — `?dev=`

Automatically on under `vite dev`. In production builds, append `?dev=1` to surface the "Run accuracy benchmark?" prompt after calibration completes. The benchmark is a 16×8 Z-pattern sweep (3 s dwell per cell, ≈ 6.4 min) that auto-saves CSV + gazemap PNG into `gaze_result/` under a mode-tagged filename.

Per-sample CSV columns include `cell_row`, `cell_col`, `target_x/y`, `gaze_x/y`, `error_px`, plus `capture_time`, `emit_time`, and `paint_time` for end-to-end latency reconstruction. The footer summary records mean / median / p95 angular error, hit rate at 1.5 °, RMS jitter, sample rate, tracking-loss %, within-fixation saccade-velocity quantiles, per-region 3×3 breakdown, inference latency (capture→emit), pipeline latency (capture→display), and the run's `px_per_degree` / grid / dwell parameters. FaceMesh additionally logs KRR fit diagnostics (N, γ, λ, kernel, feature std layout).

Capture clocks: FaceMesh uses an exact per-frame `requestVideoFrameCallback` pairing through [src/gaze/landmarks.ts](src/gaze/landmarks.ts); WebGazer uses an rVFC approximation tracked in [src/main.ts](src/main.ts) (`startWebgazerCaptureClock`) — its inference / pipeline latency numbers are a lower bound (the engine's true latency may be one or two video-frame intervals higher). On browsers without rVFC support, both engines fall back to `capture_time = emit_time` and the latency columns read ~0.

### Benchmark grid + duration — `?fast=` / `?rows=` / `?cols=` / `?dwell=`

A full 16×8 × 3 s run takes ~6.4 minutes, which is too long for debug iterations. Shortcuts:

| Flag | Effect |
|---|---|
| `?fast=1` | 8×4 grid at 1.5 s dwell → ~48 s total. Enough to see whether a fix worked without committing to a full run. |
| `?rows=N` | Override row count (1–32). |
| `?cols=M` | Override column count (1–64). |
| `?dwell=MS` | Dwell per cell in milliseconds (200–10000). |

Individual overrides take precedence over `?fast=1`, so you can tune just one axis (e.g. `?fast=1&dwell=2000` = fast grid, longer dwell). CSV metadata records `grid,<cols>x<rows>` and `dwell_ms,<N>` so debug runs are trivially distinguishable from full runs even after the files are renamed.

### Benchmark task — `?task=sweep` (default) or `?task=drift`

Two task modes share the same overlay, CSV format, and engine plumbing — pick by URL flag. Drift mode is useful for measuring how a calibrated model degrades over wall-clock time; sweep is for static-accuracy snapshots.

| Flag | Effect |
|---|---|
| `?task=sweep` *(default)* | Row-major Z-pattern over every cell, no idle gap. Same behaviour as before. |
| `?task=drift` | Random `?visits=10` cells, each shown for `?dwell=2000` ms with `?idle=28000` ms gap. Total ≈ 5 min. The gap is the point: drift only develops with wall-clock time between samples. |
| `?visits=N` | Drift-only — number of target presentations (default 10). |
| `?idle=MS` | Idle gap between presentations (default 28000 in drift mode, 0 in sweep). |

In drift mode the run-label gains a `_drift` suffix (e.g. `benchmark_facemesh_pursuit_drift_<ts>.csv`) so sweep and drift runs of the same pipeline land in distinct files.

### Ablation knobs — `?onemin=` / `?onebeta=` / `?kernel=`

§6 ablation surface for sweeping the parts of the v2 pipeline that don't have a principled default. All are passive — defaults stay the same when the flag is absent, so non-ablation runs reproduce the headline numbers in [gaze_result/RESULTS_2026-06-08.md](gaze_result/RESULTS_2026-06-08.md).

| Flag | Default | Effect |
|---|---|---|
| `?onemin=F` | `1.0` | One-Euro `minCutoff` (low-cutoff frequency, Hz). |
| `?onebeta=F` | `0.007` | One-Euro `beta` (speed-coefficient). Lower = more smoothing / more lag. |
| `?kernel=K` | `rbf` | KRR kernel: `rbf` (default, non-linear), `linear` (collapses to ridge on the 13-dim feature space), or `poly2` (degree-2 polynomial, all pairwise feature products). FaceMesh only. |

When any knob is off-default, an `_abl-<tags>` suffix is appended to the CSV / PNG filename (e.g. `benchmark_facemesh_pursuit_abl-oneB0.015_<ts>.csv`, `..._abl-k-linear_<ts>.csv`) so ablation runs don't overwrite baselines.

### Visual-angle readout — `?pxperdeg=N`

Default `45` (≈ 14" laptop at arm's length). Tune to your geometry so the benchmark summary's degree readout matches your physical display — measure 1 cm on-screen at your viewing distance and divide by `tan(1°) ≈ 0.0175` to get your actual px/deg.

### Recommended benchmark matrix

Runs end up in `gaze_result/benchmark_<mode>_<timestamp>.csv` + `gazemap_<mode>_<timestamp>.png`, so you can re-run any row as often as you like without overwriting anything.

| URL | Engine | Calibration | Coach | Intended use |
|---|---|---|---|---|
| `/` | WebGazer | 9-dot | — | **Legacy baseline** |
| `/?calib=pursuit` | WebGazer | Smooth-pursuit | — | A/B: does more samples help WebGazer's ridge? |
| `/?engine=facemesh&calib=9point` | FaceMesh | 9-dot | on | A/B: does iris input alone help vs WebGazer? |
| `/?engine=facemesh` | FaceMesh | Smooth-pursuit | on | **Full v2** — the one we'd actually ship |
| `/?engine=facemesh&coach=0` | FaceMesh | Smooth-pursuit | off | v2 without the positioning gate |

The 2×2 of engine × calibration decomposes the v2 gain: going from row 1 to row 2 isolates the calibration-density contribution, row 1 to row 3 isolates the iris-feature contribution, and row 1 to row 4 is the stacked improvement plus the non-linear KRR head.

### Benchmark analysis scripts — `bench/`

Post-process CSVs from `gaze_result/` into the metrics and figures used in the paper. All scripts read the same header block (`px_per_degree`, grid shape, dwell, kernel, …) so debug and production runs are interchangeable.

| Script | Output | Notes |
|---|---|---|
| [bench/analyze.py](bench/analyze.py) | Per-target mean / worst angular error, RMS jitter, hit rate, saccade-velocity quantiles, 3×3 region breakdown, drift slope (°/min) for `_drift` runs. | Reads both standalone-harness JSON (gaze_v2) and integrated benchmark CSVs (this repo). Auto-detects format by extension. |
| [bench/heatmap.py](bench/heatmap.py) | Per-cell mean-error heatmap PNG next to each CSV. | `--vmax N` caps the colour scale (we use 20° for cross-engine comparability). Empty cells shaded grey — relevant for drift's random-subset visits. |
| [bench/scatter_compare.py](bench/scatter_compare.py) | Side-by-side WebGazer / FaceMesh sample-scatter plot over a chosen rectangle of central cells. | Shows accuracy (centroid offset) and precision (radial p95 dashed circle) on one figure — the §5.4 accuracy / precision tradeoff visualised. |
| [bench/ablation.py](bench/ablation.py) | Two-panel ablation figure: Pareto curve of accuracy vs within-fixation v_p99 across One-Euro β values, plus per-kernel bar chart. | Reads files via the `_abl-<tag>_` filename pattern emitted by the URL knobs above. |

The most recent paper-matrix session, including the §5.3 cross-engine results and the §6 ablation runs, is written up in [gaze_result/RESULTS_2026-06-08.md](gaze_result/RESULTS_2026-06-08.md).

## Tips for Better Accuracy

- Ensure good lighting on your face
- Position your face centered in the camera view
- Keep your head relatively still during use
- Click each calibration point multiple times for better accuracy
- Re-calibrate if tracking becomes inaccurate

## Tech Stack

- [Vite](https://vitejs.dev/) - Build tool and dev server
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [WebGazer.js](https://webgazer.cs.brown.edu/) ([GitHub](https://github.com/brownhci/WebGazer)) - Baseline (v1) eye tracking library by Brown HCI
- [MediaPipe FaceMesh](https://github.com/google/mediapipe) - 478-landmark face + iris model used as direct input to the v2 FaceMesh+KRR engine (`?engine=facemesh`)
- [ONNX Runtime Web](https://onnxruntime.ai/) - Browser-based ML inference (SAM)
- [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) - Lightweight SAM model for segmentation
- [One-Euro Filter](https://gery.casiez.net/1euro/) - Adaptive low-pass for cursor smoothing in the gaze controller

## How It Works

### WebGazer.js Pipeline

WebGazer.js is an eye tracking library developed by Brown University. It uses a machine learning pipeline to predict where the user is looking on the screen:

```
Webcam Video → Face Detection → Eye Extraction → Gaze Prediction → Screen Coordinates
```

### Models & Algorithms

#### 1. Face Detection - TensorFlow.js FaceMesh

WebGazer uses [TensorFlow.js](https://www.tensorflow.org/js) with the [MediaPipe FaceMesh](https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection) model to detect facial landmarks.

**Model Architecture:**
- **Model Name**: MediaPipe FaceMesh
- **Landmarks**: 468 3D facial landmarks
- **Framework**: TensorFlow.js (runs in browser via WebGL)

**How FaceMesh Works:**
1. **BlazeFace Detection**: First, a lightweight face detector (BlazeFace) locates the face bounding box in the video frame
2. **Landmark Regression**: A deeper neural network then predicts 468 3D coordinates for facial landmarks including:
   - Eye contours (upper/lower eyelids)
   - Iris center positions
   - Eyebrow positions
   - Face outline

**Key Landmarks for Eye Tracking:**
- Landmarks 33, 133 (right eye corners)
- Landmarks 362, 263 (left eye corners)
- Landmarks 159, 145 (right eye upper/lower)
- Landmarks 386, 374 (left eye upper/lower)
- Iris landmarks for pupil position

**Paper Reference:**
> Kartynnik, Y., Ablavatski, A., Grishchenko, I., & Grundmann, M. (2019). 
> *Real-time Facial Surface Geometry from Monocular Video on Mobile GPUs*. 
> CVPR Workshop on Computer Vision for Augmented and Virtual Reality.
> https://arxiv.org/abs/1907.06724

---

#### 2. Eye Feature Extraction

Once the face is detected, WebGazer extracts eye features for gaze prediction:

**Process:**
1. **Eye Region Cropping**: Using FaceMesh landmarks, extract rectangular patches around each eye
2. **Image Preprocessing**: 
   - Convert to grayscale
   - Resize to fixed dimensions (e.g., 6x10 pixels per eye)
   - Normalize pixel values
3. **Feature Vector Creation**: Flatten the eye patch pixels into a 1D feature vector
4. **Concatenation**: Combine left eye, right eye, and optionally face position features

**Feature Vector Example:**
```
[left_eye_pixels (60), right_eye_pixels (60), face_x, face_y] = 122 features
```

---

#### 3. Gaze Prediction - Ridge Regression

WebGazer uses **Ridge Regression** (also known as Tikhonov regularization) to map eye features to screen coordinates.

**Mathematical Formulation:**

Ridge Regression minimizes the following objective function:

```
L(w) = ||Xw - y||² + λ||w||²
```

Where:
- `X` = matrix of eye feature vectors (from calibration clicks)
- `y` = vector of screen coordinates (x or y position of clicks)
- `w` = weight vector to learn
- `λ` = regularization parameter (prevents overfitting)

**Closed-form Solution:**
```
w = (X^T X + λI)^(-1) X^T y
```

**Why Ridge Regression?**
1. **Fast Training**: Closed-form solution allows real-time model updates
2. **Regularization**: L2 penalty prevents overfitting with limited calibration data
3. **Stability**: Works well even when features are correlated (eye pixels are highly correlated)
4. **Lightweight**: No iterative optimization needed, suitable for browser execution

**Implementation in WebGazer:**
- **Separate Models**: Two Ridge Regression models are trained - one for X coordinates, one for Y coordinates
- **Incremental Updates**: Model is updated with each new calibration click
- **Weighted Variants**: `weightedRidge` gives more weight to recent clicks; `threadedRidge` uses Web Workers for performance

**Available Regression Modules:**
| Module | Description |
|--------|-------------|
| `ridge` | Standard ridge regression |
| `weightedRidge` | Recent interactions weighted more heavily |
| `threadedRidge` | Multi-threaded for better performance |

**Paper Reference:**
> Hoerl, A. E., & Kennard, R. W. (1970). 
> *Ridge Regression: Biased Estimation for Nonorthogonal Problems*. 
> Technometrics, 12(1), 55-67.
> https://doi.org/10.1080/00401706.1970.10488634

### Calibration Process

1. User clicks on calibration dots at known screen positions
2. For each click, WebGazer captures:
   - Eye image features
   - Screen coordinates of the click
3. Ridge Regression model is trained/updated with this data
4. After calibration, the model predicts gaze position for new eye images

### Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Webcam    │────▶│  TensorFlow  │────▶│  Eye Features   │
│   Stream    │     │   FaceMesh   │     │   Extraction    │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                                   ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Red Dot    │◀────│    Screen    │◀────│ Ridge Regression│
│  Display    │     │  Coordinates │     │     Model       │
└─────────────┘     └──────────────┘     └─────────────────┘
```

### Gaze Smoothing

To reduce jitter in gaze predictions, a **moving average filter** is applied at the application level.

**How it works:**
1. The last N gaze positions are stored in a history buffer (default: 5 frames)
2. Each new prediction is averaged with recent positions
3. This smooths out high-frequency noise while preserving tracking accuracy

```
Raw Gaze Data → Moving Average (5 frames) → Smoothed Position → Display
```

**Configuration:**
The smoothing can be adjusted by modifying `SMOOTHING_FRAMES` in `src/main.ts`:
- **Higher value (8-10)**: Smoother but more latency
- **Lower value (3)**: More responsive but more jitter
- **Default (5)**: Balanced for most users

### Privacy

All processing happens **locally in the browser**. No video or gaze data is sent to any server.

### Gaze Heatmap

The heatmap provides a real-time visualization of gaze distribution across the screen.

**How it works:**
1. **Grid Division**: The screen is divided into a 50x50 grid for high-resolution visualization
2. **Intensity Accumulation**: Each gaze point increases the intensity of the corresponding grid cell
3. **Spatial Smoothing**: Neighboring cells also receive a slight intensity boost for smoother visualization
4. **Color Mapping**: Intensity values are mapped to a color gradient:

```
Low ──────────────────────────────────────────── High
Blue → Cyan → Green → Yellow → Red
```

**Implementation:**
- Uses HTML5 Canvas for rendering
- Updates in real-time with each gaze prediction (~60fps)
- Minimal performance impact due to efficient grid-based approach

### SAM (Segment Anything Model)

The Label Mode uses MobileSAM, a lightweight version of Meta's Segment Anything Model, running directly in the browser via ONNX Runtime Web.

**Pipeline:**
```
Image Upload → SAM Encoder → Image Embedding (cached)
                    ↓
Gaze Point → SAM Decoder → Segmentation Mask → Annotation
```

**Model Details:**
- **Encoder**: MobileSAM encoder (~25MB) - processes image once and caches embedding
- **Decoder**: MobileSAM decoder (~4MB) - generates mask from point prompts
- **Inference**: Runs on WebAssembly (WASM) with WebGL acceleration

**Fallback**: If SAM fails to load, a flood-fill based segmentation is used as fallback.

### Video Mode Architecture

The Video Mode enables gaze-tracked video annotation with synchronized audio recording.

**Pipeline:**
```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Video     │────▶│   Gaze       │────▶│  Gaze Points    │
│   Playback  │     │   Tracking   │     │  + Timestamps   │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
┌─────────────┐     ┌──────────────┐              │
│  Microphone │────▶│ MediaRecorder│              │
│   Input     │     │   (WebM)     │              ▼
└─────────────┘     └──────────────┘     ┌─────────────────┐
                                          │  Export JSON +  │
                                          │  Audio WebM     │
                                          └─────────────────┘
```

**Key Components:**
- **Video Player**: HTML5 video element with overlay canvas for gaze visualization
- **Gaze Tracking**: WebGazer.js predictions mapped to video coordinates
- **Audio Recording**: MediaRecorder API capturing microphone input as WebM
- **Timeline Visualization**: Canvas-based heatmap showing gaze distribution over time

**Coordinate Mapping:**
Gaze screen coordinates are transformed to normalized video coordinates (0-1) accounting for:
- Video element position on screen
- Video aspect ratio vs element size
- Letterboxing/pillarboxing offsets

**Use Case**: Designed for expert annotation tasks such as surgical video review, where professionals can watch procedures while their gaze patterns and verbal commentary are recorded for analysis.

### Gaze Analysis

The analysis module implements standard eye tracking metrics for research applications.

**Fixation Detection (I-DT Algorithm):**
```
Raw Gaze Points → Sliding Window → Dispersion Check → Fixation Classification
                                        ↓
                           dispersion < threshold? → Expand window
                           dispersion ≥ threshold? → Record fixation, reset
```

The I-DT (Dispersion-Threshold Identification) algorithm:
1. Collects gaze points in a temporal window
2. Calculates dispersion (maximum distance between any two points)
3. If dispersion < threshold and duration ≥ minimum, classifies as fixation
4. Computes fixation centroid and duration

**Analysis Metrics:**
- **Dwell Time**: Sum of fixation durations within each AOI
- **Time to First Fixation (TTFF)**: Time from video start to first fixation in AOI
- **Scanpath Length**: Total distance traveled between consecutive fixations
- **AOI Transition Matrix**: Counts of gaze transitions between AOIs

**Default Parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| Dispersion Threshold | 0.03 | 3% of screen (~1-2° visual angle) |
| Min Fixation Duration | 100ms | Minimum time to qualify as fixation |

## Project Structure

```
webcam_gaze_webapp/
├── index.html                # Main HTML file
├── benchmark.html            # Standalone v1 benchmark harness page
├── src/
│   ├── main.ts               # Application entry, mode switching, URL flags
│   ├── labelMode.ts          # Label mode logic & UI
│   ├── videoMode.ts          # Video annotation mode logic & UI
│   ├── gazeAnalysis.ts       # Fixation detection (I-DT) & analysis metrics
│   ├── sam.ts                # SAM model integration
│   ├── gaze/                 # v2 FaceMesh+KRR engine
│   │   ├── engine.ts         # Orchestrates landmarks → features → regression
│   │   ├── landmarks.ts      # MediaPipe FaceMesh + rVFC capture clock
│   │   ├── features.ts       # 13-dim hand-crafted feature vector
│   │   └── regression.ts     # Kernel ridge regression (rbf / linear / poly2)
│   ├── calibration/
│   │   ├── smoothPursuit.ts  # Lissajous pursuit calibration (~500 samples)
│   │   └── coach.ts          # Pre-calibration positioning quality gate
│   ├── control/
│   │   ├── controller.ts     # Raw / smoothed / snapped gaze stream
│   │   ├── oneEuroFilter.ts  # Adaptive low-pass for cursor smoothing
│   │   ├── fixationClassifier.ts  # I-VT classifier for dwell-click
│   │   └── snapping.ts       # Magnetic-snap to UI targets
│   ├── benchmark/
│   │   ├── benchmark.ts      # Sweep / drift task runner
│   │   ├── overlay.ts        # Target dot + progress overlay
│   │   └── export.ts         # CSV writer + summary stats
│   ├── bench/protocol.ts     # Shared sweep / drift protocol definitions
│   ├── blinkDetector.ts      # EAR-based blink detection
│   └── style.css             # Styles
├── bench/                    # Post-hoc analysis scripts (Python)
│   ├── analyze.py            # Headline metrics from CSV / JSON
│   ├── heatmap.py            # Per-cell error heatmap PNGs
│   ├── scatter_compare.py    # WebGazer vs FaceMesh sample-scatter figure
│   └── ablation.py           # One-Euro β + KRR kernel ablation figure
├── gaze_v2/                  # Standalone v2 harness (separate dev server)
├── gaze_result/              # Auto-saved benchmark CSVs + gazemap PNGs
├── paper/, paper_overleaf/   # MICCAI workshop paper draft
├── PAPER_PLAN.md             # Living paper-planning doc
├── package.json
└── tsconfig.json
```

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Reproducing the GazeLab paper

Beyond the WebGazer-based application above, this repository also
backs an open browser-gaze **benchmark harness** and a new
**FaceMesh + KRR** gaze pipeline. The paper that describes the
methodology and reports the empirical findings lives at
[paper/gazelab_neurips.tex](paper/gazelab_neurips.tex); a packaged
Overleaf-ready bundle is at `paper_overleaf/`.

### What the paper claims (3-bullet summary)

1. **Capture-clock methodology** — measuring browser-gaze inference
   latency honestly via `requestVideoFrameCallback`
   `presentationTime`, with exact pairing for queue-exposing engines
   and a verifiable lower bound for opaque ones (such as WebGazer).
2. **Open reference implementation** — this repo, demonstrating the
   methodology on two interchangeable engines (WebGazer baseline +
   our FaceMesh + KRR pipeline) and an analysis suite
   (per-cell heatmaps, 3×3 region partition, within-fixation
   velocity, drift slope).
3. **Empirical payoff (single user, N=1)** — a 20–50 ms gap between
   the inference-latency a naive timestamp reports (≈0 ms) and the
   honest measurement (22–34 ms median); plus a conceptual split
   between spatial-spread and temporal-jitter precision that
   aggregate metrics conflate. Cross-engine accuracy differences
   are reported as worked examples; the harness's own β-ablation
   surfaces a ~7° single-session noise floor that bounds the
   claimable engine ranking at N=1.

### Where the artefacts live

| Artefact | Location |
|---|---|
| Reference SPA source | [`src/`](src/) |
| FaceMesh + KRR engine | [`src/gaze/`](src/gaze/) (`engine.ts`, `regression.ts`, `features.ts`, `landmarks.ts`) |
| Benchmark harness | [`src/benchmark/`](src/benchmark/) |
| One-Euro filter / I-VT classifier / controller | [`src/control/`](src/control/) |
| Per-sample CSV logs (all reported runs) | [`gaze_result/`](gaze_result/) |
| Analysis scripts (Python) | [`bench/`](bench/) — `analyze.py`, `heatmap.py`, `scatter_compare.py`, `ablation.py` |
| Master results document | [`gaze_result/RESULTS_2026-06-08.md`](gaze_result/RESULTS_2026-06-08.md) |
| Paper bundle (LaTeX + figures) | [`paper_overleaf/`](paper_overleaf/) |

### Reproducing the paper figures and table

The 4-run paper matrix (sweep + drift × WebGazer + FaceMesh) and the
5-run §6 ablation (One-Euro β sweep + KRR kernel sweep) take ~90 min
of in-browser data collection. The exact URL queries are:

```
# §5 paper matrix
/?engine=webgazer&calib=pursuit&task=sweep                  # ~6 min
/?engine=facemesh&task=sweep                                # ~6 min
/?engine=webgazer&calib=pursuit&task=drift&visits=10        # ~5 min
/?engine=facemesh&task=drift&visits=10                      # ~5 min

# §6 ablation (FaceMesh + sweep only)
/?engine=facemesh&task=sweep&onebeta=0.003                  # ~6 min
/?engine=facemesh&task=sweep&onebeta=0.015                  # ~6 min
/?engine=facemesh&task=sweep&onebeta=0.030                  # ~6 min
/?engine=facemesh&task=sweep&kernel=linear                  # ~6 min
/?engine=facemesh&task=sweep&kernel=poly2                   # ~6 min
```

Each run writes a CSV + gazemap PNG to `gaze_result/`. Once collected:

```bash
# Per-engine analysis (region partition, velocity, drift slope)
python3 bench/analyze.py --dist-cm 60 --dpi 110 \
    gaze_result/benchmark_*_2026-06-08-*.csv

# Per-cell heatmaps (Fig 4 in paper)
python3 bench/heatmap.py --vmax 20 \
    gaze_result/benchmark_*_pursuit_2026-06-08-*.csv

# Scatter-compare (Fig 5 in paper, sweep central cells)
python3 bench/scatter_compare.py \
    gaze_result/benchmark_webgazer_pursuit_2026-06-08-04-47-22.csv \
    gaze_result/benchmark_facemesh_pursuit_2026-06-08-04-55-19.csv \
    --rows 2-4 --cols 6-10 --axis-deg 20 \
    --out paper/figures/scatter_compare.png

# §6 ablation aggregator (Fig 6)
python3 bench/ablation.py \
    --baseline gaze_result/benchmark_facemesh_pursuit_2026-06-08-04-55-19.csv \
    --abl-dir  gaze_result \
    --out      paper/figures/ablation.png
```

To reproduce the headline table from the already-released CSVs
without re-running the in-browser benchmark, only the Python
scripts are needed; analysis time is under 30 s on commodity
hardware.

## License

This project is released under the [MIT License](LICENSE). It
bundles WebGazer.js (Apache 2.0) and MediaPipe FaceMesh
(Apache 2.0); both upstream licenses are preserved in their
respective `node_modules/` directories.

---

## References

### WebGazer.js Paper (Primary Citation)

If you use this project or WebGazer.js, please cite:

```bibtex
@inproceedings{papoutsaki2016webgazer,
  author = {Alexandra Papoutsaki and Patsorn Sangkloy and James Laskey 
            and Nediyana Daskalova and Jeff Huang and James Hays},
  title = {WebGazer: Scalable Webcam Eye Tracking Using User Interactions},
  booktitle = {Proceedings of the 25th International Joint Conference 
               on Artificial Intelligence (IJCAI)},
  pages = {3839--3845},
  year = {2016},
  organization = {AAAI}
}
```

**Paper PDF**: https://jeffhuang.com/Final_WebGazer_IJCAI16.pdf

### Additional References

| Topic | Paper | Link |
|-------|-------|------|
| MediaPipe FaceMesh | Kartynnik et al. (2019). *Real-time Facial Surface Geometry from Monocular Video on Mobile GPUs*. CVPR Workshop. | https://arxiv.org/abs/1907.06724 |
| Ridge Regression | Hoerl & Kennard (1970). *Ridge Regression: Biased Estimation for Nonorthogonal Problems*. Technometrics. | https://doi.org/10.1080/00401706.1970.10488634 |
| BlazeFace | Bazarevsky et al. (2019). *BlazeFace: Sub-millisecond Neural Face Detection on Mobile GPUs*. CVPR Workshop. | https://arxiv.org/abs/1907.05047 |
| WebGazer Dataset | Papoutsaki et al. (2018). *The Eye of the Typer: A Benchmark and Analysis of Gaze Behavior During Typing*. ETRA. | https://jeffhuang.com/Final_EyeTyper_ETRA18.pdf |
| SAM | Kirillov et al. (2023). *Segment Anything*. ICCV. | https://arxiv.org/abs/2304.02643 |
| MobileSAM | Zhang et al. (2023). *Faster Segment Anything: Towards Lightweight SAM for Mobile Applications*. | https://arxiv.org/abs/2306.14289 |
