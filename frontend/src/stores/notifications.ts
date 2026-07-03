import type {EmailAttachment} from '@api/_shared';
import type {
    DeliveryAttempt,
    DeliveryJob,
    EmailAsset,
    EmailTemplate,
    InboxState,
    NotificationInboxItem,
    NotificationOnCallSchedule,
    NotificationRoutingPolicy,
    TemplateTokenDescriptor
} from '@api/notification';
import type {
    Channel,
    ChannelProvider,
    ChannelTestResult
} from '@api/channel';
import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import apiClient from '@/helpers/axios';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import {createUploadTicket} from '../tools/uploadTickets';
import * as ws from '../tools/websocket';
import {createLatestRefreshCoordinator} from './refreshCoordinator';
import {useToastStore} from './toast';

export type {
    DeliveryAttempt,
    DeliveryJob,
    EmailAsset,
    EmailAttachment,
    EmailTemplate,
    InboxState,
    NotificationInboxItem,
    NotificationOnCallSchedule,
    NotificationRoutingPolicy,
    TemplateTokenDescriptor
};

export type NotificationChannelType = ChannelProvider;

export interface NotificationPreference {
    userId: string;
    channelType: NotificationChannelType;
    severityFilters: string[];
    quietHours: Record<string, unknown>;
    digestPreference: Record<string, unknown>;
    disabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

export interface NotificationChannelDraft {
    channelId?: number;
    name: string;
    type: NotificationChannelType;
    config: Record<string, unknown>;
}

export interface NotificationRoutingPolicyDraft {
    policyId?: number;
    parentPolicyId?: number | null;
    name: string;
    sortOrder?: number;
    labelMatchers: unknown[];
    severityMatchers: string[];
    resourceSelectors: unknown[];
    contactPoints: unknown[];
    groupingKeys: string[];
    muteWindows: unknown[];
    runtimeSilences: unknown[];
    inhibitionRules: unknown[];
    escalationStages: unknown[];
    enabled?: boolean;
}

export interface NotificationOnCallScheduleDraft {
    scheduleId?: number;
    name: string;
    timezone: string;
    rotationRules: unknown[];
    overrides: unknown[];
    target: Record<string, unknown>;
    enabled?: boolean;
}

export interface NotificationPreferenceDraft {
    channelType: NotificationChannelType;
    severityFilters: string[];
    quietHours: Record<string, unknown>;
    digestPreference: Record<string, unknown>;
    disabled: boolean;
}

export interface NotificationBundleResponse {
    bundle?: Record<string, unknown>;
    report?: Record<string, unknown>;
    warnings?: Array<{path: string; message: string}>;
    conflicts?: unknown[];
    operations?: unknown[];
    applied?: unknown[];
    [key: string]: unknown;
}

/** Mirror of backend PROBED_ATTACHMENT_SCHEMA. */
export interface ProbedAttachment {
    filename: string;
    url: string;
    cid?: string;
    contentType?: string;
    reachable: boolean;
    error?: string;
}

export interface EmailPreviewResult {
    subject: string;
    html: string;
    text: string;
    missingTokens: string[];
    truncated: boolean;
    attachments: ProbedAttachment[];
}

export interface OAuthStartResult {
    authUrl: string;
    state: string;
    expiresAt: string;
}

export interface EmailAssetUploadResult extends EmailAsset {
    /** true when the upload matched an existing asset (dedup by sha256) */
    deduped: boolean;
}

const MAX_PER_PAGE = 1000;

interface InboxStateMutation {
    id: number;
    state: InboxState;
    failureMessage: string;
    commit(): Promise<NotificationInboxItem>;
}

export interface HistoryFilters {
    endpointId?: number;
    state?: DeliveryJob['state'];
    alertId?: number;
    from?: string;
    to?: string;
}

export const useNotificationsStore = defineStore('notifications', () => {
    const toast = useToastStore();

    const inbox = ref<Record<number, NotificationInboxItem>>({});
    const inboxLoading = ref(true);
    const history = ref<Record<number, DeliveryJob>>({});
    const historyLoading = ref(true);
    const attempts = ref<Record<number, DeliveryAttempt[]>>({});
    const emailTemplates = ref<Record<number, EmailTemplate>>({});
    const emailAssets = ref<Record<number, EmailAsset>>({});
    const channels = ref<Record<number, Channel>>({});
    const routingPolicies = ref<Record<number, NotificationRoutingPolicy>>({});
    const onCallSchedules = ref<Record<number, NotificationOnCallSchedule>>({});
    const preferences = ref<
        Record<NotificationChannelType, NotificationPreference>
    >({} as Record<NotificationChannelType, NotificationPreference>);
    const channelsLoading = ref(true);
    const routingLoading = ref(true);
    const onCallLoading = ref(true);
    const preferencesLoading = ref(true);

    const unreadCount = computed(
        () =>
            Object.values(inbox.value).filter((i) => i.state === 'unread')
                .length
    );

    function upsertInbox(item: NotificationInboxItem) {
        inbox.value = {...inbox.value, [item.id]: item};
    }

    function upsertJob(job: DeliveryJob) {
        history.value = {...history.value, [job.id]: job};
    }

    function upsertEmailTemplate(t: EmailTemplate) {
        emailTemplates.value = {...emailTemplates.value, [t.id]: t};
    }

    function upsertEmailAsset(a: EmailAsset) {
        emailAssets.value = {...emailAssets.value, [a.id]: a};
    }

    function upsertChannel(channel: Channel) {
        channels.value = {...channels.value, [channel.id]: channel};
    }

    function removeChannel(id: number) {
        const next = {...channels.value};
        delete next[id];
        channels.value = next;
    }

    function upsertRoutingPolicy(policy: NotificationRoutingPolicy) {
        routingPolicies.value = {...routingPolicies.value, [policy.id]: policy};
    }

    function removeRoutingPolicy(id: number) {
        const next = {...routingPolicies.value};
        delete next[id];
        routingPolicies.value = next;
    }

    function upsertOnCallSchedule(schedule: NotificationOnCallSchedule) {
        onCallSchedules.value = {
            ...onCallSchedules.value,
            [schedule.id]: schedule
        };
    }

    function removeOnCallSchedule(id: number) {
        const next = {...onCallSchedules.value};
        delete next[id];
        onCallSchedules.value = next;
    }

    function upsertPreference(preference: NotificationPreference) {
        preferences.value = {
            ...preferences.value,
            [preference.channelType]: preference
        };
    }

    const inboxRefresh = createLatestRefreshCoordinator(refreshInbox);

    async function fetchInbox(state?: InboxState) {
        await inboxRefresh.request(state);
    }

    async function refreshInbox(state?: InboxState): Promise<void> {
        inboxLoading.value = true;
        try {
            const items = await paginate<NotificationInboxItem>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<NotificationInboxItem>>(
                        'FLEET_MANAGER',
                        'notification.inbox.list',
                        {
                            ...(state ? {state} : {}),
                            limit: MAX_PER_PAGE,
                            offset
                        }
                    ),
                MAX_PER_PAGE
            );
            const next: Record<number, NotificationInboxItem> = state
                ? {...inbox.value}
                : {};
            for (const i of items) next[i.id] = i;
            inbox.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load inbox');
        } finally {
            inboxLoading.value = false;
        }
    }

    async function markRead(id: number): Promise<boolean> {
        return markInboxState({
            id,
            state: 'read',
            failureMessage: 'Failed to mark read',
            commit: () => commitInboxRead(id)
        });
    }

    async function markUnread(id: number): Promise<boolean> {
        return markInboxState({
            id,
            state: 'unread',
            failureMessage: 'Failed to mark unread',
            commit: () => commitInboxUnread(id)
        });
    }

    async function markInboxState(input: InboxStateMutation): Promise<boolean> {
        try {
            await runOptimisticMutation({
                snapshot: () => snapshotInboxItem(input.id),
                apply: () => applyInboxState(input),
                commit: input.commit,
                rollback: rollbackInboxState,
                reconcile: upsertInbox,
                onError: (err) =>
                    toastRpcError(toast, err, input.failureMessage)
            });
            return true;
        } catch {
            return false;
        }
    }

    function snapshotInboxItem(id: number): NotificationInboxItem | undefined {
        return inbox.value[id];
    }

    function applyInboxState(input: InboxStateMutation): void {
        const item = inbox.value[input.id];
        if (!item) return;
        upsertInbox({...item, state: input.state});
    }

    function rollbackInboxState(
        previousItem: NotificationInboxItem | undefined
    ): void {
        if (!previousItem) return;
        upsertInbox(previousItem);
    }

    function commitInboxRead(id: number): Promise<NotificationInboxItem> {
        return ws.sendRPC<NotificationInboxItem>(
            'FLEET_MANAGER',
            'notification.inbox.markread',
            {id}
        );
    }

    function commitInboxUnread(id: number): Promise<NotificationInboxItem> {
        return ws.sendRPC<NotificationInboxItem>(
            'FLEET_MANAGER',
            'notification.inbox.markunread',
            {id}
        );
    }

    async function markAllRead(): Promise<boolean> {
        try {
            await ws.sendRPC<{updatedCount: number}>(
                'FLEET_MANAGER',
                'notification.inbox.markallread',
                {}
            );
            // Server updates many rows at once — re-fetch to stay consistent.
            await fetchInbox();
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to mark all read');
            return false;
        }
    }

    const historyRefresh = createLatestRefreshCoordinator(refreshHistory);

    async function fetchHistory(filters: HistoryFilters = {}) {
        await historyRefresh.request(filters);
    }

    async function refreshHistory(filters: HistoryFilters): Promise<void> {
        historyLoading.value = true;
        try {
            const items = await paginate<DeliveryJob>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<DeliveryJob>>(
                        'FLEET_MANAGER',
                        'notification.history.list',
                        {...filters, limit: MAX_PER_PAGE, offset}
                    ),
                MAX_PER_PAGE
            );
            const next: Record<number, DeliveryJob> = {};
            for (const j of items) next[j.id] = j;
            history.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load delivery history');
        } finally {
            historyLoading.value = false;
        }
    }

    async function fetchHistoryDetail(
        id: number
    ): Promise<{job: DeliveryJob; attempts: DeliveryAttempt[]} | null> {
        try {
            const res = await ws.sendRPC<{
                job: DeliveryJob;
                attempts: DeliveryAttempt[];
            }>('FLEET_MANAGER', 'notification.history.get', {id});
            upsertJob(res.job);
            attempts.value = {...attempts.value, [id]: res.attempts};
            return res;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load delivery detail');
            return null;
        }
    }

    async function requeue(id: number): Promise<boolean> {
        try {
            const job = await ws.sendRPC<DeliveryJob>(
                'FLEET_MANAGER',
                'notification.history.requeue',
                {id}
            );
            upsertJob(job);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to requeue delivery');
            return false;
        }
    }

    // Live updates — bursty event runs would otherwise stack many concurrent
    // fetchInbox calls; coalesce to one refetch per 250ms burst.
    let inboxRefetchTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleInboxRefetch() {
        if (inboxRefetchTimer !== undefined) return;
        inboxRefetchTimer = setTimeout(() => {
            inboxRefetchTimer = undefined;
            void fetchInbox();
        }, 250);
    }

    ws.onNotificationEvent((e) => {
        if (e.method === 'Notification.DeliveryUpdated') {
            const jobId = e.params.jobId as number | undefined;
            if (typeof jobId === 'number' && history.value[jobId]) {
                void fetchHistoryDetail(jobId);
            }
            return;
        }
        scheduleInboxRefetch();
    });

    async function renderTemplate(params: {
        template: string;
        sampleAlertId?: number;
        ruleKind?: string;
        ruleName?: string;
    }): Promise<{
        rendered: string;
        missingTokens: string[];
        truncated: boolean;
        tokens: TemplateTokenDescriptor[];
    } | null> {
        try {
            return await ws.sendRPC(
                'FLEET_MANAGER',
                'notification.rendertemplate',
                params
            );
        } catch (err) {
            toastRpcError(toast, err, 'Template render failed');
            return null;
        }
    }

    async function renderEmailPreview(params: {
        channelId?: number;
        emailTemplateId?: number;
        subjectTemplate?: string;
        htmlTemplate?: string;
        textTemplate?: string;
        attachments?: EmailAttachment[];
        sampleAlertId?: number;
        ruleKind?: string;
        ruleName?: string;
    }): Promise<EmailPreviewResult | null> {
        try {
            return await ws.sendRPC<EmailPreviewResult>(
                'FLEET_MANAGER',
                'notification.renderemailpreview',
                params
            );
        } catch (err) {
            toastRpcError(toast, err, 'Email preview failed');
            return null;
        }
    }

    // ─── Email template library ────────────────────────────────────────
    async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
        try {
            const items = await paginate<EmailTemplate>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<EmailTemplate>>(
                        'FLEET_MANAGER',
                        'notification.emailtemplate.list',
                        {limit: MAX_PER_PAGE, offset}
                    ),
                MAX_PER_PAGE
            );
            const next: Record<number, EmailTemplate> = {};
            for (const t of items) next[t.id] = t;
            emailTemplates.value = next;
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load email templates');
            return [];
        }
    }

    async function fetchEmailTemplate(
        id: number
    ): Promise<EmailTemplate | null> {
        try {
            const t = await ws.sendRPC<EmailTemplate>(
                'FLEET_MANAGER',
                'notification.emailtemplate.get',
                {id}
            );
            upsertEmailTemplate(t);
            return t;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load email template');
            return null;
        }
    }

    async function createEmailTemplate(params: {
        name: string;
        description?: string | null;
        subjectTemplate?: string | null;
        htmlTemplate?: string | null;
        textTemplate?: string | null;
        attachments?: EmailAttachment[];
    }): Promise<EmailTemplate | null> {
        try {
            const t = await ws.sendRPC<EmailTemplate>(
                'FLEET_MANAGER',
                'notification.emailtemplate.create',
                params
            );
            upsertEmailTemplate(t);
            return t;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create email template');
            return null;
        }
    }

    async function updateEmailTemplate(
        id: number,
        patch: {
            name?: string;
            description?: string | null;
            subjectTemplate?: string | null;
            htmlTemplate?: string | null;
            textTemplate?: string | null;
            attachments?: EmailAttachment[];
        }
    ): Promise<EmailTemplate | null> {
        try {
            const t = await ws.sendRPC<EmailTemplate>(
                'FLEET_MANAGER',
                'notification.emailtemplate.update',
                {id, ...patch}
            );
            upsertEmailTemplate(t);
            return t;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update email template');
            return null;
        }
    }

    async function deleteEmailTemplate(id: number): Promise<boolean> {
        try {
            await ws.sendRPC(
                'FLEET_MANAGER',
                'notification.emailtemplate.delete',
                {
                    id
                }
            );
            const next = {...emailTemplates.value};
            delete next[id];
            emailTemplates.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete email template');
            return false;
        }
    }

    // ─── Email asset library (binary blobs — uploaded via multipart HTTP,
    //     listed/deleted via RPC) ─────────────────────────────────────────
    async function fetchEmailAssets(): Promise<EmailAsset[]> {
        try {
            const items = await paginate<EmailAsset>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<EmailAsset>>(
                        'FLEET_MANAGER',
                        'notification.emailasset.list',
                        {limit: MAX_PER_PAGE, offset}
                    ),
                MAX_PER_PAGE
            );
            const next: Record<number, EmailAsset> = {};
            for (const a of items) next[a.id] = a;
            emailAssets.value = next;
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load email assets');
            return [];
        }
    }

    async function fetchEmailAsset(id: number): Promise<EmailAsset | null> {
        try {
            const a = await ws.sendRPC<EmailAsset>(
                'FLEET_MANAGER',
                'notification.emailasset.get',
                {id}
            );
            upsertEmailAsset(a);
            return a;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load email asset');
            return null;
        }
    }

    async function uploadEmailAsset(
        file: File
    ): Promise<EmailAssetUploadResult | null> {
        try {
            const ticket = await createUploadTicket(
                'notification.emailasset.createuploadticket'
            );
            const form = new FormData();
            form.append('file', file);
            form.append('ticket', ticket);
            const res = await apiClient.post<EmailAssetUploadResult>(
                '/api/notifications/email-assets',
                form,
                {headers: {'Content-Type': 'multipart/form-data'}}
            );
            upsertEmailAsset(res.data);
            return res.data;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to upload email asset');
            return null;
        }
    }

    async function deleteEmailAsset(id: number): Promise<boolean> {
        try {
            await ws.sendRPC(
                'FLEET_MANAGER',
                'notification.emailasset.delete',
                {
                    id
                }
            );
            const next = {...emailAssets.value};
            delete next[id];
            emailAssets.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete email asset');
            return false;
        }
    }

    /** Asset inline-download URL. Used as `<img :src="assetUrl(id)">` etc. */
    function emailAssetUrl(id: number): string {
        return `/api/notifications/email-assets/${id}`;
    }

    async function fetchChannels(
        type?: NotificationChannelType
    ): Promise<void> {
        channelsLoading.value = true;
        try {
            const result = await ws.sendRPC<{items: Channel[]}>(
                'FLEET_MANAGER',
                'channel.list',
                type ? {provider: type} : {}
            );
            const next: Record<number, Channel> = {};
            for (const channel of result.items) {
                next[channel.id] = channel;
            }
            channels.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load channels');
        } finally {
            channelsLoading.value = false;
        }
    }

    async function saveChannel(
        draft: NotificationChannelDraft
    ): Promise<Channel | null> {
        try {
            const channel =
                draft.channelId == null
                    ? await ws.sendRPC<Channel>(
                          'FLEET_MANAGER',
                          'channel.create',
                          {
                              provider: draft.type,
                              name: draft.name,
                              config: draft.config
                          }
                      )
                    : await ws.sendRPC<Channel>(
                          'FLEET_MANAGER',
                          'channel.update',
                          {
                              id: draft.channelId,
                              patch: {
                                  name: draft.name,
                                  config: draft.config
                              }
                          }
                      );
            upsertChannel(channel);
            return channel;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to save channel');
            return null;
        }
    }

    async function deleteChannel(channelId: number): Promise<boolean> {
        try {
            const result = await ws.sendRPC<{deleted: boolean}>(
                'FLEET_MANAGER',
                'channel.delete',
                {id: channelId}
            );
            if (result.deleted) removeChannel(channelId);
            return result.deleted;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete channel');
            return false;
        }
    }

    async function testChannel(
        channelId: number,
        dryRun = false
    ): Promise<ChannelTestResult | null> {
        try {
            const result = await ws.sendRPC<ChannelTestResult>(
                'FLEET_MANAGER',
                'channel.test',
                {id: channelId, dryRun}
            );
            const channel = channels.value[channelId];
            if (channel) {
                upsertChannel({
                    ...channel,
                    lastTestAt: result.testedAt,
                    lastTestStatus: result.state,
                    lastDeliveryStatus: dryRun !== true
                        ? result.state
                        : channel.lastDeliveryStatus,
                    lastDeliveryAt: dryRun !== true
                        ? result.testedAt
                        : channel.lastDeliveryAt,
                    health: {
                        ...channel.health,
                        lastFailureAt:
                            result.state === 'failed'
                                ? result.testedAt
                                : channel.health.lastFailureAt
                    },
                    updatedAt: result.testedAt
                });
            }
            return result;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to test channel');
            return null;
        }
    }

    async function fetchRoutingPolicies(enabledOnly = false): Promise<void> {
        routingLoading.value = true;
        try {
            const result = await ws.sendRPC<{
                items: NotificationRoutingPolicy[];
            }>('FLEET_MANAGER', 'notification.routing.list', {enabledOnly});
            const next: Record<number, NotificationRoutingPolicy> = {};
            for (const policy of result.items) next[policy.id] = policy;
            routingPolicies.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load routing policies');
        } finally {
            routingLoading.value = false;
        }
    }

    async function saveRoutingPolicy(
        draft: NotificationRoutingPolicyDraft
    ): Promise<NotificationRoutingPolicy | null> {
        try {
            const policy = await ws.sendRPC<NotificationRoutingPolicy>(
                'FLEET_MANAGER',
                'notification.routing.set',
                draft
            );
            upsertRoutingPolicy(policy);
            return policy;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to save routing policy');
            return null;
        }
    }

    async function deleteRoutingPolicy(policyId: number): Promise<boolean> {
        try {
            const result = await ws.sendRPC<{deleted: boolean}>(
                'FLEET_MANAGER',
                'notification.routing.delete',
                {policyId}
            );
            if (result.deleted) removeRoutingPolicy(policyId);
            return result.deleted;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete routing policy');
            return false;
        }
    }

    async function evaluateRoutingPolicy(params: {
        severity: string;
        labels: Record<string, string>;
        resource?: Record<string, unknown>;
    }): Promise<{matches: NotificationRoutingPolicy[]} | null> {
        try {
            return await ws.sendRPC<{matches: NotificationRoutingPolicy[]}>(
                'FLEET_MANAGER',
                'notification.routing.evaluate',
                params
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to evaluate routing');
            return null;
        }
    }

    async function fetchOnCallSchedules(enabledOnly = false): Promise<void> {
        onCallLoading.value = true;
        try {
            const result = await ws.sendRPC<{
                items: NotificationOnCallSchedule[];
            }>('FLEET_MANAGER', 'notification.oncall.list', {enabledOnly});
            const next: Record<number, NotificationOnCallSchedule> = {};
            for (const schedule of result.items) next[schedule.id] = schedule;
            onCallSchedules.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load on-call schedules');
        } finally {
            onCallLoading.value = false;
        }
    }

    async function saveOnCallSchedule(
        draft: NotificationOnCallScheduleDraft
    ): Promise<NotificationOnCallSchedule | null> {
        try {
            const schedule = await ws.sendRPC<NotificationOnCallSchedule>(
                'FLEET_MANAGER',
                'notification.oncall.set',
                draft
            );
            upsertOnCallSchedule(schedule);
            return schedule;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to save on-call schedule');
            return null;
        }
    }

    async function deleteOnCallSchedule(scheduleId: number): Promise<boolean> {
        try {
            const result = await ws.sendRPC<{deleted: boolean}>(
                'FLEET_MANAGER',
                'notification.oncall.delete',
                {scheduleId}
            );
            if (result.deleted) removeOnCallSchedule(scheduleId);
            return result.deleted;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete on-call schedule');
            return false;
        }
    }

    async function fetchPreferences(): Promise<void> {
        preferencesLoading.value = true;
        try {
            const result = await ws.sendRPC<{items: NotificationPreference[]}>(
                'FLEET_MANAGER',
                'notification.preference.list',
                {}
            );
            const next = {} as Record<
                NotificationChannelType,
                NotificationPreference
            >;
            for (const preference of result.items) {
                next[preference.channelType] = preference;
            }
            preferences.value = next;
        } catch (err) {
            toastRpcError(
                toast,
                err,
                'Failed to load notification preferences'
            );
        } finally {
            preferencesLoading.value = false;
        }
    }

    async function savePreference(
        draft: NotificationPreferenceDraft
    ): Promise<NotificationPreference | null> {
        try {
            const preference = await ws.sendRPC<NotificationPreference>(
                'FLEET_MANAGER',
                'notification.preference.set',
                draft
            );
            upsertPreference(preference);
            return preference;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to save notification preference');
            return null;
        }
    }

    async function validateBundle(
        bundle: Record<string, unknown>
    ): Promise<NotificationBundleResponse | null> {
        return bundleRpc(
            'notification.bundle.validate',
            {bundle},
            'Bundle validation failed'
        );
    }

    async function planBundleImport(
        bundle: Record<string, unknown>,
        channelMappings?: Record<string, number>
    ): Promise<NotificationBundleResponse | null> {
        return bundleRpc(
            'notification.bundle.planimport',
            {
                bundle,
                ...(channelMappings ? {channelMappings} : {})
            },
            'Bundle import plan failed'
        );
    }

    async function applyBundleImport(params: {
        bundle: Record<string, unknown>;
        channelMappings?: Record<string, number>;
    }): Promise<NotificationBundleResponse | null> {
        return bundleRpc(
            'notification.bundle.applyimport',
            params,
            'Bundle import failed'
        );
    }

    async function exportBundle(
        params: Record<string, unknown> = {}
    ): Promise<NotificationBundleResponse | null> {
        return bundleRpc(
            'notification.bundle.export',
            params,
            'Bundle export failed'
        );
    }

    async function importGrafanaBundle(
        source: Record<string, unknown>
    ): Promise<NotificationBundleResponse | null> {
        return bundleRpc(
            'notification.bundle.importgrafana',
            {config: source},
            'Grafana import failed'
        );
    }

    async function importAlertmanagerBundle(
        source: Record<string, unknown>
    ): Promise<NotificationBundleResponse | null> {
        return bundleRpc(
            'notification.bundle.importalertmanager',
            {config: source},
            'Alertmanager import failed'
        );
    }

    async function bundleRpc(
        method: string,
        params: Record<string, unknown>,
        failureMessage: string
    ): Promise<NotificationBundleResponse | null> {
        try {
            return await ws.sendRPC<NotificationBundleResponse>(
                'FLEET_MANAGER',
                method,
                params
            );
        } catch (err) {
            toastRpcError(toast, err, failureMessage);
            return null;
        }
    }

    // ─── OAuth consent bootstrap ──────────────────────────────────────
    async function oauthStart(params: {
        channelId: number;
        provider: 'oauth2_google' | 'oauth2_microsoft';
        tenant?: string;
    }): Promise<OAuthStartResult | null> {
        try {
            return await ws.sendRPC<OAuthStartResult>(
                'FLEET_MANAGER',
                'notification.oauth.start',
                params
            );
        } catch (err) {
            toastRpcError(toast, err, 'OAuth consent failed to start');
            return null;
        }
    }

    return {
        inbox,
        inboxLoading,
        unreadCount,
        history,
        historyLoading,
        attempts,
        emailTemplates,
        emailAssets,
        channels,
        channelsLoading,
        routingPolicies,
        routingLoading,
        onCallSchedules,
        onCallLoading,
        preferences,
        preferencesLoading,
        fetchInbox,
        markRead,
        markUnread,
        markAllRead,
        fetchHistory,
        fetchHistoryDetail,
        requeue,
        renderTemplate,
        renderEmailPreview,
        fetchEmailTemplates,
        fetchEmailTemplate,
        createEmailTemplate,
        updateEmailTemplate,
        deleteEmailTemplate,
        fetchEmailAssets,
        fetchEmailAsset,
        uploadEmailAsset,
        deleteEmailAsset,
        emailAssetUrl,
        fetchChannels,
        saveChannel,
        deleteChannel,
        testChannel,
        fetchRoutingPolicies,
        saveRoutingPolicy,
        deleteRoutingPolicy,
        evaluateRoutingPolicy,
        fetchOnCallSchedules,
        saveOnCallSchedule,
        deleteOnCallSchedule,
        fetchPreferences,
        savePreference,
        validateBundle,
        planBundleImport,
        applyBundleImport,
        exportBundle,
        importGrafanaBundle,
        importAlertmanagerBundle,
        oauthStart
    };
});
