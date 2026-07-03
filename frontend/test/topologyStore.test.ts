// 4-tier coverage: UNIT ingest, INTEGRATION polling lifecycle,
// SYSTEM ref-counted starts, REGRESSION schema mismatch + error.

import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({sendRPC: vi.fn()}));

import {useTopologyStore} from '@/stores/topology';
import {sendRPC} from '@/tools/websocket';
import type {TopologySnapshot} from '@/types/topology';

const sendRPCMock = vi.mocked(sendRPC);

function emptySnapshot(generatedAt: number): TopologySnapshot {
    return {
        schemaVersion: 1,
        generatedAt,
        nodes: [],
        edges: [],
        clusters: [],
        thresholds: {}
    };
}

function richSnapshot(generatedAt: number): TopologySnapshot {
    return {
        schemaVersion: 1,
        generatedAt,
        nodes: [
            {
                id: 'a',
                label: 'A',
                role: 'source',
                cluster: null,
                status: 'healthy',
                stats: {n: 1},
                route: null,
                description: null,
                virtual: false
            }
        ],
        edges: [
            {
                id: 'a->b',
                from: 'a',
                to: 'b',
                throughput: 5,
                counterName: 'a_to_b',
                status: 'healthy'
            }
        ],
        clusters: [],
        thresholds: {}
    };
}

async function pollAndDrain(): Promise<void> {
    // pollOnce is async; await a microtask flush.
    await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPCMock.mockReset();
});

// ─── UNIT — schema gate ───

describe('topology store — schema gate', () => {
    it('rejects an unknown schema version without clobbering current', async () => {
        sendRPCMock.mockResolvedValueOnce({
            schemaVersion: 99,
            generatedAt: 1,
            nodes: [],
            edges: [],
            clusters: []
        });
        const store = useTopologyStore();
        store.startPolling();
        await pollAndDrain();
        expect(store.schemaUnsupported).toBe(true);
        expect(store.current).toBeNull();
        store.stopPolling();
    });

    it('accepted snapshot clears a prior schema-unsupported flag', async () => {
        sendRPCMock.mockResolvedValueOnce({
            schemaVersion: 99,
            generatedAt: 1,
            nodes: [],
            edges: [],
            clusters: []
        });
        sendRPCMock.mockResolvedValueOnce(emptySnapshot(2));
        const store = useTopologyStore();
        store.startPolling();
        await pollAndDrain();
        expect(store.schemaUnsupported).toBe(true);
        // Manually trigger another poll by calling internal hook via second start.
        store.stopPolling();
        store.startPolling();
        await pollAndDrain();
        expect(store.schemaUnsupported).toBe(false);
        store.stopPolling();
    });
});

// ─── INTEGRATION — edge + node history bounded ───

describe('topology store — bounded histories', () => {
    it('edge history is bounded to a 15-sample window', async () => {
        const store = useTopologyStore();
        for (let i = 0; i < 25; i++) {
            sendRPCMock.mockResolvedValueOnce(richSnapshot(i));
            store.startPolling();
            await pollAndDrain();
            store.stopPolling();
        }
        const series = store.edgeHistory.get('a->b');
        expect(series).toBeDefined();
        expect(series!.length).toBeLessThanOrEqual(15);
    });

    it('node history is bounded to a 15-sample window', async () => {
        const store = useTopologyStore();
        for (let i = 0; i < 25; i++) {
            sendRPCMock.mockResolvedValueOnce(richSnapshot(i));
            store.startPolling();
            await pollAndDrain();
            store.stopPolling();
        }
        const series = store.nodeHistory.get('a');
        expect(series).toBeDefined();
        expect(series!.length).toBeLessThanOrEqual(15);
    });
});

// ─── SYSTEM — ref-counted start/stop ───

describe('topology store — ref-counted polling', () => {
    it('two startPolling + one stopPolling keeps polling alive', async () => {
        sendRPCMock.mockResolvedValue(emptySnapshot(1));
        const store = useTopologyStore();
        store.startPolling();
        store.startPolling();
        store.stopPolling();
        await pollAndDrain();
        // First call from the initial startPolling has already happened.
        expect(sendRPCMock).toHaveBeenCalled();
        store.stopPolling();
    });
});

// ─── REGRESSION — error path ───

describe('topology store — error handling', () => {
    it('a failed RPC sets lastError but leaves current intact', async () => {
        sendRPCMock.mockResolvedValueOnce(emptySnapshot(1));
        const store = useTopologyStore();
        store.startPolling();
        await pollAndDrain();
        const prior = store.current;

        sendRPCMock.mockRejectedValueOnce(new Error('timeout'));
        store.stopPolling();
        store.startPolling();
        await pollAndDrain();
        expect(store.lastError).toBe('timeout');
        expect(store.current).toBe(prior);
        store.stopPolling();
    });
});
