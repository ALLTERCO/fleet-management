import type {
    AlertComponentPath,
    AlertInstance,
    AlertInstanceGetManyResult,
    AlertInstanceListFilters,
    AlertInstanceListPage,
    AlertMetricPath,
    AlertRule,
    AlertRuleFiring,
    AlertRuleKind,
    AlertRuleKindDescriptor,
    AlertRulePreviewMatch,
    AlertRuleTemplate,
    AlertSeverity,
    AlertState,
    AlertTransition,
    ScopeSelector
} from '@api/alert';
import type {MessageTemplate, MessageTemplateBodies} from '@api/notification';
import {defineStore} from 'pinia';
import {onScopeDispose, ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {
    type CursorPass,
    paginateByCursor
} from '@/shell/template-host/core/pagination';
import {createStaleGuard} from '@/stores/staleGuard';
import {ALERT_EVENT} from '@/tools/wsEvents';
import {logCountDrift, recheckWhileVisible} from '../tools/hiddenTabDeferral';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {
    AlertComponentPath,
    AlertInstance,
    AlertMetricPath,
    AlertRule,
    AlertRuleFiring,
    AlertRuleKind,
    AlertRuleKindDescriptor,
    AlertRulePreviewMatch,
    AlertRuleTemplate,
    AlertSeverity,
    AlertState,
    AlertTransition,
    MessageTemplate,
    MessageTemplateBodies,
    ScopeSelector
};

export interface MessageTemplateDraft {
    name: string;
    description?: string | null;
    bodies?: MessageTemplateBodies;
    fallbackText: string;
}

const MAX_PER_PAGE = 1000;
// Live screens need the open alerts only; past this the pass stops and says so.
const OPEN_LIST_MAX_PAGES = 10;
const HISTORY_PAGE_SIZE = 100;
// alert.instance.getmany refuses more ids than this.
const GET_MANY_MAX_IDS = 100;

export interface CreateAlertRuleParams {
    name: string;
    kind: AlertRuleKind;
    enabled?: boolean;
    severity: AlertSeverity;
    scope: ScopeSelector;
    /** Channels the rule notifies directly. */
    destinationChannelIds: number[];
    destinationGroupIds: number[];
    dedupeWindowSec?: number;
    cooldownSec?: number;
    summaryTemplate?: string | null;
    messageTemplate?: string | null;
    runbookUrl?: string | null;
    autoResolve?: boolean;
    /** Fire once, notify, then disable the rule. */
    triggerOnce?: boolean;
    config?: Record<string, unknown>;
    deliveryMode?: 'instant' | 'digest';
    digestWindowMinutes?: number | null;
    /** When the rule may fire. null = always. */
    activeWindow?: {
        startTime: string;
        endTime: string;
        daysMask: number;
        timezone: string | null;
    } | null;
    /** Reusable message template this rule renders from; null = inline wording. */
    templateId?: number | null;
}

export type UpdateAlertRulePatch = Partial<Omit<CreateAlertRuleParams, 'kind'>>;

/** Server-side list filters; every given filter must match. */
export type InstanceFilters = AlertInstanceListFilters;

export type FetchFailureOptions = {
    failureMode?: 'notify' | 'throw';
};

/** One Alert.* WS event: the id and the fields the server sends with it. */
export interface AlertInstanceEvent {
    method: string;
    alertId: number;
    state?: unknown;
    severity?: unknown;
}

export interface HistoryPageRequest {
    cursor?: string | null;
    filters?: InstanceFilters;
}

export interface HistoryPage {
    items: AlertInstance[];
    nextCursor: string | null;
    hasMore: boolean;
}

// Exhaustive by type, so the event patch accepts only real values.
const KNOWN_STATES: Record<AlertState, true> = {
    pending: true,
    active: true,
    acknowledged: true,
    recovering: true,
    cleared_unack: true,
    cleared_ack: true,
    no_data: true,
    evaluation_error: true,
    resolved: true
};
const KNOWN_SEVERITIES: Record<AlertSeverity, true> = {
    info: true,
    warning: true,
    critical: true
};

function isAlertState(value: unknown): value is AlertState {
    return typeof value === 'string' && Object.hasOwn(KNOWN_STATES, value);
}

function isAlertSeverity(value: unknown): value is AlertSeverity {
    return typeof value === 'string' && Object.hasOwn(KNOWN_SEVERITIES, value);
}

function patchFromEvent(
    row: AlertInstance,
    event: AlertInstanceEvent
): AlertInstance {
    return {
        ...row,
        ...(isAlertState(event.state) ? {state: event.state} : {}),
        ...(isAlertSeverity(event.severity) ? {severity: event.severity} : {})
    };
}

function hasFilter(filters: InstanceFilters): boolean {
    return Object.values(filters).some((v) => v !== undefined && v !== '');
}

function chunks<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

// Open = not resolved, the server's one definition (resolved_at IS NULL).
function isOpen(row: AlertInstance): boolean {
    return row.resolvedAt === null;
}

function mergeListed(
    current: Record<number, AlertInstance>,
    listed: readonly AlertInstance[],
    dropOpenNotListed: boolean
): Record<number, AlertInstance> {
    const next = {...current};
    if (dropOpenNotListed) {
        for (const row of Object.values(next)) {
            if (isOpen(row)) delete next[row.id];
        }
    }
    for (const row of listed) next[row.id] = row;
    return next;
}

export const useAlertsStore = defineStore('alerts', () => {
    const toast = useToastStore();

    const rules = ref<Record<number, AlertRule>>({});
    const instances = ref<Record<number, AlertInstance>>({});
    const transitions = ref<Record<number, AlertTransition[]>>({});
    // Distinguishes "fetched, and there truly is no history" (empty array,
    // flag false) from "the fetch itself failed" (flag true) — both leave
    // `transitions[id]` looking empty otherwise.
    const transitionsError = ref<Record<number, boolean>>({});
    const kinds = ref<AlertRuleKindDescriptor[]>([]);
    const templates = ref<Record<number, MessageTemplate>>({});
    const templatesLoading = ref(true);
    const rulesLoading = ref(true);
    const instancesLoading = ref(true);
    // True count of resolved alerts: read once with the first history page,
    // then moved by resolved events. Null until that page has been read.
    const historyTotal = ref<number | null>(null);
    // Moves with every resolved event counted, so a re-read can tell it was overtaken.
    let historyEventSeq = 0;
    let totalRecheck: Promise<void> | null = null;
    // Starts with the first loaded total; before that there is nothing to re-read.
    let countRecheck: {dispose(): void} | undefined;

    function upsertTemplate(t: MessageTemplate) {
        templates.value = {...templates.value, [t.id]: t};
    }

    function upsertRule(rule: AlertRule) {
        rules.value = {...rules.value, [rule.id]: rule};
    }
    function upsertInstance(inst: AlertInstance) {
        instances.value = {...instances.value, [inst.id]: inst};
    }

    async function fetchKinds(): Promise<AlertRuleKindDescriptor[]> {
        if (kinds.value.length > 0) return kinds.value;
        try {
            const res = await ws.sendRPC<{items: AlertRuleKindDescriptor[]}>(
                'FLEET_MANAGER',
                'alert.rule.listkinds',
                {}
            );
            kinds.value = res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load rule types');
        }
        return kinds.value;
    }

    // List fetches bump for latest-wins; mutation writes bump so stale reads bail.
    const rulesGuard = createStaleGuard();
    // Instance writes bump this; every instance read checks it.
    const instancesGuard = createStaleGuard();
    // Latest list wins: an older list response never clobbers a newer one.
    const instanceListGuard = createStaleGuard();
    let openResync: Promise<void> | null = null;
    const templatesGuard = createStaleGuard();
    const transitionsGuard = createStaleGuard();

    async function fetchRules() {
        const token = rulesGuard.bump();
        rulesLoading.value = true;
        try {
            const items = await paginate<AlertRule>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<AlertRule>>(
                        'FLEET_MANAGER',
                        'alert.rule.list',
                        {limit: MAX_PER_PAGE, offset}
                    ),
                MAX_PER_PAGE
            );
            if (rulesGuard.isStale(token)) return;
            const next: Record<number, AlertRule> = {};
            for (const r of items) next[r.id] = r;
            rules.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load alert rules');
        } finally {
            rulesLoading.value = false;
        }
    }

    async function fetchRule(id: number): Promise<AlertRule | null> {
        // Read: snapshot before the RPC; a write mid-flight discards the merge.
        const token = rulesGuard.current();
        try {
            const rule = await ws.sendRPC<AlertRule>(
                'FLEET_MANAGER',
                'alert.rule.get',
                {id}
            );
            if (!rulesGuard.isStale(token)) upsertRule(rule);
            return rule;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load rule');
            return null;
        }
    }

    async function createRule(
        params: CreateAlertRuleParams
    ): Promise<AlertRule | null> {
        try {
            const rule = await ws.sendRPC<AlertRule>(
                'FLEET_MANAGER',
                'alert.rule.create',
                params
            );
            rulesGuard.bump();
            upsertRule(rule);
            return rule;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create rule');
            return null;
        }
    }

    async function updateRule(
        id: number,
        patch: UpdateAlertRulePatch
    ): Promise<AlertRule | null> {
        try {
            const rule = await ws.sendRPC<AlertRule>(
                'FLEET_MANAGER',
                'alert.rule.update',
                {id, patch}
            );
            rulesGuard.bump();
            upsertRule(rule);
            return rule;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update rule');
            return null;
        }
    }

    async function deleteRule(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'alert.rule.delete', {id});
            rulesGuard.bump();
            const next = {...rules.value};
            delete next[id];
            rules.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete rule');
            return false;
        }
    }

    function listPass(
        params: Record<string, unknown>,
        maxPages?: number
    ): Promise<CursorPass<AlertInstance>> {
        return paginateByCursor(
            (cursor) =>
                ws.sendRPC<AlertInstanceListPage>(
                    'FLEET_MANAGER',
                    'alert.instance.list',
                    {
                        ...params,
                        limit: MAX_PER_PAGE,
                        ...(cursor ? {cursor} : {})
                    }
                ),
            maxPages
        );
    }

    async function loadInstanceList(
        query: {params: Record<string, unknown>; open: boolean},
        options: FetchFailureOptions
    ): Promise<void> {
        const listToken = instanceListGuard.bump();
        const writeToken = instancesGuard.current();
        instancesLoading.value = true;
        try {
            const pass = await listPass(
                query.params,
                query.open ? OPEN_LIST_MAX_PAGES : undefined
            );
            if (instanceListGuard.isStale(listToken)) return;
            if (instancesGuard.isStale(writeToken)) return;
            if (!pass.complete) {
                console.warn(
                    `[alerts] open alert list stopped after ${pass.items.length} rows`
                );
            }
            instances.value = mergeListed(
                instances.value,
                pass.items,
                query.open && pass.complete
            );
        } catch (err) {
            if (options.failureMode === 'throw') throw err;
            toastRpcError(toast, err, 'Failed to load alert instances');
        } finally {
            instancesLoading.value = false;
        }
    }

    /** No filter loads the open alerts only; history is fetchHistoryPage. */
    function fetchInstances(
        filters: InstanceFilters = {},
        options: FetchFailureOptions = {}
    ): Promise<void> {
        if (!hasFilter(filters)) {
            return loadInstanceList(
                {params: {open: true}, open: true},
                options
            );
        }
        return loadInstanceList({params: {...filters}, open: false}, options);
    }

    async function readHistoryTotal(): Promise<number | null> {
        const page = await ws.sendRPC<AlertInstanceListPage>(
            'FLEET_MANAGER',
            'alert.instance.list',
            {open: false, limit: 1, offset: 0}
        );
        return typeof page.total === 'number' ? page.total : null;
    }

    // Events that land during a read make its value stale: read once more,
    // and if events still move the total, keep the live local value.
    async function recheckHistoryTotal(): Promise<void> {
        try {
            let seq = historyEventSeq;
            let server = await readHistoryTotal();
            if (seq !== historyEventSeq) {
                seq = historyEventSeq;
                server = await readHistoryTotal();
                if (seq !== historyEventSeq) return;
            }
            const local = historyTotal.value;
            if (server === null || local === null || server === local) return;
            logCountDrift('alert history', local, server);
            historyTotal.value = server;
        } catch (err) {
            console.warn('[alerts] history total re-check failed:', err);
        }
    }

    // Push events can be lost: re-read a total someone already loaded.
    function reconcileHistoryTotal(): Promise<void> {
        if (historyTotal.value === null) return Promise.resolve();
        totalRecheck ??= recheckHistoryTotal().finally(() => {
            totalRecheck = null;
        });
        return totalRecheck;
    }

    onScopeDispose(() => countRecheck?.dispose());

    /** One bounded open-only pass after a reconnect or a stream gap. */
    function resyncOpenInstances(): Promise<void> {
        openResync ??= fetchInstances().finally(() => {
            openResync = null;
        });
        return openResync;
    }

    async function fetchHistoryPage(
        request: HistoryPageRequest = {}
    ): Promise<HistoryPage> {
        const writeToken = instancesGuard.current();
        try {
            const page = await ws.sendRPC<AlertInstanceListPage>(
                'FLEET_MANAGER',
                'alert.instance.list',
                {
                    ...request.filters,
                    open: false,
                    limit: HISTORY_PAGE_SIZE,
                    ...(request.cursor ? {cursor: request.cursor} : {})
                }
            );
            if (!instancesGuard.isStale(writeToken)) {
                instances.value = mergeListed(
                    instances.value,
                    page.items,
                    false
                );
            }
            // The total of a filtered page counts the matches, not the history.
            const unfiltered = !hasFilter(request.filters ?? {});
            if (
                !request.cursor &&
                unfiltered &&
                typeof page.total === 'number'
            ) {
                historyTotal.value = page.total;
                countRecheck ??= recheckWhileVisible(
                    () => void reconcileHistoryTotal()
                );
            }
            return {
                items: page.items,
                nextCursor: page.next_cursor,
                hasMore: page.has_more
            };
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load alert history');
            return {items: [], nextCursor: null, hasMore: false};
        }
    }

    function applyReadRows(result: AlertInstanceGetManyResult): void {
        const next = {...instances.value};
        for (const id of result.missingIds) delete next[id];
        for (const row of result.items) next[row.id] = row;
        instances.value = next;
    }

    /** Reads the given ids, at most GET_MANY_MAX_IDS per call. */
    async function fetchInstancesByIds(ids: readonly number[]): Promise<void> {
        for (const chunk of chunks(ids, GET_MANY_MAX_IDS)) {
            const token = instancesGuard.current();
            try {
                const result = await ws.sendRPC<AlertInstanceGetManyResult>(
                    'FLEET_MANAGER',
                    'alert.instance.getmany',
                    {ids: chunk}
                );
                if (!instancesGuard.isStale(token)) applyReadRows(result);
            } catch (err) {
                toastRpcError(toast, err, 'Failed to load alert instances');
                return;
            }
        }
    }

    function patchInstancesFromEvents(
        events: readonly AlertInstanceEvent[]
    ): void {
        const next = {...instances.value};
        for (const event of events) {
            const row = next[event.alertId];
            if (row) next[event.alertId] = patchFromEvent(row, event);
        }
        instances.value = next;
    }

    // A resolved alert this tab never held is history: nothing to show.
    function idsToRead(events: readonly AlertInstanceEvent[]): number[] {
        const ids = new Set<number>();
        for (const event of events) {
            const held = event.alertId in instances.value;
            if (event.method === ALERT_EVENT.RESOLVED && !held) continue;
            ids.add(event.alertId);
        }
        return [...ids];
    }

    // A resolved event for an alert not yet resolved here is one more in history.
    function countNewlyResolved(events: readonly AlertInstanceEvent[]): void {
        if (historyTotal.value === null) return;
        const seen = new Set<number>();
        for (const event of events) {
            if (event.method !== ALERT_EVENT.RESOLVED) continue;
            if (seen.has(event.alertId)) continue;
            seen.add(event.alertId);
            if (instances.value[event.alertId]?.state !== 'resolved') {
                historyTotal.value += 1;
                historyEventSeq++;
            }
        }
    }

    /** Applies a burst of Alert.* events: patch held rows, then read the ids. */
    async function syncInstancesFromEvents(
        events: readonly AlertInstanceEvent[]
    ): Promise<void> {
        const ids = idsToRead(events);
        countNewlyResolved(events);
        patchInstancesFromEvents(events);
        await fetchInstancesByIds(ids);
    }

    async function fetchInstance(id: number): Promise<AlertInstance | null> {
        // Read: snapshot before the RPC; an ack/write mid-flight discards the merge.
        const token = instancesGuard.current();
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.get',
                {id}
            );
            if (!instancesGuard.isStale(token)) upsertInstance(inst);
            return inst;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load alert instance');
            return null;
        }
    }

    async function fetchTransitions(id: number): Promise<AlertTransition[]> {
        // List fetch: bump so the latest fetch wins between racing fetches.
        const token = transitionsGuard.bump();
        try {
            const items = await paginate<AlertTransition>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<AlertTransition>>(
                        'FLEET_MANAGER',
                        'alert.instance.listtransitions',
                        {id, limit: MAX_PER_PAGE, offset}
                    ),
                MAX_PER_PAGE
            );
            if (transitionsGuard.isStale(token)) return items;
            transitions.value = {...transitions.value, [id]: items};
            transitionsError.value = {...transitionsError.value, [id]: false};
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load transitions');
            if (!transitionsGuard.isStale(token)) {
                transitionsError.value = {
                    ...transitionsError.value,
                    [id]: true
                };
            }
            return [];
        }
    }

    async function ackInstance(id: number): Promise<boolean> {
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.ack',
                {id}
            );
            instancesGuard.bump();
            upsertInstance(inst);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to acknowledge');
            return false;
        }
    }

    async function unackInstance(id: number): Promise<boolean> {
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.unack',
                {id}
            );
            instancesGuard.bump();
            upsertInstance(inst);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to unacknowledge');
            return false;
        }
    }

    async function silenceInstance(
        id: number,
        until: string,
        reason?: string | null
    ): Promise<boolean> {
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.silence',
                {id, until, ...(reason ? {reason} : {})}
            );
            instancesGuard.bump();
            upsertInstance(inst);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to silence');
            return false;
        }
    }

    async function unsilenceInstance(id: number): Promise<boolean> {
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.unsilence',
                {id}
            );
            instancesGuard.bump();
            upsertInstance(inst);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to unsilence');
            return false;
        }
    }

    async function resolveInstance(id: number): Promise<boolean> {
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.resolvemanual',
                {id}
            );
            instancesGuard.bump();
            upsertInstance(inst);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to resolve');
            return false;
        }
    }

    // Live instance updates arrive via the WS dispatcher's coalesced burst
    // (websocket.ts), which calls syncInstancesFromEvents here.

    // Discriminated so callers can tell "check failed" from "no duplicate".
    async function checkDuplicate(spec: {
        kind: AlertRuleKind;
        severity: AlertSeverity;
        scope: ScopeSelector;
        dedupeWindowSec?: number;
        cooldownSec?: number;
        config?: Record<string, unknown>;
        excludeId?: number;
    }): Promise<
        | {status: 'ok'; duplicate: {id: number; name: string} | null}
        | {status: 'error'}
    > {
        try {
            const res = await ws.sendRPC<{
                duplicate: {id: number; name: string} | null;
            }>('FLEET_MANAGER', 'alert.rule.checkduplicate', spec);
            return {status: 'ok', duplicate: res.duplicate};
        } catch {
            return {status: 'error'};
        }
    }

    // Starter rule templates come solely from the backend (Rule.ListTemplates);
    // it seeds the global set, so the frontend keeps no built-in copies.
    async function listTemplates(
        category?: string
    ): Promise<AlertRuleTemplate[]> {
        try {
            const res = await ws.sendRPC<{items: AlertRuleTemplate[]}>(
                'FLEET_MANAGER',
                'alert.rule.listtemplates',
                category ? {category} : {}
            );
            return res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load templates');
            return [];
        }
    }

    async function createFromTemplate(params: {
        templateKey: string;
        name: string;
        scope: ScopeSelector;
        destinationGroupIds: number[];
        // Channels are what the quick path collects; the RPC has always
        // accepted them, the store signature just never offered them.
        destinationChannelIds?: number[];
        enabled?: boolean;
        ownerUserId?: string;
        configOverride?: Record<string, unknown>;
        summaryTemplateOverride?: string | null;
        messageTemplateOverride?: string | null;
    }): Promise<AlertRule | null> {
        try {
            const rule = await ws.sendRPC<AlertRule>(
                'FLEET_MANAGER',
                'alert.rule.createfromtemplate',
                params
            );
            rulesGuard.bump();
            upsertRule(rule);
            return rule;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create from template');
            return null;
        }
    }

    async function listFirings(
        ruleId: number,
        limit = 100,
        offset = 0
    ): Promise<{
        items: AlertRuleFiring[];
        total: number;
        has_more: boolean;
    }> {
        try {
            return await ws.sendRPC('FLEET_MANAGER', 'alert.rule.listfirings', {
                id: ruleId,
                limit,
                offset
            });
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load firings');
            return {items: [], total: 0, has_more: false};
        }
    }

    async function previewRule(params: {
        ruleId?: number;
        kind?: AlertRuleKind;
        severity?: AlertSeverity;
        scope?: ScopeSelector;
        config?: Record<string, unknown>;
        dedupeWindowSec?: number;
        cooldownSec?: number;
    }): Promise<{
        matches: AlertRulePreviewMatch[];
        matchCount: number;
        scanned: number;
        supportedKind: boolean;
        truncated: boolean;
        note: string | null;
    } | null> {
        try {
            return await ws.sendRPC(
                'FLEET_MANAGER',
                'alert.rule.preview',
                params
            );
        } catch (err) {
            toastRpcError(toast, err, 'Preview failed');
            return null;
        }
    }

    // Discover the numeric metric paths (component + field + label/class/unit)
    // a device currently reports. Feeds the sensor-threshold builder so users
    // pick a real metric instead of typing "em:0" / "act_power" by hand.
    async function listMetricPaths(
        shellyID?: string
    ): Promise<AlertMetricPath[]> {
        try {
            const res = await ws.sendRPC<{items: AlertMetricPath[]}>(
                'FLEET_MANAGER',
                'alert.rule.listmetricpaths',
                shellyID ? {shellyID} : {}
            );
            return res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load device metrics');
            return [];
        }
    }

    /**
     * Devices that can actually produce this alert's signal.
     *
     * The capability rules live server-side (deviceCapability.ts), so the
     * picker asks rather than guessing from device type. Null means "could not
     * determine" — callers show every device rather than an empty list.
     */
    async function listEligibleDevices(
        kind: string,
        config: Record<string, unknown> = {}
    ): Promise<string[] | null> {
        try {
            const res = await ws.sendRPC<{shellyIDs: string[]}>(
                'FLEET_MANAGER',
                'alert.rule.listeligibledevices',
                {kind, config}
            );
            return res.shellyIDs ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to check which devices apply');
            return null;
        }
    }

    async function listComponentPaths(
        shellyID?: string
    ): Promise<AlertComponentPath[]> {
        try {
            const res = await ws.sendRPC<{items: AlertComponentPath[]}>(
                'FLEET_MANAGER',
                'alert.rule.listcomponentpaths',
                shellyID ? {shellyID} : {}
            );
            return res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load component paths');
            return [];
        }
    }

    // ── Message templates (reusable per-channel message skeletons) ────────
    // Backed by the notification component's Template.* RPCs; a rule points
    // at one via AlertRule.templateId.
    async function fetchTemplates(): Promise<MessageTemplate[]> {
        templatesLoading.value = true;
        try {
            // List fetch: bump so the latest fetch wins between racing fetches.
            const token = templatesGuard.bump();
            const res = await ws.sendRPC<{items: MessageTemplate[]}>(
                'FLEET_MANAGER',
                'notification.template.list',
                {}
            );
            if (!templatesGuard.isStale(token)) {
                const next: Record<number, MessageTemplate> = {};
                for (const t of res.items ?? []) next[t.id] = t;
                templates.value = next;
            }
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load templates');
        } finally {
            templatesLoading.value = false;
        }
        return Object.values(templates.value);
    }

    async function createTemplate(
        draft: MessageTemplateDraft
    ): Promise<MessageTemplate | null> {
        try {
            const t = await ws.sendRPC<MessageTemplate>(
                'FLEET_MANAGER',
                'notification.template.create',
                draft
            );
            templatesGuard.bump();
            upsertTemplate(t);
            return t;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create template');
            return null;
        }
    }

    async function updateTemplate(
        id: number,
        patch: Partial<MessageTemplateDraft>
    ): Promise<MessageTemplate | null> {
        try {
            const t = await ws.sendRPC<MessageTemplate>(
                'FLEET_MANAGER',
                'notification.template.update',
                {id, patch}
            );
            templatesGuard.bump();
            upsertTemplate(t);
            return t;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update template');
            return null;
        }
    }

    async function deleteTemplate(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'notification.template.delete', {
                id
            });
            templatesGuard.bump();
            const next = {...templates.value};
            delete next[id];
            templates.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete template');
            return false;
        }
    }

    return {
        rules,
        instances,
        transitions,
        transitionsError,
        kinds,
        rulesLoading,
        instancesLoading,
        fetchKinds,
        fetchRules,
        fetchRule,
        createRule,
        updateRule,
        deleteRule,
        fetchInstances,
        fetchInstance,
        fetchHistoryPage,
        historyTotal,
        resyncOpenInstances,
        reconcileHistoryTotal,
        syncInstancesFromEvents,
        fetchTransitions,
        ackInstance,
        unackInstance,
        silenceInstance,
        unsilenceInstance,
        resolveInstance,
        checkDuplicate,
        listTemplates,
        createFromTemplate,
        listFirings,
        previewRule,
        listMetricPaths,
        listComponentPaths,
        listEligibleDevices,
        templates,
        templatesLoading,
        fetchTemplates,
        createTemplate,
        updateTemplate,
        deleteTemplate
    };
});
