// PDF → SVG conversion for uploaded floor plans.
//
// Architects send PDF, so PDF is the format that actually arrives. The stored
// asset stays SVG: every geometry reader downstream (walls, zones, textures)
// keeps working unchanged, and vector paths survive — a raster conversion
// would throw away the only geometry the resolver has to work with.
//
// Requires the `pdftocairo` binary (Alpine package `poppler-utils`). It is a
// system dependency, not an npm one, so its absence is reported as its own
// failure rather than being folded into "conversion failed".

import {spawn} from 'node:child_process';
import {envInt} from '../config/envReader';

export const PDF_CONTENT_TYPE = 'application/pdf';

const CONVERTER_BIN = 'pdftocairo';

// `- -` is stdin → stdout: no temp file, so a crashed process leaks nothing.
// Page 1 only — a floor plan is one page and a 200-page set would blow the
// size budget for no gain.
const CONVERTER_ARGS = ['-svg', '-f', '1', '-l', '1', '-', '-'];

// Measured on Shelly's own Building 3 Floor 2 test fit (AutoCAD 2022, A3):
// 1.11 MiB PDF → 20.9 MiB SVG, ~19x expansion. That file is the reference
// input and must pass, so the cap sits just above it. Every extra MiB is
// real cost on both ends — ~0.4 s of server-side sanitize and ~13 ms of
// browser parse per MiB — which is why this is a hard limit and not a warning.
const MAX_SVG_BYTES = envInt(
    'FM_FLOOR_PLAN_MAX_SVG_BYTES',
    24 * 1024 * 1024,
    64 * 1024
);

// A plan that takes longer than this is not a plan we can serve.
const CONVERT_TIMEOUT_MS = envInt(
    'FM_FLOOR_PLAN_CONVERT_TIMEOUT_MS',
    30_000,
    1000
);

/** Distinct reasons a PDF did not become an SVG. Separate codes because
 *  "install poppler-utils", "this file is broken" and "this file is too big"
 *  are three different actions for whoever reads the message. */
export type PlanConversionCode =
    | 'converter_unavailable'
    | 'conversion_failed'
    | 'converted_too_large';

export class PlanConversionError extends Error {
    readonly code: PlanConversionCode;

    constructor(code: PlanConversionCode, message: string) {
        super(message);
        this.name = 'PlanConversionError';
        this.code = code;
    }
}

export function isPlanConversionError(
    err: unknown
): err is PlanConversionError {
    return err instanceof PlanConversionError;
}

/** Byte budget for the converted SVG. Exported so callers can report the
 *  limit they are enforcing instead of a bare "too large". */
export function maxConvertedSvgBytes(): number {
    return MAX_SVG_BYTES;
}

/** Convert a single-page PDF to SVG. Rejects with a PlanConversionError
 *  carrying one of the three codes; never resolves with partial output.
 *
 *  `maxSvgBytes` overrides the configured budget — a caller that knows it has
 *  less room to work with says so instead of discovering it downstream. */
export async function convertPdfToSvg(
    bytes: Buffer,
    options: {maxSvgBytes?: number} = {}
): Promise<Buffer> {
    const maxBytes = options.maxSvgBytes ?? MAX_SVG_BYTES;
    const child = spawn(CONVERTER_BIN, CONVERTER_ARGS, {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    const out: Buffer[] = [];
    let outBytes = 0;
    let overflowed = false;
    let stderr = '';

    // Stop reading the moment the budget is blown — buffering a 100 MiB
    // conversion to then reject it is the failure we are preventing.
    child.stdout.on('data', (chunk: Buffer) => {
        if (overflowed) return;
        outBytes += chunk.byteLength;
        if (outBytes > maxBytes) {
            overflowed = true;
            out.length = 0;
            child.kill('SIGKILL');
            return;
        }
        out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(0, 2000);
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), CONVERT_TIMEOUT_MS);
    // The converter closes stdin on a malformed PDF, which surfaces as EPIPE
    // on our write. The real diagnosis is the exit code, so let it get there.
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);

    try {
        const exit = await waitForExit(child);
        if (overflowed) {
            throw new PlanConversionError(
                'converted_too_large',
                `converted plan exceeds ${formatMiB(maxBytes)} of SVG — ` +
                    'export a single floor at a smaller scale, or upload SVG directly'
            );
        }
        if (exit.spawnFailed) {
            throw new PlanConversionError(
                'converter_unavailable',
                `PDF conversion is not available on this server: ${CONVERTER_BIN} ` +
                    'is not installed (Alpine package poppler-utils)'
            );
        }
        if (exit.code !== 0) {
            throw new PlanConversionError(
                'conversion_failed',
                `could not read the PDF${stderr ? `: ${firstLine(stderr)}` : ''}`
            );
        }
        const svg = Buffer.concat(out);
        if (svg.byteLength === 0) {
            throw new PlanConversionError(
                'conversion_failed',
                'the PDF converted to an empty drawing — it may have no page 1'
            );
        }
        return svg;
    } finally {
        clearTimeout(timer);
    }
}

interface ExitResult {
    readonly code: number | null;
    readonly spawnFailed: boolean;
}

// ENOENT on spawn arrives as an 'error' event, not an exit code, and it is
// the one failure an operator can fix by changing the image.
function waitForExit(child: ReturnType<typeof spawn>): Promise<ExitResult> {
    return new Promise((resolve) => {
        child.once('error', (err: NodeJS.ErrnoException) => {
            resolve({code: null, spawnFailed: err.code === 'ENOENT'});
        });
        child.once('close', (code) => {
            resolve({code, spawnFailed: false});
        });
    });
}

function firstLine(text: string): string {
    return text.split('\n')[0].trim();
}

function formatMiB(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
