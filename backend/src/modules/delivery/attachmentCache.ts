// Byte cache for fetched email attachments. Callers provide already-scoped
// keys (for example org + URL, or org + asset id). Bounded by total bytes,
// evicts LRU.

import {envInt} from '../../config/envReader';

const MAX_BYTES = envInt(
    'FM_EMAIL_ATTACHMENT_CACHE_MAX_BYTES',
    50 * 1024 * 1024,
    0
);
const TTL_MS = envInt('FM_EMAIL_ATTACHMENT_CACHE_TTL_MS', 10 * 60_000, 1_000);

interface Entry {
    content: Buffer;
    expiresAt: number;
}

const store = new Map<string, Entry>();
let totalBytes = 0;

function now(): number {
    return Date.now();
}

export function getAttachmentCacheEntry(url: string): Buffer | undefined {
    if (MAX_BYTES === 0) return undefined;
    const hit = store.get(url);
    if (!hit) return undefined;
    if (hit.expiresAt <= now()) {
        store.delete(url);
        totalBytes -= hit.content.byteLength;
        return undefined;
    }
    // Refresh LRU position — Map iteration order = insertion order.
    store.delete(url);
    store.set(url, hit);
    return hit.content;
}

export function setAttachmentCacheEntry(url: string, content: Buffer): void {
    if (MAX_BYTES === 0) return;
    if (content.byteLength > MAX_BYTES) return; // single item larger than cap
    const existing = store.get(url);
    if (existing) {
        totalBytes -= existing.content.byteLength;
        store.delete(url);
    }
    while (totalBytes + content.byteLength > MAX_BYTES) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        const ev = store.get(oldest);
        if (ev) totalBytes -= ev.content.byteLength;
        store.delete(oldest);
    }
    store.set(url, {content, expiresAt: now() + TTL_MS});
    totalBytes += content.byteLength;
}

export function clearAttachmentCache(): void {
    store.clear();
    totalBytes = 0;
}

export function __attachmentCacheStatsForTests(): {
    entries: number;
    bytes: number;
} {
    return {entries: store.size, bytes: totalBytes};
}
