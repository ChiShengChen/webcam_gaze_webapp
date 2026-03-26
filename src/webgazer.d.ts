declare module 'webgazer' {
    interface EyePatch {
        patch: ImageData;
        imagex: number;
        imagey: number;
        width: number;
        height: number;
    }

    interface EyeFeatures {
        left: EyePatch;
        right: EyePatch;
    }

    interface GazeData {
        x: number;
        y: number;
        eyeFeatures?: EyeFeatures;
    }

    type GazeListener = (data: GazeData | null, elapsedTime: number) => void;

    const webgazer: {
        begin(): Promise<any>;
        end(): void;
        pause(): void;
        resume(): void;
        setGazeListener(listener: GazeListener): typeof webgazer;
        clearGazeListener(): typeof webgazer;
        showVideoPreview(show: boolean): typeof webgazer;
        showPredictionPoints(show: boolean): typeof webgazer;
        showVideo(show: boolean): typeof webgazer;
        showFaceOverlay(show: boolean): typeof webgazer;
        showFaceFeedbackBox(show: boolean): typeof webgazer;
        setRegression(type: 'ridge' | 'weightedRidge' | 'threadedRidge'): typeof webgazer;
        setTracker(type: string): typeof webgazer;
        applyKalmanFilter(enabled: boolean): typeof webgazer;
        saveDataAcrossSessions(save: boolean): typeof webgazer;
        getCurrentPrediction(): Promise<GazeData | null>;
        clearData(): Promise<void>;
        recordScreenPosition(x: number, y: number, eventType?: string): typeof webgazer;
        addMouseEventListeners(): typeof webgazer;
        removeMouseEventListeners(): typeof webgazer;
        getTracker(): { getPositions(): number[][] | null };
    };

    export default webgazer;
}
