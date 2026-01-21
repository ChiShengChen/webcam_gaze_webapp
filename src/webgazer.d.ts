declare module 'webgazer' {
    interface GazeData {
        x: number;
        y: number;
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
        setRegression(type: string): typeof webgazer;
        setTracker(type: string): typeof webgazer;
        saveDataAcrossSessions(save: boolean): typeof webgazer;
        getCurrentPrediction(): Promise<GazeData | null>;
    };

    export default webgazer;
}
