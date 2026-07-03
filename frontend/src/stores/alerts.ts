import type {
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
    ScopeSelector
} from '@api/alert';
import type {MessageTemplate, MessageTemplateBodies} from '@api/notification';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
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
    config?: Record<string, unknown>;
    deliveryMode?: 'instant' | 'digest';
    digestWindowMinutes?: number | null;
    /** Reusable message template this rule renders from; null = inline wording. */
    templateId?: number | null;
}

export type UpdateAlertRulePatch = Partial<Omit<CreateAlertRuleParams, 'kind'>>;

export interface InstanceFilters {
    state?: AlertState;
    severity?: AlertSeverity;
    ruleId?: number;
    query?: string;
}

export const useAlertsStore = defineStore('alerts', () => {
    const toast = useToastStore();

    const rules = ref<Record<number, AlertRule>>({});
    const instances = ref<Record<number, AlertInstance>>({});
    const transitions = ref<Record<number, AlertTransition[]>>({});
    const kinds = ref<AlertRuleKindDescriptor[]>([]);
    const templates = ref<Record<number, MessageTemplate>>({});
    const templatesLoading = ref(true);
    const rulesLoading = ref(true);
    const instancesLoading = ref(true);

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
            toastRpcError(toast, err, 'Failed to load rule kinds');
        }
        return kinds.value;
    }

    // Seq guards so a stale (older) response can't overwrite a newer one.
    let rulesSeq = 0;
    let instancesSeq = 0;

    async function fetchRules() {
        const seq = ++rulesSeq;
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
            if (seq !== rulesSeq) return;
            const next: Record<number, AlertRule> = {};
            for (const r of items) next[r.id] = r;
            rules.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load alert rules');
        } finally {
            if (seq === rulesSeq) rulesLoading.value = false;
        }
    }

    async function fetchRule(id: number): Promise<AlertRule | null> {
        try {
            const rule = await ws.sendRPC<AlertRule>(
                'FLEET_MANAGER',
                'alert.rule.get',
                {id}
            );
            upsertRule(rule);
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
            const next = {...rules.value};
            delete next[id];
            rules.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete rule');
            return false;
        }
    }

    async function fetchInstances(filters: InstanceFilters = {}) {
        const seq = ++instancesSeq;
        instancesLoading.value = true;
        try {
            const items = await paginate<AlertInstance>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<AlertInstance>>(
                        'FLEET_MANAGER',
                        'alert.instance.list',
                        {...filters, limit: MAX_PER_PAGE, offset}
                    ),
                MAX_PER_PAGE
            );
            if (seq !== instancesSeq) return;
            // Merge rather than replace — list is filtered by state; other instances
            // may still be valid to display from earlier fetches.
            const next = {...instances.value};
            for (const i of items) next[i.id] = i;
            instances.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load alert instances');
        } finally {
            if (seq === instancesSeq) instancesLoading.value = false;
        }
    }

    async function fetchInstance(id: number): Promise<AlertInstance | null> {
        try {
            const inst = await ws.sendRPC<AlertInstance>(
                'FLEET_MANAGER',
                'alert.instance.get',
                {id}
            );
            upsertInstance(inst);
            return inst;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load alert instance');
            return null;
        }
    }

    async function fetchTransitions(id: number): Promise<AlertTransition[]> {
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
            transitions.value = {...transitions.value, [id]: items};
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load transitions');
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
            upsertInstance(inst);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to resolve');
            return false;
        }
    }

    // Live updates — backend emits lightweight {alertId, ...} payloads;
    // refetch the full instance to pick up the current state.
    ws.onAlertEvent((e) => {
        const alertId = e.params.alertId as number | undefined;
        if (typeof alertId !== 'number') return;
        void fetchInstance(alertId);
    });

    async function checkDuplicate(spec: {
        kind: AlertRuleKind;
        severity: AlertSeverity;
        scope: ScopeSelector;
        dedupeWindowSec?: number;
        cooldownSec?: number;
        config?: Record<string, unknown>;
        excludeId?: number;
    }): Promise<{id: number; name: string} | null> {
        try {
            const res = await ws.sendRPC<{
                duplicate: {id: number; name: string} | null;
            }>('FLEET_MANAGER', 'alert.rule.checkduplicate', spec);
            return res.duplicate;
        } catch {
            return null;
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
            const res = await ws.sendRPC<{items: MessageTemplate[]}>(
                'FLEET_MANAGER',
                'notification.template.list',
                {}
            );
            const next: Record<number, MessageTemplate> = {};
            for (const t of res.items ?? []) next[t.id] = t;
            templates.value = next;
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
        templates,
        templatesLoading,
        fetchTemplates,
        createTemplate,
        updateTemplate,
        deleteTemplate
    };
});
