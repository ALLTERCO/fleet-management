// Dead letter view for meter history: list the blocks PostgreSQL rejected
// and queue one again after the cause is fixed. Scope is resolved like
// Energy.SyncStatus so a caller only sees devices it may read.

import type {EmSyncBlock} from '../../modules/device/emSyncCoalescer';
import type {EmSyncRejectedRow} from '../../modules/repositories/EmSyncRejectedRepository';
import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyRejectedSyncBlocksParams,
    EnergyRejectedSyncBlocksResponse,
    EnergyRequeueRejectedSyncBlockParams,
    EnergyRequeueRejectedSyncBlockResponse
} from '../../types/api/energy';
import {resolveScope, type SenderCapabilities} from './queryHandler';

const DEFAULT_LIMIT = 100;

export interface RejectedSyncBlockStore {
    list(input: {
        devices: readonly number[];
        openOnly: boolean;
        limit: number;
    }): Promise<EmSyncRejectedRow[]>;
    countOpen(devices: readonly number[]): Promise<number>;
    get(input: {
        id: number;
        devices: readonly number[];
    }): Promise<{id: number; block: EmSyncBlock} | null>;
    take(input: {
        id: number;
        devices: readonly number[];
        by: string;
    }): Promise<{id: number; block: EmSyncBlock} | null>;
}

export async function handleRejectedSyncBlocks(
    validated: EnergyRejectedSyncBlocksParams,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    store: RejectedSyncBlockStore
): Promise<EnergyRejectedSyncBlocksResponse> {
    if (validated.scope !== undefined && validated.devices !== undefined) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }
    const resolved = await resolveScope(sender, validated, repo);
    const [rows, openCount] = await Promise.all([
        store.list({
            devices: resolved.internalIds,
            openOnly: validated.openOnly ?? true,
            limit: validated.limit ?? DEFAULT_LIMIT
        }),
        store.countOpen(resolved.internalIds)
    ]);
    return {
        openCount,
        blocks: rows.map((row) => ({
            ...row,
            shellyID: resolved.idMap[row.device] ?? ''
        }))
    };
}

export async function handleRequeueRejectedSyncBlock(
    validated: EnergyRequeueRejectedSyncBlockParams,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    store: RejectedSyncBlockStore,
    enqueue: (block: EmSyncBlock) => Promise<boolean>
): Promise<EnergyRequeueRejectedSyncBlockResponse> {
    const resolved = await resolveScope(sender, {}, repo);
    const scope = {id: validated.id, devices: resolved.internalIds};
    const open = await store.get(scope);
    if (!open) throw RpcError.NotFound('rejected_sync_block', validated.id);
    // Queue first, mark second: a mark without a queued block would hide the
    // gap again. A second caller in between queues the same block twice,
    // which the append function's dedup makes harmless.
    const queued = await enqueue(open.block);
    if (!queued) {
        throw RpcError.Unavailable(
            'em-sync buffer',
            'buffer refused the block'
        );
    }
    const taken = await store.take({
        ...scope,
        by: sender.getUserId?.() ?? 'unknown'
    });
    return {id: open.id, queued: taken !== null};
}
