<template>
    <div class="dip">
        <div class="dip__head">
            <h3 class="dip__title">Device identities</h3>
            <div class="dip__head-actions">
                <span v-if="offPageNote" class="dip__selection-note">
                    {{ offPageNote }}
                </span>
                <Button
                    v-if="selectedCount > 0"
                    type="blue-hollow"
                    size="sm"
                    @click="clearSelection"
                >
                    Clear selection
                </Button>
                <Button
                    type="blue"
                    size="sm"
                    :disabled="selectedCount === 0"
                    :title="rotateTitle"
                    @click="confirmRotate"
                >
                    {{ rotateLabel }}
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    narrow
                    title="Refresh"
                    aria-label="Refresh device identities"
                    :loading="loading"
                    @click="refresh"
                >
                    <i class="fas fa-sync-alt" aria-hidden="true" />
                </Button>
            </div>
        </div>
        <p class="dip__sub">
            Every device that may connect, and the key it uses. Disable a
            device to cut it off. Rotate to give it a new key.
        </p>
        <p v-if="keysChecked === false" class="dip__sub">
            This server does not check device keys. Rotating a key restarts
            the device but changes nothing until key checking is turned on.
        </p>
        <div v-if="error" class="dip__state dip__state--error">
            {{ error }}
        </div>
        <div v-else-if="loading && rows.length === 0" class="dip__state">
            <Spinner size="sm" /> Loading…
        </div>
        <div v-else-if="rows.length === 0" class="dip__state">
            No device identities yet. They appear after a device is set up or
            approved.
        </div>
        <div v-else class="dip__table-wrap">
            <table class="dip__table">
                <thead>
                    <tr>
                        <th class="dip__pick" aria-label="Select" />
                        <th>Device</th>
                        <th>Status</th>
                        <th>Last seen</th>
                        <th>Key ends</th>
                        <th class="dip__actions" aria-label="Actions" />
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.identity.id">
                        <td class="dip__pick">
                            <Checkbox
                                v-if="row.identity.status === 'active'"
                                :model-value="selected.has(row.identity.id)"
                                :aria-label="`Select ${row.label}`"
                                @update:model-value="
                                    toggle(row.identity.id, $event)
                                "
                            />
                        </td>
                        <td
                            class="dip__device"
                            :class="{'dip__mono': row.isMachineId}"
                        >
                            {{ row.label }}
                        </td>
                        <td>
                            <Pill :variant="statusVariant(row.identity.status)">
                                {{ statusLabel(row.identity.status) }}
                            </Pill>
                        </td>
                        <td :title="row.lastSeenTitle">
                            {{ row.lastSeenLabel }}
                        </td>
                        <td :title="row.keyEndTitle">
                            <Pill
                                v-if="row.keyEndLabel"
                                :variant="row.keyEndVariant"
                            >
                                {{ row.keyEndLabel }}
                            </Pill>
                            <template v-else>—</template>
                        </td>
                        <td class="dip__actions">
                            <Button
                                v-if="canEnable(row.identity.status)"
                                type="green"
                                size="xs"
                                :loading="busy === row.identity.id"
                                :aria-label="`Enable ${row.label}`"
                                @click="enable(row.identity.id)"
                            >
                                Enable
                            </Button>
                            <Button
                                v-else-if="row.identity.status === 'active'"
                                type="red"
                                size="xs"
                                :loading="busy === row.identity.id"
                                :aria-label="`Disable ${row.label}`"
                                @click="confirmDisable(row)"
                            >
                                Disable
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div v-if="showPaging" class="dip__paging">
            <span>{{ pagingLabel }}</span>
            <div class="dip__paging-actions">
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="!hasPrev"
                    :loading="loading"
                    @click="prev"
                >
                    Prev
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="!hasNext"
                    :loading="loading"
                    @click="next"
                >
                    Next
                </Button>
            </div>
        </div>
        <ConfirmationModal ref="disableConfirm" />
        <ConfirmationModal ref="rotateConfirm" />
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from 'vue';
import type {IngressIdentity} from '@/api/deviceIngressRpc';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Pill from '@/components/core/Pill.vue';
import Spinner from '@/components/core/Spinner.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {
    resetDeviceIdentities,
    useDeviceIdentities
} from '@/composables/useDeviceIdentities';
import {useNowTicker} from '@/composables/useNowTicker';
import {formatRelative, formatTime, formatUntil} from '@/helpers/format';

type PillVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

interface IdentityRow {
    identity: IngressIdentity;
    label: string;
    isMachineId: boolean;
    keyEndsAt: string | null;
    keyEndLabel: string | null;
    keyEndVariant: PillVariant;
    keyEndTitle: string | undefined;
    lastSeenLabel: string;
    lastSeenTitle: string;
}

const STATUS_LABELS: Record<string, string> = {
    pending: 'Waiting',
    active: 'Active',
    disabled: 'Disabled',
    quarantined: 'Quarantined',
    deleted: 'Deleted'
};

const STATUS_VARIANTS: Record<string, PillVariant> = {
    pending: 'warning',
    active: 'success',
    disabled: 'neutral',
    quarantined: 'danger',
    deleted: 'neutral'
};

const {
    identities,
    expiring,
    total,
    page,
    pageSize,
    hasPrev,
    hasNext,
    loading,
    error,
    busy,
    keysChecked,
    load,
    enable,
    disable,
    rotate,
    rotationNotStarted,
    next,
    prev
} = useDeviceIdentities();
const {now, release} = useNowTicker();

// This panel is the only loader, so the shared list leaves with the page and
// no other tenant's rows can show before the next load lands.
onBeforeUnmount(() => {
    release();
    resetDeviceIdentities();
});

const selected = ref<Set<string>>(new Set());

const rows = computed<IdentityRow[]>(() =>
    identities.value
        .map((identity) => {
            // A listed credential with no end date never expires, so it is
            // not a warning — only a real date marks the row.
            const keyEndsAt = expiring.value.get(identity.id) ?? null;
            const externalId = identity.expectedExternalId;
            return {
                identity,
                label: externalId || identity.displayName,
                isMachineId: Boolean(externalId),
                keyEndsAt,
                keyEndLabel: keyEndsAt ? formatUntil(keyEndsAt, now.value) : null,
                keyEndVariant: keyEndVariant(keyEndsAt, now.value),
                keyEndTitle: keyEndsAt ? formatTime(keyEndsAt) : undefined,
                lastSeenLabel: identity.lastSeenAt
                    ? formatRelative(identity.lastSeenAt, now.value)
                    : 'Never',
                lastSeenTitle: identity.lastSeenAt
                    ? formatTime(identity.lastSeenAt)
                    : 'Never seen'
            };
        })
        .sort(compareRows)
);

// The selection is fleet-wide: paging away from a row must not drop it, so the
// set is kept whole and the backend refuses any id that is no longer active.
const selectedCount = computed(() => selected.value.size);

const offPageCount = computed(() => {
    const onPage = rows.value.filter((row) =>
        selected.value.has(row.identity.id)
    ).length;
    return selectedCount.value - onPage;
});

const offPageNote = computed(() =>
    offPageCount.value > 0
        ? `${selectedCount.value} selected, ${offPageCount.value} on other pages`
        : null
);

// Only when the fleet is larger than one page, so a single-page list has no dead controls.
const showPaging = computed(() => total.value > pageSize);

// Counted off the rows actually returned, so the label can never claim more.
const pagingLabel = computed(() => {
    if (rows.value.length === 0) return `0 of ${total.value}`;
    const from = page.value * pageSize + 1;
    return `${from} to ${from + rows.value.length - 1} of ${total.value}`;
});

const rotateLabel = computed(() =>
    selectedCount.value === 0
        ? 'Rotate keys'
        : `Rotate keys (${selectedCount.value})`
);

const rotateTitle = computed(() =>
    selectedCount.value === 0
        ? 'Select devices first'
        : 'Rotate keys for the selected devices'
);

function keyEndVariant(keyEndsAt: string | null, nowMs: number): PillVariant {
    if (!keyEndsAt) return 'neutral';
    return new Date(keyEndsAt).getTime() <= nowMs ? 'danger' : 'warning';
}

function compareRows(a: IdentityRow, b: IdentityRow): number {
    const aExpiring = a.keyEndsAt !== null;
    const bExpiring = b.keyEndsAt !== null;
    if (aExpiring !== bExpiring) return aExpiring ? -1 : 1;
    const endDiff = endMs(a.keyEndsAt) - endMs(b.keyEndsAt);
    if (endDiff !== 0) return endDiff;
    return seenMs(b.identity.lastSeenAt) - seenMs(a.identity.lastSeenAt);
}

function endMs(value: string | null): number {
    return value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
}

function seenMs(value: string | null): number {
    return value ? new Date(value).getTime() : 0;
}

function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

function statusVariant(status: string): PillVariant {
    return STATUS_VARIANTS[status] ?? 'neutral';
}

function canEnable(status: string): boolean {
    return status === 'pending' || status === 'disabled';
}

function toggle(id: string, checked: boolean): void {
    const updated = new Set(selected.value);
    if (checked) updated.add(id);
    else updated.delete(id);
    selected.value = updated;
}

function clearSelection(): void {
    selected.value = new Set();
}

function refresh(): void {
    void load();
}

const disableConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(
    null
);
const rotateConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(null);

function confirmDisable(row: IdentityRow): void {
    disableConfirm.value?.storeAction(() => disable(row.identity.id), {
        title: 'Disable device',
        message:
            'Disable this device? It will be disconnected and cannot reconnect until enabled.',
        confirmLabel: 'Disable'
    });
}

function confirmRotate(): void {
    const ids = [...selected.value];
    if (ids.length === 0) return;
    rotateConfirm.value?.storeAction(
        async () => {
            // Keep the picks when the batch was refused so the operator can
            // retry without selecting every device again. A partial success
            // keeps only the identities that never got a rotation job selected.
            if (await rotate(ids)) {
                selected.value = new Set(
                    ids.filter((id) => rotationNotStarted.value.has(id))
                );
            }
        },
        {
            title: 'Rotate keys',
            message: `Rotate keys for ${ids.length} devices? Each device restarts once when its new address is applied.`,
            confirmLabel: 'Rotate'
        }
    );
}

defineExpose({load});
</script>

<style scoped>
/* Same panel language as the Enrollment tokens section on this page. */
.dip {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
    padding-bottom: var(--gap-sm);
}
.dip__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.dip__head-actions {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.dip__selection-note {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    white-space: nowrap;
}
.dip__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.dip__sub {
    margin: 0;
    padding: var(--gap-sm) var(--gap-sm) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.dip__state {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-md) var(--gap-sm);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.dip__state--error {
    color: var(--color-danger-text);
}
.dip__paging {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-sm) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.dip__paging-actions {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}

/* The panel clips its corners; the table scrolls sideways on its own. */
.dip__table-wrap {
    overflow-x: auto;
}
.dip__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-body);
    margin-top: var(--gap-xs);
}
.dip__table th {
    padding: var(--gap-xs) var(--gap-sm);
    text-align: left;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    border-bottom: 1px solid var(--color-border-subtle);
}
.dip__table td {
    padding: var(--gap-xs) var(--gap-sm);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--divider-hairline);
    white-space: nowrap;
}
.dip__table tbody tr:last-child td {
    border-bottom: 0;
}
.dip__device {
    color: var(--color-text-primary);
}
.dip__mono {
    font-family: var(--font-mono);
}
/* Both hold one control each; the table sizes them to their content. */
.dip__pick,
.dip__actions {
    width: 1%;
}
.dip__actions {
    text-align: right;
}
</style>
