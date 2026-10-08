import type {
    AuditExportParams,
    AuditExportResponse,
    AuditQueryParams,
    AuditQueryResponse,
    AuditQueryRow
} from '@api/audit';
import type {AuthzAuditEntry, AuthzAuditListParams} from '@api/authz_audit';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import apiClient from '@/helpers/axios';
import {formatRpcError} from '@/helpers/domainErrors';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '../tools/websocket';

export type {AuditExportResponse, AuditQueryRow};

interface AuthzAuditPage {
    items: AuthzAuditEntry[];
    total?: number;
}

export interface AuditSearch {
    /** System audit params; also carries the time range for the authz log. */
    query: AuditQueryParams;
    includeSystem: boolean;
    includeAuthz: boolean;
}

export interface AuditSearchResult {
    rows: AuditQueryRow[];
    /** Tracks only the system-audit page; the authz log pages on its own. */
    hasMore: boolean;
}

// Coerce authz_audit rows into the system row shape so one table shows both.
function authzToAuditRow(e: AuthzAuditEntry): AuditQueryRow {
    return {
        id: Number.parseInt(e.id.replace(/[^0-9]/g, '').slice(0, 12), 10) || 0,
        ts: e.created_at,
        event_type: 'authz',
        username: e.actor_id,
        shelly_id: null,
        shelly_ids: null,
        device_id: null,
        method: e.action,
        params: {
            target_type: e.target_type,
            target_id: e.target_id,
            ...(e.payload ?? {})
        },
        success: true,
        error_message: null,
        ip_address: null,
        agent_key_id: null,
        correlation_id: null
    };
}

const NO_SYSTEM_PAGE: AuditQueryResponse = {
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
    has_more: false
};

export const useAuditLogStore = defineStore('auditLog', () => {
    const searching = ref(false);
    const searchError = ref('');
    const exporting = ref(false);
    const downloading = ref(false);
    const exportError = ref('');

    // Each search bumps, so a slow earlier page cannot replace a newer one.
    const searchGuard = createStaleGuard();

    function queryAudit(params: AuditQueryParams): Promise<AuditQueryResponse> {
        return ws.sendRPC<AuditQueryResponse>(
            'FLEET_MANAGER',
            'Audit.Query',
            params
        );
    }

    function listAuthzAudit(
        params: AuthzAuditListParams
    ): Promise<AuthzAuditPage> {
        return ws.sendRPC<AuthzAuditPage>(
            'FLEET_MANAGER',
            'authz_audit.list',
            params
        );
    }

    function fetchSearchPages(spec: AuditSearch) {
        const {from, to, limit, offset} = spec.query;
        return Promise.all([
            spec.includeSystem
                ? queryAudit(spec.query)
                : Promise.resolve(NO_SYSTEM_PAGE),
            spec.includeAuthz
                ? listAuthzAudit({from, to, limit, offset})
                : Promise.resolve<AuthzAuditPage>({items: []})
        ]);
    }

    /** Null when the search failed (see searchError) or a newer one started. */
    async function search(
        spec: AuditSearch
    ): Promise<AuditSearchResult | null> {
        const token = searchGuard.bump();
        searching.value = true;
        searchError.value = '';
        try {
            const [system, authz] = await fetchSearchPages(spec);
            if (searchGuard.isStale(token)) return null;
            return {
                rows: [
                    ...(system.items ?? []),
                    ...(authz.items ?? []).map(authzToAuditRow)
                ],
                hasMore: Boolean(system.has_more)
            };
        } catch (err) {
            if (searchGuard.isStale(token)) return null;
            searchError.value = formatRpcError(err, 'Search failed');
            return null;
        } finally {
            if (!searchGuard.isStale(token)) searching.value = false;
        }
    }

    async function exportAudit(
        params: AuditExportParams
    ): Promise<AuditExportResponse | null> {
        exporting.value = true;
        exportError.value = '';
        try {
            return await ws.sendRPC<AuditExportResponse>(
                'FLEET_MANAGER',
                'Audit.Export',
                params
            );
        } catch (err) {
            exportError.value = formatRpcError(
                err,
                'Failed to generate export'
            );
            return null;
        } finally {
            exporting.value = false;
        }
    }

    /** Mints a one-time download URL for a finished export. */
    async function mintDownloadUrl(
        info: AuditExportResponse
    ): Promise<string | null> {
        downloading.value = true;
        exportError.value = '';
        try {
            const res = await apiClient.post<{downloadUrl: string}>(
                info.downloadTicketUrl
            );
            return res.data.downloadUrl;
        } catch (err) {
            exportError.value = formatRpcError(
                err,
                'Failed to download export'
            );
            return null;
        } finally {
            downloading.value = false;
        }
    }

    // A new visit starts clean, not with the last visit's failure.
    function clearMessages(): void {
        searchError.value = '';
        exportError.value = '';
    }

    return {
        searching,
        searchError,
        exporting,
        downloading,
        exportError,
        clearMessages,
        search,
        exportAudit,
        mintDownloadUrl
    };
});
