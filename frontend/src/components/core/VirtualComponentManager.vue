<template>
    <div class="vcm">
        <div class="vcm__row">
            <span class="vcm__count">
                {{ count }} virtual
                {{ count === 1 ? 'component' : 'components' }}
            </span>
            <div class="vcm__add">
                <select v-model="newType" class="vcm__select">
                    <option v-for="t in TYPES" :key="t.value" :value="t.value">
                        {{ t.label }}
                    </option>
                </select>
                <input
                    v-model="newName"
                    class="vcm__input"
                    placeholder="Name (optional)"
                />
                <button
                    class="vcm__add-btn"
                    :disabled="busy"
                    @click="addComponent"
                >
                    <i
                        :class="busy ? 'fas fa-spinner fa-spin' : 'fas fa-plus'"
                    />
                    Add
                </button>
            </div>
        </div>

        <div v-if="error" class="vcm__error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>
        <div v-if="componentKeys.length" class="vcm__list">
            <button
                v-for="key in componentKeys"
                :key="key"
                type="button"
                class="vcm__item"
                @click="editingKey = key"
            >
                <span>
                    <strong>{{ componentName(key) }}</strong>
                    <small>{{ key }}</small>
                </span>
                <i class="fas fa-pen" />
            </button>
        </div>
        <VirtualEditModal
            v-if="editingKey"
            :visible="true"
            :shelly-i-d="props.shellyID"
            :component-key="editingKey"
            @close="editingKey = null"
            @deleted="editingKey = null"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import VirtualEditModal from '@/components/modals/VirtualEditModal.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{shellyID: string}>();

const deviceStore = useDevicesStore();
const device = computed(() => deviceStore.devices[props.shellyID]);
const busy = ref(false);
const error = ref<string | null>(null);
const newType = ref('boolean');
const newName = ref('');
const editingKey = ref<string | null>(null);

interface TypeOption {
    value: string;
    label: string;
}

// User-facing labels for the virtual types. The device adjudicates which
// types it actually supports — Virtual.Add will reject unknown types.
const TYPES: TypeOption[] = [
    {value: 'boolean', label: 'Toggle'},
    {value: 'number', label: 'Number'},
    {value: 'text', label: 'Text'},
    {value: 'enum', label: 'Dropdown'},
    {value: 'button', label: 'Button'},
    {value: 'group', label: 'Group'}
];

const componentKeys = computed(() => {
    const status = device.value?.status;
    if (!status) return [];
    return Object.keys(status)
        .filter(isVirtualComponentKey)
        .sort((a, b) => a.localeCompare(b));
});
const count = computed(() => componentKeys.value.length);

function isVirtualComponentKey(key: string): boolean {
    return /^(boolean|number|text|enum|button|group):\d+$/.test(key);
}

function componentName(key: string): string {
    const config = device.value?.settings?.[key];
    if (config && typeof config === 'object') {
        const name = (config as {name?: unknown}).name;
        if (typeof name === 'string' && name.trim()) return name.trim();
    }
    return key;
}

async function addComponent(): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
        const config: Record<string, unknown> = {};
        if (newName.value) config.name = newName.value;
        await sendRPC('FLEET_MANAGER', 'Virtual.Add', {
            shellyID: props.shellyID,
            type: newType.value,
            config: Object.keys(config).length ? config : undefined
        });
        newName.value = '';
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Virtual.Add failed');
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.vcm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.vcm__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.vcm__count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.vcm__add {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.vcm__select,
.vcm__input {
    padding: 0.3rem var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.vcm__add-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.3rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-primary);
    background: var(--color-primary-subtle);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
}

.vcm__add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.vcm__error {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-danger-text);
}

.vcm__list {
    display: grid;
    gap: var(--space-1);
}

.vcm__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    text-align: left;
    cursor: pointer;
}

.vcm__item strong,
.vcm__item small {
    display: block;
}

.vcm__item strong {
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.vcm__item small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.vcm__item:hover {
    border-color: var(--color-border-medium);
}
</style>
