/**
 * Thin wrapper around getUserMedia with sensible defaults for gaze tracking.
 *
 * We prefer 1280x720 at 30 fps: iris width scales with resolution and is the
 * accuracy ceiling for iris localization. Lower resolutions cost accuracy;
 * higher resolutions cost CPU without marketable gain at webcam quality.
 */

export interface CameraConfig {
    width: number;
    height: number;
    frameRate: number;
    deviceId?: string;
}

export interface ActiveCamera {
    stream: MediaStream;
    video: HTMLVideoElement;
    track: MediaStreamTrack;
    settings: MediaTrackSettings;
    stop: () => void;
}

const DEFAULT_CONFIG: CameraConfig = {
    width: 1280,
    height: 720,
    frameRate: 30,
};

export async function openCamera(
    config: Partial<CameraConfig> = {}
): Promise<ActiveCamera> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            deviceId: cfg.deviceId ? { exact: cfg.deviceId } : undefined,
            width: { ideal: cfg.width },
            height: { ideal: cfg.height },
            frameRate: { ideal: cfg.frameRate },
            facingMode: 'user',
        },
    });

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;

    // Wait for metadata so videoWidth/Height are valid before downstream reads.
    await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Video element failed to load'));
    });
    await video.play();

    return {
        stream,
        video,
        track,
        settings,
        stop: () => {
            track.stop();
            video.srcObject = null;
        },
    };
}
