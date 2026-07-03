<template>
    <div class="sfp">
        <Dropdown
            :options="labels"
            :default="currentLabel"
            @selected="onSelected"
        />
        <p v-if="inheritHint" class="sfp__hint">{{ inheritHint }}</p>
    </div>
</template>

<script setup lang="ts">
import {ALERT_SEVERITIES, type AlertSeverity} from '@api/alert';
import {computed} from 'vue';
import Dropdown from './Dropdown.vue';

const INHERIT_LABEL = 'Inherit';

const labels = [
    INHERIT_LABEL,
    ...ALERT_SEVERITIES.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
];

const model = defineModel<AlertSeverity | ''>({required: true});

defineProps<{inheritHint?: string}>();

const currentLabel = computed(() =>
    model.value
        ? model.value.charAt(0).toUpperCase() + model.value.slice(1)
        : INHERIT_LABEL
);

function onSelected(label: string | number | boolean) {
    const asStr = String(label);
    if (asStr === INHERIT_LABEL) {
        model.value = '';
        return;
    }
    const match = ALERT_SEVERITIES.find(
        (s) => s.toLowerCase() === asStr.toLowerCase()
    );
    model.value = match ?? '';
}
</script>

<style scoped>
.sfp {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.sfp__hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
