<template>
    <DetailPageLayout
        back-to="/alerts/channels"
        back-label="Back to Channels"
        :loading="loading"
        :missing="!loading && !destination"
        missing-sub="This destination may have been deleted or you don't have access."
    >
        <template v-if="destination">
            <section class="dd-summary">
                <div class="dd-summary-left">
                    <h2 class="dd-name">{{ destination.name }}</h2>
                    <p v-if="destination.description" class="dd-desc">
                        {{ destination.description }}
                    </p>
                    <div class="dd-counts">
                        <span
                            class="dd-state"
                            :class="`dd-state--${destination.enabled ? 'on' : 'off'}`"
                        >
                            {{ destination.enabled ? 'Enabled' : 'Disabled' }}
                        </span>
                        <span class="dd-count">
                            {{ destination.counts.members }} member{{
                                destination.counts.members === 1 ? '' : 's'
                            }}
                        </span>
                        <span
                            v-if="destination.counts.rulesReferencing > 0"
                            class="dd-count"
                        >
                            {{ destination.counts.rulesReferencing }} rule{{
                                destination.counts.rulesReferencing === 1 ? '' : 's'
                            }}
                            using this
                        </span>
                    </div>
                </div>
                <div class="dd-summary-actions">
                    <Button
                        v-if="canWrite"
                        type="blue-hollow"
                        narrow
                        @click="editVisible = true"
                    >
                        Edit
                    </Button>
                    <Button
                        v-if="canWrite"
                        type="red"
                        narrow
                        @click="askDelete"
                    >
                        Delete
                    </Button>
                </div>
            </section>

            <section class="dd-members">
                <div class="dd-section-hdr">
                    <h3 class="dd-section-title">Members</h3>
                    <Button
                        v-if="canWrite && availableChannels.length > 0"
                        type="green"
                        narrow
                        @click="addChannelVisible = true"
                    >
                        Add channel
                    </Button>
                </div>

                <div v-if="membersLoading" class="dd-loading">
                    <Spinner />
                </div>
                <EmptyBlock v-else-if="members.length === 0">
                    <p>No members yet.</p>
                    <p class="dd-empty-sub">
                        Members are integration channels, users, or push
                        tokens. Add at least one channel so alert rules
                        targeting this group can deliver.
                    </p>
                </EmptyBlock>

                <div v-else class="dd-member-list">
                    <div
                        v-for="group in groupedMembers"
                        :key="group.type"
                        class="dd-member-group"
                    >
                        <h4 class="dd-member-label">
                            {{ memberTypeLabel(group.type) }} ({{ group.items.length }})
                        </h4>
                        <ul class="dd-member-items">
                            <li
                                v-for="m in group.items"
                                :key="`${m.memberType}:${m.memberId}`"
                                class="dd-member-item"
                            >
                                <ProviderLogo
                                    v-if="m.memberType === 'channel' && providerFor(m.memberId)"
                                    :provider="providerFor(m.memberId)!"
                                />
                                <div class="dd-member-text">
                                    <div class="dd-member-name">
                                        {{ channelNameFor(m) }}
                                    </div>
                                    <code class="dd-member-id">{{ m.memberId }}</code>
                                </div>
                                <button
                                    v-if="canWrite"
                                    type="button"
                                    class="dd-member-remove"
                                    :aria-label="`Remove ${m.memberType}`"
                                    @click="removeMember(m)"
                                >
                                    <i class="fas fa-xmark" />
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </section>
        </template>

        <EditDestinationModal
            v-if="destination"
            v-model="editVisible"
            mode="edit"
            :initial="destination"
            @saved="onEdited"
        />

        <!-- Add-channel picker -->
        <Modal :visible="addChannelVisible" @close="addChannelVisible = false">
            <template #title>
                <h3>Add integration channel</h3>
            </template>
            <template #default>
                <ul class="dd-picker">
                    <li
                        v-for="ep in availableChannels"
                        :key="ep.id"
                        class="dd-picker-item"
                        @click="addChannel(ep.id)"
                    >
                        <ProviderLogo :provider="ep.provider" />
                        <div class="dd-picker-text">
                            <div class="dd-picker-name">{{ ep.name }}</div>
                            <div class="dd-picker-provider">
                                {{ providerLabelFor(ep.provider) }}
                            </div>
                        </div>
                    </li>
                </ul>
                <EmptyBlock v-if="availableChannels.length === 0">
                    <p>No more channels available.</p>
                </EmptyBlock>
            </template>
            <template #footer>
                <div class="dd-picker-footer">
                    <Button type="blue-hollow" @click="addChannelVisible = false">
                        Close
                    </Button>
                </div>
            </template>
        </Modal>

        <ConfirmationModal ref="deleteConfirmRef">
            <template #title>
                <h3>Delete destination "{{ destination?.name }}"?</h3>
            </template>
            <template v-if="destination && destination.counts.rulesReferencing > 0" #subText>
                <p class="dd-delete-warn">
                    <i class="fas fa-exclamation-triangle" />
                    {{ destination.counts.rulesReferencing }} alert rule(s)
                    still reference this group. The backend will reject the
                    delete until those are removed.
                </p>
            </template>
        </ConfirmationModal>
    </DetailPageLayout>
</template>

<script setup lang="ts">
import type {ChannelProvider} from '@api/channel';
import type {
    DestinationGroup,
    DestinationMemberRef,
    DestinationMemberType
} from '@api/notification';
import {computed, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import Button from '@/components/core/Button.vue';
import DetailPageLayout from '@/components/core/DetailPageLayout.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ProviderLogo from '@/components/core/ProviderLogo.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditDestinationModal from '@/components/modals/EditDestinationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useDestinationsStore} from '@/stores/destinations';
import {useChannelsStore} from '@/stores/channels';

const destStore = useDestinationsStore();
const channelsStore = useChannelsStore();
const {canWrite} = usePermissions();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const membersLoading = ref(true);
const editVisible = ref(false);
const addChannelVisible = ref(false);
const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();

const destId = computed(() => {
    const params = route.params as Record<
        string,
        string | string[] | undefined
    >;
    const raw = Array.isArray(params.id) ? params.id[0] : params.id;
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) ? n : null;
});

const destination = computed<DestinationGroup | null>(() =>
    destId.value != null ? (destStore.destinations[destId.value] ?? null) : null
);

const members = computed<DestinationMemberRef[]>(() =>
    destId.value != null ? (destStore.members[destId.value] ?? []) : []
);

interface MemberGroup {
    type: DestinationMemberType;
    items: DestinationMemberRef[];
}
const groupedMembers = computed<MemberGroup[]>(() => {
    const map: Partial<Record<DestinationMemberType, DestinationMemberRef[]>> =
        {};
    for (const m of members.value) (map[m.memberType] ??= []).push(m);
    return Object.entries(map)
        .filter(([, items]) => items && items.length > 0)
        .map(([type, items]) => ({
            type: type as DestinationMemberType,
            items: items as DestinationMemberRef[]
        }));
});

const MEMBER_TYPE_LABELS: Record<DestinationMemberType, string> = {
    channel: 'Channels',
    user: 'Users',
    push_token: 'Push tokens'
};

function memberTypeLabel(type: DestinationMemberType): string {
    return MEMBER_TYPE_LABELS[type];
}

function providerFor(memberId: string): ChannelProvider | null {
    const n = Number.parseInt(memberId, 10);
    if (!Number.isFinite(n)) return null;
    return channelsStore.channels[n]?.provider ?? null;
}

function channelNameFor(m: DestinationMemberRef): string {
    if (m.memberType !== 'channel') return m.memberId;
    const n = Number.parseInt(m.memberId, 10);
    const ep = Number.isFinite(n) ? channelsStore.channels[n] : null;
    return ep ? ep.name : m.memberId;
}

function providerLabelFor(provider: ChannelProvider): string {
    return (
        channelsStore.providers.find((p) => p.key === provider)?.label ?? provider
    );
}

const currentChannelMemberIds = computed<Set<string>>(
    () =>
        new Set(
            members.value
                .filter((m) => m.memberType === 'channel')
                .map((m) => m.memberId)
        )
);

const availableChannels = computed(() =>
    Object.values(channelsStore.channels)
        .filter(
            (ep) =>
                ep.enabled && !currentChannelMemberIds.value.has(String(ep.id))
        )
        .sort((a, b) => a.name.localeCompare(b.name))
);

async function refresh() {
    if (destId.value == null) return;
    loading.value = true;
    try {
        await Promise.all([
            destStore.fetchDestination(destId.value),
            destStore.fetchModel(),
            channelsStore.fetchChannels(),
            channelsStore.fetchProviders()
        ]);
    } finally {
        loading.value = false;
    }
    membersLoading.value = true;
    try {
        await destStore.fetchMembers(destId.value);
    } finally {
        membersLoading.value = false;
    }
}

onMounted(refresh);
watch(destId, refresh);

function onEdited() {
    // Store already updated the row.
}

async function addChannel(channelId: number) {
    if (destId.value == null) return;
    const ok = await destStore.addMembers(destId.value, [
        {memberType: 'channel', memberId: String(channelId)}
    ]);
    if (ok) addChannelVisible.value = false;
}

async function removeMember(m: DestinationMemberRef) {
    if (destId.value == null) return;
    await destStore.removeMembers(destId.value, [m]);
}

function askDelete() {
    if (!destination.value) return;
    deleteConfirmRef.value?.storeAction(async () => {
        const ok = await destStore.deleteDestination(destination.value!.id);
        if (ok) router.push('/alerts/channels');
    });
}
</script>

<style scoped>
.dest-detail {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding-top: var(--gap-sm);
}
.dd-hdr {
    display: flex;
    align-items: center;
}
.dd-loading {
    display: flex;
    justify-content: center;
    padding: var(--space-6);
}
.dd-back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-decoration: none;
}
.dd-back:hover {
    color: var(--color-text-primary);
}
.dd-back:hover, .dd-back:focus-visible {
    text-decoration: underline;
}
.dd-summary {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.dd-summary-left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.dd-name {
    margin: 0;
    font-size: var(--type-heading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.dd-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    max-width: 72ch;
}
.dd-counts {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
}
.dd-state {
    font-size: var(--type-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
}
.dd-state--on {
    color: var(--color-success-text);
    background: var(--color-success-subtle);
    border-color: var(--color-success);
}
.dd-state--off {
    color: var(--color-text-disabled);
    background: var(--color-surface-2);
    border-color: var(--color-border-medium);
}
.dd-count {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.dd-summary-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.dd-members {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.dd-section-hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.dd-section-title {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.dd-empty-sub {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    max-width: 56ch;
}
.dd-member-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.dd-member-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.dd-member-label {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.dd-member-items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.dd-member-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}
.dd-member-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.dd-member-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
}
.dd-member-id {
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.dd-member-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.dd-member-remove:hover {
    color: var(--color-danger-text);
    border-color: var(--color-danger);
}
.dd-picker {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 50vh;
    overflow-y: auto;
}
.dd-picker-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.dd-picker-item:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-brand-ring);
    background: var(--color-surface-3);
}
.dd-picker-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.dd-picker-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
}
.dd-picker-provider {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.dd-picker-footer {
    display: flex;
    justify-content: flex-end;
}
.dd-delete-warn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-status-warn);
    font-size: var(--type-body);
}
</style>
