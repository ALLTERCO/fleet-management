<template>
    <PageTemplate
        v-model:search="state.nameFilter.value"
        title="Waiting Room"
        :tabs="tabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search by Shelly ID…"
        :filterable="true"
        :has-active-filter="state.filterCount.value > 0"
        :filter-count="state.filterCount.value"
        :loading="state.loading.value && !state.devices.value"
        :empty="!state.error.value && state.filteredEntries.value.length === 0 && !state.loading.value"
        :empty-title="copy.emptyTitle"
        :empty-sub="copy.emptySub"
        @filter-click="state.filterModalVisible.value = true"
    >
        <template #toggles>
            <ViewToggle
                :model-value="mode"
                :options="STATUS_OPTIONS"
                @update:model-value="goToStatus"
            />
        </template>

        <template #actions>
            <WaitingRoomBulkActions
                :state="state"
                :mode="mode"
                :can-accept="canAccept"
                :can-reject="canReject"
            />
        </template>

        <Notification v-if="state.error.value" type="error">
            Something went wrong
        </Notification>

        <!-- Bulk-accept progress (large batches run as a background job). -->
        <div v-if="state.bulkJob.value" class="wr-bulk">
            <div class="wr-bulk__head">
                <span class="wr-bulk__label">
                    Accepting {{ state.bulkJob.value.processed }} /
                    {{ state.bulkJob.value.total }} ·
                    {{ state.bulkJob.value.accepted }} accepted<template
                        v-if="state.bulkJob.value.failed.length"
                    >
                        · {{ state.bulkJob.value.failed.length }} failed</template
                    >
                </span>
                <Button
                    v-if="state.bulkJob.value.state === 'running'"
                    type="blue-hollow"
                    size="sm"
                    @click="state.cancelBulkJob"
                >
                    Cancel
                </Button>
            </div>
            <div class="wr-bulk__track">
                <div
                    class="wr-bulk__fill"
                    :style="{width: `${bulkPercent}%`}"
                />
            </div>
        </div>

        <template v-if="state.filteredEntries.value.length > 0">
            <div class="dc-grid">
                <WaitingRoomDeviceCard
                    v-for="[internalId, device] in state.paginatedItems.value"
                    :key="internalId"
                    :device="device"
                    :selected="state.selectedSet.value.has(internalId)"
                    :can-accept="canAccept"
                    :can-reject="canReject"
                    :accepting="state.accepting.value"
                    :is-accepting="state.isAccepting(internalId)"
                    :show-reject="mode === 'pending'"
                    @click="state.openDetail(internalId)"
                    @accept="state.acceptDevice(internalId)"
                    @reject="mode === 'pending' ? state.rejectDevice(internalId) : null"
                />
            </div>
            <div v-if="state.hasMorePages.value" class="wr-spinner">
                <Spinner />
            </div>
            <div ref="cardSentinel" class="wr-sentinel" />
        </template>

        <template #modals>
            <FilterModal
                :visible="state.filterModalVisible.value"
                :title="copy.filterTitle"
                match-label="devices"
                :match-count="state.filteredEntries.value.length"
                :sections="state.filterSections.value"
                :initial-state="state.activeFilterState.value"
                @close="state.filterModalVisible.value = false"
                @apply-generic="state.applyFilters"
            />
            <WaitingRoomDeviceDetailModal
                v-model="state.detailModalVisible.value"
                :device="state.detailDevice.value"
                :can-accept="canAccept"
                :can-reject="canReject"
                :show-reject="mode === 'pending'"
                @accept="state.detailDeviceId.value && state.acceptDevice(state.detailDeviceId.value)"
                @reject="
                    mode === 'pending' &&
                    state.detailDeviceId.value &&
                    state.rejectDevice(state.detailDeviceId.value)
                "
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {computed, onUnmounted, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import WaitingRoomDeviceCard from '@/components/cards/WaitingRoomDeviceCard.vue';
import Button from '@/components/core/Button.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import Notification from '@/components/core/Notification.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Spinner from '@/components/core/Spinner.vue';
import ViewToggle from '@/components/core/ViewToggle.vue';
import WaitingRoomBulkActions from '@/components/ingress/WaitingRoomBulkActions.vue';
import WaitingRoomDeviceDetailModal from '@/components/modals/WaitingRoomDeviceDetailModal.vue';
import {useDeviceSectionTabs} from '@/composables/useSectionTabs';
import {
    useWaitingRoomList,
    type WaitingRoomMode
} from '@/composables/useWaitingRoomList';
import {WAITING_ROOM_PATH} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import type {StatItem} from '@/types/page-template';

// Shared list rendering for the Pending and Denied tabs of /waiting-room.
// Each route file mounts this component with its mode; everything else is identical.

const props = defineProps<{mode: WaitingRoomMode}>();

const NO_WRITE_TITLE = 'You do not have permission to perform this action';

// Per-mode copy. Keeps mode-specific strings in one place; the bulk-action
// labels live in WaitingRoomBulkActions.
const COPY = {
    pending: {
        emptyTitle: 'No pending devices',
        emptySub: 'Pending Shelly devices will appear here.',
        filterTitle: 'Filter Pending',
        acceptTitle: 'Accept device'
    },
    denied: {
        emptyTitle: 'No denied devices',
        emptySub: 'Denied Shelly devices will appear here.',
        filterTitle: 'Filter Denied',
        acceptTitle: 'Re-allow device'
    }
} as const;

// Primary switch (Devices | Waiting Room). Pending/Denied is a secondary
// status control below — each is its own route, so it navigates.
const tabs = useDeviceSectionTabs();

const STATUS_OPTIONS = [
    {value: 'pending' as const, label: 'Pending'},
    {value: 'denied' as const, label: 'Denied'}
];
const router = useRouter();
function goToStatus(next: WaitingRoomMode): void {
    if (next === props.mode) return;
    router.push(
        next === 'denied' ? `${WAITING_ROOM_PATH}/denied` : WAITING_ROOM_PATH
    );
}

const authStore = useAuthStore();
const state = useWaitingRoomList(props.mode);

const bulkPercent = computed(() => {
    const job = state.bulkJob.value;
    return job && job.total > 0
        ? Math.round((job.processed / job.total) * 100)
        : 0;
});

const copy = computed(() => COPY[props.mode]);
const canAccept = computed(() =>
    authStore.canPerformComponent('waiting_room', 'create')
);
const canReject = computed(() =>
    authStore.canPerformComponent('waiting_room', 'delete')
);

const headerStats = computed<StatItem[]>(() => [
    {value: state.allEntries.value.length, label: props.mode}
]);

// Infinite-scroll sentinel for the cards view.
const cardSentinel = ref<HTMLElement | null>(null);
let cardObserver: IntersectionObserver | null = null;

watch(cardSentinel, (el) => {
    cardObserver?.disconnect();
    if (!el) return;
    cardObserver = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting && state.hasMorePages.value) {
                state.loadItems();
            }
        },
        {rootMargin: '0px 0px 400px 0px'}
    );
    cardObserver.observe(el);
});

onUnmounted(() => cardObserver?.disconnect());
</script>

<style scoped>
.wr-spinner {
    display: flex;
    justify-content: center;
    margin: var(--space-4) 0;
}

.wr-sentinel {
    height: 1px;
}

.wr-bulk {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    margin-bottom: var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.wr-bulk__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}
.wr-bulk__label {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.wr-bulk__track {
    height: var(--space-1-5);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
}
.wr-bulk__fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    transition: width var(--motion-hover);
}

</style>
