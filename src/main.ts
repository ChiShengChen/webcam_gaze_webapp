import './style.css';
import webgazer from 'webgazer';
import { LabelMode } from './labelMode';
import { VideoMode } from './videoMode';
import { BlinkDetector } from './blinkDetector';
import { BlinkDetectorEAR } from './blinkDetectorEAR';
import { GazeController } from './control/controller';
import { computeSnap, SnapStrength } from './control/snapping';
import { Benchmark } from './benchmark/benchmark';
import { FaceMeshGazeEngine } from './gaze/engine';
import { SmoothPursuit } from './calibration/smoothPursuit';
import { PositioningCoach } from './calibration/coach';

let currentMode: 'tracker' | 'label' | 'video' = 'tracker';
let labelMode: LabelMode | null = null;
let videoMode: VideoMode | null = null;
let webgazerStarted = false;
let correctionMode = false;
let correctionCount = 0;
const blinkDetector = new BlinkDetector();
// Parallel EAR-based detector used only when the FaceMesh engine is
// active. The WebGazer path keeps the pixel-variance detector so legacy
// behaviour is unchanged.
const blinkDetectorEAR = new BlinkDetectorEAR();

const CLICKS_PER_DOT = 5;

// One-Euro + I-VT + dwell-click pipeline. Replaces the old 5-frame
// moving average: OneEuro is strictly better on gaze (adapts cutoff to
// instantaneous speed), and the controller exposes raw/snapped/dwell_click
// streams so each consumer can pick what fits (heatmap wants raw, cursor
// wants snapped, dwell-click wires gaze targets to synthetic events).
const gazeController = new GazeController({
    oneEuro: { minCutoff: 1.0, beta: 0.007 },
});
const snapStrength = new SnapStrength(120);

// Dev-mode benchmark. Gated on `import.meta.env.DEV` (true under `npm run
// dev`, false in production build) OR the `?dev=1` URL flag, so the prompt
// never appears to end users unless they explicitly opt in.
const urlParams = new URLSearchParams(window.location.search);
const devMode = import.meta.env.DEV || urlParams.has('dev');

// Gaze engine selection. Default stays WebGazer so existing users are
// unaffected. `?engine=facemesh` switches to MediaPipe FaceMesh + KRR —
// gives the regression head iris landmarks directly instead of raw eye
// pixel patches, which is the single biggest input upgrade we can make.
const useFaceMesh = urlParams.get('engine') === 'facemesh';
const facemeshEngine: FaceMeshGazeEngine | null = useFaceMesh ? new FaceMeshGazeEngine() : null;

// Calibration method. Smooth-pursuit (~500 samples over 18 s) is the
// default for FaceMesh so the KRR head has enough data to shape a real
// non-linear mapping; WebGazer stays on the 9-dot flow. `?calib=9point`
// or `?calib=pursuit` overrides either way.
const calibModeOverride = urlParams.get('calib');
const useSmoothPursuit =
    calibModeOverride === 'pursuit' ||
    (useFaceMesh && calibModeOverride !== '9point');

// Positioning coach gates calibration on face framing + distance +
// head tilt + lighting. Requires FaceMesh (WebGazer doesn't expose the
// needed landmarks). Default on in FaceMesh mode; `?coach=0` bypasses.
const useCoach = useFaceMesh && urlParams.get('coach') !== '0';

// Route both engines into the same controller. Done once at module scope
// so re-calibration doesn't stack listeners.
if (facemeshEngine) {
    facemeshEngine.onGaze((x, y) => {
        gazeController.push(x, y, performance.now());
    });
}

// FaceMesh mode runs without WebGazer's built-in preview canvas, so we
// build one ourselves. Shown only in tracker mode; hidden during
// calibration overlays and in Label/Video modes where the preview would
// fight for screen real estate with the mode UI.
let facemeshPreviewEl: HTMLVideoElement | null = null;
function ensureFacemeshPreview(): HTMLVideoElement {
    if (facemeshPreviewEl) return facemeshPreviewEl;
    const v = document.createElement('video');
    v.id = 'facemesh-preview';
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    Object.assign(v.style, {
        position: 'fixed',
        bottom: '12px',
        right: '12px',
        width: '240px',
        height: '135px',
        border: '2px solid #333',
        borderRadius: '6px',
        zIndex: '500',
        background: '#000',
        transform: 'scaleX(-1)', // mirror so "left on screen" matches user's left
        objectFit: 'cover',
        display: 'none',
    });
    document.body.appendChild(v);

    // Small label on top of the video so the user knows what it is.
    const label = document.createElement('div');
    label.textContent = 'facemesh · live';
    Object.assign(label.style, {
        position: 'fixed',
        bottom: '140px',
        right: '18px',
        color: '#ccc',
        fontSize: '10px',
        fontFamily: 'ui-monospace, monospace',
        letterSpacing: '0.3px',
        zIndex: '501',
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.65)',
        padding: '2px 6px',
        borderRadius: '4px',
    });
    label.id = 'facemesh-preview-label';
    label.style.display = 'none';
    document.body.appendChild(label);

    facemeshPreviewEl = v;
    return v;
}
function setFacemeshPreviewVisible(visible: boolean): void {
    const label = document.getElementById('facemesh-preview-label');
    if (facemeshPreviewEl) facemeshPreviewEl.style.display = visible ? 'block' : 'none';
    if (label) label.style.display = visible ? 'block' : 'none';
}

function recordCalibrationSample(x: number, y: number): boolean {
    if (useFaceMesh && facemeshEngine) {
        return facemeshEngine.recordSample(x, y);
    }
    webgazer.recordScreenPosition(x, y, 'click');
    return true; // WebGazer has no acceptance signal; treat every click as a sample.
}
// Rough conversion for degree-of-visual-angle readouts. Default 45 px/deg
// matches a ~14" laptop at arm's length; tune via `?pxperdeg=N` if you
// know your geometry (e.g. measure 1 cm at viewing distance → divide by
// tan(1°) ≈ 0.0175 to get px/deg).
const pxPerDegreeRaw = Number(urlParams.get('pxperdeg'));
const pxPerDegree = Number.isFinite(pxPerDegreeRaw) && pxPerDegreeRaw > 0 ? pxPerDegreeRaw : 45;

// Benchmark grid + dwell can be shrunk for faster iteration.
//   ?fast=1     -> 4x8 grid, 1.5 s dwell (~48 s total vs ~6.4 min default)
//   ?rows=N, ?cols=M, ?dwell=MS  -> individual overrides (take priority)
// The mode-tagged filename stays the same; CSV metadata embeds the grid
// dims so debug runs are self-identifying when comparing side-by-side.
function intParam(name: string, min: number, max: number): number | null {
    const raw = urlParams.get(name);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
    return n;
}
const fastMode = urlParams.get('fast') === '1';
const gridRows = intParam('rows', 1, 32) ?? (fastMode ? 4 : 8);
const gridCols = intParam('cols', 1, 64) ?? (fastMode ? 8 : 16);
const dwellMs = intParam('dwell', 200, 10000) ?? (fastMode ? 1500 : 3000);

// Mode-tagged label — auto-save filenames embed this so multiple runs
// in the same dev session land in distinct files in gaze_result/.
// URL layout is deliberately flat so the label is obvious:
//   / or ?engine=webgazer           -> webgazer_9point
//   /?calib=pursuit                 -> webgazer_pursuit
//   /?engine=facemesh&calib=9point  -> facemesh_9point
//   /?engine=facemesh (default)     -> facemesh_pursuit
//   ... with -nocoach suffix when the coach is bypassed.
const runLabel = (() => {
    const engine = useFaceMesh ? 'facemesh' : 'webgazer';
    const calib = useSmoothPursuit ? 'pursuit' : '9point';
    const coachTag = (useFaceMesh && !useCoach) ? '-nocoach' : '';
    return `${engine}_${calib}${coachTag}`;
})();

const benchmark = new Benchmark(gazeController, {
    rows: gridRows,
    cols: gridCols,
    dwellMs,
    pxPerDegree,
    runLabel,
});

window.onload = function() {
    // Mode toggle elements
    const modeToggle = document.getElementById('mode-toggle')!;
    const trackerModeBtn = document.getElementById('tracker-mode-btn')!;
    const labelModeBtn = document.getElementById('label-mode-btn')!;
    const videoModeBtn = document.getElementById('video-mode-btn')!;
    const trackerModeContainer = document.getElementById('tracker-mode')!;
    const labelModeContainer = document.getElementById('label-mode')!;
    const videoModeContainer = document.getElementById('video-mode')!;
    
    // Gaze Tracker elements
    const gazeDot = document.getElementById('gaze-dot')!;
    const startCalibrationBtn = document.getElementById('start-calibration')!;
    const calibrationDotsContainer = document.getElementById('calibration-dots')!;
    const calibrationDots = document.querySelectorAll<HTMLDivElement>('.calibration-dot');
    let calibrationClicks = 0;

    // Heatmap elements
    const heatmapContainer = document.getElementById('heatmap-container')!;
    const heatmapCanvas = document.getElementById('heatmap-canvas') as HTMLCanvasElement;
    const toggleHeatmapBtn = document.getElementById('toggle-heatmap')!;
    const clearHeatmapBtn = document.getElementById('clear-heatmap')!;
    const ctx = heatmapCanvas.getContext('2d')!;

    // Correction controls elements
    const correctionControls = document.getElementById('correction-controls')!;
    const toggleCorrectionBtn = document.getElementById('toggle-correction-btn')!;
    const correctionCountSpan = document.getElementById('correction-count')!;

    // Heatmap data
    const GRID_SIZE = 50;
    let heatmapData: number[][] = [];
    let isHeatmapVisible = true;

    // ==================== Mode Switching ====================
    function switchMode(mode: 'tracker' | 'label' | 'video') {
        currentMode = mode;
        
        // Update button states
        trackerModeBtn.classList.toggle('active', mode === 'tracker');
        labelModeBtn.classList.toggle('active', mode === 'label');
        videoModeBtn.classList.toggle('active', mode === 'video');
        
        // Show/hide containers
        trackerModeContainer.style.display = mode === 'tracker' ? 'block' : 'none';
        labelModeContainer.style.display = mode === 'label' ? 'block' : 'none';
        videoModeContainer.style.display = mode === 'video' ? 'block' : 'none';
        
        // Handle gaze dot, heatmap, and correction controls visibility
        if (mode === 'tracker') {
            if (webgazerStarted) {
                gazeDot.style.display = 'block';
                heatmapContainer.style.display = 'block';
                correctionControls.style.display = 'flex';
                blinkLogContainer.style.display = 'flex';
                if (useFaceMesh) setFacemeshPreviewVisible(true);
                else webgazer.showVideoPreview(true);
            }
        } else {
            gazeDot.style.display = 'none';
            heatmapContainer.style.display = 'none';
            correctionControls.style.display = 'none';
            blinkLogContainer.style.display = 'none';
            if (webgazerStarted) {
                if (useFaceMesh) setFacemeshPreviewVisible(false);
                else webgazer.showVideoPreview(false);
            }
        }
    }
    
    trackerModeBtn.onclick = () => switchMode('tracker');
    
    labelModeBtn.onclick = async () => {
        switchMode('label');
        
        // Initialize label mode if not already
        if (!labelMode) {
            const modelStatus = document.getElementById('model-status')!;
            labelMode = new LabelMode((status, type) => {
                modelStatus.textContent = status;
                modelStatus.className = type;
            });
            await labelMode.initialize();
        }
    };
    
    videoModeBtn.onclick = () => {
        switchMode('video');
        
        // Initialize video mode if not already
        if (!videoMode) {
            videoMode = new VideoMode();
        }
    };

    // ==================== Heatmap Functions ====================
    function initHeatmap() {
        heatmapCanvas.width = 400;
        heatmapCanvas.height = 225;
        
        heatmapData = [];
        for (let i = 0; i < GRID_SIZE; i++) {
            heatmapData[i] = [];
            for (let j = 0; j < GRID_SIZE; j++) {
                heatmapData[i][j] = 0;
            }
        }
        
        drawHeatmap();
    }

    function updateHeatmap(x: number, y: number) {
        if (!isHeatmapVisible) return;
        
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        
        const gridX = Math.floor((x / screenWidth) * GRID_SIZE);
        const gridY = Math.floor((y / screenHeight) * GRID_SIZE);
        
        if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
            heatmapData[gridY][gridX] = Math.min(1, heatmapData[gridY][gridX] + 0.05);
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = gridX + dx;
                    const ny = gridY + dy;
                    if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && (dx !== 0 || dy !== 0)) {
                        heatmapData[ny][nx] = Math.min(1, heatmapData[ny][nx] + 0.02);
                    }
                }
            }
        }
        
        drawHeatmap();
    }

    function drawHeatmap() {
        const cellWidth = heatmapCanvas.width / GRID_SIZE;
        const cellHeight = heatmapCanvas.height / GRID_SIZE;
        
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
        
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const intensity = heatmapData[y][x];
                if (intensity > 0) {
                    const color = getHeatmapColor(intensity);
                    ctx.fillStyle = color;
                    ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
                }
            }
        }
    }

    function getHeatmapColor(intensity: number): string {
        intensity = Math.max(0, Math.min(1, intensity));
        
        let r, g, b;
        
        if (intensity < 0.25) {
            const t = intensity / 0.25;
            r = 0;
            g = Math.round(255 * t);
            b = 255;
        } else if (intensity < 0.5) {
            const t = (intensity - 0.25) / 0.25;
            r = 0;
            g = 255;
            b = Math.round(255 * (1 - t));
        } else if (intensity < 0.75) {
            const t = (intensity - 0.5) / 0.25;
            r = Math.round(255 * t);
            g = 255;
            b = 0;
        } else {
            const t = (intensity - 0.75) / 0.25;
            r = 255;
            g = Math.round(255 * (1 - t));
            b = 0;
        }
        
        return `rgba(${r}, ${g}, ${b}, 0.8)`;
    }

    toggleHeatmapBtn.onclick = () => {
        isHeatmapVisible = !isHeatmapVisible;
        if (isHeatmapVisible) {
            heatmapContainer.classList.remove('hidden');
            toggleHeatmapBtn.textContent = 'Hide';
        } else {
            heatmapContainer.classList.add('hidden');
            toggleHeatmapBtn.textContent = 'Show';
        }
    };

    clearHeatmapBtn.onclick = () => {
        initHeatmap();
    };

    // ==================== Blink Log & Marker (Gaze Tracker mode) ====================
    const blinkLogContainer = document.getElementById('blink-log-container')!;
    const blinkLogList = document.getElementById('blink-log-list')!;
    const blinkTotalCount = document.getElementById('blink-total-count')!;
    const clearBlinkLogBtn = document.getElementById('clear-blink-log')!;
    const exportBlinkLogBtn = document.getElementById('export-blink-log')!;

    interface BlinkRecord {
        index: number;
        time: string;
        x: number;
        y: number;
        screenX: number;
        screenY: number;
    }
    const blinkRecords: BlinkRecord[] = [];
    let blinkIndex = 0;

    function showBlinkMarker(x: number, y: number) {
        const marker = document.createElement('div');
        marker.className = 'blink-marker';
        marker.style.left = `${x}px`;
        marker.style.top = `${y}px`;
        document.body.appendChild(marker);
        marker.addEventListener('animationend', () => marker.remove());
    }

    function addBlinkToLog(x: number, y: number) {
        blinkIndex++;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
        const normX = +(x / window.innerWidth).toFixed(3);
        const normY = +(y / window.innerHeight).toFixed(3);

        const record: BlinkRecord = {
            index: blinkIndex,
            time: timeStr,
            x: normX,
            y: normY,
            screenX: Math.round(x),
            screenY: Math.round(y),
        };
        blinkRecords.push(record);
        blinkTotalCount.textContent = String(blinkRecords.length);

        // Add entry to top of list
        const entry = document.createElement('div');
        entry.className = 'blink-log-entry';
        entry.innerHTML = `<span class="blink-time">#${record.index} ${record.time}</span><span class="blink-coords">(${record.screenX}, ${record.screenY})</span>`;
        blinkLogList.prepend(entry);
    }

    clearBlinkLogBtn.onclick = () => {
        blinkRecords.length = 0;
        blinkIndex = 0;
        blinkLogList.innerHTML = '';
        blinkTotalCount.textContent = '0';
    };

    exportBlinkLogBtn.onclick = () => {
        if (blinkRecords.length === 0) return;
        const header = 'index,time,norm_x,norm_y,screen_x,screen_y\n';
        const csv = header + blinkRecords.map(r =>
            `${r.index},${r.time},${r.x},${r.y},${r.screenX},${r.screenY}`
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `blink_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Register blink handler on both detectors — only one of them runs at
    // a time (start/stop are branched on engine), but keeping the handler
    // wired to both avoids an engine-switch code path in the middle of
    // the UI logic.
    const onBlink = (gazeX: number, gazeY: number) => {
        if (currentMode === 'tracker') {
            showBlinkMarker(gazeX, gazeY);
            addBlinkToLog(gazeX, gazeY);
        } else if (currentMode === 'label' && labelMode) {
            labelMode.triggerSegmentation();
        } else if (currentMode === 'video' && videoMode) {
            // Could be used for video bookmarking in the future
        }
    };
    blinkDetector.onBlink(onBlink);
    blinkDetectorEAR.onBlink(onBlink);

    // FaceMesh engine pipes EAR into the EAR-based detector. Fires for
    // every landmark result, regardless of calibration state, so blinks
    // work even before the KRR is fitted.
    if (facemeshEngine) {
        facemeshEngine.onFrame((features) => {
            // Feature vector indices 4, 5 are left/right EAR per features.ts.
            blinkDetectorEAR.processEAR(features.vector[4], features.vector[5]);
        });
    }

    // Raw stream → heatmap (higher temporal fidelity, no fixation snap).
    gazeController.onRaw((x, y) => {
        if (currentMode === 'tracker') updateHeatmap(x, y);
    });

    // Snapped stream → visible cursor + mode-specific gaze position.
    // During fixations the centroid replaces raw filtered output, which
    // cuts jitter on small UI targets. Magnetic snap pulls the cursor
    // toward any nearby [data-gaze-target=true] element.
    gazeController.onSnapped((x, y, _state, nowMs) => {
        blinkDetector.updateGaze(x, y);
        blinkDetectorEAR.updateGaze(x, y);

        const candidate = computeSnap(x, y, 1.0);
        const strength = snapStrength.update(candidate.target, nowMs);
        const px = x + (candidate.x - x) * strength;
        const py = y + (candidate.y - y) * strength;

        if (currentMode === 'tracker') {
            gazeDot.style.left = `${px}px`;
            gazeDot.style.top = `${py}px`;
        } else if (currentMode === 'label' && labelMode) {
            labelMode.updateGazePosition(px, py);
        } else if (currentMode === 'video' && videoMode) {
            videoMode.updateGazePosition(px, py);
        }
    });

    // Dwell-click → synthetic 'gazeclick' CustomEvent on the target.
    // No consumers today (Control Mode lands in a later step); nothing
    // else listens for 'gazeclick', so firing is safe.
    gazeController.onDwellClick((ev) => {
        ev.target.dispatchEvent(new CustomEvent('gazeclick', { bubbles: true, detail: ev }));
    });

    function startGazeListener() {
        gazeDot.style.display = 'block';
        webgazerStarted = true;
        if (useFaceMesh) {
            blinkDetectorEAR.start();
            setFacemeshPreviewVisible(currentMode === 'tracker');
        } else {
            blinkDetector.start();
        }
        gazeController.reset();

        // FaceMesh engine already routes gaze through the controller; we
        // only need to register the WebGazer listener in legacy mode. The
        // blink detector's patch-variance method is WebGazer-specific and
        // is a no-op in FaceMesh mode (we can replace it with a FaceMesh
        // EAR-based detector later).
        if (useFaceMesh) return;

        webgazer.setGazeListener((data, _elapsedTime) => {
            if (data == null) return;
            gazeController.push(data.x, data.y, performance.now());
            if (data.eyeFeatures) {
                blinkDetector.processEyePatches(
                    data.eyeFeatures.left?.patch ?? null,
                    data.eyeFeatures.right?.patch ?? null
                );
            }
        });
    }
    
    function startCalibration() {
        calibrationClicks = 0;
        calibrationDotsContainer.style.display = 'block';
        heatmapContainer.style.display = 'none';
        // Hide mode toggle during calibration
        modeToggle.style.display = 'none';
        
        // Track click count per dot
        const dotClicks = new Map<HTMLDivElement, number>();
        let dotsCompleted = 0;
        
        calibrationDots.forEach(dot => {
            dotClicks.set(dot, 0);
            dot.style.backgroundColor = 'yellow';
            dot.textContent = '';
            dot.style.color = '#000';
            dot.style.fontSize = '12px';
            dot.style.display = 'flex';
            dot.style.justifyContent = 'center';
            dot.style.alignItems = 'center';
            dot.style.fontWeight = 'bold';
            
            dot.onclick = (e) => {
                // Manually feed this click to whichever engine is active.
                recordCalibrationSample(e.clientX, e.clientY);

                const count = (dotClicks.get(dot) || 0) + 1;
                dotClicks.set(dot, count);
                calibrationClicks++;
                
                // Visual progress: interpolate yellow → green
                const progress = count / CLICKS_PER_DOT;
                const r = Math.round(255 * (1 - progress));
                const g = Math.round(128 + 127 * progress);
                const b = 0;
                dot.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
                dot.textContent = `${count}/${CLICKS_PER_DOT}`;
                
                if (count >= CLICKS_PER_DOT) {
                    dot.style.backgroundColor = 'green';
                    dot.textContent = '✓';
                    dot.style.pointerEvents = 'none';
                    dotsCompleted++;
                    
                    if (dotsCompleted >= calibrationDots.length) {
                        // FaceMesh engine needs an explicit KRR fit against
                        // the accumulated samples; WebGazer fits online as
                        // samples arrive so there's nothing to do there.
                        if (useFaceMesh && facemeshEngine) {
                            const ok = facemeshEngine.refit();
                            if (!ok) {
                                alert(`Only ${facemeshEngine.sampleCount} samples captured — FaceMesh couldn't see your face on most clicks. Try re-calibrating with better lighting / face centered.`);
                                return;
                            }
                        }
                        calibrationDotsContainer.style.display = 'none';
                        heatmapContainer.style.display = 'block';
                        // Show mode toggle and correction controls after calibration
                        modeToggle.style.display = 'flex';
                        correctionControls.style.display = 'flex';
                        blinkLogContainer.style.display = 'flex';
                        alert(`Calibration complete! (${calibrationClicks} training samples collected)\n\nThe red dot will now follow your gaze.\n\nTip: Turn on "Click to Correct" at the bottom of the screen — click where you're actually looking to improve accuracy on the fly.`);
                        startGazeListener();
                        maybeOfferBenchmark();
                    }
                }
            };
        });
    }

    // ==================== Smooth-pursuit calibration ====================
    // 18 s of tracking a moving Lissajous target → ~500 samples. Fed into
    // whichever engine is active via recordCalibrationSample (same sink
    // the 9-dot flow uses); the FaceMesh engine refits its KRR at the end,
    // WebGazer accumulates samples online.
    function startSmoothPursuitCalibration() {
        // Hide UI chrome; the overlay covers everything anyway, but
        // hiding these avoids z-index fights on abort.
        heatmapContainer.style.display = 'none';
        modeToggle.style.display = 'none';
        correctionControls.style.display = 'none';
        blinkLogContainer.style.display = 'none';
        gazeDot.style.display = 'none';

        const runner = new SmoothPursuit(
            (x, y) => recordCalibrationSample(x, y),
            { durationMs: 18000, countdownMs: 3000 }
        );
        runner.start((result) => {
            const { accepted, rejected, aborted } = result;
            if (aborted) {
                // Restore chrome, leave model in whatever state it was in.
                heatmapContainer.style.display = webgazerStarted ? 'block' : 'none';
                modeToggle.style.display = 'flex';
                correctionControls.style.display = webgazerStarted ? 'flex' : 'none';
                blinkLogContainer.style.display = webgazerStarted ? 'flex' : 'none';
                gazeDot.style.display = webgazerStarted ? 'block' : 'none';
                return;
            }
            if (useFaceMesh && facemeshEngine) {
                const ok = facemeshEngine.refit();
                if (!ok) {
                    alert(
                        `Only ${accepted} samples captured (${rejected} skipped for blinks or missing face). ` +
                        `Need at least 20 to fit. Try re-calibrating with better lighting and face centered.`
                    );
                    return;
                }
            }
            heatmapContainer.style.display = 'block';
            modeToggle.style.display = 'flex';
            correctionControls.style.display = 'flex';
            blinkLogContainer.style.display = 'flex';
            alert(
                `Calibration complete! (${accepted} samples accepted, ${rejected} skipped)\n\n` +
                `The red dot will now follow your gaze. Enable "Click to Correct" for on-the-fly tuning.`
            );
            startGazeListener();
            maybeOfferBenchmark();
        });
    }

    function runCalibrationFlow() {
        if (useSmoothPursuit) {
            startSmoothPursuitCalibration();
        } else {
            startCalibration();
        }
    }

    // Run the coach first when enabled; otherwise straight to calibration.
    // Used by both first-time and re-calibration entry points so the user
    // gets the same framing check whenever they ask to calibrate.
    function runCoachedFlow() {
        if (useCoach && facemeshEngine) {
            const coach = new PositioningCoach(facemeshEngine);
            coach.start((r) => {
                if (!r.proceeded) return;
                runCalibrationFlow();
            });
        } else {
            runCalibrationFlow();
        }
    }

    // ==================== Dev-mode Benchmark ====================
    // 16-col × 8-row Z-pattern sweep, 3 s dwell per cell. Emits a CSV
    // (per-sample + per-cell summary + run metadata) plus a gazemap PNG.
    // Only offered when `import.meta.env.DEV` is true or `?dev=1` is set.
    function maybeOfferBenchmark() {
        if (!devMode || benchmark.isRunning) return;
        // Defer past the calibration-complete alert so the user actually sees
        // the prompt instead of it queuing behind the alert.
        setTimeout(() => {
            const totalCells = gridRows * gridCols;
            const totalSec = Math.round((totalCells * dwellMs) / 1000);
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            const dur = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            const ok = confirm(
                'Dev mode detected.\n\n' +
                `Run accuracy benchmark? (${gridCols}×${gridRows} grid, ${(dwellMs/1000).toFixed(1)} s per cell ≈ ${dur})\n\n` +
                'You will be asked to gaze at each highlighted cell in Z-order,' +
                ' left-to-right, top-to-bottom. You can abort at any time.'
            );
            if (!ok) return;
            // Hide heatmap + mode toggle + correction controls so the overlay
            // is unambiguous; the benchmark overlay itself covers everything.
            heatmapContainer.style.display = 'none';
            modeToggle.style.display = 'none';
            correctionControls.style.display = 'none';
            blinkLogContainer.style.display = 'none';
            gazeDot.style.display = 'none';
            benchmark.start((_result) => {
                // Restore chrome regardless of complete vs abort.
                heatmapContainer.style.display = 'block';
                modeToggle.style.display = 'flex';
                correctionControls.style.display = 'flex';
                blinkLogContainer.style.display = 'flex';
                gazeDot.style.display = 'block';
            });
        }, 200);
    }

    // ==================== Click-to-Correct Mode ====================
    function showCorrectionRipple(x: number, y: number) {
        const ripple = document.createElement('div');
        ripple.className = 'correction-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        document.body.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    }

    function handleCorrectionClick(e: MouseEvent) {
        if (!correctionMode || !webgazerStarted) return;
        // Ignore clicks on UI controls
        const target = e.target as HTMLElement;
        if (target.closest('#mode-toggle, #correction-controls, #heatmap-container, #calibration-instructions, button')) return;

        recordCalibrationSample(e.clientX, e.clientY);
        // FaceMesh KRR needs an explicit refit — WebGazer learns online.
        if (useFaceMesh && facemeshEngine) facemeshEngine.refit();
        correctionCount++;
        correctionCountSpan.textContent = `corrections: ${correctionCount}`;
        showCorrectionRipple(e.clientX, e.clientY);
    }

    toggleCorrectionBtn.onclick = () => {
        correctionMode = !correctionMode;
        toggleCorrectionBtn.classList.toggle('active', correctionMode);
        toggleCorrectionBtn.textContent = correctionMode
            ? '🎯 Click to Correct: ON'
            : '🎯 Click to Correct: OFF';

        if (correctionMode) {
            document.body.style.cursor = 'crosshair';
        } else {
            document.body.style.cursor = '';
        }
    };

    document.addEventListener('click', handleCorrectionClick);

    startCalibrationBtn.onclick = async () => {
        try {
            // If already calibrated, ask user whether to reset or accumulate
            if (webgazerStarted) {
                const reset = confirm(
                    '已有校準資料。\n\n' +
                    '按「確定」→ 清除舊資料，重新校準\n' +
                    '按「取消」→ 保留舊資料，追加校準'
                );
                if (reset) {
                    if (useFaceMesh && facemeshEngine) {
                        await facemeshEngine.clearData();
                    } else {
                        await webgazer.clearData();
                    }
                }
                gazeController.reset();
                initHeatmap();
                runCoachedFlow();
                return;
            }

            initHeatmap();
            if (useFaceMesh && facemeshEngine) {
                await facemeshEngine.begin();
                // Wire the engine's camera stream into our preview tile so
                // the user has visual confirmation the tracker sees them.
                // Hidden during calibration overlays; shown when tracker
                // mode is active.
                const preview = ensureFacemeshPreview();
                facemeshEngine.attachPreview(preview);
                if (!useSmoothPursuit) {
                    alert(
                        'FaceMesh engine ready!\n\n' +
                        'Click on each yellow dot while looking at it. The KRR model ' +
                        'fits after all dots are completed.'
                    );
                }
            } else {
                await webgazer.begin();
                webgazer.showVideoPreview(true);
                webgazer.showPredictionPoints(false);
                webgazer.applyKalmanFilter(true);
                // Prevent WebGazer from auto-learning on every click (we handle it explicitly in correction mode)
                webgazer.removeMouseEventListeners();
                if (!useSmoothPursuit) {
                    alert('Webgazer started! Please click on each yellow dot to calibrate.');
                }
            }
            runCoachedFlow();
        } catch (err: any) {
            console.error('Gaze engine error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert('Camera access was denied. Please allow camera access and try again.');
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                alert('No camera found. Please connect a webcam and try again.');
            } else {
                alert('Could not start gaze engine: ' + err.message);
            }
        }
    };
    
    initHeatmap();
};
