import './style.css';
import webgazer from 'webgazer';
import { LabelMode } from './labelMode';

// Current mode
let currentMode: 'tracker' | 'label' = 'tracker';
let labelMode: LabelMode | null = null;
let webgazerStarted = false;

window.onload = function() {
    // Mode toggle elements
    const modeToggle = document.getElementById('mode-toggle')!;
    const trackerModeBtn = document.getElementById('tracker-mode-btn')!;
    const labelModeBtn = document.getElementById('label-mode-btn')!;
    const trackerModeContainer = document.getElementById('tracker-mode')!;
    const labelModeContainer = document.getElementById('label-mode')!;
    
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
    function switchMode(mode: 'tracker' | 'label') {
        currentMode = mode;
        
        // Update button states
        trackerModeBtn.classList.toggle('active', mode === 'tracker');
        labelModeBtn.classList.toggle('active', mode === 'label');
        
        // Show/hide containers
        trackerModeContainer.style.display = mode === 'tracker' ? 'block' : 'none';
        labelModeContainer.style.display = mode === 'label' ? 'block' : 'none';
        
        // Hide gaze dot and heatmap in label mode (we use different cursor)
        if (mode === 'label') {
            gazeDot.style.display = 'none';
            heatmapContainer.style.display = 'none';
            // Hide webgazer video preview in label mode
            if (webgazerStarted) {
                webgazer.showVideoPreview(false);
            }
        } else if (webgazerStarted) {
            gazeDot.style.display = 'block';
            heatmapContainer.style.display = 'block';
            // Show webgazer video preview in tracker mode
            webgazer.showVideoPreview(true);
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

    // ==================== Gaze Tracking ====================
    function startGazeListener() {
        gazeDot.style.display = 'block';
        webgazerStarted = true;
        
        webgazer.setGazeListener((data, _elapsedTime) => {
            if (data == null) {
                return;
            }
            
            // Always track gaze position
            const x = data.x;
            const y = data.y;
            
            if (currentMode === 'tracker') {
                // Update gaze dot position
                gazeDot.style.left = `${x}px`;
                gazeDot.style.top = `${y}px`;
                
                // Update heatmap
                updateHeatmap(x, y);
            } else if (currentMode === 'label' && labelMode) {
                // Update label mode gaze cursor
                labelMode.updateGazePosition(x, y);
            }
        });
    }
    
    function startCalibration() {
        calibrationClicks = 0;
        calibrationDotsContainer.style.display = 'block';
        heatmapContainer.style.display = 'none';
        // Hide mode toggle during calibration
        modeToggle.style.display = 'none';
        
        calibrationDots.forEach(dot => {
            dot.style.backgroundColor = 'yellow';
            dot.onclick = () => {
                calibrationClicks++;
                dot.style.backgroundColor = 'green';
                if (calibrationClicks >= calibrationDots.length) {
                    calibrationDotsContainer.style.display = 'none';
                    heatmapContainer.style.display = 'block';
                    // Show mode toggle after calibration
                    modeToggle.style.display = 'flex';
                    alert("Calibration complete! The red dot will now follow your gaze.\n\nYou can now switch to Label Mode to use gaze-based image labeling.");
                    startGazeListener();
                }
            };
        });
    }

    startCalibrationBtn.onclick = async () => {
        try {
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
    
    // Initialize
    initHeatmap();
};
