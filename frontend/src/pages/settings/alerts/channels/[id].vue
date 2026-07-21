<template>
    <DetailPageLayout
        back-to="/settings/alerts/channels"
        back-label="Back to Channels"
        :loading="loading"
        :missing="!loading && !channel"
        missing-sub="This channel may have been deleted or you don't have access."
    >
        <template v-if="channel">
            <BasicBlock bordered padding="md" class="id-hero">
                <div class="id-hero__row">
                    <div class="id-hero__left">
                        <ProviderLogo :provider="channel.provider" />
                        <div class="id-hero__text">
                            <h2 class="id-hero__name">{{ channel.name }}</h2>
                            <div class="id-hero__provider">{{ providerLabel }}</div>
                        </div>
                    </div>
                    <div class="id-hero__actions">
                        <Button
                            v-if="canWrite"
                            type="blue-hollow"
                            narrow
                            :loading="testing"
                            @click="runTest(true)"
                        >
                            <i class="fas fa-flask" /> Dry-run test
                        </Button>
                        <Button
                            v-if="canWrite && testSupported"
                            type="blue"
                            narrow
                            :loading="testingLive"
                            @click="confirmLiveTest"
                        >
                            <i class="fas fa-paper-plane" /> Live test
                        </Button>
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
                </div>
            </BasicBlock>

            <SectionHeading icon="fas fa-circle-info">Status</SectionHeading>
            <BasicBlock bordered padding="md">
                <dl class="id-info-grid">
                    <div class="id-info-row">
                        <dt>Enabled</dt>
                        <dd>{{ channel.enabled ? 'Yes' : 'No' }}</dd>
                    </div>
                    <div v-if="channel.lastTestAt" class="id-info-row">
                        <dt>Last test</dt>
                        <dd>
                            {{ formatTs(channel.lastTestAt) }}
                            <Pill
                                v-if="channel.lastTestStatus"
                                :variant="statusVariant(channel.lastTestStatus)"
                            >
                                {{ channel.lastTestStatus }}
                            </Pill>
                        </dd>
                    </div>
                    <div v-if="channel.lastDeliveryAt" class="id-info-row">
                        <dt>Last delivery</dt>
                        <dd>
                            {{ formatTs(channel.lastDeliveryAt) }}
                            <Pill
                                v-if="channel.lastDeliveryStatus"
                                :variant="statusVariant(channel.lastDeliveryStatus)"
                            >
                                {{ channel.lastDeliveryStatus }}
                            </Pill>
                        </dd>
                    </div>
                    <div v-if="channel.secretState.hasSecretFields" class="id-info-row">
                        <dt>Secret state</dt>
                        <dd>
                            <i class="fas fa-lock" />
                            Configured (write-only)
                        </dd>
                    </div>
                </dl>
            </BasicBlock>

            <SectionHeading icon="fas fa-code">Configuration</SectionHeading>
            <BasicBlock bordered padding="md">
                <pre class="id-config-json">{{ configPreview }}</pre>
            </BasicBlock>

            <template v-if="lastTestResult">
                <SectionHeading icon="fas fa-flask">Test result</SectionHeading>
                <BasicBlock bordered padding="md">
                    <p class="id-test-line">
                        <Pill :variant="statusVariant(lastTestResult.state)">
                            {{ lastTestResult.state }}
                        </Pill>
                        at {{ formatTs(lastTestResult.testedAt) }}
                    </p>
                    <p v-if="lastTestResult.errorMessage" class="id-test-error">
                        {{ lastTestResult.errorMessage }}
                    </p>
                </BasicBlock>
            </template>
        </template>

        <EditChannelModal
            v-if="channel"
            v-model="editVisible"
            mode="edit"
            :initial="channel"
            @saved="onEdited"
        />

        <ConfirmationModal ref="deleteConfirmRef">
            <template #title>
                <h3>Delete channel "{{ channel?.name }}"?</h3>
            </template>
        </ConfirmationModal>

        <ConfirmationModal ref="liveTestConfirmRef">
            <template #title>
                <h3>Send a live test through "{{ channel?.name }}"?</h3>
            </template>
            <template #subText>
                <p class="id-live-warn">
                    <i class="fas fa-exclamation-triangle" />
                    A real message will be delivered via this provider.
                </p>
            </template>
        </ConfirmationModal>
    </DetailPageLayout>
</template>

<script setup lang="ts">
import type {
    Channel,
    ChannelTestResult
} from '@api/channel';
import {computed, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import DetailPageLayout from '@/components/core/DetailPageLayout.vue';
import Pill from '@/components/core/Pill.vue';
import ProviderLogo from '@/components/core/ProviderLogo.vue';
import SectionHeading from '@/components/core/SectionHeading.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditChannelModal from '@/components/modals/EditChannelModal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useChannelsStore} from '@/stores/channels';

const store = useChannelsStore();
const {canWrite} = usePermissions();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const testing = ref(false);
const testingLive = ref(false);
const editVisible = ref(false);
const lastTestResult = ref<ChannelTestResult | null>(null);
const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();
const liveTestConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();

const channelId = computed(() => {
    const params = route.params as Record<
        string,
        string | string[] | undefined
    >;
    const raw = Array.isArray(params.id) ? params.id[0] : params.id;
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) ? n : null;
});

const channel = computed<Channel | null>(() =>
    channelId.value != null
        ? (store.channels[channelId.value] ?? null)
        : null
);

const providerLabel = computed(() => {
    if (!channel.value) return '';
    return (
        store.providers.find((p) => p.key === channel.value!.provider)
            ?.label ?? channel.value.provider
    );
});

const testSupported = computed(
    () =>
        !!store.providers.find((p) => p.key === channel.value?.provider)
            ?.testSupported
);

const configPreview = computed(() =>
    channel.value ? JSON.stringify(channel.value.config, null, 2) : ''
);

function statusVariant(
    status: string | undefined | null
): 'success' | 'danger' | 'warning' | 'neutral' {
    switch (status) {
        case 'success':
        case 'ok':
        case 'delivered':
            return 'success';
        case 'failed':
        case 'error':
            return 'danger';
        case 'pending':
        case 'running':
            return 'warning';
        default:
            return 'neutral';
    }
}

function formatTs(ts: string): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
}

async function refresh() {
    if (channelId.value == null) return;
    loading.value = true;
    try {
        await Promise.all([
            store.fetchChannel(channelId.value),
            store.fetchProviders()
        ]);
    } finally {
        loading.value = false;
    }
}

onMounted(refresh);
watch(channelId, refresh);

async function runTest(dryRun: boolean) {
    if (!channel.value) return;
    const flag = dryRun ? testing : testingLive;
    flag.value = true;
    try {
        const res = await store.testChannel(channel.value.id, dryRun);
        if (res) {
            lastTestResult.value = res;
            await store.fetchChannel(channel.value.id);
        }
    } finally {
        flag.value = false;
    }
}

function confirmLiveTest() {
    if (!channel.value) return;
    liveTestConfirmRef.value?.storeAction(() => runTest(false));
}

function onEdited() {
    // Store already updated the row.
}

function askDelete() {
    if (!channel.value) return;
    deleteConfirmRef.value?.storeAction(async () => {
        const ok = await store.deleteChannel(channel.value!.id);
        if (ok) router.push('/settings/alerts/channels');
    });
}
</script>

<style scoped>
.id-hero__row {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    flex-wrap: wrap;
}
.id-hero__left {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    flex: 1;
    min-width: 0;
}
.id-hero__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.id-hero__name {
    margin: 0;
    font-size: var(--type-heading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.id-hero__provider {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.id-hero__actions {
    display: flex;
    gap: var(--gap-xs);
    flex-wrap: wrap;
}

.id-info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--gap-sm);
    margin: 0;
}
.id-info-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.id-info-row dt {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.id-info-row dd {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}

.id-config-json {
    margin: 0;
    padding: var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    white-space: pre-wrap;
    overflow-x: auto;
}

.id-test-line {
    margin: 0;
    font-size: var(--type-body);
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.id-test-error {
    margin: var(--gap-xs) 0 0;
    font-size: var(--type-caption);
    color: var(--color-danger-text);
    font-family: var(--font-mono, monospace);
}

.id-live-warn {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-warning-text);
    font-size: var(--type-body);
}
</style>
