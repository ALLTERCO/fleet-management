/**
 * Worker-thread entry for the PDF drawing pass.
 *
 * It owns no drawing code of its own: `pdfArtifact.ts` remains the single owner
 * of how a report document is drawn, and this file only runs it somewhere the
 * main event loop cannot feel. A render measured in tens of seconds used to
 * block every request, redis heartbeat and device lease in the process.
 */

import {parentPort, workerData} from 'node:worker_threads';
import {
    type PdfRenderInput,
    type PdfRenderProgress,
    renderPdfDocument
} from './pdfArtifact';

const port = parentPort;
if (!port)
    throw new Error('pdfRenderWorker must be started as a worker thread');

renderPdfDocument(workerData as PdfRenderInput, {
    onProgress: (progress: PdfRenderProgress) =>
        port.postMessage({type: 'progress', ...progress})
})
    .then((result) => port.postMessage({type: 'done', bytes: result.bytes}))
    .catch((error: unknown) =>
        port.postMessage({
            type: 'failed',
            message: error instanceof Error ? error.message : String(error)
        })
    );
