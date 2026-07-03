<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>
            <h3>Add device</h3>
        </template>

        <div class="adw">
            <div class="adw__modes">
                <button
                    type="button"
                    class="adw__mode"
                    :class="{'adw__mode--active': mode === 'real'}"
                    @click="mode = 'real'"
                >
                    <i class="fas fa-network-wired" aria-hidden="true" />
                    <span>Real</span>
                </button>
                <button
                    type="button"
                    class="adw__mode"
                    :class="{'adw__mode--active': mode === 'bluetooth'}"
                    @click="openBle"
                >
                    <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    <span>BLE</span>
                </button>
                <button
                    type="button"
                    class="adw__mode"
                    :class="{'adw__mode--active': mode === 'virtual'}"
                    @click="mode = 'virtual'"
                >
                    <i class="fas fa-layer-group" aria-hidden="true" />
                    <span>Virtual</span>
                </button>
            </div>

            <div v-if="mode === 'real'" class="adw__panel">
                <div class="adw__empty">Waiting-room and outbound websocket admission stay unchanged.</div>
            </div>

            <div v-else-if="mode === 'virtual'" class="adw__panel">
                <div class="adw__grid">
                    <label class="adw__field">
                        <span>Name</span>
                        <input v-model.trim="name" type="text" />
                    </label>
                    <label class="adw__field">
                        <span>Type</span>
                        <input v-model.trim="typeKey" type="text" />
                    </label>
                    <label class="adw__field">
                        <span>Role</span>
                        <input v-model="roleKeyInput" type="text" placeholder="lowercase letters, digits, underscore" />
                    </label>
                    <label class="adw__field">
                        <span>Source</span>
                        <select v-model="selectedSourceKey">
                            <option value="">Select source</option>
                            <option
                                v-for="source in sources"
                                :key="sourceKey(source)"
                                :value="sourceKey(source)"
                            >
                                {{ source.deviceName }} / {{ source.componentKey }}
                            </option>
                        </select>
                    </label>
                </div>

                <div class="adw__actions">
                    <Button
                        type="green"
                        size="sm"
                        :disabled="!canAddBinding"
                        @click="addBinding"
                    >
                        Add binding
                    </Button>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="loadingSources"
                        @click="loadSources"
                    >
                        Refresh
                    </Button>
                </div>

                <div v-if="bindings.length > 0" class="adw__bindings">
                    <div
                        v-for="binding in bindings"
                        :key="binding.roleKey"
                        class="adw__binding"
                    >
                        <span>{{ binding.roleKey }}</span>
                        <span>{{ binding.source.deviceExternalId }} / {{ binding.source.componentKey }}</span>
                        <button
                            type="button"
                            aria-label="Remove binding"
                            @click="removeBinding(binding.roleKey)"
                        >
                            <i class="fas fa-xmark" />
                        </button>
                    </div>
                </div>

                <div v-if="error" class="adw__error">{{ error }}</div>
            </div>
        </div>

        <template #footer>
            <div class="adw__footer">
                <Button type="blue-hollow" size="sm" @click="emit('close')">Close</Button>
                <Button
                    v-if="mode === 'virtual'"
                    type="green"
                    size="sm"
                    :disabled="!canCreateVirtual"
                    :loading="creating"
                    @click="createVirtualDevice"
                >
                    Create
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {
    type SourceComponentCandidate,
    type SourceComponentRef,
    virtualDevices
} from '@host/virtualDevices';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import {isValidRoleKey, normalizeRoleKey} from '@/helpers/roleKey';

interface BindingDraft {
    roleKey: string;
    source: SourceComponentRef;
}

const props = defineProps<{visible: boolean}>();
const emit = defineEmits<{
    close: [];
    created: [];
    'open-ble': [];
}>();

const mode = ref<'real' | 'bluetooth' | 'virtual'>('virtual');
const name = ref('');
const typeKey = ref('custom_device');
const roleKey = ref('');
// The bound input value is auto-normalised on every keystroke so the
// user can't enter anything the backend would reject. Single source of
// truth lives in @/helpers/roleKey.
const roleKeyInput = computed({
    get: () => roleKey.value,
    set: (raw: string) => {
        roleKey.value = normalizeRoleKey(raw);
    }
});
const selectedSourceKey = ref('');
const sources = ref<SourceComponentCandidate[]>([]);
const bindings = ref<BindingDraft[]>([]);
const loadingSources = ref(false);
const creating = ref(false);
const error = ref('');

const selectedSource = computed(() => {
    return sources.value.find(
        (source) => sourceKey(source) === selectedSourceKey.value
    );
});

const canAddBinding = computed(() => {
    return Boolean(
        roleKey.value && isValidRoleKey(roleKey.value) && selectedSource.value
    );
});

const canCreateVirtual = computed(() => {
    return Boolean(name.value && typeKey.value && bindings.value.length > 0);
});

function sourceKey(source: SourceComponentCandidate): string {
    return `${source.deviceExternalId}|${source.componentKey}`;
}

function resetForm() {
    mode.value = 'virtual';
    name.value = '';
    typeKey.value = 'custom_device';
    roleKey.value = '';
    selectedSourceKey.value = '';
    bindings.value = [];
    error.value = '';
}

function openBle() {
    mode.value = 'bluetooth';
    emit('open-ble');
}

async function loadSources() {
    loadingSources.value = true;
    error.value = '';
    try {
        const res = await virtualDevices.bindings.listSources({limit: 200});
        sources.value = res.items ?? [];
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        sources.value = [];
    } finally {
        loadingSources.value = false;
    }
}

function addBinding() {
    const source = selectedSource.value;
    if (!source || !roleKey.value) return;
    bindings.value = bindings.value.filter(
        (binding) => binding.roleKey !== roleKey.value
    );
    bindings.value.push({
        roleKey: roleKey.value,
        source: {
            deviceExternalId: source.deviceExternalId,
            componentKey: source.componentKey,
            ...(source.dynamicCategory
                ? {dynamicCategory: source.dynamicCategory}
                : {})
        }
    });
    roleKey.value = '';
    selectedSourceKey.value = '';
}

function removeBinding(key: string) {
    bindings.value = bindings.value.filter(
        (binding) => binding.roleKey !== key
    );
}

async function createVirtualDevice() {
    creating.value = true;
    error.value = '';
    try {
        await virtualDevices.draft.preview({
            device: {
                kind: 'composed',
                name: name.value,
                typeKey: typeKey.value,
                categoryKey: 'custom'
            },
            bindings: bindings.value
        });
        const created = await virtualDevices.create({
            kind: 'composed',
            name: name.value,
            typeKey: typeKey.value,
            categoryKey: 'custom'
        });
        let revision = created.revision;
        for (const binding of bindings.value) {
            await virtualDevices.bindings.create({
                externalId: created.externalId,
                expectedRevision: revision,
                roleKey: binding.roleKey,
                source: binding.source
            });
            revision += 1;
        }
        emit('created');
        emit('close');
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        creating.value = false;
    }
}

watch(
    () => props.visible,
    (open) => {
        if (!open) return;
        resetForm();
        loadSources();
    }
);
</script>

<style scoped>
.adw {
    display: grid;
    gap: var(--gap-lg);
}
.adw__modes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--gap-sm);
}
.adw__mode {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-xs);
    min-height: var(--touch-target-min);
    border: 1px solid var(--color-border-default);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.adw__mode--active {
    border-color: var(--color-border-focus);
    background: var(--color-surface-2);
}
.adw__panel {
    display: grid;
    gap: var(--gap-md);
}
.adw__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-md);
}
.adw__field {
    display: grid;
    gap: var(--gap-xs);
    font-size: var(--type-body);
}
.adw__field input,
.adw__field select {
    min-height: var(--touch-target-min);
    border: 1px solid var(--color-border-default);
    border-radius: var(--btn-radius);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--gap-sm);
}
.adw__actions,
.adw__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-sm);
}
.adw__bindings {
    display: grid;
    gap: var(--gap-xs);
}
.adw__binding {
    display: grid;
    grid-template-columns: minmax(80px, 0.6fr) minmax(0, 1.4fr) var(--touch-target-min);
    align-items: center;
    gap: var(--gap-sm);
    min-height: var(--touch-target-min);
    padding: 0 var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--btn-radius);
    background: var(--color-surface-3);
    font-size: var(--type-body);
}
.adw__binding button {
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
}
.adw__empty {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.adw__error {
    color: var(--color-danger-text);
    font-size: var(--type-body);
}
@media (max-width: 640px) {
    .adw__grid,
    .adw__modes {
        grid-template-columns: 1fr;
    }
}
</style>
