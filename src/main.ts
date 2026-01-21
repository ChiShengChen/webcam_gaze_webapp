import './style.css';
import webgazer from 'webgazer';

window.onload = function() {
    const gazeDot = document.getElementById('gaze-dot')!;
    const startCalibrationBtn = document.getElementById('start-calibration')!;
    const calibrationDotsContainer = document.getElementById('calibration-dots')!;
    const calibrationDots = document.querySelectorAll<HTMLDivElement>('.calibration-dot');
    let calibrationClicks = 0;

    function startGazeListener() {
        gazeDot.style.display = 'block';
        webgazer.setGazeListener((data, _elapsedTime) => {
            if (data == null) {
                return;
            }
            gazeDot.style.left = `${data.x}px`;
            gazeDot.style.top = `${data.y}px`;
        });
    }
    
    function startCalibration() {
        calibrationClicks = 0;
        calibrationDotsContainer.style.display = 'block';
        
        calibrationDots.forEach(dot => {
            dot.style.backgroundColor = 'yellow';
            dot.onclick = () => {
                calibrationClicks++;
                dot.style.backgroundColor = 'green';
                if (calibrationClicks >= calibrationDots.length) {
                    calibrationDotsContainer.style.display = 'none';
                    alert("Calibration complete! The red dot will now follow your gaze.");
                    startGazeListener();
                }
            };
        });
    }

    startCalibrationBtn.onclick = async () => {
        try {
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
};
