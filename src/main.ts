import './style.css';
import webgazer from 'webgazer';
import { LabelMode } from './labelMode';
import { VideoMode } from './videoMode';

let currentMode: 'tracker' | 'label' | 'video' = 'tracker';
let labelMode: LabelMode | null = null;
let videoMode: VideoMode | null = null;
let webgazerStarted = false;

const gazeHistory: { x: number; y: number }[] = [];
const SMOOTHING_FRAMES = 5;
const CLICKS_PER_DOT = 5;

function smoothGaze(rawX: number, rawY: number): { x: number; y: number } {
    gazeHistory.push({ x: rawX, y: rawY });
    if (gazeHistory.length > SMOOTHING_FRAMES) {
        gazeHistory.shift();
    }
    
    const avgX = gazeHistory.reduce((sum, p) => sum + p.x, 0) / gazeHistory.length;
    const avgY = gazeHistory.reduce((sum, p) => sum + p.y, 0) / gazeHistory.length;
    
    return { x: avgX, y: avgY };
}

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
        
        // Handle gaze dot and heatmap visibility
        if (mode === 'tracker') {
            if (webgazerStarted) {
                gazeDot.style.display = 'block';
                heatmapContainer.style.display = 'block';
                webgazer.showVideoPreview(true);
            }
        } else {
            gazeDot.style.display = 'none';
            heatmapContainer.style.display = 'none';
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

    function startGazeListener() {
        gazeDot.style.display = 'block';
        webgazerStarted = true;
        
        webgazer.setGazeListener((data, _elapsedTime) => {
            if (data == null) {
                return;
            }
            
            const smoothed = smoothGaze(data.x, data.y);
            const x = smoothed.x;
            const y = smoothed.y;
            
            if (currentMode === 'tracker') {
                gazeDot.style.left = `${x}px`;
                gazeDot.style.top = `${y}px`;
                updateHeatmap(x, y);
            } else if (currentMode === 'label' && labelMode) {
                labelMode.updateGazePosition(x, y);
            } else if (currentMode === 'video' && videoMode) {
                videoMode.updateGazePosition(x, y);
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
            
            dot.onclick = () => {
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
                        // Show mode toggle after calibration
                        modeToggle.style.display = 'flex';
                        alert(`Calibration complete! (${calibrationClicks} training samples collected)\n\nThe red dot will now follow your gaze.\nYou can now switch to Label Mode or Video Mode.`);
                        startGazeListener();
                    }
                }
            };
        });
    }

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
                gazeHistory.length = 0;
                initHeatmap();
                startCalibration();
                return;
            }

            initHeatmap();
            await webgazer.begin();
            webgazer.showVideoPreview(true);
            webgazer.showPredictionPoints(false);

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
