// Shared helpers for email attachments. envReader is used direct (not
// via tuning) to dodge the config/index.ts TDZ chain under test loaders.

import {envInt} from '../../config/envReader';
import RpcError from '../../rpc/RpcError';
import type {EmailAttachment} from '../../types/api/_shared';

function str(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function posInt(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) && v > 0
        ? v
        : undefined;
}

// Best-effort parse — malformed entries are dropped. Schema validation
// has already run at this point for RPC-sourced configs; DB-sourced
// configs may contain stale shapes.
export function parseEmailAttachments(raw: unknown): EmailAttachment[] {
    if (!Array.isArray(raw)) return [];
    const out: EmailAttachment[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const filename = str(rec.filename);
        if (!filename) continue;
        const url = str(rec.url);
        const assetId = posInt(rec.assetId);
        if (!url && !assetId) continue;
        if (url && assetId) continue; // invalid shape, skip
        const att: EmailAttachment = {filename};
        if (url) att.url = url;
        if (assetId) att.assetId = assetId;
        const cid = str(rec.cid);
        if (cid) att.cid = cid;
        const contentType = str(rec.contentType);
        if (contentType) att.contentType = contentType;
        out.push(att);
    }
    return out;
}

/** Reject write if count > FM_EMAIL_MAX_ATTACHMENTS, or if any item has
 *  a bad url/assetId shape. Returns normally on no-op / valid input. */
export function enforceEmailAttachmentLimit(attachments: unknown): void {
    if (!Array.isArray(attachments)) return;
    const cap = envInt('FM_EMAIL_MAX_ATTACHMENTS', 10, 0);
    if (attachments.length > cap) {
        throw RpcError.InvalidParams(
            `Too many attachments — limit is ${cap} (FM_EMAIL_MAX_ATTACHMENTS). Got ${attachments.length}.`
        );
    }
    for (const [i, item] of attachments.entries()) {
        if (!item || typeof item !== 'object') {
            throw RpcError.InvalidParams(`attachments[${i}] must be an object`);
        }
        const rec = item as Record<string, unknown>;
        const hasUrl = typeof rec.url === 'string' && rec.url.length > 0;
        const hasAsset = typeof rec.assetId === 'number' && rec.assetId > 0;
        if (hasUrl === hasAsset) {
            throw RpcError.InvalidParams(
                `attachments[${i}] must have exactly one of "url" or "assetId"`
            );
        }
    }
}
