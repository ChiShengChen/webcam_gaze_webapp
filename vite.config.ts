import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dev-only save endpoint for benchmark outputs.
 *
 * The browser sandbox forbids writing to arbitrary filesystem paths, so
 * we expose a tiny POST handler during `vite dev` that persists whatever
 * bytes the benchmark POSTs into `gaze_result/` with a mode-tagged
 * filename. No-op in production builds (the plugin only runs in dev).
 *
 * Safety: filename is reduced to its basename and any non
 * [A-Za-z0-9._-] characters are squashed to `_`, so path traversal is
 * impossible. Writes are confined to `gaze_result/` under the project
 * root.
 */

const SAVE_DIR_REL = 'gaze_result';
const ROUTE = '/__benchmark/save';

function sanitizeFilename(raw: string): string {
    const base = path.basename(raw);
    const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
    return cleaned;
}

function handleSave(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('POST required');
        return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    const rawFilename = url.searchParams.get('filename') ?? '';
    const safe = sanitizeFilename(rawFilename);
    if (!safe) {
        res.statusCode = 400;
        res.end('missing or invalid filename');
        return;
    }

    const saveDir = path.resolve(process.cwd(), SAVE_DIR_REL);
    try {
        fs.mkdirSync(saveDir, { recursive: true });
    } catch (err) {
        res.statusCode = 500;
        res.end(`mkdir failed: ${String(err)}`);
        return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer | string) => {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => {
        try {
            const buf = Buffer.concat(chunks);
            const outPath = path.join(saveDir, safe);
            fs.writeFileSync(outPath, buf);
            const rel = path.relative(process.cwd(), outPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: rel, bytes: buf.length }));
        } catch (err) {
            res.statusCode = 500;
            res.end(`write failed: ${String(err)}`);
        }
    });
    req.on('error', () => {
        res.statusCode = 500;
        res.end('stream error');
    });
}

export default defineConfig({
    plugins: [
        {
            name: 'benchmark-save',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    if (!req.url?.startsWith(ROUTE)) return next();
                    handleSave(req, res);
                });
            },
        },
    ],
});
