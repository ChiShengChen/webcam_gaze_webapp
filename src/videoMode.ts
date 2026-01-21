// Types
interface GazePoint {
    timestamp: number;      // Video timestamp in seconds
    frameNumber: number;    // Estimated frame number
    x: number;              // Gaze x position (relative to video, 0-1)
    y: number;              // Gaze y position (relative to video, 0-1)
    screenX: number;        // Absolute screen position
    screenY: number;        // Absolute screen position
}

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
        // Video upload
        const videoUpload = document.getElementById('video-upload') as HTMLInputElement;
        videoUpload.addEventListener('change', (e) => this.handleVideoUpload(e));
        
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
        
        // Enable play button
        (document.getElementById('video-play-btn') as HTMLButtonElement).disabled = false;
        
        // Reset state
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
    
    // Recording controls
    private startRecording(): void {
        if (!this.video.src) return;
        
        this.isRecording = true;
        this.isPaused = false;
        this.recordingStartTime = new Date();
        this.recordStartTimestamp = Date.now();
        
        // Start video playback
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
        
        if (this.isPaused) {
            this.video.pause();
            if (this.mediaRecorder?.state === 'recording') {
                this.mediaRecorder.pause();
            }
            this.stopTimer();
            (document.getElementById('video-pause-btn') as HTMLButtonElement).textContent = '▶ Resume';
        } else {
            this.video.play();
            if (this.mediaRecorder?.state === 'paused') {
                this.mediaRecorder.resume();
            }
            this.startTimer();
            (document.getElementById('video-pause-btn') as HTMLButtonElement).textContent = '⏸ Pause';
        }
    }
    
    private stopRecording(): void {
        this.isRecording = false;
        this.isPaused = false;
        this.recordingEndTime = new Date();
        
        // Stop video
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
        
        // Draw final timeline with gaze data
        this.drawTimeline();
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
            document.getElementById('record-time')!.textContent = this.formatTime(elapsed);
        }, 100);
    }
    
    private stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
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
    updateGazePosition(screenX: number, screenY: number): void {
        const rect = this.video.getBoundingClientRect();
        const x = screenX - rect.left;
        const y = screenY - rect.top;
        
        // Check if within video bounds
        if (x >= 0 && x < rect.width && y >= 0 && y < rect.height) {
            // Normalize to 0-1
            const normalizedX = x / rect.width;
            const normalizedY = y / rect.height;
            
            // Update cursor position
            this.gazeCursor.style.display = 'block';
            this.gazeCursor.style.left = `${x + this.video.offsetLeft}px`;
            this.gazeCursor.style.top = `${y + this.video.offsetTop}px`;
            
            // Update coordinates display
            document.getElementById('video-gaze-coords')!.textContent = 
                `Gaze: (${Math.round(normalizedX * this.videoWidth)}, ${Math.round(normalizedY * this.videoHeight)})`;
            
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
                
                // Draw gaze point on overlay
                this.drawGazePoint(x, y);
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
    
    // Check if video mode is active
    isVideoModeActive(): boolean {
        const videoMode = document.getElementById('video-mode');
        return videoMode?.style.display !== 'none';
    }
}
