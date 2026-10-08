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

                <FormSection v-if="configFamily" title="Configuration">
                    <VirtualConfigFields
                        v-model="draft"
                        :family="configFamily ?? 'boolean'"
                    />
                </FormSection>

                <FormSection v-if="isGroup" title="Members">
                    <ul v-if="members.length" class="vem__members">
                        <li v-for="key in members" :key="key">
                            <span class="vem__member-label">
                                {{ memberLabel(key) }}
                            </span>
                            <span class="vem__member-key">{{ key }}</span>
                            <button
                                type="button"
                                class="vem__member-remove"
                                :aria-label="`Remove ${key}`"
                                @click="removeMember(key)"
                            >
                                <i class="fas fa-xmark" />
                            </button>
                        </li>
                    </ul>
                    <p v-else class="vem__members-empty">No members yet.</p>
                    <Dropdown
                        v-if="memberAddGroups[0].items.length"
                        :groups="memberAddGroups"
                        placeholder="Add component"
                        aria-label="Add member"
                        @selected="addMember"
                    />
                </FormSection>

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
                :loading="meta.saving.value || savingConfig"
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
import Dropdown from '@/components/core/Dropdown.vue';
import FormSection from '@/components/core/FormSection.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import MeasurementMetaEdit from '@/components/modals/MeasurementMetaEdit.vue';
import VirtualConfigFields, {
    draftFromVirtualConfig,
    emptyVirtualConfigDraft,
    type VirtualConfigDraft,
    type VirtualConfigFamily,
    virtualConfigDelta
} from '@/components/modals/VirtualConfigFields.vue';
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

const family = computed(() => props.componentKey.split(':')[0] ?? '');
const isGroup = computed(() => family.value === 'group');
const configFamily = computed<VirtualConfigFamily | null>(() =>
    family.value === 'boolean' ||
    family.value === 'number' ||
    family.value === 'text' ||
    family.value === 'enum'
        ? family.value
        : null
);

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
const savingConfig = ref(false);
const errorMsg = ref<string | null>(null);
const pickerVisible = ref(false);
const draft = ref<VirtualConfigDraft>(emptyVirtualConfigDraft());
const members = ref<string[]>([]);

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

// Keyed on the serialized config so store-reference churn without a real
// remote change never clobbers in-progress edits.
watch(
    () => JSON.stringify(componentConfig.value),
    () => {
        if (!configFamily.value) return;
        draft.value = draftFromVirtualConfig(
            configFamily.value,
            componentConfig.value
        );
    },
    {immediate: true}
);

const currentMembers = computed<string[]>(() => {
    if (!isGroup.value) return [];
    const raw = componentStatus.value.value;
    return Array.isArray(raw) ? raw.map(String) : [];
});

watch(
    () => currentMembers.value.join('\n'),
    () => {
        members.value = [...currentMembers.value];
    },
    {immediate: true}
);

const membersDirty = computed(
    () => members.value.join('\n') !== currentMembers.value.join('\n')
);

// Groups hold value components; nested groups are not supported on-device.
const memberCandidates = computed<string[]>(() => {
    const status = device.value?.status;
    if (!status) return [];
    return Object.keys(status)
        .filter((key) => /^(boolean|number|text|enum|button):\d+$/.test(key))
        .filter((key) => !members.value.includes(key))
        .sort((a, b) => a.localeCompare(b));
});

const memberAddGroups = computed(() => [
    {
        label: 'Virtual components',
        items: memberCandidates.value.map((key) => {
            const label = memberLabel(key);
            return {value: key, label: label === key ? key : `${label} (${key})`};
        })
    }
]);

function memberLabel(key: string): string {
    const config = device.value?.settings?.[key];
    if (config && typeof config === 'object') {
        const memberName = (config as {name?: unknown}).name;
        if (typeof memberName === 'string' && memberName.trim()) {
            return memberName.trim();
        }
    }
    return key;
}

function addMember(key: string): void {
    if (!members.value.includes(key)) members.value.push(key);
}

function removeMember(key: string): void {
    members.value = members.value.filter((member) => member !== key);
}

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

const configDelta = computed<Record<string, unknown>>(() => {
    const delta = configFamily.value
        ? virtualConfigDelta(
              configFamily.value,
              draft.value,
              componentConfig.value
          )
        : {};
    if (name.value !== (componentConfig.value.name ?? '')) {
        delta.name = name.value;
    }
    return delta;
});

const dirty = computed(() => {
    const row = meta.row.value;
    return (
        Object.keys(configDelta.value).length > 0 ||
        membersDirty.value ||
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

async function onSave(): Promise<void> {
    errorMsg.value = null;
    const delta = configDelta.value;
    savingConfig.value = true;
    try {
        if (Object.keys(delta).length > 0) {
            await sendRPC('FLEET_MANAGER', setConfigMethod(), {
                shellyID: props.shellyID,
                id: parseComponentId(props.componentKey),
                config: delta
            });
        }
        if (isGroup.value && membersDirty.value) {
            await sendRPC('FLEET_MANAGER', 'Virtual.Group.Set', {
                shellyID: props.shellyID,
                id: parseComponentId(props.componentKey),
                value: [...members.value]
            });
        }
    } catch (err) {
        // Keep the modal open so the failure and the edits stay visible.
        errorMsg.value = rpcErrorMessage(err, 'Save failed');
        return;
    } finally {
        savingConfig.value = false;
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

// Per-type namespaces live under the FM `virtual` component; a bare
// `<Type>.SetConfig` would route to unrelated fleet-level components.
// Button is the exception: FM registers a dedicated `button` proxy.
function setConfigMethod(): string {
    if (family.value === 'button') return 'Button.SetConfig';
    const capital =
        family.value.charAt(0).toUpperCase() + family.value.slice(1);
    return `Virtual.${capital}.SetConfig`;
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
.vem__members {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.vem__members li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    font-size: var(--type-caption);
}
.vem__member-label {
    color: var(--color-text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vem__member-key {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono, monospace);
}
.vem__member-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    background: transparent;
    cursor: pointer;
}
.vem__member-remove:hover {
    color: var(--color-danger-text);
    background: var(--color-surface-3);
}
.vem__members-empty {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
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
