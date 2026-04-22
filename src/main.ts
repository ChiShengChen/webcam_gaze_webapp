import './style.css';
import webgazer from 'webgazer';
import { LabelMode } from './labelMode';
import { VideoMode } from './videoMode';
import { BlinkDetector } from './blinkDetector';
import { GazeController } from './control/controller';
import { computeSnap, SnapStrength } from './control/snapping';
import { Benchmark } from './benchmark/benchmark';

let currentMode: 'tracker' | 'label' | 'video' = 'tracker';
let labelMode: LabelMode | null = null;
let videoMode: VideoMode | null = null;
let webgazerStarted = false;
let correctionMode = false;
let correctionCount = 0;
const blinkDetector = new BlinkDetector();

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
const devMode =
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has('dev');
const benchmark = new Benchmark(gazeController, {
    rows: 8,
    cols: 16,
    dwellMs: 3000,
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
                webgazer.showVideoPreview(true);
            }
        } else {
            gazeDot.style.display = 'none';
            heatmapContainer.style.display = 'none';
            correctionControls.style.display = 'none';
            blinkLogContainer.style.display = 'none';
            if (webgazerStarted) {
                webgazer.showVideoPreview(false);
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

    // Register blink handler
    blinkDetector.onBlink((gazeX, gazeY) => {
        if (currentMode === 'tracker') {
            showBlinkMarker(gazeX, gazeY);
            addBlinkToLog(gazeX, gazeY);
        } else if (currentMode === 'label' && labelMode) {
            labelMode.triggerSegmentation();
        } else if (currentMode === 'video' && videoMode) {
            // Could be used for video bookmarking in the future
        }
    });

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
        blinkDetector.start();
        gazeController.reset();

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
                // Manually feed this click to WebGazer as training data
                webgazer.recordScreenPosition(e.clientX, e.clientY, 'click');

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

    // ==================== Dev-mode Benchmark ====================
    // 16-col × 8-row Z-pattern sweep, 3 s dwell per cell. Emits a CSV
    // (per-sample + per-cell summary + run metadata) plus a gazemap PNG.
    // Only offered when `import.meta.env.DEV` is true or `?dev=1` is set.
    function maybeOfferBenchmark() {
        if (!devMode || benchmark.isRunning) return;
        // Defer past the calibration-complete alert so the user actually sees
        // the prompt instead of it queuing behind the alert.
        setTimeout(() => {
            const ok = confirm(
                'Dev mode detected.\n\n' +
                'Run accuracy benchmark? (16×8 grid, 3 s per cell ≈ 6.4 min)\n\n' +
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

        webgazer.recordScreenPosition(e.clientX, e.clientY, 'click');
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
                    await webgazer.clearData();
                }
                gazeController.reset();
                initHeatmap();
                startCalibration();
                return;
            }

            initHeatmap();
            await webgazer.begin();
            webgazer.showVideoPreview(true);
            webgazer.showPredictionPoints(false);
            webgazer.applyKalmanFilter(true);
            // Prevent WebGazer from auto-learning on every click (we handle it explicitly in correction mode)
            webgazer.removeMouseEventListeners();

            alert('Webgazer started! Please click on each yellow dot to calibrate.');
            startCalibration();
        } catch (err: any) {
            console.error('Webgazer error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert('Camera access was denied. Please allow camera access and try again.');
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                alert('No camera found. Please connect a webcam and try again.');
            } else {
                alert('Could not start webgazer: ' + err.message);
            }
        }
    };
    
    initHeatmap();
};
