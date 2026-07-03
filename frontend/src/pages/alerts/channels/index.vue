<template>
    <PageTemplate
        fill
        :tabs="tabs"
        v-model:search="search"
        title="Channels"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search channels..."
        :scope="scope"
        :loading="loading"
        :empty="visibleRows.length === 0 && !loading"
        empty-title="No channels yet"
        empty-sub="Channels deliver alerts to email, Slack, Teams, Telegram, or any HTTPS webhook. Add one to start routing notifications."
    >
        <template #actions>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="New channel"
                aria-label="New channel"
                @click="openCreateModal"
            >
                <i class="fas fa-plus" />
            </Button>
        </template>

        <section class="notification-admin">
            <div class="notification-admin__grid">
                <article
                    v-for="channel in filteredChannels"
                    :key="channel.id"
                    class="notification-admin__card"
                >
                    <header>
                        <h3>{{ channel.name }}</h3>
                        <ChannelStatusBadge
                            :verification-status="verificationStatus(channel)"
                            :disabled-reason="channel.health.disableReason"
                        />
                    </header>
                    <dl>
                        <dt>Type</dt>
                        <dd>{{ channelLabel(channel.provider) }}</dd>
                        <dt>Last delivery</dt>
                        <dd>{{ channel.lastDeliveryStatus ?? 'none' }}</dd>
                        <template v-if="channel.health.lastFailureAt">
                            <dt>Last failure</dt>
                            <dd>{{ channel.health.lastFailureAt }}</dd>
                        </template>
                    </dl>
                    <div v-if="canWrite" class="notification-admin__actions">
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :loading="testingChannelId === channel.id"
                            :disabled="isTestCoolingDown(channel.id)"
                            @click="testChannel(channel.id)"
                        >
                            <i class="fas fa-paper-plane" /> Test
                        </Button>
                        <Button type="blue-hollow" size="sm" @click="openEditModal(channel)">
                            Edit
                        </Button>
                        <Button type="red" size="sm" @click="channelsStore.deleteChannel(channel.id)">
                            Delete
                        </Button>
                    </div>
                </article>
            </div>
        </section>




        <template #modals>
            <CreateChannelModal
                :visible="modalVisible"
                :initial-draft="modalDraft"
                :testing-now="modalTesting"
                @close="closeModal"
                @save="onModalSave"
                @test="onModalTest"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {Channel, ChannelProvider} from '@api/channel';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import ChannelStatusBadge from '@/components/core/ChannelStatusBadge.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import CreateChannelModal, {
    type ChannelDraft
} from '@/components/modals/CreateChannelModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {usePermissions} from '@/composables/usePermissions';
import type {PageScope} from '@/composables/useUniversalSearch';
import {
    type ChannelType,
    isChannelType,
    labelForChannelType
} from '@/helpers/channelTypes';
import {
    buildEmailChannelConfig,
    createEmailChannelConfigForm,
    fillEmailChannelConfigForm
} from '@/helpers/notificationEmailConfig';
import {useChannelsStore} from '@/stores/channels';
import {useToastStore} from '@/stores/toast';
import type {RouteTab, StatItem} from '@/types/page-template';

type SearchItem = Channel;

const TEST_COOLDOWN_MS = 3000;

const tabs = inject<ComputedRef<RouteTab[]>>(
    'alertTabs',
    computed(() => [])
);
const channelsStore = useChannelsStore();
const toast = useToastStore();
const {canWrite} = usePermissions();

const search = ref('');
const testingChannelId = ref<number | null>(null);
const testCooldownUntil = reactive<Record<number, number>>({});
const testCooldownTick = ref(0);

const modalVisible = ref(false);
const modalDraft = ref<ChannelDraft>(buildBlankDraft());
const modalEditingId = ref<number | null>(null);
const modalTesting = ref(false);

onMounted(() => {
    void refreshAll();
});

function buildBlankDraft(): ChannelDraft {
    return {
        channelId: null,
        name: '',
        type: 'email_smtp',
        config: {
            email: createEmailChannelConfigForm(),
            webhook: {url: '', signingSecret: '', timeoutMs: 10000},
            slack: {url: '', channelOverride: ''},
            teams: {url: ''},
            telegram: {botToken: '', chatId: '', parseMode: ''}
        },
        quietHours: {start: '', end: '', timezone: ''}
    };
}

async function refreshAll(): Promise<void> {
    await channelsStore.fetchChannels();
}

const sortedChannels = computed(() =>
    Object.values(channelsStore.channels).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);

const filteredChannels = useFuzzySearch(sortedChannels, search, {
    keys: ['name', 'provider', 'lastTestStatus']
});

const loading = computed(() => channelsStore.loading);

const visibleRows = computed(() => filteredChannels.value);

const headerStats = computed<StatItem[]>(() => [
    {value: sortedChannels.value.length, label: 'channels', status: 'on'}
]);

const scope = computed<PageScope<SearchItem>>(() => ({
    type: 'Channel',
    icon: 'fas fa-bullhorn',
    items: sortedChannels.value,
    keys: ['name', 'provider', 'lastTestStatus'],
    toHit: (item) => ({
        id: `channel-${item.id}`,
        label: itemLabel(item),
        meta: itemMeta(item),
        type: 'Channel',
        icon: 'fas fa-bullhorn',
        route: '/alerts/channels'
    })
}));

function channelLabel(type: string): string {
    return labelForChannelType(type);
}

function itemLabel(item: SearchItem): string {
    return item.name;
}

function itemMeta(item: SearchItem): string {
    return channelLabel(item.provider);
}

function openCreateModal(): void {
    modalDraft.value = buildBlankDraft();
    modalEditingId.value = null;
    modalVisible.value = true;
}

async function openEditModal(channel: Channel): Promise<void> {
    modalDraft.value = buildDraftFromChannel(channel);
    modalEditingId.value = channel.id;
    modalVisible.value = true;
    hydrateQuietHoursForDraft(channel);
}

function closeModal(): void {
    modalVisible.value = false;
}

async function onModalSave(draft: ChannelDraft): Promise<void> {
    const config = buildConfigFromDraft(draft);
    const saved =
        draft.channelId === null
            ? await channelsStore.createChannel({
                  provider: draft.type as ChannelProvider,
                  name: draft.name,
                  config
              })
            : await channelsStore.updateChannel(draft.channelId, {
                  name: draft.name,
                  config,
                  quietHours: readQuietHoursPatch(draft.quietHours)
              });
    if (!saved) return;
    if (draft.channelId === null)
        await patchQuietHoursIfNeeded(saved.id, draft);
    closeModal();
}

async function onModalTest(): Promise<void> {
    const channelId = modalEditingId.value;
    if (channelId === null) return;
    modalTesting.value = true;
    try {
        await runTestForChannel(channelId);
    } finally {
        modalTesting.value = false;
    }
}

async function testChannel(channelId: number): Promise<void> {
    if (isTestCoolingDown(channelId)) return;
    testingChannelId.value = channelId;
    try {
        await runTestForChannel(channelId);
    } finally {
        testingChannelId.value = null;
        startTestCooldown(channelId);
    }
}

async function runTestForChannel(channelId: number): Promise<void> {
    try {
        const result = await channelsStore.testChannel(channelId);
        if (!result) return;
        if (result.state === 'success') toast.success('Channel tested');
        else toast.error(result.errorMessage ?? 'Channel test failed');
    } catch (error) {
        toast.error(String((error as Error)?.message ?? error));
    }
}

function startTestCooldown(channelId: number): void {
    testCooldownUntil[channelId] = Date.now() + TEST_COOLDOWN_MS;
    setTimeout(() => {
        testCooldownTick.value += 1;
    }, TEST_COOLDOWN_MS + 50);
}

function isTestCoolingDown(channelId: number): boolean {
    // Re-read the tick so the computed-binding stays reactive across timers.
    void testCooldownTick.value;
    const until = testCooldownUntil[channelId];
    return typeof until === 'number' && until > Date.now();
}

function buildConfigFromDraft(draft: ChannelDraft): Record<string, unknown> {
    if (draft.type === 'email_smtp')
        return buildEmailChannelConfig(draft.config.email);
    if (draft.type === 'generic_webhook')
        return compactRecord(draft.config.webhook);
    if (draft.type === 'slack_webhook')
        return compactRecord(draft.config.slack);
    if (draft.type === 'teams_workflow_webhook')
        return compactRecord(draft.config.teams);
    if (draft.type === 'telegram_bot')
        return compactRecord(draft.config.telegram);
    return {};
}

function compactRecord(source: object): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
        if (value === '' || value === null || value === undefined) continue;
        result[key] = value;
    }
    return result;
}

function buildDraftFromChannel(channel: Channel): ChannelDraft {
    const draft = buildBlankDraft();
    draft.channelId = channel.id;
    draft.name = channel.name;
    draft.type = isChannelType(channel.provider)
        ? (channel.provider as ChannelType)
        : 'email_smtp';
    if (channel.provider === 'email_smtp') {
        fillEmailChannelConfigForm(draft.config.email, channel.config);
    }
    if (channel.provider === 'generic_webhook') {
        Object.assign(draft.config.webhook, pickKeys(channel.config, draft.config.webhook));
    }
    if (channel.provider === 'slack_webhook') {
        Object.assign(draft.config.slack, pickKeys(channel.config, draft.config.slack));
    }
    if (channel.provider === 'teams_workflow_webhook') {
        Object.assign(draft.config.teams, pickKeys(channel.config, draft.config.teams));
    }
    if (channel.provider === 'telegram_bot') {
        Object.assign(
            draft.config.telegram,
            pickKeys(channel.config, draft.config.telegram)
        );
    }
    return draft;
}

function pickKeys<T extends object>(
    source: Record<string, unknown>,
    template: T
): Partial<T> {
    const next: Partial<T> = {};
    for (const key of Object.keys(template) as Array<keyof T>) {
        if (source[key as string] !== undefined)
            next[key] = source[key as string] as T[keyof T];
    }
    return next;
}

function hydrateQuietHoursForDraft(channel: Channel): void {
    if (!channel?.quietHours) return;
    modalDraft.value.quietHours = {
        start: String(channel.quietHours.startHour),
        end: String(channel.quietHours.endHour),
        timezone: channel.quietHours.timezone ?? ''
    };
}

function verificationStatus(channel: Channel): string {
    if (channel.lastTestStatus === 'success') return 'verified';
    if (channel.lastTestStatus === 'failed') return 'failed';
    return 'unverified';
}

async function patchQuietHoursIfNeeded(
    channelId: number | null | undefined,
    draft: ChannelDraft
): Promise<void> {
    if (!channelId) return;
    const patch = readQuietHoursPatch(draft.quietHours);
    if (!patch) return;
    await channelsStore.updateChannel(channelId, {quietHours: patch});
}

function readQuietHoursPatch(form: ChannelDraft['quietHours']) {
    const start = Number(form.start);
    const end = Number(form.end);
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        start > 23 ||
        end < 0 ||
        end > 23
    ) {
        return null;
    }
    return {
        startHour: start,
        endHour: end,
        timezone: form.timezone.trim() || 'UTC'
    };
}
</script>

<style scoped>
.notification-admin {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.notification-admin__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--space-3);
}

.notification-admin__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-surface-primary);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.notification-admin__card header,
.notification-admin__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}

.notification-admin__card h3 {
    min-width: 0;
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.notification-admin__card dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.notification-admin__card dt {
    font-weight: 700;
}

.notification-admin__card dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.notification-admin__actions {
    justify-content: flex-start;
    flex-wrap: wrap;
}

</style>
