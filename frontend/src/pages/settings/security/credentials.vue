<template>
    <PageTemplate
        fill
        v-model:search="search"
        title="Credentials"
        :count="credentialsCountLabel"
        :tabs="tabs"
        searchable
        search-placeholder="Search by device id…"
        filterable
        :has-active-filter="statusFilter !== ''"
        :filter-count="statusFilter === '' ? undefined : 1"
        @filter-click="filterVisible = true"
    >
        <template #toggles>
            <DeviceAuthSubTabs />
        </template>

        <template #actions>
            <Button
                type="green"
                narrow
                title="Set device password"
                aria-label="Set device password"
                @click="setPwOpen = true"
            >
                <i class="fas fa-plus" />
            </Button>
            <Button
                type="blue-hollow"
                narrow
                title="Rotate selected"
                aria-label="Rotate selected"
                @click="openRotate"
            >
                <i class="fas fa-rotate" />
            </Button>
        </template>

        <div class="cred-layout">
            <h2 class="sr-only">Credentials</h2>
            <DataList
                :rows="filtered"
                :columns="columns"
                row-key="device_id"
                :loading="store.loading"
                empty-message="No device credentials yet."
            >
                <template #cell-device_id="{row}">
                    <Checkbox
                        :model-value="selected.has(row.device_id)"
                        @update:model-value="() => toggleSelect(row.device_id)"
                    />
                    <span class="cred-device">{{ row.device_id }}</span>
                </template>
                <template #cell-rotated_at="{row}">
                    {{ formatTime(row.rotated_at) }}
                </template>
                <template #cell-status="{row}">
                    <span :class="`cred-status cred-status--${row.last_rotation_status}`">
                        {{ row.last_rotation_status }}
                    </span>
                </template>
                <template #cell-actions="{row}">
                    <button
                        type="button"
                        class="cred-action-btn cred-action-btn--reveal"
                        :title="`Reveal password for ${row.device_id}`"
                        @click="doReveal(row)"
                    >
                        <i class="fas fa-eye" />
                    </button>
                    <button
                        type="button"
                        class="cred-action-btn cred-action-btn--clear"
                        :title="`Clear auth on ${row.device_id}`"
                        @click="doClear(row)"
                    >
                        <i class="fas fa-ban" />
                    </button>
                </template>
            </DataList>
        </div>

        <template #modals>
            <Modal :visible="rotateOpen" @close="closeRotate">
                <template #title>Rotate credentials</template>
                <div class="cred-form">
                    <template v-if="!rotateResult">
                        <p class="cred-form-hint">
                            {{ selected.size }} device(s) selected. Each rotation
                            generates a new strong password and pushes it via
                            Shelly.SetAuth. Failed rotations stay flagged in the list.
                        </p>
                        <Checkbox
                            v-model="includeFlagged"
                            label="Include previously-failed devices"
                        />
                    </template>
                    <template v-else>
                        <p class="cred-form-hint">
                            New password for each of
                            <b>{{ rotateResult.results.length }}</b> device(s).
                            Download the list now — it is shown only once.
                        </p>
                        <PasswordResultList :rows="rotateResult.results" />
                    </template>
                    <div class="cred-form-actions">
                        <Button type="blue-hollow" @click="closeRotate">Close</Button>
                        <Button
                            v-if="!rotateResult"
                            type="green"
                            :disabled="rotating || selected.size === 0"
                            @click="submitRotate"
                        >
                            Rotate {{ selected.size }}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal :visible="revealOpen" @close="closeReveal">
                <template #title>Reveal password</template>
                <div class="cred-form">
                    <p class="cred-form-hint">
                        Justification is logged for audit. Password is fetched from
                        the credentials vault.
                    </p>
                    <FormField label="Device">
                        <Input :model-value="revealDeviceId" disabled />
                    </FormField>
                    <FormField label="Justification" :error="revealError">
                        <Input
                            v-model="revealJust"
                            placeholder="e.g. on-site service call"
                        />
                    </FormField>
                    <SecretReveal
                        v-if="revealResult"
                        :token="revealResult"
                        warning="This reveal is logged for audit."
                        copy-label="Copy password"
                        @copy="copyRevealed"
                    />
                    <div class="cred-form-actions">
                        <Button type="blue-hollow" @click="closeReveal">Close</Button>
                        <Button
                            v-if="!revealResult"
                            type="blue"
                            :disabled="revealing"
                            @click="submitReveal"
                        >
                            Reveal
                        </Button>
                    </div>
                </div>
            </Modal>

            <ConfirmationModal ref="confirmModal" />

            <FilterModal
                :visible="filterVisible"
                title="Filter Credentials"
                match-label="credentials"
                :match-count="filtered.length"
                :sections="filterSections"
                :initial-state="currentFilterState"
                @close="filterVisible = false"
                @apply-generic="applyFilters"
            />

            <SetPasswordModal :visible="setPwOpen" @close="setPwOpen = false" />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    CREDENTIAL_ROTATION_STATUS_LABELS,
    type CredentialRotationStatus,
    type DeviceCredentialResponse
} from '@api/credential';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import SecretReveal from '@/components/core/SecretReveal.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import DeviceAuthSubTabs from '@/components/pages/device-auth/DeviceAuthSubTabs.vue';
import PasswordResultList from '@/components/pages/device-auth/PasswordResultList.vue';
import SetPasswordModal from '@/components/pages/device-auth/SetPasswordModal.vue';
import {copyText} from '@/helpers/clipboard';
import {formatTime} from '@/helpers/format';
import {useCredentialsStore} from '@/stores/credentials';
import {useToastStore} from '@/stores/toast';
import type {RouteTab} from '@/types/page-template';

type Status = '' | CredentialRotationStatus;

const STATUS_OPTIONS: Array<{key: Status; label: string}> = [
    {key: '', label: 'All statuses'},
    ...Object.entries(CREDENTIAL_ROTATION_STATUS_LABELS).map(
        ([key, label]) => ({key: key as Status, label})
    )
];

const tabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'settingsTabs',
    [] as RouteTab[]
);
const store = useCredentialsStore();
const toast = useToastStore();

const setPwOpen = ref(false);
const search = ref('');
const statusFilter = ref<Status>('');
const selected = reactive(new Set<string>());
const filterVisible = ref(false);

const filterSections = computed<FilterSection[]>(() => [
    {
        key: 'status',
        label: 'Rotation Status',
        icon: 'fa-rotate',
        singleSelect: true,
        options: STATUS_OPTIONS.map((s) => ({key: s.key, label: s.label}))
    }
]);

const currentFilterState = computed<FilterState>(() => ({
    status: [statusFilter.value]
}));

function applyFilters(state: FilterState): void {
    statusFilter.value = (state.status?.[0] as Status) ?? '';
    filterVisible.value = false;
}

const credentials = computed(() => Object.values(store.credentials));
const credentialsCountLabel = computed(() => {
    const total = credentials.value.length;
    if (total === 0) return undefined;
    const word = total === 1 ? 'device' : 'devices';
    return `${total} ${word}`;
});
const filtered = computed(() => {
    let rows = credentials.value;
    if (statusFilter.value) {
        rows = rows.filter((r) => r.last_rotation_status === statusFilter.value);
    }
    if (search.value) {
        const q = search.value.toLowerCase();
        rows = rows.filter((r) => r.device_id.toLowerCase().includes(q));
    }
    return rows;
});

const columns: DataColumn[] = [
    {key: 'device_id', label: 'Device', role: 'primary'},
    {key: 'rotated_at', label: 'Last rotated'},
    {key: 'status', label: 'Status'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

function toggleSelect(id: string): void {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
}


const rotateOpen = ref(false);
const rotating = ref(false);
const includeFlagged = ref(false);
const rotateResult = ref<{
    jobId: string;
    results: Array<{deviceId: string; pushId: number; password: string}>;
} | null>(null);

function openRotate(): void {
    rotateResult.value = null;
    includeFlagged.value = false;
    rotateOpen.value = true;
}

// Plaintext leaves state with the modal.
function closeRotate(): void {
    rotateOpen.value = false;
    rotateResult.value = null;
}

async function submitRotate(): Promise<void> {
    if (selected.size === 0) return;
    rotating.value = true;
    const r = await store.rotate({
        target: {deviceIds: Array.from(selected)},
        includeFlagged: includeFlagged.value
    });
    rotating.value = false;
    if (r) rotateResult.value = r;
}

const revealOpen = ref(false);
const revealing = ref(false);
const revealJust = ref('');
const revealResult = ref<string | null>(null);
const revealDeviceId = ref('');
const revealError = ref('');

function doReveal(row: DeviceCredentialResponse): void {
    revealOpen.value = true;
    revealJust.value = '';
    revealResult.value = null;
    revealDeviceId.value = row.device_id;
    revealError.value = '';
}

// Plaintext leaves state with the modal.
function closeReveal(): void {
    revealOpen.value = false;
    revealResult.value = null;
    revealJust.value = '';
}

async function copyRevealed(): Promise<void> {
    if (!revealResult.value) return;
    const ok = await copyText(revealResult.value);
    if (ok) toast.info('Password copied.');
    else toast.error('Could not copy — select and copy it manually.');
}

async function submitReveal(): Promise<void> {
    revealError.value = '';
    if (!revealDeviceId.value) return;
    if (!revealJust.value.trim()) {
        revealError.value = 'Justification is required for the audit log.';
        return;
    }
    revealing.value = true;
    const r = await store.reveal(revealDeviceId.value, revealJust.value.trim());
    revealing.value = false;
    if (r) revealResult.value = r.password;
}

const confirmModal = ref<InstanceType<typeof ConfirmationModal> | null>(null);

function doClear(row: DeviceCredentialResponse): void {
    confirmModal.value?.storeAction(
        async () => {
            await store.clearAuth({target: {deviceIds: [row.device_id]}});
        },
        {
            title: 'Disable Web UI auth',
            message: `Disable Web UI auth on ${row.device_id}? The device will accept unauthenticated requests until you re-enable it.`,
            confirmLabel: 'Disable auth'
        }
    );
}

onMounted(() => {
    void store.fetchAll();
});
</script>

<style scoped>
.cred-layout {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.cred-device {
    margin-left: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.cred-status {
    text-transform: capitalize;
    font-size: var(--type-caption);
}
.cred-status--ok {
    color: var(--color-success-text);
}
.cred-status--failed {
    color: var(--color-danger-text);
}
.cred-status--unknown {
    color: var(--color-text-tertiary);
}
.cred-action-btn {
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-2);
    transition: color var(--motion-hover);
}
.cred-action-btn--reveal:hover:not(:disabled) {
    color: var(--color-primary-text);
}
.cred-action-btn--clear:hover:not(:disabled) {
    color: var(--color-danger-text);
}
.cred-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: var(--floating-w-xs);
}
.cred-form-hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.cred-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
</style>
