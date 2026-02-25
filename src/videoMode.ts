import type { GazePoint, AOI, AnalysisResult } from './gazeAnalysis';
import { analyzeGazeData, analysisToCSV, getScanpathDrawingData } from './gazeAnalysis';

interface VideoAnnotation {
    videoName: string;
    videoDuration: number;
    videoWidth: number;
    videoHeight: number;
    frameRate: number;
    recordingStartTime: string;
    recordingEndTime: string;
    gazePoints: GazePoint[];
    hasAudio: boolean;
}

export class VideoMode {
    // DOM Elements
    private video: HTMLVideoElement;
    private gazeOverlay: HTMLCanvasElement;
    private gazeCursor: HTMLElement;
    private videoContainer: HTMLElement;
    private timelineCanvas: HTMLCanvasElement;
    private audioLevelCanvas: HTMLCanvasElement;
    
    // State
    private isRecording = false;
    private isPaused = false;
    private gazePoints: GazePoint[] = [];
    private recordingStartTime: Date | null = null;
    private recordingEndTime: Date | null = null;
    
    // Video info
    private videoName = '';
    private videoDuration = 0;
    private videoWidth = 0;
    private videoHeight = 0;
    private frameRate = 30; // Estimated
    
    // Audio recording
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private audioStream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private audioAnalyser: AnalyserNode | null = null;
    private audioDataArray: Uint8Array | null = null;
    
    // Timer
    private timerInterval: number | null = null;
    private recordStartTimestamp = 0;
    
    // Fullscreen
    private isFullscreen = false;
    private fullscreenFadeTimeout: number | null = null;
    
    // AOI state
    private aois: AOI[] = [];
    private nextAoiId = 1;
    private isDrawingAOI = false;
    private aoiDrawStart: { x: number; y: number } | null = null;
    private aoiDrawingCanvas: HTMLCanvasElement | null = null;
    
    // Analysis state
    private analysisResult: AnalysisResult | null = null;
    private showScanpath = false;
    
    constructor() {
        // Get DOM elements
        this.video = document.getElementById('annotation-video') as HTMLVideoElement;
        this.gazeOverlay = document.getElementById('video-gaze-overlay') as HTMLCanvasElement;
        this.gazeCursor = document.getElementById('video-gaze-cursor') as HTMLElement;
        this.videoContainer = document.getElementById('video-player-container') as HTMLElement;
        this.timelineCanvas = document.getElementById('timeline-canvas') as HTMLCanvasElement;
        this.audioLevelCanvas = document.getElementById('audio-level-canvas') as HTMLCanvasElement;
        
        this.setupEventListeners();
    }
    
    private setupEventListeners(): void {
        const videoUpload = document.getElementById('video-upload') as HTMLInputElement;
        videoUpload.addEventListener('change', (e) => {
            this.handleVideoUpload(e);
            const fileName = videoUpload.files?.[0]?.name || 'No file chosen';
            document.getElementById('video-upload-name')!.textContent = fileName;
        });
        
        // Microphone connection
        document.getElementById('connect-mic-btn')!.addEventListener('click', () => {
            this.connectMicrophone();
        });
        
        // Playback controls
        document.getElementById('video-play-btn')!.addEventListener('click', () => {
            this.startRecording();
        });
        
        document.getElementById('video-pause-btn')!.addEventListener('click', () => {
            this.pauseRecording();
        });
        
        document.getElementById('video-stop-btn')!.addEventListener('click', () => {
            this.stopRecording();
        });
        
        // Export buttons
        document.getElementById('export-video-annotation-btn')!.addEventListener('click', () => {
            this.exportAnnotation();
        });
        
        document.getElementById('export-video-audio-btn')!.addEventListener('click', () => {
            this.exportAudio();
        });
        
        document.getElementById('export-video-all-btn')!.addEventListener('click', () => {
            this.exportAll();
        });
        
        // Video events
        this.video.addEventListener('loadedmetadata', () => {
            this.onVideoLoaded();
        });
        
        this.video.addEventListener('timeupdate', () => {
            this.onVideoTimeUpdate();
        });
        
        this.video.addEventListener('ended', () => {
            this.stopRecording();
        });
        
        // Resize handler
        window.addEventListener('resize', () => {
            this.updateOverlaySize();
            this.updateAOIOverlaySize();
        });
        
        // Fullscreen controls
        document.getElementById('fullscreen-pause-btn')!.addEventListener('click', () => {
            this.pauseRecording();
        });
        
        document.getElementById('fullscreen-stop-btn')!.addEventListener('click', () => {
            this.stopRecording();
        });
        
        document.addEventListener('fullscreenchange', () => {
            this.isFullscreen = !!document.fullscreenElement;
            if (this.isFullscreen) {
                setTimeout(() => this.updateOverlaySize(), 100);
            } else {
                this.updateOverlaySize();
            }
        });
        
        this.videoContainer.addEventListener('mousemove', () => {
            this.resetFullscreenFade();
        });
        
        this.setupAOIListeners();
        this.setupAnalysisListeners();
    }
    
    private setupAOIListeners(): void {
        const drawBtn = document.getElementById('draw-aoi-btn') as HTMLButtonElement;
        const cancelBtn = document.getElementById('cancel-aoi-btn') as HTMLButtonElement;
        
        drawBtn.addEventListener('click', () => {
            if (this.isDrawingAOI) {
                this.cancelAOIDrawing();
            } else {
                this.startAOIDrawing();
            }
        });
        
        cancelBtn.addEventListener('click', () => this.cancelAOIDrawing());
    }
    
    private setupAnalysisListeners(): void {
        document.getElementById('run-analysis-btn')!.addEventListener('click', () => {
            this.runAnalysis();
        });
        
        document.getElementById('toggle-scanpath-btn')!.addEventListener('click', () => {
            this.toggleScanpath();
        });
        
        document.getElementById('export-analysis-btn')!.addEventListener('click', () => {
            this.exportAnalysis();
        });
    }
    
    // Video handling
    private handleVideoUpload(e: Event): void {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        
        this.videoName = file.name;
        const url = URL.createObjectURL(file);
        this.video.src = url;
        
        // Update UI
        this.videoContainer.classList.add('has-video');
        document.getElementById('video-info')!.classList.add('has-video');
        document.getElementById('video-info')!.innerHTML = `
            <div>File: ${file.name}</div>
            <div>Size: ${(file.size / 1024 / 1024).toFixed(2)} MB</div>
        `;
        
        (document.getElementById('video-play-btn') as HTMLButtonElement).disabled = false;
        (document.getElementById('draw-aoi-btn') as HTMLButtonElement).disabled = false;
        
        this.resetRecording();
    }
    
    private onVideoLoaded(): void {
        this.videoDuration = this.video.duration;
        this.videoWidth = this.video.videoWidth;
        this.videoHeight = this.video.videoHeight;
        
        // Estimate frame rate (default to 30 if not available)
        this.frameRate = 30;
        
        // Update UI
        document.getElementById('video-info')!.innerHTML += `
            <div>Duration: ${this.formatTime(this.videoDuration)}</div>
            <div>Resolution: ${this.videoWidth}x${this.videoHeight}</div>
        `;
        
        document.getElementById('session-video-name')!.textContent = this.videoName;
        document.getElementById('session-duration')!.textContent = this.formatTime(this.videoDuration);
        
        // Update overlay size
        this.updateOverlaySize();
        
        // Draw timeline
        this.drawTimeline();
    }
    
    private updateOverlaySize(): void {
        const rect = this.video.getBoundingClientRect();
        this.gazeOverlay.width = rect.width;
        this.gazeOverlay.height = rect.height;
        this.gazeOverlay.style.width = `${rect.width}px`;
        this.gazeOverlay.style.height = `${rect.height}px`;
        this.gazeOverlay.style.left = `${this.video.offsetLeft}px`;
        this.gazeOverlay.style.top = `${this.video.offsetTop}px`;
    }
    
    // Microphone handling
    private async connectMicrophone(): Promise<void> {
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Setup audio context for visualization
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            this.audioAnalyser = this.audioContext.createAnalyser();
            this.audioAnalyser.fftSize = 256;
            source.connect(this.audioAnalyser);
            
            this.audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
            
            // Start visualization
            this.startAudioVisualization();
            
            // Update UI
            const micStatus = document.getElementById('mic-status')!;
            micStatus.textContent = 'Microphone: Connected';
            micStatus.classList.add('connected');
            
            (document.getElementById('connect-mic-btn') as HTMLButtonElement).textContent = 'Microphone Connected';
            (document.getElementById('connect-mic-btn') as HTMLButtonElement).disabled = true;
            
        } catch (error) {
            console.error('Failed to connect microphone:', error);
            const micStatus = document.getElementById('mic-status')!;
            micStatus.textContent = 'Microphone: Error - ' + (error as Error).message;
            micStatus.classList.add('error');
        }
    }
    
    private startAudioVisualization(): void {
        const canvas = this.audioLevelCanvas;
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        const draw = () => {
            requestAnimationFrame(draw);
            
            if (!this.audioAnalyser || !this.audioDataArray) return;
            
            this.audioAnalyser.getByteFrequencyData(this.audioDataArray as Uint8Array<ArrayBuffer>);
            
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, width, height);
            
            const barWidth = width / this.audioDataArray.length;
            let x = 0;
            
            for (let i = 0; i < this.audioDataArray.length; i++) {
                const barHeight = (this.audioDataArray[i] / 255) * height;
                
                // Color based on level
                const hue = 120 - (this.audioDataArray[i] / 255) * 120; // Green to red
                ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
                
                ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
                x += barWidth;
            }
        };
        
        draw();
    }
    
    private startRecording(): void {
        if (!this.video.src) return;
        
        this.isRecording = true;
        this.isPaused = false;
        this.recordingStartTime = new Date();
        this.recordStartTimestamp = Date.now();
        
        this.enterFullscreen();
        
        this.video.play();
        
        // Start audio recording if microphone is connected
        if (this.audioStream) {
            this.mediaRecorder = new MediaRecorder(this.audioStream);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };
            
            this.mediaRecorder.start(100); // Collect data every 100ms
        }
        
        // Start timer
        this.startTimer();
        
        // Update UI
        this.updateRecordingUI(true);
        
        (document.getElementById('video-play-btn') as HTMLButtonElement).disabled = true;
        (document.getElementById('video-pause-btn') as HTMLButtonElement).disabled = false;
        (document.getElementById('video-stop-btn') as HTMLButtonElement).disabled = false;
    }
    
    private pauseRecording(): void {
        if (!this.isRecording) return;
        
        this.isPaused = !this.isPaused;
        
        const fsPauseBtn = document.getElementById('fullscreen-pause-btn') as HTMLButtonElement;
        
        if (this.isPaused) {
            this.video.pause();
            if (this.mediaRecorder?.state === 'recording') {
                this.mediaRecorder.pause();
            }
            this.stopTimer();
            (document.getElementById('video-pause-btn') as HTMLButtonElement).textContent = '▶ Resume';
            if (fsPauseBtn) fsPauseBtn.textContent = '▶ Resume';
        } else {
            this.video.play();
            if (this.mediaRecorder?.state === 'paused') {
                this.mediaRecorder.resume();
            }
            this.startTimer();
            (document.getElementById('video-pause-btn') as HTMLButtonElement).textContent = '⏸ Pause';
            if (fsPauseBtn) fsPauseBtn.textContent = '⏸ Pause';
        }
    }
    
    private stopRecording(): void {
        this.isRecording = false;
        this.isPaused = false;
        this.recordingEndTime = new Date();
        
        this.exitFullscreen();
        
        this.video.pause();
        
        // Stop audio recording
        if (this.mediaRecorder?.state !== 'inactive') {
            this.mediaRecorder?.stop();
        }
        
        // Stop timer
        this.stopTimer();
        
        // Update UI
        this.updateRecordingUI(false);
        
        (document.getElementById('video-play-btn') as HTMLButtonElement).disabled = false;
        (document.getElementById('video-pause-btn') as HTMLButtonElement).disabled = true;
        (document.getElementById('video-stop-btn') as HTMLButtonElement).disabled = true;
        (document.getElementById('video-pause-btn') as HTMLButtonElement).textContent = '⏸ Pause';
        
        // Enable export buttons
        (document.getElementById('export-video-annotation-btn') as HTMLButtonElement).disabled = false;
        if (this.audioChunks.length > 0) {
            (document.getElementById('export-video-audio-btn') as HTMLButtonElement).disabled = false;
            document.getElementById('session-audio-status')!.textContent = 'Recorded';
        }
        (document.getElementById('export-video-all-btn') as HTMLButtonElement).disabled = false;
        
        this.drawTimeline();
        this.updateAnalysisButtons();
    }
    
    private resetRecording(): void {
        this.gazePoints = [];
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.recordingEndTime = null;
        
        document.getElementById('session-gaze-count')!.textContent = '0';
        document.getElementById('gaze-point-count')!.textContent = 'Points recorded: 0';
        document.getElementById('session-audio-status')!.textContent = 'Not recorded';
        
        // Disable export buttons
        (document.getElementById('export-video-annotation-btn') as HTMLButtonElement).disabled = true;
        (document.getElementById('export-video-audio-btn') as HTMLButtonElement).disabled = true;
        (document.getElementById('export-video-all-btn') as HTMLButtonElement).disabled = true;
    }
    
    private updateRecordingUI(isRecording: boolean): void {
        const indicator = document.getElementById('record-indicator')!;
        if (isRecording) {
            indicator.textContent = '● Recording';
            indicator.classList.add('recording');
        } else {
            indicator.textContent = '● Ready';
            indicator.classList.remove('recording');
        }
    }
    
    // Timer
    private startTimer(): void {
        this.timerInterval = window.setInterval(() => {
            const elapsed = (Date.now() - this.recordStartTimestamp) / 1000;
            const formatted = this.formatTime(elapsed);
            document.getElementById('record-time')!.textContent = formatted;
            
            const fsTime = document.getElementById('fullscreen-time');
            if (fsTime) fsTime.textContent = formatted;
        }, 100);
    }
    
    private stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    private resetFullscreenFade(): void {
        const controls = document.getElementById('fullscreen-controls');
        if (!controls) return;
        
        controls.classList.remove('faded');
        
        if (this.fullscreenFadeTimeout) {
            clearTimeout(this.fullscreenFadeTimeout);
        }
        
        if (this.isFullscreen && this.isRecording) {
            this.fullscreenFadeTimeout = window.setTimeout(() => {
                controls.classList.add('faded');
            }, 3000);
        }
    }
    
    private async enterFullscreen(): Promise<void> {
        try {
            await this.videoContainer.requestFullscreen();
            this.isFullscreen = true;
        } catch (err) {
            console.warn('Fullscreen request denied:', err);
        }
    }
    
    private async exitFullscreen(): Promise<void> {
        if (document.fullscreenElement) {
            try {
                await document.exitFullscreen();
            } catch (err) {
                console.warn('Exit fullscreen failed:', err);
            }
        }
        this.isFullscreen = false;
    }
    
    private formatTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    
    // Video time update
    private onVideoTimeUpdate(): void {
        // Update frame info
        const currentTime = this.video.currentTime;
        const frameNumber = Math.floor(currentTime * this.frameRate);
        document.getElementById('video-frame-info')!.textContent = `Frame: ${frameNumber}`;
        
        // Draw timeline progress
        this.drawTimelineProgress(currentTime);
    }
    
    // Gaze tracking integration
    private getVideoContentRect(): { left: number; top: number; width: number; height: number } {
        const rect = this.video.getBoundingClientRect();
        
        if (!this.isFullscreen || !this.videoWidth || !this.videoHeight) {
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        }
        
        const videoAspect = this.videoWidth / this.videoHeight;
        const containerAspect = rect.width / rect.height;
        
        let contentWidth: number, contentHeight: number, offsetX: number, offsetY: number;
        
        if (videoAspect > containerAspect) {
            contentWidth = rect.width;
            contentHeight = rect.width / videoAspect;
            offsetX = 0;
            offsetY = (rect.height - contentHeight) / 2;
        } else {
            contentHeight = rect.height;
            contentWidth = rect.height * videoAspect;
            offsetX = (rect.width - contentWidth) / 2;
            offsetY = 0;
        }
        
        return {
            left: rect.left + offsetX,
            top: rect.top + offsetY,
            width: contentWidth,
            height: contentHeight
        };
    }
    
    updateGazePosition(screenX: number, screenY: number): void {
        const contentRect = this.getVideoContentRect();
        const x = screenX - contentRect.left;
        const y = screenY - contentRect.top;
        
        if (x >= 0 && x < contentRect.width && y >= 0 && y < contentRect.height) {
            const normalizedX = x / contentRect.width;
            const normalizedY = y / contentRect.height;
            
            this.gazeCursor.style.display = 'block';
            if (this.isFullscreen) {
                this.gazeCursor.style.left = `${screenX}px`;
                this.gazeCursor.style.top = `${screenY}px`;
                this.gazeCursor.style.position = 'fixed';
            } else {
                this.gazeCursor.style.left = `${x + this.video.offsetLeft}px`;
                this.gazeCursor.style.top = `${y + this.video.offsetTop}px`;
                this.gazeCursor.style.position = 'absolute';
            }
            
            const gazeText = `Gaze: (${Math.round(normalizedX * this.videoWidth)}, ${Math.round(normalizedY * this.videoHeight)})`;
            document.getElementById('video-gaze-coords')!.textContent = gazeText;
            
            const fsGazeInfo = document.getElementById('fullscreen-gaze-info');
            if (fsGazeInfo) fsGazeInfo.textContent = gazeText;
            
            // Record gaze point if recording
            if (this.isRecording && !this.isPaused) {
                const gazePoint: GazePoint = {
                    timestamp: this.video.currentTime,
                    frameNumber: Math.floor(this.video.currentTime * this.frameRate),
                    x: normalizedX,
                    y: normalizedY,
                    screenX,
                    screenY
                };
                
                this.gazePoints.push(gazePoint);
                
                // Update UI
                document.getElementById('gaze-point-count')!.textContent = `Points recorded: ${this.gazePoints.length}`;
                document.getElementById('session-gaze-count')!.textContent = this.gazePoints.length.toString();
                
                this.drawGazePoint(normalizedX * this.gazeOverlay.width, normalizedY * this.gazeOverlay.height);
            }
        } else {
            this.gazeCursor.style.display = 'none';
        }
    }
    
    private drawGazePoint(x: number, y: number): void {
        const ctx = this.gazeOverlay.getContext('2d')!;
        
        // Draw a small dot
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 152, 0, 0.5)';
        ctx.fill();
    }
    
    // Timeline drawing
    private drawTimeline(): void {
        const canvas = this.timelineCanvas;
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        // Clear
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, width, height);
        
        if (this.videoDuration === 0) return;
        
        // Draw gaze density
        if (this.gazePoints.length > 0) {
            const buckets = 100;
            const bucketWidth = width / buckets;
            const density = new Array(buckets).fill(0);
            
            for (const point of this.gazePoints) {
                const bucketIndex = Math.floor((point.timestamp / this.videoDuration) * buckets);
                if (bucketIndex >= 0 && bucketIndex < buckets) {
                    density[bucketIndex]++;
                }
            }
            
            const maxDensity = Math.max(...density, 1);
            
            for (let i = 0; i < buckets; i++) {
                const barHeight = (density[i] / maxDensity) * height * 0.8;
                ctx.fillStyle = `rgba(255, 152, 0, ${0.3 + (density[i] / maxDensity) * 0.7})`;
                ctx.fillRect(i * bucketWidth, height - barHeight, bucketWidth - 1, barHeight);
            }
        }
        
        // Draw time markers
        ctx.fillStyle = '#666';
        ctx.font = '10px monospace';
        const markerCount = 10;
        for (let i = 0; i <= markerCount; i++) {
            const x = (i / markerCount) * width;
            const time = (i / markerCount) * this.videoDuration;
            ctx.fillText(this.formatTime(time), x, 12);
        }
    }
    
    private drawTimelineProgress(currentTime: number): void {
        const canvas = this.timelineCanvas;
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width;
        const height = canvas.height;
        
        // Redraw timeline
        this.drawTimeline();
        
        // Draw progress indicator
        const x = (currentTime / this.videoDuration) * width;
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    
    // Export functions
    private exportAnnotation(): void {
        const annotation: VideoAnnotation = {
            videoName: this.videoName,
            videoDuration: this.videoDuration,
            videoWidth: this.videoWidth,
            videoHeight: this.videoHeight,
            frameRate: this.frameRate,
            recordingStartTime: this.recordingStartTime?.toISOString() || '',
            recordingEndTime: this.recordingEndTime?.toISOString() || '',
            gazePoints: this.gazePoints,
            hasAudio: this.audioChunks.length > 0
        };
        
        const blob = new Blob([JSON.stringify(annotation, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, `${this.videoName}_gaze_annotation.json`);
    }
    
    private exportAudio(): void {
        if (this.audioChunks.length === 0) return;
        
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.downloadBlob(blob, `${this.videoName}_audio.webm`);
    }
    
    private async exportAll(): Promise<void> {
        // For simplicity, just export both files separately
        // A full implementation would use JSZip to create a ZIP file
        this.exportAnnotation();
        
        if (this.audioChunks.length > 0) {
            setTimeout(() => this.exportAudio(), 500);
        }
    }
    
    private downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    isVideoModeActive(): boolean {
        const videoMode = document.getElementById('video-mode');
        return videoMode?.style.display !== 'none';
    }
    
    private createAOIOverlay(): void {
        if (this.aoiDrawingCanvas) return;
        
        this.aoiDrawingCanvas = document.createElement('canvas');
        this.aoiDrawingCanvas.id = 'aoi-drawing-overlay';
        this.videoContainer.appendChild(this.aoiDrawingCanvas);
        this.updateAOIOverlaySize();
        
        this.aoiDrawingCanvas.addEventListener('mousedown', (e) => this.onAOIMouseDown(e));
        this.aoiDrawingCanvas.addEventListener('mousemove', (e) => this.onAOIMouseMove(e));
        this.aoiDrawingCanvas.addEventListener('mouseup', (e) => this.onAOIMouseUp(e));
    }
    
    private updateAOIOverlaySize(): void {
        if (!this.aoiDrawingCanvas) return;
        
        const rect = this.video.getBoundingClientRect();
        this.aoiDrawingCanvas.width = rect.width;
        this.aoiDrawingCanvas.height = rect.height;
        this.aoiDrawingCanvas.style.width = `${rect.width}px`;
        this.aoiDrawingCanvas.style.height = `${rect.height}px`;
        this.aoiDrawingCanvas.style.position = 'absolute';
        this.aoiDrawingCanvas.style.left = `${this.video.offsetLeft}px`;
        this.aoiDrawingCanvas.style.top = `${this.video.offsetTop}px`;
        
        this.drawAOIs();
    }
    
    private startAOIDrawing(): void {
        const nameInput = document.getElementById('aoi-name-input') as HTMLInputElement;
        if (!nameInput.value.trim()) {
            alert('Please enter an AOI name first');
            return;
        }
        
        this.createAOIOverlay();
        this.isDrawingAOI = true;
        this.aoiDrawingCanvas!.classList.add('drawing');
        
        const drawBtn = document.getElementById('draw-aoi-btn') as HTMLButtonElement;
        const cancelBtn = document.getElementById('cancel-aoi-btn') as HTMLButtonElement;
        drawBtn.textContent = 'Drawing...';
        drawBtn.classList.add('drawing');
        cancelBtn.style.display = 'block';
    }
    
    private cancelAOIDrawing(): void {
        this.isDrawingAOI = false;
        this.aoiDrawStart = null;
        
        if (this.aoiDrawingCanvas) {
            this.aoiDrawingCanvas.classList.remove('drawing');
        }
        
        const drawBtn = document.getElementById('draw-aoi-btn') as HTMLButtonElement;
        const cancelBtn = document.getElementById('cancel-aoi-btn') as HTMLButtonElement;
        drawBtn.textContent = 'Draw Rectangle';
        drawBtn.classList.remove('drawing');
        cancelBtn.style.display = 'none';
        
        this.drawAOIs();
    }
    
    private onAOIMouseDown(e: MouseEvent): void {
        if (!this.isDrawingAOI) return;
        
        const rect = this.aoiDrawingCanvas!.getBoundingClientRect();
        this.aoiDrawStart = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    }
    
    private onAOIMouseMove(e: MouseEvent): void {
        if (!this.isDrawingAOI || !this.aoiDrawStart) return;
        
        const rect = this.aoiDrawingCanvas!.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) / rect.width;
        const currentY = (e.clientY - rect.top) / rect.height;
        
        this.drawAOIs();
        this.drawTempAOI(this.aoiDrawStart.x, this.aoiDrawStart.y, currentX, currentY);
    }
    
    private onAOIMouseUp(e: MouseEvent): void {
        if (!this.isDrawingAOI || !this.aoiDrawStart) return;
        
        const rect = this.aoiDrawingCanvas!.getBoundingClientRect();
        const endX = (e.clientX - rect.left) / rect.width;
        const endY = (e.clientY - rect.top) / rect.height;
        
        const minX = Math.min(this.aoiDrawStart.x, endX);
        const minY = Math.min(this.aoiDrawStart.y, endY);
        const width = Math.abs(endX - this.aoiDrawStart.x);
        const height = Math.abs(endY - this.aoiDrawStart.y);
        
        if (width > 0.01 && height > 0.01) {
            const nameInput = document.getElementById('aoi-name-input') as HTMLInputElement;
            const colorInput = document.getElementById('aoi-color-input') as HTMLInputElement;
            
            const aoi: AOI = {
                id: `aoi-${this.nextAoiId++}`,
                name: nameInput.value.trim(),
                color: colorInput.value,
                bounds: { x: minX, y: minY, width, height }
            };
            
            this.aois.push(aoi);
            nameInput.value = '';
            this.updateAOIList();
            this.updateAnalysisButtons();
        }
        
        this.cancelAOIDrawing();
    }
    
    private drawTempAOI(x1: number, y1: number, x2: number, y2: number): void {
        if (!this.aoiDrawingCanvas) return;
        
        const ctx = this.aoiDrawingCanvas.getContext('2d')!;
        const w = this.aoiDrawingCanvas.width;
        const h = this.aoiDrawingCanvas.height;
        
        const colorInput = document.getElementById('aoi-color-input') as HTMLInputElement;
        
        ctx.strokeStyle = colorInput.value;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
            Math.min(x1, x2) * w,
            Math.min(y1, y2) * h,
            Math.abs(x2 - x1) * w,
            Math.abs(y2 - y1) * h
        );
        ctx.setLineDash([]);
    }
    
    private drawAOIs(): void {
        if (!this.aoiDrawingCanvas) return;
        
        const ctx = this.aoiDrawingCanvas.getContext('2d')!;
        const w = this.aoiDrawingCanvas.width;
        const h = this.aoiDrawingCanvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        for (const aoi of this.aois) {
            const x = aoi.bounds.x * w;
            const y = aoi.bounds.y * h;
            const width = aoi.bounds.width * w;
            const height = aoi.bounds.height * h;
            
            ctx.fillStyle = aoi.color + '20';
            ctx.fillRect(x, y, width, height);
            
            ctx.strokeStyle = aoi.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);
            
            ctx.fillStyle = aoi.color;
            ctx.font = '12px sans-serif';
            ctx.fillText(aoi.name, x + 4, y + 14);
        }
        
        if (this.showScanpath && this.analysisResult) {
            this.drawScanpathVisualization();
        }
    }
    
    private updateAOIList(): void {
        const listEl = document.getElementById('aoi-list')!;
        listEl.innerHTML = this.aois.map(aoi => `
            <div class="aoi-item" data-id="${aoi.id}">
                <div class="aoi-color" style="background-color: ${aoi.color}"></div>
                <span class="aoi-name">${aoi.name}</span>
                <button class="aoi-delete" data-id="${aoi.id}">X</button>
            </div>
        `).join('');
        
        listEl.querySelectorAll('.aoi-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id')!;
                this.deleteAOI(id);
            });
        });
    }
    
    private deleteAOI(id: string): void {
        this.aois = this.aois.filter(a => a.id !== id);
        this.updateAOIList();
        this.updateAnalysisButtons();
        this.drawAOIs();
    }
    
    private updateAnalysisButtons(): void {
        const hasData = this.gazePoints.length > 0;
        const drawBtn = document.getElementById('draw-aoi-btn') as HTMLButtonElement;
        const runBtn = document.getElementById('run-analysis-btn') as HTMLButtonElement;
        const exportBtn = document.getElementById('export-analysis-btn') as HTMLButtonElement;
        
        drawBtn.disabled = !this.video.src;
        runBtn.disabled = !hasData;
        exportBtn.disabled = !this.analysisResult;
    }
    
    private runAnalysis(): void {
        if (this.gazePoints.length === 0) {
            alert('No gaze data recorded. Please record a session first.');
            return;
        }
        
        const dispersionInput = document.getElementById('dispersion-threshold') as HTMLInputElement;
        const minDurationInput = document.getElementById('min-fixation-duration') as HTMLInputElement;
        
        this.analysisResult = analyzeGazeData(this.gazePoints, this.aois, {
            dispersionThreshold: parseFloat(dispersionInput.value),
            minFixationDuration: parseInt(minDurationInput.value),
            videoStartTime: 0
        });
        
        this.displayAnalysisResults();
        this.updateAnalysisButtons();
        
        const toggleBtn = document.getElementById('toggle-scanpath-btn') as HTMLButtonElement;
        toggleBtn.disabled = false;
    }
    
    private displayAnalysisResults(): void {
        if (!this.analysisResult) return;
        
        const resultsDiv = document.getElementById('analysis-results')!;
        resultsDiv.style.display = 'block';
        
        const { fixations, dwellTimeStats, scanpathMetrics, firstFixationMetrics } = this.analysisResult;
        
        document.getElementById('fixation-summary')!.innerHTML = `
            <div class="stat-row">
                <span>Total Fixations:</span>
                <span class="stat-value">${fixations.length}</span>
            </div>
            <div class="stat-row">
                <span>Total Duration:</span>
                <span class="stat-value">${(scanpathMetrics.totalDuration / 1000).toFixed(2)}s</span>
            </div>
            <div class="stat-row">
                <span>Mean Fixation:</span>
                <span class="stat-value">${scanpathMetrics.meanFixationDuration.toFixed(0)}ms</span>
            </div>
        `;
        
        document.getElementById('dwell-time-table')!.innerHTML = `
            <table class="analysis-table">
                <thead>
                    <tr><th>AOI</th><th>Dwell (ms)</th><th>Count</th><th>%</th></tr>
                </thead>
                <tbody>
                    ${dwellTimeStats.map(d => `
                        <tr>
                            <td>${d.aoiName}</td>
                            <td>${d.totalDwellTime.toFixed(0)}</td>
                            <td>${d.fixationCount}</td>
                            <td>${d.percentOfTotal.toFixed(1)}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('first-fixation-table')!.innerHTML = `
            <table class="analysis-table">
                <thead>
                    <tr><th>AOI</th><th>TTFF (ms)</th><th>Duration</th><th>Entries</th></tr>
                </thead>
                <tbody>
                    ${firstFixationMetrics.map(f => `
                        <tr>
                            <td>${f.aoiName}</td>
                            <td>${f.timeToFirstFixation !== null ? f.timeToFirstFixation.toFixed(0) : 'N/A'}</td>
                            <td>${f.firstFixationDuration !== null ? f.firstFixationDuration.toFixed(0) : 'N/A'}</td>
                            <td>${f.entryCount}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('scanpath-metrics')!.innerHTML = `
            <div class="metric-row">
                <span class="metric-label">Path Length:</span>
                <span class="metric-value">${scanpathMetrics.totalLength.toFixed(3)}</span>
            </div>
            <div class="metric-row">
                <span class="metric-label">Mean Saccade:</span>
                <span class="metric-value">${scanpathMetrics.meanSaccadeAmplitude.toFixed(4)}</span>
            </div>
            <div class="aoi-sequence">
                <strong>AOI Sequence:</strong><br>
                ${scanpathMetrics.aoiSequence.join(' → ') || 'No AOI visits'}
            </div>
        `;
    }
    
    private toggleScanpath(): void {
        this.showScanpath = !this.showScanpath;
        
        const btn = document.getElementById('toggle-scanpath-btn') as HTMLButtonElement;
        btn.textContent = this.showScanpath ? 'Hide Scanpath' : 'Show Scanpath';
        btn.classList.toggle('active', this.showScanpath);
        
        this.createAOIOverlay();
        this.drawAOIs();
    }
    
    private drawScanpathVisualization(): void {
        if (!this.analysisResult || !this.aoiDrawingCanvas) return;
        
        const ctx = this.aoiDrawingCanvas.getContext('2d')!;
        const w = this.aoiDrawingCanvas.width;
        const h = this.aoiDrawingCanvas.height;
        
        const { circles, lines } = getScanpathDrawingData(this.analysisResult.fixations);
        
        ctx.strokeStyle = 'rgba(255, 152, 0, 0.6)';
        ctx.lineWidth = 2;
        for (const line of lines) {
            ctx.beginPath();
            ctx.moveTo(line.x1 * w, line.y1 * h);
            ctx.lineTo(line.x2 * w, line.y2 * h);
            ctx.stroke();
        }
        
        for (const circle of circles) {
            ctx.beginPath();
            ctx.arc(circle.x * w, circle.y * h, circle.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 152, 0, 0.4)';
            ctx.fill();
            ctx.strokeStyle = '#ff9800';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.fillStyle = '#fff';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(circle.id.toString(), circle.x * w, circle.y * h);
        }
    }
    
    private exportAnalysis(): void {
        if (!this.analysisResult) return;
        
        const csvData = analysisToCSV(this.analysisResult, this.aois);
        
        this.downloadText(csvData.fixationsCSV, `${this.videoName}_fixations.csv`);
        setTimeout(() => this.downloadText(csvData.dwellTimeCSV, `${this.videoName}_dwell_time.csv`), 200);
        setTimeout(() => this.downloadText(csvData.firstFixationCSV, `${this.videoName}_first_fixation.csv`), 400);
        setTimeout(() => this.downloadText(csvData.scanpathCSV, `${this.videoName}_scanpath.csv`), 600);
    }
    
    private downloadText(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'text/csv' });
        this.downloadBlob(blob, filename);
    }
}
