import type {
    McpApprovalEntry,
    McpApprovalListParams,
    McpApprovalListScope,
    McpApprovalRevokeResult
} from '@api/mcp_approval';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {formatRpcError} from '@/helpers/domainErrors';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '../tools/websocket';

export type {McpApprovalEntry, McpApprovalListScope};

interface McpApprovalPage {
    items: McpApprovalEntry[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export const MCP_APPROVAL_PAGE_SIZE = 100;

// Remembered "stop asking" answers people gave AI agents, listed and revoked.
export const useMcpApprovalsStore = defineStore('mcpApprovals', () => {
    const items = ref<McpApprovalEntry[]>([]);
    const total = ref(0);
    const hasMore = ref(false);
    const scope = ref<McpApprovalListScope>('mine');
    const loading = ref(false);
    const loadingMore = ref(false);
    const loaded = ref(false);
    const error = ref('');
    const revokeError = ref('');
    const revokingId = ref<string | null>(null);

    // Fetches and revokes bump, so an older page never lands on newer state.
    const listGuard = createStaleGuard();

    function listApprovals(
        params: McpApprovalListParams
    ): Promise<McpApprovalPage> {
        return ws.sendRPC<McpApprovalPage>(
            'FLEET_MANAGER',
            'mcp_approval.List',
            params
        );
    }

    function revokeApprovalRpc(id: string): Promise<McpApprovalRevokeResult> {
        return ws.sendRPC<McpApprovalRevokeResult>(
            'FLEET_MANAGER',
            'mcp_approval.Revoke',
            {id}
        );
    }

    async function fetchApprovals(
        nextScope: McpApprovalListScope
    ): Promise<void> {
        const token = listGuard.bump();
        // Another scope's rows must not show while this one loads.
        if (nextScope !== scope.value) {
            items.value = [];
            total.value = 0;
            hasMore.value = false;
        }
        scope.value = nextScope;
        loading.value = true;
        error.value = '';
        try {
            const page = await listApprovals({
                scope: nextScope,
                limit: MCP_APPROVAL_PAGE_SIZE,
                offset: 0
            });
            if (listGuard.isStale(token)) return;
            applyPage(page, []);
        } catch (err) {
            if (listGuard.isStale(token)) return;
            items.value = [];
            total.value = 0;
            hasMore.value = false;
            error.value = formatRpcError(
                err,
                'Could not load remembered approvals'
            );
        } finally {
            if (!listGuard.isStale(token)) {
                loading.value = false;
                loaded.value = true;
            }
        }
    }

    async function fetchMore(): Promise<void> {
        const token = listGuard.current();
        loadingMore.value = true;
        error.value = '';
        try {
            const page = await listApprovals({
                scope: scope.value,
                limit: MCP_APPROVAL_PAGE_SIZE,
                offset: items.value.length
            });
            if (listGuard.isStale(token)) return;
            applyPage(page, items.value);
        } catch (err) {
            if (listGuard.isStale(token)) return;
            error.value = formatRpcError(
                err,
                'Could not load more remembered approvals'
            );
        } finally {
            loadingMore.value = false;
        }
    }

    function applyPage(
        page: McpApprovalPage,
        before: McpApprovalEntry[]
    ): void {
        items.value = [...before, ...(page.items ?? [])];
        total.value = page.total;
        hasMore.value = page.has_more;
    }

    /** False when the RPC failed; revokeError then says why. */
    async function revokeApproval(id: string): Promise<boolean> {
        revokingId.value = id;
        revokeError.value = '';
        try {
            // revoked=false means it already ended; either way it is gone.
            await revokeApprovalRpc(id);
            listGuard.bump();
            removeEntry(id);
            return true;
        } catch (err) {
            revokeError.value = formatRpcError(
                err,
                'Could not revoke the approval'
            );
            return false;
        } finally {
            revokingId.value = null;
        }
    }

    function removeEntry(id: string): void {
        const before = items.value.length;
        items.value = items.value.filter((entry) => entry.id !== id);
        if (items.value.length < before) {
            total.value = Math.max(0, total.value - 1);
        }
    }

    return {
        items,
        total,
        hasMore,
        scope,
        loading,
        loadingMore,
        loaded,
        error,
        revokeError,
        revokingId,
        fetchApprovals,
        fetchMore,
        revokeApproval
    };
});
