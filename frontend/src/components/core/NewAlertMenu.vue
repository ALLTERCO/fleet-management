<template>
    <ActionMenu
        title="New alert"
        menu-label="How to create the alert"
        :options="OPTIONS"
        @pick="onPick"
    />
</template>

<script setup lang="ts">
// One "+" for alerts, like the Devices tab: a ready-made alert in three
// short steps, or the full form for a rule of your own.
import ActionMenu, {
    type ActionMenuOption
} from '@/components/core/ActionMenu.vue';

export type NewAlertPath = 'quick' | 'custom';

const OPTIONS: readonly ActionMenuOption[] = [
    {
        key: 'quick',
        label: 'Quick alert',
        hint: 'Pick a ready-made alert, then the devices and who to tell',
        icon: 'fas fa-bolt'
    },
    {
        key: 'custom',
        label: 'Custom alert',
        hint: 'Set the condition yourself',
        icon: 'fas fa-sliders'
    }
];

const emit = defineEmits<{pick: [path: NewAlertPath]}>();

function onPick(key: string): void {
    if (key === 'quick' || key === 'custom') emit('pick', key);
}
</script>
