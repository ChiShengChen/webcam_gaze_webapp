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


https://github.com/user-attachments/assets/demo_2026-02-04_compressed.mp4


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

## Tips for Better Accuracy

- Ensure good lighting on your face
- Position your face centered in the camera view
- Keep your head relatively still during use
- Click each calibration point multiple times for better accuracy
- Re-calibrate if tracking becomes inaccurate

## Tech Stack

- [Vite](https://vitejs.dev/) - Build tool and dev server
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [WebGazer.js](https://webgazer.cs.brown.edu/) ([GitHub](https://github.com/brownhci/WebGazer)) - Eye tracking library by Brown HCI
- [ONNX Runtime Web](https://onnxruntime.ai/) - Browser-based ML inference
- [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) - Lightweight SAM model for segmentation

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
├── index.html          # Main HTML file
├── src/
│   ├── main.ts         # Application entry & mode switching
│   ├── labelMode.ts    # Label mode logic & UI
│   ├── videoMode.ts    # Video annotation mode logic & UI
│   ├── gazeAnalysis.ts # Fixation detection & analysis metrics
│   ├── sam.ts          # SAM model integration
│   ├── style.css       # Styles
│   └── webgazer.d.ts   # TypeScript declarations
├── assets/
│   ├── demo.mp4        # Gaze tracker demo
│   └── demo_label_mode.mp4  # Label mode demo
├── package.json
└── tsconfig.json
```

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## License

MIT

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
