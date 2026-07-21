<template>
    <div class="cfg-panel lnm-panel">
        <div class="cfg-panel__row">
            <span class="cfg-panel__list-count">
                {{ groups.length }} multicast group{{ groups.length === 1 ? '' : 's' }}
            </span>
            <div class="cfg-panel__list-actions">
                <Button type="green" size="sm" @click="openCreate">
                    New group
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="loading"
                    @click="loadGroups"
                >
                    Refresh
                </Button>
            </div>
        </div>

        <div
            v-if="error"
            class="cfg-panel__notice cfg-panel__notice--error cfg-panel__notice--split"
            role="alert"
        >
            <span>
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                {{ error }}
            </span>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="loading"
                @click="loadGroups"
            >
                Retry
            </Button>
        </div>

        <section
            v-if="formOpen"
            class="cfg-panel__workspace-section lnm-panel__editor"
            :aria-label="formTitle"
        >
            <strong class="lnm-panel__editor-title">{{ formTitle }}</strong>

            <div class="cfg-panel__field-grid">
                <label class="cfg-panel__field" :for="`${uid}-addr`">
                    <strong>Multicast address</strong>
                    <input
                        :id="`${uid}-addr`"
                        v-model.trim="form.addr"
                        class="cfg-panel__workspace-input"
                        placeholder="239.1.1.1:3333"
                        @input="markFormDirty"
                    />
                    <span class="cfg-panel__field-help">
                        Group address and port. Changing it on an existing
                        group needs a device restart.
                    </span>
                </label>
                <label
                    class="cfg-panel__field cfg-panel__field--wide"
                    :for="`${uid}-tx-components`"
                >
                    <strong>Broadcast components (optional)</strong>
                    <input
                        :id="`${uid}-tx-components`"
                        v-model.trim="form.txComponents"
                        class="cfg-panel__workspace-input"
                        placeholder="switch:0, em1:0"
                        @input="markFormDirty"
                    />
                    <span class="cfg-panel__field-help">
                        Component keys to broadcast, separated by commas.
                    </span>
                </label>
            </div>

            <div class="cfg-panel__toggle-grid">
                <div class="cfg-panel__toggle">
                    <div class="cfg-panel__toggle-label">
                        <strong>Broadcast status</strong>
                    </div>
                    <CardToggle size="row"
                        v-model="form.txEnable"
                        aria-label="Broadcast status updates"
                        @update:model-value="markFormDirty"
                    />
                </div>
                <div class="cfg-panel__toggle">
                    <div class="cfg-panel__toggle-label">
                        <strong>Listen for messages</strong>
                    </div>
                    <CardToggle size="row"
                        v-model="form.rxEnable"
                        aria-label="Listen for messages"
                        @update:model-value="markFormDirty"
                    />
                </div>
                <div class="cfg-panel__toggle">
                    <div class="cfg-panel__toggle-label">
                        <strong>Accept commands</strong>
                    </div>
                    <CardToggle size="row"
                        v-model="form.rpcEnable"
                        aria-label="Accept commands from the group"
                        @update:model-value="markFormDirty"
                    />
                </div>
            </div>

            <div
                v-if="formError"
                class="cfg-panel__notice cfg-panel__notice--error"
            >
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                {{ formError }}
            </div>

            <div class="lnm-panel__editor-actions">
                <Button
                    type="blue"
                    size="sm"
                    :loading="saving"
                    @click="saveForm"
                >
                    Save
                </Button>
                <Button type="blue-hollow" size="sm" @click="closeForm">
                    Cancel
                </Button>
            </div>
        </section>

        <div
            v-if="!groups.length && !loading && !error && !formOpen"
            class="cfg-panel__empty"
        >
            <i class="fas fa-rss" aria-hidden="true" />
            <strong>No multicast groups yet</strong>
            <span>Devices on the same group exchange status and commands locally, without the cloud.</span>
            <Button type="green" size="sm" @click="openCreate">
                New group
            </Button>
        </div>

        <div v-if="groups.length" class="cfg-panel__section">
            <div
                v-for="group in groups"
                :key="group.id"
                class="cfg-panel__row cfg-panel__row--link"
                role="button"
                tabindex="0"
                :aria-label="`Edit multicast group ${group.addr}`"
                @click="openEdit(group)"
                @keydown.enter.prevent="openEdit(group)"
                @keydown.space.prevent="openEdit(group)"
            >
                <div class="cfg-panel__row-label">
                    <strong class="cfg-panel__list-mono">{{ group.addr }}</strong>
                    <span>{{ groupSummary(group) }}</span>
                </div>
                <div class="cfg-panel__list-actions" @click.stop>
                    <Button
                        type="red"
                        size="xs"
                        :loading="busy.has(group.id)"
                        @click="confirmDelete(group)"
                    >
                        Delete
                    </Button>
                </div>
                <i class="fas fa-chevron-right cfg-panel__row-chevron" aria-hidden="true" />
            </div>
        </div>

        <p class="cfg-panel__field-help lnm-panel__hint">
            Local Network Messaging works over UDP multicast on the local
            network only. It is a firmware preview feature.
        </p>

        <ConfirmationModal ref="deleteConfirm" />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, useId, watch} from 'vue';
import {useSettingsDirtySource} from '@/composables/useSettingsDirtyTracker';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import CardToggle from '../cards/CardToggle.vue';
import ConfirmationModal from '../modals/ConfirmationModal.vue';
import Button from './Button.vue';

interface LnmInstance {
    id: number;
    addr: string;
    rpc_enable?: boolean;
    tx?: {enable?: boolean; components?: string[]};
    rx?: {enable?: boolean};
}

interface DynamicComponentEntry {
    key: string;
    config?: LnmInstance;
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();
const uid = useId();

const groups = ref<LnmInstance[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = reactive(new Set<number>());
let requestGeneration = 0;

const formOpen = ref(false);
const formDirty = ref(false);
const formError = ref<string | null>(null);
const saving = ref(false);
const editingId = ref<number | null>(null);
const form = reactive({
    addr: '',
    txComponents: '',
    txEnable: false,
    rxEnable: false,
    rpcEnable: false
});
const deleteConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(null);

useSettingsDirtySource('config:lnm', 'device-config:lnm-editor', formDirty);

const formTitle = computed(() =>
    editingId.value === null ? 'New multicast group' : 'Edit multicast group'
);

async function loadGroups(): Promise<void> {
    const generation = ++requestGeneration;
    loading.value = true;
    error.value = null;
    try {
        const response = await sendRPC<{
            components?: DynamicComponentEntry[];
        }>('FLEET_MANAGER', 'Shelly.GetComponents', {
            shellyID: props.shellyID,
            dynamic_only: true,
            include: ['config']
        });
        if (generation !== requestGeneration) return;
        groups.value = (response?.components ?? [])
            .filter((entry) => entry.key.startsWith('lnm:'))
            .map((entry) => entry.config)
            .filter((config): config is LnmInstance => Boolean(config));
    } catch (err: unknown) {
        if (generation !== requestGeneration) return;
        error.value = rpcErrorMessage(err);
    } finally {
        if (generation === requestGeneration) loading.value = false;
    }
}

function groupSummary(group: LnmInstance): string {
    const parts: string[] = [];
    if (group.tx?.enable) {
        const count = group.tx.components?.length ?? 0;
        parts.push(count ? `broadcasts ${count} component${count === 1 ? '' : 's'}` : 'broadcasts');
    }
    if (group.rx?.enable) parts.push('listens');
    if (group.rpc_enable) parts.push('accepts commands');
    return parts.length ? parts.join(' · ') : 'Inactive';
}

function markFormDirty(): void {
    formDirty.value = true;
}

function openCreate(): void {
    editingId.value = null;
    form.addr = '';
    form.txComponents = '';
    form.txEnable = false;
    form.rxEnable = false;
    form.rpcEnable = false;
    formError.value = null;
    formDirty.value = false;
    formOpen.value = true;
}

function openEdit(group: LnmInstance): void {
    editingId.value = group.id;
    form.addr = group.addr ?? '';
    form.txComponents = (group.tx?.components ?? []).join(', ');
    form.txEnable = group.tx?.enable ?? false;
    form.rxEnable = group.rx?.enable ?? false;
    form.rpcEnable = group.rpc_enable ?? false;
    formError.value = null;
    formDirty.value = false;
    formOpen.value = true;
}

function closeForm(): void {
    formOpen.value = false;
    formDirty.value = false;
    formError.value = null;
}

function formConfig(): Record<string, unknown> {
    const components = form.txComponents
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    return {
        addr: form.addr,
        rpc_enable: form.rpcEnable,
        tx: {enable: form.txEnable, components},
        rx: {enable: form.rxEnable}
    };
}

async function saveForm(): Promise<void> {
    if (!form.addr) {
        formError.value = 'Multicast address is required';
        return;
    }
    saving.value = true;
    formError.value = null;
    try {
        if (editingId.value === null) {
            await sendRPC('FLEET_MANAGER', 'LNM.Create', {
                shellyID: props.shellyID,
                config: formConfig()
            });
            toast.success('Multicast group created');
        } else {
            const response = await sendRPC<{restart_required?: boolean}>(
                'FLEET_MANAGER',
                'LNM.SetConfig',
                {
                    shellyID: props.shellyID,
                    id: editingId.value,
                    config: formConfig()
                }
            );
            toast.success('Multicast group saved');
            if (response?.restart_required) {
                toast.info('Restart the device to apply the new address');
            }
        }
        closeForm();
        await loadGroups();
    } catch (err: unknown) {
        formError.value = rpcErrorMessage(err);
    } finally {
        saving.value = false;
    }
}

function confirmDelete(group: LnmInstance): void {
    deleteConfirm.value?.storeAction(() => performDelete(group.id), {
        title: 'Delete multicast group?',
        message: `The group "${group.addr}" is removed from the device.`,
        confirmLabel: 'Delete'
    });
}

async function performDelete(id: number): Promise<void> {
    busy.add(id);
    try {
        await sendRPC('FLEET_MANAGER', 'LNM.Delete', {
            shellyID: props.shellyID,
            id
        });
        groups.value = groups.value.filter((group) => group.id !== id);
        toast.success('Multicast group deleted');
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        busy.delete(id);
    }
}

onMounted(() => void loadGroups());
watch(
    () => props.shellyID,
    () => {
        requestGeneration++;
        groups.value = [];
        closeForm();
        void loadGroups();
    }
);
</script>

<style scoped>
.lnm-panel__editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.lnm-panel__editor-title {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.lnm-panel__editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}

.lnm-panel__hint {
    margin: 0;
}
</style>
