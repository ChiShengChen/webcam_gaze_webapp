import './style.css';
import webgazer from 'webgazer';

window.onload = function() {
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

    // Heatmap data - stores intensity values for each grid cell
    const GRID_SIZE = 50; // Number of cells in each dimension (higher = finer resolution)
    let heatmapData: number[][] = [];
    let isHeatmapVisible = true;

    // Initialize heatmap
    function initHeatmap() {
        // Set canvas resolution (higher for finer grid)
        heatmapCanvas.width = 400;
        heatmapCanvas.height = 225;
        
        // Initialize grid with zeros
        heatmapData = [];
        for (let i = 0; i < GRID_SIZE; i++) {
            heatmapData[i] = [];
            for (let j = 0; j < GRID_SIZE; j++) {
                heatmapData[i][j] = 0;
            }
        }
        
        drawHeatmap();
    }

    // Update heatmap with new gaze position
    function updateHeatmap(x: number, y: number) {
        if (!isHeatmapVisible) return;
        
        // Convert screen coordinates to grid coordinates
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        
        const gridX = Math.floor((x / screenWidth) * GRID_SIZE);
        const gridY = Math.floor((y / screenHeight) * GRID_SIZE);
        
        // Bounds check
        if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
            // Increase intensity at this position
            heatmapData[gridY][gridX] = Math.min(1, heatmapData[gridY][gridX] + 0.05);
            
            // Also slightly increase neighboring cells for smoother heatmap
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

    // Draw the heatmap on canvas
    function drawHeatmap() {
        const cellWidth = heatmapCanvas.width / GRID_SIZE;
        const cellHeight = heatmapCanvas.height / GRID_SIZE;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
        
        // Draw each cell
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const intensity = heatmapData[y][x];
                if (intensity > 0) {
                    // Color gradient: blue -> green -> yellow -> red
                    const color = getHeatmapColor(intensity);
                    ctx.fillStyle = color;
                    ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
                }
            }
        }
        
    }

    // Get color based on intensity (0-1)
    function getHeatmapColor(intensity: number): string {
        // Clamp intensity
        intensity = Math.max(0, Math.min(1, intensity));
        
        let r, g, b;
        
        if (intensity < 0.25) {
            // Blue to Cyan
            const t = intensity / 0.25;
            r = 0;
            g = Math.round(255 * t);
            b = 255;
        } else if (intensity < 0.5) {
            // Cyan to Green
            const t = (intensity - 0.25) / 0.25;
            r = 0;
            g = 255;
            b = Math.round(255 * (1 - t));
        } else if (intensity < 0.75) {
            // Green to Yellow
            const t = (intensity - 0.5) / 0.25;
            r = Math.round(255 * t);
            g = 255;
            b = 0;
        } else {
            // Yellow to Red
            const t = (intensity - 0.75) / 0.25;
            r = 255;
            g = Math.round(255 * (1 - t));
            b = 0;
        }
        
        return `rgba(${r}, ${g}, ${b}, 0.8)`;
    }

    // Toggle heatmap visibility
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

    // Clear heatmap data
    clearHeatmapBtn.onclick = () => {
        initHeatmap();
    };

    function startGazeListener() {
        gazeDot.style.display = 'block';
        webgazer.setGazeListener((data, _elapsedTime) => {
            if (data == null) {
                return;
            }
            gazeDot.style.left = `${data.x}px`;
            gazeDot.style.top = `${data.y}px`;
            
            // Update heatmap with gaze position
            updateHeatmap(data.x, data.y);
        });
    }
    
    function startCalibration() {
        calibrationClicks = 0;
        calibrationDotsContainer.style.display = 'block';
        
        // Hide heatmap during calibration
        heatmapContainer.style.display = 'none';
        
        calibrationDots.forEach(dot => {
            dot.style.backgroundColor = 'yellow';
            dot.onclick = () => {
                calibrationClicks++;
                dot.style.backgroundColor = 'green';
                if (calibrationClicks >= calibrationDots.length) {
                    calibrationDotsContainer.style.display = 'none';
                    // Show heatmap after calibration
                    heatmapContainer.style.display = 'block';
                    alert("Calibration complete! The red dot will now follow your gaze.");
                    startGazeListener();
                }
            };
        });
    }

    startCalibrationBtn.onclick = async () => {
        try {
            // Initialize heatmap
            initHeatmap();
            
            // Start webgazer
            await webgazer.begin();
            
            // Configure display options after begin
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
    
    // Initialize heatmap on page load (hidden state)
    initHeatmap();
};
