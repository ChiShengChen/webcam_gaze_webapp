import * as ort from 'onnxruntime-web';

// SAM Model URLs (using MobileSAM for browser efficiency)
const ENCODER_URL = 'https://huggingface.co/pinsalern/mobile_sam_onnx_cpu/resolve/main/mobile_sam_encoder.onnx';
const DECODER_URL = 'https://huggingface.co/pinsalern/mobile_sam_onnx_cpu/resolve/main/mobile_sam_decoder.onnx';

export interface Point {
    x: number;
    y: number;
    label: number; // 1 for foreground, 0 for background
}

export interface Mask {
    data: Uint8Array;
    width: number;
    height: number;
    bounds: { x: number; y: number; width: number; height: number };
}

export class SAMModel {
    private encoderSession: ort.InferenceSession | null = null;
    private decoderSession: ort.InferenceSession | null = null;
    private imageEmbedding: ort.Tensor | null = null;
    private currentImageSize: { width: number; height: number } | null = null;
    private isLoading = false;
    private isReady = false;

    async initialize(onProgress?: (status: string) => void): Promise<void> {
        if (this.isLoading || this.isReady) return;
        
        this.isLoading = true;
        
        try {
            onProgress?.('Loading SAM encoder model...');
            
            // Configure ONNX Runtime
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';
            
            // Load encoder
            this.encoderSession = await ort.InferenceSession.create(ENCODER_URL, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            onProgress?.('Loading SAM decoder model...');
            
            // Load decoder
            this.decoderSession = await ort.InferenceSession.create(DECODER_URL, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            this.isReady = true;
            onProgress?.('SAM model ready!');
        } catch (error) {
            console.error('Failed to load SAM model:', error);
            onProgress?.('Failed to load SAM model. Using fallback.');
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    async setImage(imageData: ImageData): Promise<void> {
        if (!this.encoderSession) {
            throw new Error('Model not initialized');
        }

        this.currentImageSize = { width: imageData.width, height: imageData.height };

        // Preprocess image for encoder (resize to 1024x1024)
        const inputSize = 1024;
        const resizedData = this.resizeImage(imageData, inputSize, inputSize);
        
        // Convert to tensor (NCHW format, normalized)
        const inputTensor = this.imageDataToTensor(resizedData, inputSize, inputSize);
        
        // Run encoder
        const encoderResult = await this.encoderSession.run({
            'image': inputTensor
        });
        
        this.imageEmbedding = encoderResult['image_embeddings'];
    }

    async segment(points: Point[]): Promise<Mask | null> {
        if (!this.decoderSession || !this.imageEmbedding || !this.currentImageSize) {
            throw new Error('Model not initialized or no image set');
        }

        const inputSize = 1024;
        const { width: origW, height: origH } = this.currentImageSize;
        
        // Scale points to 1024x1024
        const scaleX = inputSize / origW;
        const scaleY = inputSize / origH;
        
        const scaledPoints = points.map(p => ({
            x: p.x * scaleX,
            y: p.y * scaleY,
            label: p.label
        }));

        // Create point tensors
        const pointCoords = new Float32Array(points.length * 2);
        const pointLabels = new Float32Array(points.length);
        
        scaledPoints.forEach((p, i) => {
            pointCoords[i * 2] = p.x;
            pointCoords[i * 2 + 1] = p.y;
            pointLabels[i] = p.label;
        });

        const pointCoordsTensor = new ort.Tensor('float32', pointCoords, [1, points.length, 2]);
        const pointLabelsTensor = new ort.Tensor('float32', pointLabels, [1, points.length]);
        
        // Dummy mask input (no previous mask)
        const maskInput = new ort.Tensor('float32', new Float32Array(256 * 256).fill(0), [1, 1, 256, 256]);
        const hasMaskInput = new ort.Tensor('float32', new Float32Array([0]), [1]);
        
        // Original image size
        const origSize = new ort.Tensor('float32', new Float32Array([origH, origW]), [2]);

        // Run decoder
        const decoderResult = await this.decoderSession.run({
            'image_embeddings': this.imageEmbedding,
            'point_coords': pointCoordsTensor,
            'point_labels': pointLabelsTensor,
            'mask_input': maskInput,
            'has_mask_input': hasMaskInput,
            'orig_im_size': origSize
        });

        // Get mask from result
        const maskData = decoderResult['masks'].data as Float32Array;
        const maskWidth = origW;
        const maskHeight = origH;
        
        // Convert to binary mask
        const binaryMask = new Uint8Array(maskWidth * maskHeight);
        let minX = maskWidth, minY = maskHeight, maxX = 0, maxY = 0;
        
        for (let i = 0; i < maskData.length; i++) {
            const value = maskData[i] > 0 ? 255 : 0;
            binaryMask[i] = value;
            
            if (value > 0) {
                const x = i % maskWidth;
                const y = Math.floor(i / maskWidth);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }

        return {
            data: binaryMask,
            width: maskWidth,
            height: maskHeight,
            bounds: {
                x: minX,
                y: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1
            }
        };
    }

    private resizeImage(imageData: ImageData, targetWidth: number, targetHeight: number): ImageData {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d')!;
        
        // Create temp canvas with original image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(imageData, 0, 0);
        
        // Draw resized
        ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        
        return ctx.getImageData(0, 0, targetWidth, targetHeight);
    }

    private imageDataToTensor(imageData: ImageData, width: number, height: number): ort.Tensor {
        const { data } = imageData;
        const float32Data = new Float32Array(3 * width * height);
        
        // Normalize and convert to NCHW format
        // SAM expects pixel values in range [0, 255] with mean subtraction
        const mean = [123.675, 116.28, 103.53];
        const std = [58.395, 57.12, 57.375];
        
        for (let i = 0; i < width * height; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            
            float32Data[i] = (r - mean[0]) / std[0];
            float32Data[width * height + i] = (g - mean[1]) / std[1];
            float32Data[2 * width * height + i] = (b - mean[2]) / std[2];
        }
        
        return new ort.Tensor('float32', float32Data, [1, 3, height, width]);
    }

    getIsReady(): boolean {
        return this.isReady;
    }
}

// Fallback: Simple flood-fill based segmentation when SAM fails to load
export function fallbackSegment(
    imageData: ImageData,
    point: { x: number; y: number },
    tolerance: number = 32
): Mask {
    const { width, height, data } = imageData;
    const mask = new Uint8Array(width * height);
    const visited = new Set<number>();
    
    const startIdx = (Math.floor(point.y) * width + Math.floor(point.x)) * 4;
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    
    const stack: [number, number][] = [[Math.floor(point.x), Math.floor(point.y)]];
    let minX = width, minY = height, maxX = 0, maxY = 0;
    
    while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        const key = y * width + x;
        
        if (x < 0 || x >= width || y < 0 || y >= height || visited.has(key)) {
            continue;
        }
        
        const idx = key * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        const diff = Math.abs(r - startR) + Math.abs(g - startG) + Math.abs(b - startB);
        
        if (diff <= tolerance * 3) {
            visited.add(key);
            mask[key] = 255;
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
    }
    
    return {
        data: mask,
        width,
        height,
        bounds: {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        }
    };
}
