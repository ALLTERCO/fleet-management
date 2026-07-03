// Parallel reachability probe for preview. URL → HEAD request, assetId
// → DB metadata lookup. Surfaces broken references in the editor rather
// than at first send.

import {envInt} from '../../config/envReader';
import type {EmailAttachment} from '../../types/api/_shared';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {withPublicFetch} from './adapters/_http';

const PROBE_TIMEOUT_MS = envInt(
    'FM_EMAIL_ATTACHMENT_PROBE_TIMEOUT_MS',
    5_000,
    500
);

type AssetMetadataFn = (
    orgId: string,
    id: number
) => Promise<{id: number} | undefined>;
let _getAssetMetadata: AssetMetadataFn | undefined;
async function getAssetMetadataImpl(): Promise<AssetMetadataFn> {
    if (!_getAssetMetadata) {
        _getAssetMetadata = (await import('./emailAssets.js')).getAssetMetadata;
    }
    return _getAssetMetadata as AssetMetadataFn;
}
export function __setAssetMetadataForTests(impl: AssetMetadataFn | null): void {
    _getAssetMetadata = impl ?? undefined;
}

type FetchLike = typeof fetch;
let _fetchImpl: FetchLike = (...args) => fetch(...args);
export function __setProbeFetchForTests(impl: FetchLike | null): void {
    _fetchImpl = impl ?? ((...args) => fetch(...args));
}

export interface ProbedAttachment extends EmailAttachment {
    reachable: boolean;
    error?: string;
}

async function probeUrl(
    a: EmailAttachment & {url: string}
): Promise<ProbedAttachment> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        return await withPublicFetch(
            a.url,
            {
                method: 'HEAD',
                signal: controller.signal,
                headers: {accept: '*/*'},
                redirect: 'error'
            },
            async (res) =>
                res.ok
                    ? {...a, reachable: true}
                    : {...a, reachable: false, error: `HTTP ${res.status}`},
            _fetchImpl
        );
    } catch (err) {
        return {
            ...a,
            reachable: false,
            error: err instanceof Error ? err.message : String(err)
        };
    } finally {
        clearTimeout(timer);
    }
}

async function probeAsset(
    a: EmailAttachment & {assetId: number},
    organizationId: string
): Promise<ProbedAttachment> {
    try {
        const md = await (await getAssetMetadataImpl())(
            organizationId,
            a.assetId
        );
        if (!md) {
            return {...a, reachable: false, error: 'asset not found'};
        }
        return {...a, reachable: true};
    } catch (err) {
        return {
            ...a,
            reachable: false,
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

// Concurrency: cap HEAD/DB probes so 50 attachments in one preview do not
// fire 50 parallel network calls.
const PROBE_CONCURRENCY = 5;

export async function probeAttachments(
    list: EmailAttachment[],
    organizationId: string
): Promise<ProbedAttachment[]> {
    if (list.length === 0) return [];
    const settled = await runBoundedParallel({
        tasks: list,
        run: (a) =>
            a.assetId
                ? probeAsset(
                      a as EmailAttachment & {assetId: number},
                      organizationId
                  )
                : probeUrl(a as EmailAttachment & {url: string}),
        concurrency: PROBE_CONCURRENCY,
        perTaskTimeoutMs: PROBE_TIMEOUT_MS * 2,
        label: 'attachment-probe'
    });
    return settled.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
            ...list[i],
            reachable: false,
            error:
                r.reason instanceof Error ? r.reason.message : String(r.reason)
        };
    });
}
