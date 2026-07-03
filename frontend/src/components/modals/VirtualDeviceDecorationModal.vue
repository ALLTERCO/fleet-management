<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Customize appearance</template>
        <template #default>
            <div class="vdd">
                <div class="vdd__preview">
                    <i
                        v-if="previewLogo.kind === 'icon'"
                        :class="['vdd__preview-icon', previewLogo.faClass]"
                        :style="previewLogo.accent ? {color: `rgb(var(--accent-${previewLogo.accent}))`} : undefined"
                    />
                    <img
                        v-else
                        :src="previewLogo.src"
                        alt=""
                        class="vdd__preview-img"
                    />
                    <div class="vdd__preview-meta">
                        <div class="vdd__preview-name">{{ deviceName }}</div>
                        <div class="vdd__preview-kind">{{ kindLabel }}</div>
                    </div>
                </div>

                <section class="vdd__section">
                    <label class="vdd__label">Decoration</label>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        @click="pickerVisible = true"
                    >
                        {{
                            pickedIcon || pickedImageUrl
                                ? 'Change decoration'
                                : 'Pick icon or image'
                        }}
                    </Button>
                </section>

                <div v-if="errorMsg" class="vdd__error">
                    <i class="fas fa-triangle-exclamation" /> {{ errorMsg }}
                </div>
            </div>
            <AssetPickerModal
                v-if="pickerVisible"
                :visible="pickerVisible"
                :initial-selected-asset-id="pickedImageUrl"
                :initial-selected-image-model="pickedImageModel"
                :initial-selected-icon="pickedIcon"
                :initial-selected-accent="pickedAccent"
                default-context="device"
                :upload-ticket="createImageUploadTicket"
                @close="pickerVisible = false"
                @select-asset="onPickAsset"
                @select-device-picture="onPickDevicePicture"
                @select-icon="onPickIcon"
                @clear="onClearDecoration"
            />
        </template>
        <template #footer>
            <Button type="blue-hollow" @click="emit('close')">Cancel</Button>
            <Button
                type="blue"
                :loading="saving"
                :disabled="!dirty"
                @click="onSave"
            >
                Save
            </Button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {bluetoothDevices} from '@host/bluetoothDevices';
import {virtualDevices} from '@host/virtualDevices';
import {computed, ref, watch} from 'vue';
import type {AssetUploadTicket} from '@/api/assetRpc';
import Button from '@/components/core/Button.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import {useDecorationDraft} from '@/composables/useDecorationDraft';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';
import {rpcErrorMessage} from '@/helpers/rpcError';
import type {shelly_device_t} from '@/types';
import Modal from './Modal.vue';

const props = defineProps<{
    visible: boolean;
    device: shelly_device_t;
}>();

const emit = defineEmits<{close: []; saved: []}>();

// Initial values are pulled from the backend's authoritative shape on
// every open — local edits never overwrite a peer's concurrent change.
const {
    icon: pickedIcon,
    accent: pickedAccent,
    imageAssetId: pickedImageUrl,
    imageModel: pickedImageModel,
    onSelectAsset: onPickAsset,
    onSelectDevicePicture: onPickDevicePicture,
    onSelectIcon: onPickIcon,
    onClear: onClearDecoration
} = useDecorationDraft();
const saving = ref(false);
const errorMsg = ref<string | null>(null);
const pickerVisible = ref(false);

watch(
    () => [props.visible, props.device],
    () => {
        if (!props.visible) return;
        const visual = currentVisual();
        pickedIcon.value = visual.icon ?? null;
        pickedAccent.value = visual.accent ?? null;
        pickedImageModel.value = visual.imageModel ?? null;
        pickedImageUrl.value = props.device.info?.imageAssetId ?? null;
        errorMsg.value = null;
    },
    {immediate: true}
);

const deviceName = computed(
    () => props.device.info?.name || props.device.shellyID
);

const kindLabel = computed(() => {
    const kind = props.device.meta?.virtualDevice?.kind;
    if (kind === 'extracted') return 'Extracted device';
    if (kind === 'composed') return 'Composed device';
    if (kind === 'connector') return 'Connector device';
    return 'Virtual device';
});

function currentVisual(): {
    icon?: string;
    accent?: string;
    imageModel?: string;
} {
    return (
        props.device.meta?.virtualDevice?.visual ??
        props.device.meta?.bluetoothDevice?.visual ??
        {}
    );
}

// Live preview reuses the same resolver the card uses — no second
// rendering rule to drift out of sync.
const previewLogo = computed(() =>
    resolveDeviceLogo({
        ...props.device,
        info: {...props.device.info, imageAssetId: pickedImageUrl.value},
        meta: previewMeta()
    } as never)
);

function previewMeta(): shelly_device_t['meta'] {
    const visual = {
        icon: pickedIcon.value,
        accent: pickedAccent.value,
        imageModel: pickedImageModel.value
    };
    if (isBluetoothDevice()) {
        return {
            ...props.device.meta,
            bluetoothDevice: {
                ...props.device.meta?.bluetoothDevice,
                visual
            }
        };
    }
    return {
        ...props.device.meta,
        virtualDevice: {
            ...props.device.meta?.virtualDevice,
            visual
        }
    };
}

const dirty = computed(() => {
    const visual = currentVisual();
    return (
        pickedIcon.value !== (visual.icon ?? null) ||
        pickedAccent.value !== (visual.accent ?? null) ||
        pickedImageModel.value !== (visual.imageModel ?? null) ||
        pickedImageUrl.value !== (props.device.info?.imageAssetId ?? null)
    );
});

// Icon and image are mutually exclusive — picking one clears the other.
// BLU update RPC has no revision check.
function isBluetoothDevice(): boolean {
    return (props.device as {source?: string}).source === 'bluetooth';
}

async function createImageUploadTicket(): Promise<AssetUploadTicket> {
    const externalId = props.device.shellyID;
    if (isBluetoothDevice()) {
        const ticket = await bluetoothDevices.createImageUploadTicket({
            externalId
        });
        return {
            uploadTicket: ticket.uploadTicket,
            resourceKind: 'bluetooth-device',
            resourceId: externalId
        };
    }
    const ticket = await virtualDevices.createImageUploadTicket({externalId});
    return {
        uploadTicket: ticket.uploadTicket,
        resourceKind: 'virtual-device',
        resourceId: externalId
    };
}

async function onSave(): Promise<void> {
    errorMsg.value = null;
    saving.value = true;
    try {
        const visual = {
            icon: pickedIcon.value ?? undefined,
            accent: pickedAccent.value ?? undefined,
            imageModel: pickedImageModel.value ?? undefined
        };
        if (isBluetoothDevice()) {
            await bluetoothDevices.update({
                externalId: props.device.shellyID,
                visual,
                imageAssetId: pickedImageUrl.value ?? undefined
            });
        } else {
            await virtualDevices.update({
                externalId: props.device.shellyID,
                expectedRevision: virtualDeviceRevision(),
                visual,
                imageAssetId: pickedImageUrl.value ?? undefined
            });
        }
        emit('saved');
        emit('close');
    } catch (err) {
        errorMsg.value = rpcErrorMessage(err, 'Failed to save appearance');
    } finally {
        saving.value = false;
    }
}

function virtualDeviceRevision(): number {
    const revision = props.device.meta?.virtualDevice?.revision;
    if (typeof revision !== 'number') {
        throw new Error('Virtual device revision is missing.');
    }
    return revision;
}
</script>

<style scoped>
.vdd {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.vdd__preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-2);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-medium);
}

.vdd__preview-icon {
    font-size: var(--type-heading);
    color: var(--color-text-secondary);
    width: 64px;
    text-align: center;
}

.vdd__preview-img {
    width: 64px;
    height: 64px;
    object-fit: contain;
}

.vdd__preview-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.vdd__preview-name {
    font-weight: 600;
    color: var(--color-text-primary);
}

.vdd__preview-kind {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.vdd__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.vdd__label {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.vdd__error {
    color: rgba(var(--color-danger-rgb), 0.9);
    font-size: var(--type-body);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
</style>
