// Gaze Analysis Module
// Implements fixation detection, AOI analysis, dwell time, scanpath, and first fixation metrics

// ==================== Types ====================

export interface GazePoint {
    timestamp: number;      // Video timestamp in seconds
    frameNumber: number;    // Estimated frame number
    x: number;              // Gaze x position (relative to video, 0-1)
    y: number;              // Gaze y position (relative to video, 0-1)
    screenX: number;        // Absolute screen position
    screenY: number;        // Absolute screen position
}

export interface Fixation {
    id: number;
    startTime: number;      // Start time in seconds
    endTime: number;        // End time in seconds
    duration: number;       // Duration in milliseconds
    x: number;              // Centroid x (0-1)
    y: number;              // Centroid y (0-1)
    pointCount: number;     // Number of gaze points in this fixation
    points: GazePoint[];    // Raw points that make up this fixation
}

export interface AOI {
    id: string;
    name: string;
    color: string;
    bounds: {
        x: number;      // Top-left x (0-1)
        y: number;      // Top-left y (0-1)
        width: number;  // Width (0-1)
        height: number; // Height (0-1)
    };
}

export interface DwellTimeStats {
    aoiId: string;
    aoiName: string;
    totalDwellTime: number;         // Total dwell time in ms
    fixationCount: number;          // Number of fixations in AOI
    meanFixationDuration: number;   // Mean fixation duration in ms
    percentOfTotal: number;         // Percentage of total viewing time
}

export interface ScanpathMetrics {
    totalLength: number;            // Total path length (normalized units)
    fixationCount: number;          // Number of fixations
    totalDuration: number;          // Total fixation duration in ms
    meanFixationDuration: number;   // Mean fixation duration in ms
    meanSaccadeAmplitude: number;   // Mean saccade amplitude (normalized units)
    aoiSequence: string[];          // Sequence of AOI visits
    aoiTransitionMatrix: Map<string, Map<string, number>>; // Transition counts
}

export interface FirstFixationMetrics {
    aoiId: string;
    aoiName: string;
    timeToFirstFixation: number | null;     // Time to first fixation in ms (null if never)
    firstFixationDuration: number | null;   // First fixation duration in ms
    firstFixationX: number | null;          // First fixation x coordinate
    firstFixationY: number | null;          // First fixation y coordinate
    entryCount: number;                     // Number of times gaze entered this AOI
}

export interface AnalysisResult {
    fixations: Fixation[];
    dwellTimeStats: DwellTimeStats[];
    scanpathMetrics: ScanpathMetrics;
    firstFixationMetrics: FirstFixationMetrics[];
    parameters: {
        dispersionThreshold: number;
        minFixationDuration: number;
    };
}

// ==================== Algorithm Parameters ====================

// I-DT (Dispersion-Threshold Identification) parameters
const DEFAULT_DISPERSION_THRESHOLD = 0.03;  // 3% of screen (~1-2 degrees visual angle)
const DEFAULT_MIN_FIXATION_DURATION = 100;   // 100ms minimum fixation duration

// ==================== Fixation Detection (I-DT Algorithm) ====================

/**
 * Calculate dispersion (max distance) of a set of points
 */
function calculateDispersion(points: GazePoint[]): number {
    if (points.length < 2) return 0;
    
    let maxDist = 0;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxDist) maxDist = dist;
        }
    }
    return maxDist;
}

/**
 * Calculate centroid of a set of points
 */
function calculateCentroid(points: GazePoint[]): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    
    return {
        x: sumX / points.length,
        y: sumY / points.length
    };
}

/**
 * I-DT (Dispersion-Threshold Identification) Algorithm
 * 
 * Algorithm:
 * 1. Initialize window with first points until duration >= min duration
 * 2. If dispersion < threshold, expand window
 * 3. If dispersion >= threshold, record fixation and start new window
 * 
 * @param gazePoints - Array of gaze points sorted by timestamp
 * @param dispersionThreshold - Maximum dispersion for a fixation (0-1 normalized)
 * @param minDuration - Minimum fixation duration in milliseconds
 * @returns Array of detected fixations
 */
export function detectFixationsIDT(
    gazePoints: GazePoint[],
    dispersionThreshold: number = DEFAULT_DISPERSION_THRESHOLD,
    minDuration: number = DEFAULT_MIN_FIXATION_DURATION
): Fixation[] {
    if (gazePoints.length < 2) return [];
    
    const fixations: Fixation[] = [];
    let fixationId = 1;
    
    // Sort by timestamp
    const sortedPoints = [...gazePoints].sort((a, b) => a.timestamp - b.timestamp);
    
    let windowStart = 0;
    let windowEnd = 0;
    
    while (windowStart < sortedPoints.length) {
        // Find initial window that meets minimum duration
        windowEnd = windowStart;
        while (
            windowEnd < sortedPoints.length &&
            (sortedPoints[windowEnd].timestamp - sortedPoints[windowStart].timestamp) * 1000 < minDuration
        ) {
            windowEnd++;
        }
        
        if (windowEnd >= sortedPoints.length) {
            // Not enough points for minimum duration
            break;
        }
        
        // Get window points
        let windowPoints = sortedPoints.slice(windowStart, windowEnd + 1);
        let dispersion = calculateDispersion(windowPoints);
        
        if (dispersion <= dispersionThreshold) {
            // This is a potential fixation, try to expand
            while (windowEnd + 1 < sortedPoints.length) {
                const testPoints = sortedPoints.slice(windowStart, windowEnd + 2);
                const testDispersion = calculateDispersion(testPoints);
                
                if (testDispersion <= dispersionThreshold) {
                    windowEnd++;
                    windowPoints = testPoints;
                    dispersion = testDispersion;
                } else {
                    break;
                }
            }
            
            // Record fixation
            const centroid = calculateCentroid(windowPoints);
            const startTime = windowPoints[0].timestamp;
            const endTime = windowPoints[windowPoints.length - 1].timestamp;
            const duration = (endTime - startTime) * 1000;
            
            if (duration >= minDuration) {
                fixations.push({
                    id: fixationId++,
                    startTime,
                    endTime,
                    duration,
                    x: centroid.x,
                    y: centroid.y,
                    pointCount: windowPoints.length,
                    points: windowPoints
                });
            }
            
            // Move window past this fixation
            windowStart = windowEnd + 1;
        } else {
            // Not a fixation, move window forward
            windowStart++;
        }
    }
    
    return fixations;
}

// ==================== AOI Analysis ====================

/**
 * Check if a point is inside an AOI
 */
export function isPointInAOI(x: number, y: number, aoi: AOI): boolean {
    return (
        x >= aoi.bounds.x &&
        x <= aoi.bounds.x + aoi.bounds.width &&
        y >= aoi.bounds.y &&
        y <= aoi.bounds.y + aoi.bounds.height
    );
}

/**
 * Find which AOI a fixation belongs to (if any)
 */
export function findAOIForFixation(fixation: Fixation, aois: AOI[]): AOI | null {
    for (const aoi of aois) {
        if (isPointInAOI(fixation.x, fixation.y, aoi)) {
            return aoi;
        }
    }
    return null;
}

// ==================== Dwell Time Statistics ====================

/**
 * Calculate dwell time statistics for each AOI
 */
export function calculateDwellTime(
    fixations: Fixation[],
    aois: AOI[]
): DwellTimeStats[] {
    const totalViewingTime = fixations.reduce((sum, f) => sum + f.duration, 0);
    
    const stats: DwellTimeStats[] = aois.map(aoi => {
        const aoiFixations = fixations.filter(f => isPointInAOI(f.x, f.y, aoi));
        const totalDwellTime = aoiFixations.reduce((sum, f) => sum + f.duration, 0);
        const fixationCount = aoiFixations.length;
        
        return {
            aoiId: aoi.id,
            aoiName: aoi.name,
            totalDwellTime,
            fixationCount,
            meanFixationDuration: fixationCount > 0 ? totalDwellTime / fixationCount : 0,
            percentOfTotal: totalViewingTime > 0 ? (totalDwellTime / totalViewingTime) * 100 : 0
        };
    });
    
    // Add "Outside AOIs" stats
    const outsideFixations = fixations.filter(f => !aois.some(aoi => isPointInAOI(f.x, f.y, aoi)));
    const outsideDwellTime = outsideFixations.reduce((sum, f) => sum + f.duration, 0);
    
    stats.push({
        aoiId: '__outside__',
        aoiName: 'Outside AOIs',
        totalDwellTime: outsideDwellTime,
        fixationCount: outsideFixations.length,
        meanFixationDuration: outsideFixations.length > 0 ? outsideDwellTime / outsideFixations.length : 0,
        percentOfTotal: totalViewingTime > 0 ? (outsideDwellTime / totalViewingTime) * 100 : 0
    });
    
    return stats;
}

// ==================== Scanpath Analysis ====================

/**
 * Calculate distance between two points
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate scanpath metrics
 */
export function calculateScanpathMetrics(
    fixations: Fixation[],
    aois: AOI[]
): ScanpathMetrics {
    if (fixations.length === 0) {
        return {
            totalLength: 0,
            fixationCount: 0,
            totalDuration: 0,
            meanFixationDuration: 0,
            meanSaccadeAmplitude: 0,
            aoiSequence: [],
            aoiTransitionMatrix: new Map()
        };
    }
    
    // Sort by start time
    const sortedFixations = [...fixations].sort((a, b) => a.startTime - b.startTime);
    
    // Calculate total path length and saccade amplitudes
    let totalLength = 0;
    const saccadeAmplitudes: number[] = [];
    
    for (let i = 1; i < sortedFixations.length; i++) {
        const prev = sortedFixations[i - 1];
        const curr = sortedFixations[i];
        const dist = distance(prev.x, prev.y, curr.x, curr.y);
        totalLength += dist;
        saccadeAmplitudes.push(dist);
    }
    
    // Calculate AOI sequence
    const aoiSequence: string[] = [];
    let lastAOI: string | null = null;
    
    for (const fixation of sortedFixations) {
        const aoi = findAOIForFixation(fixation, aois);
        const aoiName = aoi ? aoi.name : '__outside__';
        
        // Only add if different from last (collapse consecutive same-AOI fixations)
        if (aoiName !== lastAOI) {
            aoiSequence.push(aoiName);
            lastAOI = aoiName;
        }
    }
    
    // Calculate transition matrix
    const transitionMatrix = new Map<string, Map<string, number>>();
    
    for (let i = 1; i < sortedFixations.length; i++) {
        const prevAOI = findAOIForFixation(sortedFixations[i - 1], aois);
        const currAOI = findAOIForFixation(sortedFixations[i], aois);
        const prevName = prevAOI ? prevAOI.name : '__outside__';
        const currName = currAOI ? currAOI.name : '__outside__';
        
        if (!transitionMatrix.has(prevName)) {
            transitionMatrix.set(prevName, new Map());
        }
        const row = transitionMatrix.get(prevName)!;
        row.set(currName, (row.get(currName) || 0) + 1);
    }
    
    // Calculate summary stats
    const totalDuration = sortedFixations.reduce((sum, f) => sum + f.duration, 0);
    const meanSaccadeAmplitude = saccadeAmplitudes.length > 0
        ? saccadeAmplitudes.reduce((sum, a) => sum + a, 0) / saccadeAmplitudes.length
        : 0;
    
    return {
        totalLength,
        fixationCount: sortedFixations.length,
        totalDuration,
        meanFixationDuration: totalDuration / sortedFixations.length,
        meanSaccadeAmplitude,
        aoiSequence,
        aoiTransitionMatrix: transitionMatrix
    };
}

// ==================== First Fixation Metrics ====================

/**
 * Calculate first fixation metrics for each AOI
 */
export function calculateFirstFixation(
    fixations: Fixation[],
    aois: AOI[],
    videoStartTime: number = 0
): FirstFixationMetrics[] {
    // Sort fixations by start time
    const sortedFixations = [...fixations].sort((a, b) => a.startTime - b.startTime);
    
    return aois.map(aoi => {
        // Find fixations in this AOI
        const aoiFixations = sortedFixations.filter(f => isPointInAOI(f.x, f.y, aoi));
        
        // Find first fixation
        const firstFixation = aoiFixations.length > 0 ? aoiFixations[0] : null;
        
        // Count entries (transitions into this AOI)
        let entryCount = 0;
        let wasInAOI = false;
        
        for (const fixation of sortedFixations) {
            const isInAOI = isPointInAOI(fixation.x, fixation.y, aoi);
            if (isInAOI && !wasInAOI) {
                entryCount++;
            }
            wasInAOI = isInAOI;
        }
        
        return {
            aoiId: aoi.id,
            aoiName: aoi.name,
            timeToFirstFixation: firstFixation 
                ? (firstFixation.startTime - videoStartTime) * 1000 
                : null,
            firstFixationDuration: firstFixation ? firstFixation.duration : null,
            firstFixationX: firstFixation ? firstFixation.x : null,
            firstFixationY: firstFixation ? firstFixation.y : null,
            entryCount
        };
    });
}

// ==================== Full Analysis ====================

/**
 * Run complete gaze analysis
 */
export function analyzeGazeData(
    gazePoints: GazePoint[],
    aois: AOI[],
    options: {
        dispersionThreshold?: number;
        minFixationDuration?: number;
        videoStartTime?: number;
    } = {}
): AnalysisResult {
    const dispersionThreshold = options.dispersionThreshold ?? DEFAULT_DISPERSION_THRESHOLD;
    const minFixationDuration = options.minFixationDuration ?? DEFAULT_MIN_FIXATION_DURATION;
    const videoStartTime = options.videoStartTime ?? 0;
    
    // Detect fixations
    const fixations = detectFixationsIDT(gazePoints, dispersionThreshold, minFixationDuration);
    
    // Calculate metrics
    const dwellTimeStats = calculateDwellTime(fixations, aois);
    const scanpathMetrics = calculateScanpathMetrics(fixations, aois);
    const firstFixationMetrics = calculateFirstFixation(fixations, aois, videoStartTime);
    
    return {
        fixations,
        dwellTimeStats,
        scanpathMetrics,
        firstFixationMetrics,
        parameters: {
            dispersionThreshold,
            minFixationDuration
        }
    };
}

// ==================== Export Utilities ====================

/**
 * Convert analysis result to CSV format
 */
export function analysisToCSV(result: AnalysisResult, aois: AOI[]): {
    fixationsCSV: string;
    dwellTimeCSV: string;
    firstFixationCSV: string;
    scanpathCSV: string;
} {
    // Fixations CSV
    const fixationHeaders = ['id', 'start_time_s', 'end_time_s', 'duration_ms', 'x', 'y', 'point_count', 'aoi'];
    const fixationRows = result.fixations.map(f => {
        const aoi = aois.find(a => isPointInAOI(f.x, f.y, a));
        return [
            f.id,
            f.startTime.toFixed(3),
            f.endTime.toFixed(3),
            f.duration.toFixed(1),
            f.x.toFixed(4),
            f.y.toFixed(4),
            f.pointCount,
            aoi ? aoi.name : 'outside'
        ].join(',');
    });
    const fixationsCSV = [fixationHeaders.join(','), ...fixationRows].join('\n');
    
    // Dwell Time CSV
    const dwellHeaders = ['aoi_id', 'aoi_name', 'total_dwell_ms', 'fixation_count', 'mean_duration_ms', 'percent_total'];
    const dwellRows = result.dwellTimeStats.map(d => [
        d.aoiId,
        d.aoiName,
        d.totalDwellTime.toFixed(1),
        d.fixationCount,
        d.meanFixationDuration.toFixed(1),
        d.percentOfTotal.toFixed(2)
    ].join(','));
    const dwellTimeCSV = [dwellHeaders.join(','), ...dwellRows].join('\n');
    
    // First Fixation CSV
    const ffHeaders = ['aoi_id', 'aoi_name', 'ttff_ms', 'first_duration_ms', 'first_x', 'first_y', 'entry_count'];
    const ffRows = result.firstFixationMetrics.map(f => [
        f.aoiId,
        f.aoiName,
        f.timeToFirstFixation !== null ? f.timeToFirstFixation.toFixed(1) : 'N/A',
        f.firstFixationDuration !== null ? f.firstFixationDuration.toFixed(1) : 'N/A',
        f.firstFixationX !== null ? f.firstFixationX.toFixed(4) : 'N/A',
        f.firstFixationY !== null ? f.firstFixationY.toFixed(4) : 'N/A',
        f.entryCount
    ].join(','));
    const firstFixationCSV = [ffHeaders.join(','), ...ffRows].join('\n');
    
    // Scanpath summary CSV
    const scanpathHeaders = ['metric', 'value'];
    const scanpathRows = [
        ['total_length', result.scanpathMetrics.totalLength.toFixed(4)],
        ['fixation_count', result.scanpathMetrics.fixationCount.toString()],
        ['total_duration_ms', result.scanpathMetrics.totalDuration.toFixed(1)],
        ['mean_fixation_duration_ms', result.scanpathMetrics.meanFixationDuration.toFixed(1)],
        ['mean_saccade_amplitude', result.scanpathMetrics.meanSaccadeAmplitude.toFixed(4)],
        ['aoi_sequence', result.scanpathMetrics.aoiSequence.join(' -> ')]
    ].map(row => row.join(','));
    const scanpathCSV = [scanpathHeaders.join(','), ...scanpathRows].join('\n');
    
    return {
        fixationsCSV,
        dwellTimeCSV,
        firstFixationCSV,
        scanpathCSV
    };
}

// ==================== Visualization Helpers ====================

/**
 * Generate scanpath drawing instructions
 */
export function getScanpathDrawingData(fixations: Fixation[]): {
    circles: Array<{ x: number; y: number; radius: number; id: number }>;
    lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
} {
    const sortedFixations = [...fixations].sort((a, b) => a.startTime - b.startTime);
    
    // Calculate radius based on duration (min 5, max 30)
    const minDuration = Math.min(...sortedFixations.map(f => f.duration));
    const maxDuration = Math.max(...sortedFixations.map(f => f.duration));
    const durationRange = maxDuration - minDuration || 1;
    
    const circles = sortedFixations.map(f => ({
        x: f.x,
        y: f.y,
        radius: 5 + ((f.duration - minDuration) / durationRange) * 25,
        id: f.id
    }));
    
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let i = 1; i < sortedFixations.length; i++) {
        lines.push({
            x1: sortedFixations[i - 1].x,
            y1: sortedFixations[i - 1].y,
            x2: sortedFixations[i].x,
            y2: sortedFixations[i].y
        });
    }
    
    return { circles, lines };
}
