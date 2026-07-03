<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>{{ titleText }}</template>
        <template #default>
            <div v-if="!device" class="vem__empty">Device not available.</div>

            <div v-else class="vem">
                <div class="vem__preview" :style="previewStyle">
                    <i v-if="previewGlyph" :class="previewGlyph" />
                    <img v-else-if="previewUrl" :src="previewUrl" alt="" />
                    <i v-else class="fas fa-cube vem__preview-fallback" />
                </div>

                <div class="vem__row">
                    <label class="vem__label">Name</label>
                    <input
                        v-model="name"
                        type="text"
                        class="vem__input"
                        :placeholder="componentKey"
                    />
                </div>

                <div class="vem__row">
                    <label class="vem__label">Decoration</label>
                    <Button
                        type="white"
                        size="sm"
                        @click="pickerVisible = true"
                    >
                        <i class="fas fa-palette" />
                        {{
                            pickedGlyph || pickedAssetId
                                ? 'Change decoration'
                                : 'Pick icon or image'
                        }}
                    </Button>
                </div>

                <div v-if="isGroup" class="vem__row vem__row--inline">
                    <label class="vem__label">Show as device</label>
                    <Checkbox v-model="promoted" />
                </div>

                <Collapse title="Measurement metadata (IEC 61850)">
                    <MeasurementMetaEdit v-model="measurement" />
                </Collapse>

                <Collapse title="Device-reported data">
                    <section class="vem__section">
                        <h3 class="vem__heading">Config</h3>
                        <pre class="vem__json">{{ configJson }}</pre>
                    </section>
                    <section class="vem__section">
                        <h3 class="vem__heading">Status</h3>
                        <pre class="vem__json">{{ statusJson }}</pre>
                    </section>
                    <section
                        v-if="resolvedChildren.length"
                        class="vem__section"
                    >
                        <h3 class="vem__heading">Group children</h3>
                        <ul class="vem__children">
                            <li
                                v-for="child in resolvedChildren"
                                :key="child.key"
                            >
                                <span class="vem__child-key">{{
                                    child.key
                                }}</span>
                                <span>{{ formatValue(child.value) }}</span>
                            </li>
                        </ul>
                    </section>
                </Collapse>

                <div v-if="errorMsg" class="vem__error">
                    <i class="fas fa-triangle-exclamation" /> {{ errorMsg }}
                </div>
            </div>
            <AssetPickerModal
                v-if="pickerVisible"
                :visible="pickerVisible"
                :initial-selected-asset-id="pickedAssetId"
                :initial-selected-icon="pickedGlyph"
                :initial-selected-accent="color"
                default-context="component"
                @close="pickerVisible = false"
                @select-asset="onPickAsset"
                @select-icon="onPickGlyph"
                @clear="onClearDecoration"
            />
        </template>
        <template #footer>
            <Button type="red" @click="onDelete">
                Delete
            </Button>
            <Button type="blue-hollow" @click="emit('close')">Close</Button>
            <Button
                type="blue"
                :loading="meta.saving.value || savingName"
                :disabled="!dirty"
                @click="onSave"
            >
                Save
            </Button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Collapse from '@/components/core/Collapse.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import MeasurementMetaEdit from '@/components/modals/MeasurementMetaEdit.vue';
import {useDecorationDraft} from '@/composables/useDecorationDraft';
import {
    type MeasurementMeta,
    useVirtualMeta
} from '@/composables/useVirtualMeta';
import {accentToCss} from '@/config/accentTokens';
import {resolveAssetSrc} from '@/helpers/deviceLogo';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';
import Button from '../core/Button.vue';
import Modal from './Modal.vue';

const props = defineProps<{
    visible: boolean;
    shellyID: string;
    componentKey: string;
}>();

const emit = defineEmits<{close: []; deleted: []}>();

const deviceStore = useDevicesStore();
const device = computed(() => deviceStore.devices[props.shellyID]);

const componentConfig = computed<Record<string, unknown>>(
    () => device.value?.settings?.[props.componentKey] ?? {}
);
const componentStatus = computed<Record<string, unknown>>(
    () => device.value?.status?.[props.componentKey] ?? {}
);

const isGroup = computed(() => props.componentKey.startsWith('group:'));

const meta = useVirtualMeta(
    () => props.shellyID,
    () => props.componentKey
);

const name = ref('');
const {
    icon: pickedGlyph,
    accent: color,
    imageAssetId: pickedAssetId,
    onSelectAsset: onPickAsset,
    onSelectIcon: onPickGlyph,
    onClear: onClearDecoration
} = useDecorationDraft();
const promoted = ref(false);
const measurement = ref<MeasurementMeta | null>(null);
const savingName = ref(false);
const errorMsg = ref<string | null>(null);
const pickerVisible = ref(false);

watch(
    () => meta.row.value,
    (row) => {
        pickedGlyph.value = row?.glyph ?? null;
        color.value = row?.color ?? null;
        promoted.value = !!row?.promoted_at;
        // image_path column holds the asset UUID; resolver builds the URL.
        pickedAssetId.value = row?.image_path ?? null;
        measurement.value = row?.measurement ?? null;
    },
    {immediate: true}
);

watch(
    () => componentConfig.value.name,
    (n) => {
        name.value = typeof n === 'string' ? n : '';
    },
    {immediate: true}
);

const titleText = computed(() => {
    const display = name.value || props.componentKey;
    return `Edit · ${display}`;
});

const previewGlyph = computed(() =>
    pickedGlyph.value && !pickedAssetId.value ? pickedGlyph.value : ''
);
const previewUrl = computed(() =>
    pickedAssetId.value ? resolveAssetSrc(pickedAssetId.value) : null
);

const previewStyle = computed(() => {
    const c = accentToCss(color.value);
    return c ? {borderColor: c, color: c} : {};
});

const dirty = computed(() => {
    const row = meta.row.value;
    const nameChanged = name.value !== (componentConfig.value.name ?? '');
    return (
        nameChanged ||
        pickedGlyph.value !== (row?.glyph ?? null) ||
        color.value !== (row?.color ?? null) ||
        promoted.value !== !!row?.promoted_at ||
        pickedAssetId.value !== (row?.image_path ?? null) ||
        !measurementsEqual(measurement.value, row?.measurement ?? null)
    );
});

function measurementsEqual(
    a: MeasurementMeta | null,
    b: MeasurementMeta | null
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

const configJson = computed(() =>
    JSON.stringify(componentConfig.value, null, 2)
);
const statusJson = computed(() =>
    JSON.stringify(componentStatus.value, null, 2)
);

interface ResolvedChild {
    key: string;
    value: unknown;
}

const resolvedChildren = computed<ResolvedChild[]>(() => {
    if (!isGroup.value) return [];
    const raw = componentStatus.value.value;
    if (!Array.isArray(raw)) return [];
    return raw.map((childKey) => {
        const k = String(childKey);
        const child = device.value?.status?.[k];
        const value =
            child && typeof child === 'object'
                ? (child as {value?: unknown}).value
                : undefined;
        return {key: k, value};
    });
});

function formatValue(v: unknown): string {
    if (v === undefined) return '—';
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
}


async function onSave(): Promise<void> {
    errorMsg.value = null;
    if (name.value !== (componentConfig.value.name ?? '')) {
        savingName.value = true;
        try {
            await sendRPC('FLEET_MANAGER', renameMethod(), {
                shellyID: props.shellyID,
                id: parseComponentId(props.componentKey),
                config: {name: name.value}
            });
        } catch (err) {
            errorMsg.value = rpcErrorMessage(err, 'Rename failed');
        } finally {
            savingName.value = false;
        }
    }
    await meta.save({
        glyph: pickedGlyph.value,
        color: color.value,
        promoted: promoted.value,
        imagePath: pickedAssetId.value,
        measurement: measurement.value
    });
    emit('close');
}

async function onDelete(): Promise<void> {
    if (!window.confirm(`Delete ${props.componentKey}?`)) return;
    try {
        await sendRPC('FLEET_MANAGER', 'Virtual.Delete', {
            shellyID: props.shellyID,
            key: props.componentKey
        });
        await sendRPC('FLEET_MANAGER', 'virtual_meta.Delete', {
            shellyID: props.shellyID,
            componentKey: props.componentKey
        });
        emit('deleted');
        emit('close');
    } catch (err) {
        errorMsg.value = rpcErrorMessage(err, 'Delete failed');
    }
}

function renameMethod(): string {
    const type = props.componentKey.split(':')[0];
    const capital = type.charAt(0).toUpperCase() + type.slice(1);
    return `${capital}.SetConfig`;
}

function parseComponentId(key: string): number {
    return Number.parseInt(key.split(':')[1] ?? '0', 10);
}
</script>

<style scoped>
.vem {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.vem__empty {
    padding: var(--space-3);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.vem__preview {
    align-self: center;
    width: 96px;
    height: 96px;
    border: 2px solid var(--color-border-default);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 3rem;
    background: var(--color-surface-2);
    color: var(--color-text-primary);
}
.vem__preview img {
    width: 80%;
    height: 80%;
    object-fit: contain;
}
.vem__preview-fallback {
    color: var(--color-text-disabled);
}
.vem__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.vem__row--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
}
.vem__label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-weight: var(--font-bold);
}
.vem__input {
    padding: var(--space-2) var(--space-3);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    color: var(--color-text-primary);
    font-size: var(--input-font-size);
}
.vem__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
}
.vem__heading {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-tertiary);
    margin: 0;
}
.vem__json {
    margin: 0;
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    white-space: pre-wrap;
    max-height: 12rem;
    overflow-y: auto;
}
.vem__children {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
}
.vem__children li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
}
.vem__child-key {
    color: var(--color-text-tertiary);
}
.vem__error {
    padding: var(--space-2) var(--space-3);
    background: rgba(var(--color-danger-rgb), 0.1);
    border: 1px solid rgba(var(--color-danger-rgb), 0.25);
    border-radius: var(--radius-md);
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}
</style>
