// 2s System.GetTopology polling, paused when the tab is hidden.

import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import {findBottleneck} from '@/helpers/bottleneck';
import {sendRPC} from '@/tools/websocket';
import type {TopologySnapshot} from '@/types/topology';

const POLL_INTERVAL_MS = 2000;
const EDGE_HISTORY_LENGTH = 15;
const STALE_AFTER_MS = 10_000;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

export interface NodeStatsSample {
    ts: number;
    stats: Record<string, unknown>;
}

export const useTopologyStore = defineStore('topology', () => {
    const current = ref<TopologySnapshot | null>(null);
    const previous = ref<TopologySnapshot | null>(null);
    const edgeHistory = ref(new Map<string, number[]>());
    const nodeHistory = ref(new Map<string, NodeStatsSample[]>());
    const schemaUnsupported = ref(false);
    const lastError = ref<string | null>(null);

    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let visibilityHandler: (() => void) | null = null;
    let refCount = 0;

    const isStale = computed(() => {
        const c = current.value;
        if (!c) return false;
        return Date.now() - c.generatedAt > STALE_AFTER_MS;
    });

    const bottleneckId = computed<string | null>(() => {
        const snap = current.value;
        if (!snap) return null;
        return findBottleneck({
            nodes: snap.nodes,
            edges: snap.edges,
            edgeHistory: edgeHistory.value
        });
    });

    async function pollOnce(): Promise<void> {
        try {
            ingestSnapshot(await requestTopologySnapshot());
        } catch (err) {
            recordPollFailure(err);
        }
    }

    async function requestTopologySnapshot(): Promise<TopologySnapshot> {
        return await sendRPC<TopologySnapshot>(
            'FLEET_MANAGER',
            'System.GetTopology',
            {}
        );
    }

    function recordPollFailure(err: unknown): void {
        lastError.value = stringifyError(err);
    }

    function ingestSnapshot(snap: TopologySnapshot): void {
        if (!SUPPORTED_SCHEMA_VERSIONS.has(snap.schemaVersion)) {
            schemaUnsupported.value = true;
            return;
        }
        schemaUnsupported.value = false;
        lastError.value = null;
        previous.value = current.value;
        current.value = snap;
        recordEdgeHistory(snap);
        recordNodeHistory(snap);
    }

    function recordEdgeHistory(snap: TopologySnapshot): void {
        for (const edge of snap.edges) {
            const series = edgeHistory.value.get(edge.id) ?? [];
            series.push(edge.throughput);
            if (series.length > EDGE_HISTORY_LENGTH) series.shift();
            edgeHistory.value.set(edge.id, series);
        }
    }

    function recordNodeHistory(snap: TopologySnapshot): void {
        for (const node of snap.nodes) {
            const series = nodeHistory.value.get(node.id) ?? [];
            series.push({ts: snap.generatedAt, stats: node.stats});
            if (series.length > EDGE_HISTORY_LENGTH) series.shift();
            nodeHistory.value.set(node.id, series);
        }
    }

    function startPolling(): void {
        refCount++;
        if (pollHandle) return;
        attachVisibilityHandler();
        if (isDocumentVisible()) beginInterval();
        void pollOnce();
    }

    function stopPolling(): void {
        refCount = Math.max(0, refCount - 1);
        if (refCount > 0) return;
        endInterval();
        detachVisibilityHandler();
    }

    function beginInterval(): void {
        if (pollHandle) return;
        pollHandle = setInterval(pollOnce, POLL_INTERVAL_MS);
    }

    function endInterval(): void {
        if (pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
        }
    }

    function attachVisibilityHandler(): void {
        if (visibilityHandler || typeof document === 'undefined') return;
        visibilityHandler = () => {
            if (isDocumentVisible()) {
                beginInterval();
                void pollOnce();
            } else {
                endInterval();
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
    }

    function detachVisibilityHandler(): void {
        if (!visibilityHandler || typeof document === 'undefined') return;
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }

    return {
        current,
        previous,
        edgeHistory,
        nodeHistory,
        schemaUnsupported,
        lastError,
        isStale,
        bottleneckId,
        startPolling,
        stopPolling
    };
});

function isDocumentVisible(): boolean {
    return (
        typeof document === 'undefined' ||
        document.visibilityState === 'visible'
    );
}

function stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : 'Unknown error';
}
