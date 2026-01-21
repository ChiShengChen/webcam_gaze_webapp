# Webcam Gaze Tracker

A web application that uses your webcam to track your eye gaze in real-time. Built with WebGazer.js and Vite.

## Features

- Real-time eye gaze tracking using webcam
- 9-point calibration system for improved accuracy
- Visual gaze indicator (red dot follows your gaze)
- Video preview to ensure proper face positioning

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

## Tips for Better Accuracy

- Ensure good lighting on your face
- Position your face centered in the camera view
- Keep your head relatively still during use
- Click each calibration point multiple times for better accuracy
- Re-calibrate if tracking becomes inaccurate

## Tech Stack

- [Vite](https://vitejs.dev/) - Build tool and dev server
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [WebGazer.js](https://webgazer.cs.brown.edu/) - Eye tracking library

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

### Privacy

All processing happens **locally in the browser**. No video or gaze data is sent to any server.

## Project Structure

```
webcam_gaze_webapp/
├── index.html          # Main HTML file
├── src/
│   ├── main.ts         # Application logic
│   ├── style.css       # Styles
│   └── webgazer.d.ts   # TypeScript declarations for WebGazer
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
