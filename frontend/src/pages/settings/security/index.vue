<template>
    <PageTemplate title="Security" :tabs="tabs" fill>
        <template #toggles>
            <DeviceAuthSubTabs />
        </template>
        <div class="sec-layout">
            <h2 class="sr-only">Enrollment tokens</h2>

            <!-- ── Enrollment tokens ─────────────────────────────────── -->
            <section class="sec-panel" aria-labelledby="sec-tokens-title">
                <div class="sec-panel__head">
                    <h3 id="sec-tokens-title" class="sec-panel__title">
                        Enrollment tokens
                    </h3>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        narrow
                        title="Refresh"
                        aria-label="Refresh tokens"
                        :loading="loading"
                        @click="load"
                    >
                        <i class="fas fa-sync-alt" aria-hidden="true" />
                    </Button>
                </div>
                <p class="sec-panel__sub">
                    Every minted token and what happened to it. The token value
                    is never stored; copy it when you create it.
                </p>
                <div v-if="error" class="sec-panel__state sec-panel__state--error">
                    {{ error }}
                </div>
                <div v-else-if="loading && tokens.length === 0" class="sec-panel__state">
                    <Spinner size="sm" /> Loading…
                </div>
                <div v-else-if="tokens.length === 0" class="sec-panel__state">
                    No tokens minted yet. Generate one when adding a device.
                </div>
                <div v-else class="sec-table-wrap">
                <table class="sec-table">
                    <thead>
                        <tr>
                            <th>Token</th>
                            <th>State</th>
                            <th>Uses</th>
                            <th>Created</th>
                            <th>Expires</th>
                            <th>Last used</th>
                            <th class="sec-table__actions" aria-label="Actions" />
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="token in tokens" :key="token.id">
                            <td class="sec-table__mono">{{ token.tokenPrefix }}…</td>
                            <td>
                                <Pill :variant="stateVariant(token)">
                                    {{ stateLabel(token) }}
                                </Pill>
                            </td>
                            <td class="sec-table__mono">
                                {{ token.useCount }}/{{ token.maxUses }}
                            </td>
                            <td :title="formatTime(token.createdAt)">
                                {{ formatRelative(token.createdAt, now) }}
                            </td>
                            <td :title="formatTime(token.notAfter)">
                                <CountdownRing
                                    v-if="stateLabel(token) === 'Active'"
                                    :start-at="token.createdAt"
                                    :end-at="token.notAfter"
                                    :now-ms="now"
                                />
                                <template v-else>
                                    {{ expiryLabel(token) }}
                                </template>
                            </td>
                            <td :title="token.lastUsedAt ? formatTime(token.lastUsedAt) : 'Never used'">
                                {{ token.lastUsedAt ? formatRelative(token.lastUsedAt, now) : '—' }}
                            </td>
                            <td class="sec-table__actions">
                                <Button
                                    v-if="stateLabel(token) === 'Active'"
                                    type="red"
                                    size="xs"
                                    narrow
                                    :loading="revoking === token.id"
                                    title="Revoke token"
                                    :aria-label="`Revoke ${token.tokenPrefix}`"
                                    @click="confirmRevoke(token)"
                                >
                                    <i class="fas fa-ban" aria-hidden="true" />
                                </Button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                </div>
            </section>

        </div>
        <ConfirmationModal ref="revokeConfirm" />
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    computed,
    inject,
    onBeforeUnmount,
    onMounted,
    ref
} from 'vue';
import type {EnrollmentTokenSummary} from '@/api/deviceIngressRpc';
import Button from '@/components/core/Button.vue';
import CountdownRing from '@/components/core/CountdownRing.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Pill from '@/components/core/Pill.vue';
import Spinner from '@/components/core/Spinner.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import DeviceAuthSubTabs from '@/components/pages/device-auth/DeviceAuthSubTabs.vue';
import {
    effectiveTokenState,
    useEnrollmentTokens
} from '@/composables/useEnrollmentTokens';
import {SECOND_TICK_MS, useNowTicker} from '@/composables/useNowTicker';
import {formatRelative, formatTime, formatUntil} from '@/helpers/format';
import type {RouteTab} from '@/types/page-template';

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const {tokens, loading, error, revoking, load, revoke} = useEnrollmentTokens();
const {now, release} = useNowTicker(SECOND_TICK_MS);
onBeforeUnmount(release);

const STATE_LABELS: Record<string, string> = {
    active: 'Active',
    consumed: 'Used',
    revoked: 'Revoked',
    expired: 'Expired'
};

const STATE_VARIANTS: Record<
    string,
    'success' | 'info' | 'danger' | 'neutral'
> = {
    active: 'success',
    consumed: 'info',
    revoked: 'danger',
    expired: 'neutral'
};

function stateLabel(token: EnrollmentTokenSummary): string {
    return STATE_LABELS[effectiveTokenState(token, now.value)];
}

function stateVariant(
    token: EnrollmentTokenSummary
): 'success' | 'info' | 'danger' | 'neutral' {
    return STATE_VARIANTS[effectiveTokenState(token, now.value)];
}

// Dead tokens can still carry a future notAfter (revoked or used early)
// — pick the formatter by direction so the label never goes negative.
function expiryLabel(token: EnrollmentTokenSummary): string {
    const expiresMs = new Date(token.notAfter).getTime();
    return expiresMs > now.value
        ? formatUntil(token.notAfter, now.value)
        : formatRelative(token.notAfter, now.value);
}

const revokeConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(
    null
);

function confirmRevoke(token: EnrollmentTokenSummary): void {
    revokeConfirm.value?.storeAction(() => revoke(token.id), {
        title: 'Revoke token',
        message: `Devices can no longer enroll with ${token.tokenPrefix}…`,
        confirmLabel: 'Revoke'
    });
}

onMounted(() => {
    void load();
});
</script>

<style scoped>
.sec-layout {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding-top: var(--gap-sm);
}

/* Same panel language as the Users page. */
.sec-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
    padding-bottom: var(--gap-sm);
}
.sec-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.sec-panel__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.sec-panel__sub {
    margin: 0;
    padding: var(--gap-sm) var(--gap-sm) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.sec-panel__state {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-md) var(--gap-sm);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.sec-panel__state--error {
    color: var(--color-danger-text);
}

/* The panel clips its corners; the table scrolls sideways on its own. */
.sec-table-wrap {
    overflow-x: auto;
}
.sec-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-body);
    margin-top: var(--gap-xs);
}
.sec-table th {
    padding: var(--space-2) var(--gap-sm);
    text-align: left;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    border-bottom: 1px solid var(--color-border-subtle);
}
.sec-table td {
    padding: var(--space-2) var(--gap-sm);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--divider-hairline);
    white-space: nowrap;
}
.sec-table tbody tr:last-child td {
    border-bottom: 0;
}
.sec-table__mono {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
}
.sec-table__actions {
    text-align: right;
    width: var(--space-12);
}
</style>
