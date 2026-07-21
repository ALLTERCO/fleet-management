/**
 * Trigger a browser file download from a Blob.
 */
export function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Trigger a browser file download from a server URL (already-minted, e.g. a
 * signed firmware-library link). The Blob variant owns object-URL lifecycle;
 * this variant just points an anchor at an existing endpoint.
 */
export function triggerUrlDownload(url: string, filename?: string) {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
