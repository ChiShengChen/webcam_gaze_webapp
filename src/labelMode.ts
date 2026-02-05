import { SAMModel, fallbackSegment } from './sam';
import type { Mask } from './sam';

// Types
interface Label {
    id: number;
    name: string;
    color: string;
}

interface Annotation {
    id: number;
    labelId: number;
    imageId: number;
    mask: Mask;
    polygon: number[][];
}

interface LoadedImage {
    id: number;
    name: string;
    element: HTMLImageElement;
    width: number;
    height: number;
}

// Color palette for labels
const COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8B500', '#00CED1', '#FF69B4', '#32CD32', '#FFD700'
];

export class LabelMode {
    private sam: SAMModel;
    private useFallback = false;
    
    // DOM Elements
    private imageCanvas: HTMLCanvasElement;
    private maskCanvas: HTMLCanvasElement;
    private imageCtx: CanvasRenderingContext2D;
    private maskCtx: CanvasRenderingContext2D;
    private gazeCursor: HTMLElement;
    private canvasContainer: HTMLElement;
    
    // State
    private labels: Label[] = [];
    private annotations: Annotation[] = [];
    private images: LoadedImage[] = [];
    private currentImageId: number | null = null;
    private currentLabelId: number | null = null;
    private currentGazePosition: { x: number; y: number } | null = null;
    
    private nextLabelId = 1;
    private nextAnnotationId = 1;
    private nextImageId = 1;
    
    // Callbacks
    private onStatusChange: (status: string, type: 'ready' | 'loading' | 'error') => void;
    
    constructor(onStatusChange: (status: string, type: 'ready' | 'loading' | 'error') => void) {
        this.sam = new SAMModel();
        this.onStatusChange = onStatusChange;
        
        // Get DOM elements
        this.imageCanvas = document.getElementById('image-canvas') as HTMLCanvasElement;
        this.maskCanvas = document.getElementById('mask-canvas') as HTMLCanvasElement;
        this.gazeCursor = document.getElementById('gaze-cursor') as HTMLElement;
        this.canvasContainer = document.getElementById('canvas-container') as HTMLElement;
        
        this.imageCtx = this.imageCanvas.getContext('2d')!;
        this.maskCtx = this.maskCanvas.getContext('2d')!;
        
        this.setupEventListeners();
    }
    
    async initialize(): Promise<void> {
        try {
            this.onStatusChange('Loading SAM model...', 'loading');
            await this.sam.initialize((status) => {
                this.onStatusChange(status, 'loading');
            });
            this.onStatusChange('SAM model ready!', 'ready');
        } catch (error) {
            console.error('SAM initialization failed, using fallback:', error);
            this.useFallback = true;
            this.onStatusChange('Using fallback segmentation (SAM unavailable)', 'error');
        }
    }
    
    private setupEventListeners(): void {
        const imageUpload = document.getElementById('image-upload') as HTMLInputElement;
        imageUpload.addEventListener('change', (e) => {
            this.handleImageUpload(e);
            const fileName = imageUpload.files?.[0]?.name || 'No file chosen';
            document.getElementById('image-upload-name')!.textContent = fileName;
        });
        
        // Label management
        const addLabelBtn = document.getElementById('add-label-btn')!;
        const labelInput = document.getElementById('label-name-input') as HTMLInputElement;
        const labelColorInput = document.getElementById('label-color-input') as HTMLInputElement;
        const deselectLabelBtn = document.getElementById('deselect-label-btn') as HTMLButtonElement;
        
        addLabelBtn.addEventListener('click', () => {
            const name = labelInput.value.trim();
            if (name) {
                const color = labelColorInput.value;
                this.addLabel(name, color);
                labelInput.value = '';
                // Set next color in palette
                const nextColorIndex = (this.labels.length) % COLORS.length;
                labelColorInput.value = COLORS[nextColorIndex];
            }
        });
        
        labelInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addLabelBtn.click();
            }
        });
        
        // Deselect label
        deselectLabelBtn.addEventListener('click', () => {
            this.deselectLabel();
        });
        
        // Undo
        document.getElementById('undo-segment-btn')!.addEventListener('click', () => {
            this.undoLastAnnotation();
        });
        
        // Export
        document.getElementById('export-coco-btn')!.addEventListener('click', () => {
            this.exportCOCO();
        });
        
        document.getElementById('export-yolo-btn')!.addEventListener('click', () => {
            this.exportYOLO();
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && this.isLabelModeActive()) {
                e.preventDefault();
                this.segmentAtGaze();
            }
        });
    }
    
    private isLabelModeActive(): boolean {
        const labelMode = document.getElementById('label-mode');
        return labelMode?.style.display !== 'none';
    }
    
    // Image handling
    private async handleImageUpload(e: Event): Promise<void> {
        const input = e.target as HTMLInputElement;
        const files = input.files;
        if (!files) return;
        
        for (const file of files) {
            await this.loadImage(file);
        }
    }
    
    private async loadImage(file: File): Promise<void> {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const img = new Image();
                img.onload = async () => {
                    const loadedImage: LoadedImage = {
                        id: this.nextImageId++,
                        name: file.name,
                        element: img,
                        width: img.width,
                        height: img.height
                    };
                    
                    this.images.push(loadedImage);
                    this.updateImageList();
                    this.selectImage(loadedImage.id);
                    resolve();
                };
                img.src = e.target?.result as string;
            };
            reader.readAsDataURL(file);
        });
    }
    
    private updateImageList(): void {
        const listEl = document.getElementById('image-list')!;
        listEl.innerHTML = this.images.map(img => `
            <div class="image-item ${img.id === this.currentImageId ? 'active' : ''}" 
                 data-id="${img.id}">
                ${img.name}
            </div>
        `).join('');
        
        listEl.querySelectorAll('.image-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.getAttribute('data-id')!);
                this.selectImage(id);
            });
        });
    }
    
    private async selectImage(imageId: number): Promise<void> {
        const image = this.images.find(img => img.id === imageId);
        if (!image) return;
        
        this.currentImageId = imageId;
        this.updateImageList();
        
        // Setup canvas
        this.imageCanvas.width = image.width;
        this.imageCanvas.height = image.height;
        this.maskCanvas.width = image.width;
        this.maskCanvas.height = image.height;
        
        this.canvasContainer.classList.add('has-image');
        
        // Draw image
        this.imageCtx.drawImage(image.element, 0, 0);
        
        // Set image for SAM
        if (!this.useFallback) {
            this.onStatusChange('Processing image for SAM...', 'loading');
            try {
                const imageData = this.imageCtx.getImageData(0, 0, image.width, image.height);
                await this.sam.setImage(imageData);
                this.onStatusChange('Ready to segment!', 'ready');
            } catch (error) {
                console.error('Failed to process image:', error);
                this.useFallback = true;
                this.onStatusChange('Using fallback segmentation', 'error');
            }
        }
        
        // Redraw annotations for this image
        this.redrawMasks();
    }
    
    // Label management
    addLabel(name: string, color?: string): void {
        const labelColor = color || COLORS[this.labels.length % COLORS.length];
        const label: Label = {
            id: this.nextLabelId++,
            name,
            color: labelColor
        };
        this.labels.push(label);
        this.updateLabelList();
        this.selectLabel(label.id);
    }
    
    private updateLabelList(): void {
        const listEl = document.getElementById('label-list')!;
        listEl.innerHTML = this.labels.map(label => `
            <div class="label-item ${label.id === this.currentLabelId ? 'active' : ''}" 
                 data-id="${label.id}">
                <input type="color" class="label-color-picker" value="${label.color}" data-id="${label.id}" title="Change color" />
                <span class="label-name">${label.name}</span>
                <button class="label-delete" data-id="${label.id}">X</button>
            </div>
        `).join('');
        
        // Click to select label
        listEl.querySelectorAll('.label-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (!target.classList.contains('label-delete') && !target.classList.contains('label-color-picker')) {
                    const id = parseInt(item.getAttribute('data-id')!);
                    this.selectLabel(id);
                }
            });
        });
        
        // Color picker change
        listEl.querySelectorAll('.label-color-picker').forEach(picker => {
            picker.addEventListener('change', (e) => {
                const input = e.target as HTMLInputElement;
                const id = parseInt(input.getAttribute('data-id')!);
                this.changeLabelColor(id, input.value);
            });
            // Prevent click propagation
            picker.addEventListener('click', (e) => e.stopPropagation());
        });
        
        // Delete button
        listEl.querySelectorAll('.label-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.getAttribute('data-id')!);
                this.deleteLabel(id);
            });
        });
        
        // Update current label display
        this.updateCurrentLabelDisplay();
    }
    
    private updateCurrentLabelDisplay(): void {
        const currentLabelName = document.getElementById('current-label-name')!;
        const deselectBtn = document.getElementById('deselect-label-btn') as HTMLButtonElement;
        
        if (this.currentLabelId) {
            const label = this.labels.find(l => l.id === this.currentLabelId);
            if (label) {
                currentLabelName.textContent = label.name;
                currentLabelName.style.color = label.color;
                deselectBtn.disabled = false;
            }
        } else {
            currentLabelName.textContent = 'None';
            currentLabelName.style.color = '#888';
            deselectBtn.disabled = true;
        }
    }
    
    private selectLabel(labelId: number): void {
        this.currentLabelId = labelId;
        this.updateLabelList();
    }
    
    private deselectLabel(): void {
        this.currentLabelId = null;
        this.updateLabelList();
    }
    
    private changeLabelColor(labelId: number, newColor: string): void {
        const label = this.labels.find(l => l.id === labelId);
        if (label) {
            label.color = newColor;
            this.updateLabelList();
            this.redrawMasks();
        }
    }
    
    private deleteLabel(labelId: number): void {
        this.labels = this.labels.filter(l => l.id !== labelId);
        this.annotations = this.annotations.filter(a => a.labelId !== labelId);
        if (this.currentLabelId === labelId) {
            this.currentLabelId = this.labels.length > 0 ? this.labels[0].id : null;
        }
        this.updateLabelList();
        this.updateAnnotationList();
        this.redrawMasks();
    }
    
    // Gaze tracking integration
    updateGazePosition(screenX: number, screenY: number): void {
        if (!this.currentImageId) return;
        
        const rect = this.imageCanvas.getBoundingClientRect();
        const x = screenX - rect.left;
        const y = screenY - rect.top;
        
        // Check if within canvas bounds
        if (x >= 0 && x < rect.width && y >= 0 && y < rect.height) {
            // Scale to image coordinates
            const scaleX = this.imageCanvas.width / rect.width;
            const scaleY = this.imageCanvas.height / rect.height;
            
            this.currentGazePosition = {
                x: x * scaleX,
                y: y * scaleY
            };
            
            // Update cursor position
            this.gazeCursor.style.display = 'block';
            this.gazeCursor.style.left = `${x}px`;
            this.gazeCursor.style.top = `${y}px`;
            
            // Update coordinates display
            const coordsEl = document.getElementById('gaze-coords');
            if (coordsEl) {
                coordsEl.textContent = `Gaze: (${Math.round(this.currentGazePosition.x)}, ${Math.round(this.currentGazePosition.y)})`;
            }
        } else {
            this.gazeCursor.style.display = 'none';
            this.currentGazePosition = null;
        }
    }
    
    // Segmentation
    async segmentAtGaze(): Promise<void> {
        if (!this.currentGazePosition || !this.currentLabelId || !this.currentImageId) {
            console.log('Cannot segment: missing gaze position, label, or image');
            return;
        }
        
        this.onStatusChange('Segmenting...', 'loading');
        
        try {
            let mask: Mask;
            
            if (this.useFallback) {
                // Use flood-fill fallback
                const imageData = this.imageCtx.getImageData(
                    0, 0, this.imageCanvas.width, this.imageCanvas.height
                );
                mask = fallbackSegment(imageData, this.currentGazePosition, 32);
            } else {
                // Use SAM
                const result = await this.sam.segment([{
                    x: this.currentGazePosition.x,
                    y: this.currentGazePosition.y,
                    label: 1 // foreground
                }]);
                
                if (!result) {
                    throw new Error('Segmentation returned no result');
                }
                mask = result;
            }
            
            // Create annotation
            const annotation: Annotation = {
                id: this.nextAnnotationId++,
                labelId: this.currentLabelId,
                imageId: this.currentImageId,
                mask,
                polygon: this.maskToPolygon(mask)
            };
            
            this.annotations.push(annotation);
            this.updateAnnotationList();
            this.redrawMasks();
            
            // Enable undo button
            (document.getElementById('undo-segment-btn') as HTMLButtonElement).disabled = false;
            
            this.onStatusChange('Segmentation complete!', 'ready');
        } catch (error) {
            console.error('Segmentation failed:', error);
            this.onStatusChange('Segmentation failed', 'error');
        }
    }
    
    private maskToPolygon(mask: Mask): number[][] {
        // Simple contour extraction (simplified version)
        const points: number[][] = [];
        const { data, width, height } = mask;
        
        // Find boundary points
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (data[idx] > 0) {
                    // Check if it's a boundary pixel
                    const isEdge = (
                        x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
                        data[idx - 1] === 0 || data[idx + 1] === 0 ||
                        data[idx - width] === 0 || data[idx + width] === 0
                    );
                    if (isEdge) {
                        points.push([x, y]);
                    }
                }
            }
        }
        
        // Simplify polygon (keep every nth point)
        const simplified: number[][] = [];
        const step = Math.max(1, Math.floor(points.length / 100));
        for (let i = 0; i < points.length; i += step) {
            simplified.push(points[i]);
        }
        
        return simplified;
    }
    
    private redrawMasks(): void {
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        
        const currentAnnotations = this.annotations.filter(a => a.imageId === this.currentImageId);
        
        for (const annotation of currentAnnotations) {
            const label = this.labels.find(l => l.id === annotation.labelId);
            if (!label) continue;
            
            // Draw mask
            const imageData = this.maskCtx.createImageData(annotation.mask.width, annotation.mask.height);
            const color = this.hexToRgb(label.color);
            
            for (let i = 0; i < annotation.mask.data.length; i++) {
                if (annotation.mask.data[i] > 0) {
                    imageData.data[i * 4] = color.r;
                    imageData.data[i * 4 + 1] = color.g;
                    imageData.data[i * 4 + 2] = color.b;
                    imageData.data[i * 4 + 3] = 150;
                }
            }
            
            this.maskCtx.putImageData(imageData, 0, 0);
        }
    }
    
    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 0, b: 0 };
    }
    
    private updateAnnotationList(): void {
        const listEl = document.getElementById('annotation-list')!;
        const currentAnnotations = this.annotations.filter(a => a.imageId === this.currentImageId);
        
        listEl.innerHTML = currentAnnotations.map(ann => {
            const label = this.labels.find(l => l.id === ann.labelId);
            return `
                <div class="annotation-item" data-id="${ann.id}">
                    <div class="label-color" style="background-color: ${label?.color || '#ccc'}"></div>
                    <span class="annotation-info">${label?.name || 'Unknown'}</span>
                    <button class="annotation-delete" data-id="${ann.id}">X</button>
                </div>
            `;
        }).join('');
        
        listEl.querySelectorAll('.annotation-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id')!);
                this.deleteAnnotation(id);
            });
        });
    }
    
    private deleteAnnotation(annotationId: number): void {
        this.annotations = this.annotations.filter(a => a.id !== annotationId);
        this.updateAnnotationList();
        this.redrawMasks();
        
        const hasAnnotations = this.annotations.some(a => a.imageId === this.currentImageId);
        (document.getElementById('undo-segment-btn') as HTMLButtonElement).disabled = !hasAnnotations;
    }
    
    private undoLastAnnotation(): void {
        const currentAnnotations = this.annotations.filter(a => a.imageId === this.currentImageId);
        if (currentAnnotations.length > 0) {
            const lastAnnotation = currentAnnotations[currentAnnotations.length - 1];
            this.deleteAnnotation(lastAnnotation.id);
        }
    }
    
    // Export functions
    private exportCOCO(): void {
        const cocoData = {
            info: {
                description: 'Gaze Label Tool Export',
                date_created: new Date().toISOString()
            },
            images: this.images.map(img => ({
                id: img.id,
                file_name: img.name,
                width: img.width,
                height: img.height
            })),
            categories: this.labels.map(label => ({
                id: label.id,
                name: label.name
            })),
            annotations: this.annotations.map(ann => ({
                id: ann.id,
                image_id: ann.imageId,
                category_id: ann.labelId,
                segmentation: [ann.polygon.flat()],
                bbox: [ann.mask.bounds.x, ann.mask.bounds.y, ann.mask.bounds.width, ann.mask.bounds.height],
                area: ann.mask.bounds.width * ann.mask.bounds.height,
                iscrowd: 0
            }))
        };
        
        this.downloadJSON(cocoData, 'annotations_coco.json');
    }
    
    private exportYOLO(): void {
        // Group annotations by image
        const annotationsByImage = new Map<number, Annotation[]>();
        
        for (const ann of this.annotations) {
            const existing = annotationsByImage.get(ann.imageId) || [];
            existing.push(ann);
            annotationsByImage.set(ann.imageId, existing);
        }
        
        // Create a file for each image
        const files: { name: string; content: string }[] = [];
        
        for (const [imageId, anns] of annotationsByImage) {
            const image = this.images.find(img => img.id === imageId);
            if (!image) continue;
            
            const lines = anns.map(ann => {
                const label = this.labels.find(l => l.id === ann.labelId);
                const labelIndex = this.labels.indexOf(label!);
                
                // YOLO format: class_index x_center y_center width height (normalized)
                const xCenter = (ann.mask.bounds.x + ann.mask.bounds.width / 2) / image.width;
                const yCenter = (ann.mask.bounds.y + ann.mask.bounds.height / 2) / image.height;
                const width = ann.mask.bounds.width / image.width;
                const height = ann.mask.bounds.height / image.height;
                
                return `${labelIndex} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
            });
            
            const baseName = image.name.replace(/\.[^/.]+$/, '');
            files.push({
                name: `${baseName}.txt`,
                content: lines.join('\n')
            });
        }
        
        // Also create classes.txt
        files.push({
            name: 'classes.txt',
            content: this.labels.map(l => l.name).join('\n')
        });
        
        // Download as zip or individual files
        if (files.length === 1) {
            this.downloadText(files[0].content, files[0].name);
        } else {
            // Download each file
            files.forEach(f => this.downloadText(f.content, f.name));
        }
    }
    
    private downloadJSON(data: object, filename: string): void {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, filename);
    }
    
    private downloadText(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'text/plain' });
        this.downloadBlob(blob, filename);
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
}
