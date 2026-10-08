<template>
    <PageTemplate
        fill
        :tabs="tabs"
        v-model:search="search"
        title="Channels"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search channels..."
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        @filter-click="filterModalVisible = true"
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

        <template #empty-cta>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                @click="openCreateModal"
            >
                Create Channel
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
                        <dt>Channel</dt>
                        <dd>{{ channelLabel(channel.provider) }}</dd>
                        <dt>Last delivery</dt>
                        <dd>{{ channel.lastDeliveryStatus ?? 'none' }}</dd>
                        <template v-if="channel.health.lastFailureAt">
                            <dt>Last failure</dt>
                            <dd>{{ channel.health.lastFailureAt }}</dd>
                        </template>
                    </dl>
                    <div
                        v-if="canWrite && channel.access === 'full'"
                        class="notification-admin__actions"
                    >
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
                        <Button
                            v-if="channel.health.autoDisabledAt"
                            type="blue-hollow"
                            size="sm"
                            @click="resetHealth(channel.id)"
                        >
                            Reset health
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
                :masked-fields="modalMaskedFields"
                @close="closeModal"
                @save="onModalSave"
            />
            <FilterModal
                :visible="filterModalVisible"
                title="Filter channels"
                match-label="channels"
                :match-count="visibleRows.length"
                :sections="filterSections"
                :initial-state="activeFilterState"
                @close="filterModalVisible = false"
                @apply-generic="applyGenericFilters"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {Channel, ChannelListItem, ChannelProvider} from '@api/channel';
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
import FilterModal from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import CreateChannelModal from '@/components/modals/CreateChannelModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {usePermissions} from '@/composables/usePermissions';
import {
    buildChannelConfigFromDraft,
    buildDraftFromChannel,
    type ChannelDraft,
    createBlankChannelDraft,
    readQuietHoursPatch
} from '@/helpers/channelDraft';
import {
    type ChannelType,
    isChannelType,
    labelForChannelType
} from '@/helpers/channelTypes';
import {countByKey} from '@/helpers/filter-sections';
import {rpcErrorMessage} from '@/helpers/rpcError';
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
const modalDraft = ref<ChannelDraft>(createBlankChannelDraft());
const modalEditingId = ref<number | null>(null);

onMounted(() => {
    void refreshAll();
});

async function refreshAll(): Promise<void> {
    await channelsStore.fetchChannels();
}

const sortedChannels = computed(() =>
    Object.values(channelsStore.channels).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);

const searchedChannels = useFuzzySearch(sortedChannels, search, {
    keys: ['name', 'provider', 'lastTestStatus']
});

const modalMaskedFields = ref<Record<string, string>>({});
const filterModalVisible = ref(false);
const providerFilter = ref<string[]>([]);
const stateFilter = ref<string[]>([]);
const healthFilter = ref<string[]>([]);

/** Health is derived, not stored — one place decides what each bucket means. */
function healthKeyOf(channel: ChannelListItem): string {
    if (channel.health.autoDisabledAt) return 'auto_disabled';
    if (channel.health.consecutiveFailures > 0) return 'failing';
    return 'healthy';
}

function stateKeyOf(channel: ChannelListItem): string {
    return channel.enabled ? 'enabled' : 'disabled';
}

const filteredChannels = computed(() =>
    searchedChannels.value.filter(
        (c) =>
            (providerFilter.value.length === 0 ||
                providerFilter.value.includes(c.provider)) &&
            (stateFilter.value.length === 0 ||
                stateFilter.value.includes(stateKeyOf(c))) &&
            (healthFilter.value.length === 0 ||
                healthFilter.value.includes(healthKeyOf(c)))
    )
);

const activeFilterCount = computed(
    () =>
        providerFilter.value.length +
        stateFilter.value.length +
        healthFilter.value.length
);

const activeFilterState = computed(() => ({
    provider: providerFilter.value,
    state: stateFilter.value,
    health: healthFilter.value
}));

// Counts come from the search result, so they describe what filtering would
// actually narrow rather than the whole unsearched list.
const filterSections = computed(() => {
    const rows = searchedChannels.value;
    const byProvider = countByKey(rows, (c) => c.provider as string);
    const byState = countByKey(rows, stateKeyOf);
    const byHealth = countByKey(rows, healthKeyOf);
    return [
        {
            key: 'provider',
            label: 'Channel',
            icon: 'fa-bullhorn',
            options: Array.from(byProvider.entries()).map(([k, count]) => ({
                key: k,
                label: channelLabel(k as Channel['provider']),
                count
            }))
        },
        {
            key: 'state',
            label: 'State',
            icon: 'fa-toggle-on',
            options: [
                {key: 'enabled', label: 'Enabled', count: byState.get('enabled') ?? 0},
                {key: 'disabled', label: 'Disabled', count: byState.get('disabled') ?? 0}
            ]
        },
        {
            key: 'health',
            label: 'Health',
            icon: 'fa-heart-pulse',
            options: [
                {key: 'healthy', label: 'Healthy', count: byHealth.get('healthy') ?? 0},
                {key: 'failing', label: 'Failing', count: byHealth.get('failing') ?? 0},
                {
                    key: 'auto_disabled',
                    label: 'Auto-disabled',
                    count: byHealth.get('auto_disabled') ?? 0
                }
            ]
        }
    ];
});

function applyGenericFilters(next: Record<string, string[]>) {
    providerFilter.value = next.provider ?? [];
    stateFilter.value = next.state ?? [];
    healthFilter.value = next.health ?? [];
    filterModalVisible.value = false;
}

const loading = computed(() => channelsStore.loading);

const visibleRows = computed(() => filteredChannels.value);

const headerStats = computed<StatItem[]>(() => [
    {value: sortedChannels.value.length, label: 'channels', status: 'on'}
]);

function channelLabel(type: string): string {
    return labelForChannelType(type);
}

function openCreateModal(): void {
    modalDraft.value = createBlankChannelDraft();
    modalEditingId.value = null;
    modalVisible.value = true;
}

async function openEditModal(channel: Channel): Promise<void> {
    modalDraft.value = buildDraftFromChannel(channel);
    modalEditingId.value = channel.id;
    modalMaskedFields.value = {};
    modalVisible.value = true;
    // Masks come from the single-channel read; the list does not carry them.
    const full = await channelsStore.fetchChannel(channel.id);
    if (modalEditingId.value === channel.id) {
        modalMaskedFields.value = full?.secretState?.maskedFields ?? {};
    }
}

function closeModal(): void {
    modalVisible.value = false;
}

async function onModalSave(draft: ChannelDraft): Promise<void> {
    const config = buildChannelConfigFromDraft(draft);
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

async function resetHealth(channelId: number): Promise<void> {
    const ok = await channelsStore.resetHealth(channelId);
    if (ok) toast.success('Channel re-enabled');
}

async function runTestForChannel(channelId: number): Promise<void> {
    try {
        const result = await channelsStore.testChannel(channelId);
        if (!result) return;
        if (result.state === 'success') toast.success('Channel tested');
        else toast.error(result.errorMessage ?? 'Channel test failed');
    } catch (error) {
        toast.error(rpcErrorMessage(error, 'Request failed'));
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

function verificationStatus(channel: ChannelListItem): string {
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
    background: var(--color-surface-2);
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
    /* The name is the card's subject. It stays on the body step of the scale;
       the detail rows drop to caption so the order reads without inventing an
       off-scale size. */
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
}

.notification-admin__card dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.notification-admin__card dt {
    font-weight: var(--font-semibold);
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
