<template>
    <Modal :visible="visible" compact @close="emit('close')">
        <template #title>Edit device</template>
        <template #default>
            <div class="dem">
                <button
                    type="button"
                    class="dem__art"
                    title="Change picture or icon"
                    @click="pickerVisible = true"
                >
                    <i
                        v-if="previewLogo.kind === 'icon'"
                        :class="['dem__art-icon', previewLogo.faClass]"
                        :style="previewLogo.accent ? {color: `rgb(var(--accent-${previewLogo.accent}))`} : undefined"
                    />
                    <img
                        v-else
                        :src="previewLogo.src"
                        alt=""
                        class="dem__art-img"
                    />
                    <span class="dem__art-overlay">
                        <i class="fas fa-pen" aria-hidden="true" />
                    </span>
                </button>

                <Button
                    type="blue-hollow"
                    size="sm"
                    class="dem__change"
                    @click="pickerVisible = true"
                >
                    Change picture
                </Button>

                <Input
                    v-if="canRename"
                    v-model="nameDraft"
                    label="Device name"
                    :disabled="saving"
                    :error="nameError || undefined"
                    :maxlength="NAME_MAX_LENGTH"
                />
                <div v-else class="dem__readonly-name">{{ nameDraft || shellyID }}</div>

                <div v-if="errorMsg" class="dem__error">
                    <i class="fas fa-triangle-exclamation" /> {{ errorMsg }}
                </div>
            </div>
            <AssetPickerModal
                v-if="pickerVisible"
                :visible="pickerVisible"
                :initial-selected-asset-id="draft.imageAssetId.value"
                :initial-selected-image-model="draft.imageModel.value"
                :initial-selected-icon="draft.icon.value"
                :initial-selected-accent="draft.accent.value"
                :show-accent="supportsAppearance"
                default-context="device"
                :upload-ticket="supportsAppearance ? createImageUploadTicket : undefined"
                @close="pickerVisible = false"
                @select-asset="draft.onSelectAsset"
                @select-device-picture="draft.onSelectDevicePicture"
                @select-icon="draft.onSelectIcon"
                @clear="draft.onClear"
            />
        </template>
        <template #footer>
            <Button type="blue-hollow" :disabled="saving" @click="emit('close')">
                Cancel
            </Button>
            <Button
                type="blue"
                :loading="saving"
                :disabled="!canSave"
                @click="onSave"
            >
                Save
            </Button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {bluetoothDevices} from '@host/bluetoothDevices';
import {devices as hostDevices} from '@host/devices';
import {virtualDevices} from '@host/virtualDevices';
import {computed, ref, watch} from 'vue';
import type {AssetUploadTicket} from '@/api/assetRpc';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import {useDecorationDraft} from '@/composables/useDecorationDraft';
import {resolveAssetSrc, resolveDeviceLogo} from '@/helpers/deviceLogo';
import {rpcErrorMessage} from '@/helpers/rpcError';
import * as ws from '@/tools/websocket';
import type {shelly_device_t} from '@/types';
import Modal from './Modal.vue';

const NAME_MAX_LENGTH = 128;

const props = defineProps<{
    visible: boolean;
    device: shelly_device_t;
}>();

const emit = defineEmits<{close: []; saved: []}>();

const draft = useDecorationDraft();
const nameDraft = ref('');
const savedName = ref('');
const saving = ref(false);
const errorMsg = ref<string | null>(null);
const pickerVisible = ref(false);

// Appearance captured on open — the draft is compared against it so a no-op
// reopen never reports dirty. Virtual/BLU seed from meta, physical from getImage.
const seededIcon = ref<string | null>(null);
const seededAccent = ref<string | null>(null);
const seededImageModel = ref<string | null>(null);
const seededImageAssetId = ref<string | null>(null);

const source = computed(() => (props.device as {source?: string}).source);
const isBluetooth = computed(() => source.value === 'bluetooth');
const isVirtual = computed(() => source.value === 'virtual');
// Virtual + BLU carry an icon/accent decoration; physical devices override
// the CDN logo with a picture or plain icon only.
const supportsAppearance = computed(
    () => isVirtual.value || isBluetooth.value
);
const canRename = computed(() => !isBluetooth.value);

const shellyID = computed(() => props.device.shellyID);

// Reseed on every open from the backend's authoritative shape so a peer's
// concurrent change is never overwritten by stale local edits.
watch(
    () => [props.visible, props.device] as const,
    async () => {
        if (!props.visible) return;
        errorMsg.value = null;
        pickerVisible.value = false;
        nameDraft.value = props.device.info?.name ?? props.device.shellyID;
        savedName.value = nameDraft.value;
        if (supportsAppearance.value) {
            const visual = currentVisual();
            seed({
                icon: visual.icon ?? null,
                accent: visual.accent ?? null,
                imageModel: visual.imageModel ?? null,
                imageAssetId: props.device.info?.imageAssetId ?? null
            });
            return;
        }
        seed({icon: null, accent: null, imageModel: null, imageAssetId: null});
        try {
            const image = await hostDevices.getImage({
                shellyID: props.device.shellyID
            });
            seed({icon: image.icon, imageAssetId: image.imageAssetId});
        } catch (err) {
            errorMsg.value = rpcErrorMessage(err, 'Failed to load appearance');
        }
    },
    {immediate: true}
);

function seed(value: {
    icon?: string | null;
    accent?: string | null;
    imageModel?: string | null;
    imageAssetId?: string | null;
}): void {
    draft.reset(value);
    seededIcon.value = value.icon ?? null;
    seededAccent.value = value.accent ?? null;
    seededImageModel.value = value.imageModel ?? null;
    seededImageAssetId.value = value.imageAssetId ?? null;
}

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

const previewLogo = computed(() => {
    if (draft.imageAssetId.value) {
        return {kind: 'image' as const, src: resolveAssetSrc(draft.imageAssetId.value)};
    }
    if (draft.icon.value) {
        return {
            kind: 'icon' as const,
            faClass: draft.icon.value,
            accent: draft.accent.value
        };
    }
    if (draft.imageModel.value) {
        return resolveDeviceLogo({
            ...props.device,
            meta: previewMeta()
        } as never);
    }
    return resolveDeviceLogo(props.device as never);
});

function previewMeta(): shelly_device_t['meta'] {
    const visual = {imageModel: draft.imageModel.value};
    if (isBluetooth.value) {
        return {
            ...props.device.meta,
            bluetoothDevice: {...props.device.meta?.bluetoothDevice, visual}
        };
    }
    return {
        ...props.device.meta,
        virtualDevice: {...props.device.meta?.virtualDevice, visual}
    };
}

const trimmedName = computed(() => nameDraft.value.trim());
const nameError = computed(() => {
    if (!canRename.value) return null;
    if (!trimmedName.value) return 'Device name is required';
    if (trimmedName.value.length > NAME_MAX_LENGTH) {
        return `Name must be ${NAME_MAX_LENGTH} characters or fewer`;
    }
    return null;
});

const nameDirty = computed(
    () => canRename.value && trimmedName.value !== savedName.value.trim()
);
const appearanceDirty = computed(
    () =>
        draft.icon.value !== seededIcon.value ||
        draft.imageAssetId.value !== seededImageAssetId.value ||
        draft.imageModel.value !== seededImageModel.value ||
        draft.accent.value !== seededAccent.value
);

const canSave = computed(
    () =>
        !saving.value &&
        !nameError.value &&
        (nameDirty.value || appearanceDirty.value)
);

async function createImageUploadTicket(): Promise<AssetUploadTicket> {
    const externalId = props.device.shellyID;
    if (isBluetooth.value) {
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
    if (!canSave.value) return;
    errorMsg.value = null;
    saving.value = true;
    try {
        if (isVirtual.value) await saveVirtual();
        else if (isBluetooth.value) await saveBluetooth();
        else await savePhysical();
        emit('saved');
        emit('close');
    } catch (err) {
        errorMsg.value = rpcErrorMessage(err, 'Failed to save changes');
    } finally {
        saving.value = false;
    }
}

async function saveVirtual(): Promise<void> {
    const revision = props.device.meta?.virtualDevice?.revision;
    if (typeof revision !== 'number') {
        throw new Error('Virtual device revision is missing.');
    }
    await virtualDevices.update({
        externalId: props.device.shellyID,
        expectedRevision: revision,
        name: nameDirty.value ? trimmedName.value : undefined,
        visual: visualPayload(),
        imageAssetId: draft.imageAssetId.value ?? undefined
    });
}

async function saveBluetooth(): Promise<void> {
    await bluetoothDevices.update({
        externalId: props.device.shellyID,
        visual: visualPayload(),
        imageAssetId: draft.imageAssetId.value ?? undefined
    });
}

async function savePhysical(): Promise<void> {
    if (nameDirty.value) {
        await ws.sendRPC('FLEET_MANAGER', 'Sys.SetConfig', {
            shellyID: props.device.shellyID,
            config: {device: {name: trimmedName.value}}
        });
    }
    await hostDevices.setImage({
        shellyID: props.device.shellyID,
        imageAssetId: draft.imageAssetId.value,
        icon: draft.icon.value
    });
}

function visualPayload(): {icon?: string; accent?: string; imageModel?: string} {
    return {
        icon: draft.icon.value ?? undefined,
        accent: draft.accent.value ?? undefined,
        imageModel: draft.imageModel.value ?? undefined
    };
}
</script>

<style scoped>
.dem {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) 0;
}

.dem__art {
    position: relative;
    width: 88px;
    height: 88px;
    margin: 0 auto;
    padding: 0;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-2);
    display: grid;
    place-items: center;
    overflow: hidden;
    cursor: pointer;
}

.dem__art:hover {
    border-color: var(--color-border-strong);
}

.dem__art-icon {
    font-size: var(--type-heading);
    color: var(--color-text-secondary);
}

.dem__art-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: var(--space-2);
}

.dem__art-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0;
    transition: opacity 0.15s ease;
}

.dem__art:hover .dem__art-overlay,
.dem__art:focus-visible .dem__art-overlay {
    opacity: 1;
}

.dem__change {
    align-self: center;
}

.dem__readonly-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    text-align: center;
    overflow-wrap: anywhere;
}

.dem__error {
    color: rgba(var(--color-danger-rgb), 0.9);
    font-size: var(--type-body);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
}
</style>
