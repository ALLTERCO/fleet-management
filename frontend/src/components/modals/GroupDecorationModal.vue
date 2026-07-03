<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Customize appearance</template>
        <template #default>
            <div class="gdd">
                <div class="gdd__preview">
                    <DecorationAvatar
                        :icon="pickedIcon"
                        :accent="pickedAccent"
                        :image-asset-id="pickedImageUrl"
                        fallback-icon="fas fa-folder"
                        editable
                        :size="64"
                        @edit="pickerVisible = true"
                    />
                    <div class="gdd__preview-meta">
                        <div class="gdd__preview-name">{{ group.name }}</div>
                        <div class="gdd__preview-kind">Group</div>
                    </div>
                </div>

                <div v-if="errorMsg" class="gdd__error">
                    <i class="fas fa-triangle-exclamation" /> {{ errorMsg }}
                </div>
            </div>
            <AssetPickerModal
                v-if="pickerVisible"
                :visible="pickerVisible"
                :initial-selected-asset-id="pickedImageUrl"
                :initial-selected-icon="pickedIcon"
                :initial-selected-accent="pickedAccent"
                default-context="group"
                @close="pickerVisible = false"
                @select-asset="onPickAsset"
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
import type {Group} from '@api/group';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DecorationAvatar from '@/components/core/DecorationAvatar.vue';
import {useDecorationDraft} from '@/composables/useDecorationDraft';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useGroupsStore} from '@/stores/groups';
import AssetPickerModal from './AssetPickerModal.vue';
import Modal from './Modal.vue';

const props = defineProps<{
    visible: boolean;
    group: Group;
}>();

const emit = defineEmits<{close: []; saved: []}>();

const groupsStore = useGroupsStore();

// Bind to the current group's authoritative visual on every open so a
// peer's concurrent change doesn't get silently overwritten.
const {
    icon: pickedIcon,
    accent: pickedAccent,
    imageAssetId: pickedImageUrl,
    onSelectAsset: onPickAsset,
    onSelectIcon: onPickIcon,
    onClear: onClearDecoration
} = useDecorationDraft();
const saving = ref(false);
const errorMsg = ref<string | null>(null);
const pickerVisible = ref(false);

watch(
    () => [props.visible, props.group],
    () => {
        if (!props.visible) return;
        pickedIcon.value = props.group.visual?.icon ?? null;
        pickedAccent.value = props.group.visual?.accent ?? null;
        pickedImageUrl.value = props.group.imageAssetId ?? null;
        errorMsg.value = null;
    },
    {immediate: true}
);

const dirty = computed(
    () =>
        pickedIcon.value !== (props.group.visual?.icon ?? null) ||
        pickedAccent.value !== (props.group.visual?.accent ?? null) ||
        pickedImageUrl.value !== (props.group.imageAssetId ?? null)
);

async function onSave(): Promise<void> {
    errorMsg.value = null;
    saving.value = true;
    try {
        await groupsStore.updateGroup({
            id: props.group.id,
            expectedRevision: props.group.revision,
            patch: {
                visual: {
                    icon: pickedIcon.value ?? undefined,
                    accent: pickedAccent.value ?? undefined
                },
                imageAssetId: pickedImageUrl.value
            }
        });
        emit('saved');
        emit('close');
    } catch (err) {
        errorMsg.value = rpcErrorMessage(err, 'Failed to save appearance');
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.gdd {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.gdd__preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-2);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-medium);
}

.gdd__preview-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.gdd__preview-name {
    font-weight: 600;
    color: var(--color-text-primary);
}

.gdd__preview-kind {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.gdd__error {
    color: rgba(var(--color-danger-rgb), 0.9);
    font-size: var(--type-body);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
</style>
