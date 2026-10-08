<template>
    <ActionMenu
        title="New device"
        menu-label="Device kind"
        :options="OPTIONS"
        @pick="onPick"
    />
</template>

<script setup lang="ts">
import ActionMenu, {
    type ActionMenuOption
} from '@/components/core/ActionMenu.vue';
import {DEVICE_KIND_META, DEVICE_KIND_ORDER} from '@/helpers/deviceKindMeta';
import type {WizardKind} from '@/stores/virtualDeviceDraftStore';

type ConcreteKind = Exclude<WizardKind, null>;

const OPTIONS: readonly ActionMenuOption[] = DEVICE_KIND_ORDER.map((kind) => ({
    key: kind,
    ...DEVICE_KIND_META[kind]
}));

const emit = defineEmits<{pick: [ConcreteKind]}>();

function onPick(key: string): void {
    emit('pick', key as ConcreteKind);
}
</script>
