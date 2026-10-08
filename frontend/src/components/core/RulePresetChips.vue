<template>
    <div v-if="presets.length > 0" class="rpc">
        <div v-for="group in groups" :key="group.label" class="rpc__group">
            <!-- One heading over everything says nothing; it only earns the
                 space once there is a second family to tell it apart from. -->
            <p v-if="showGroupLabels" class="rpc__group-label">
                {{ group.label }}
            </p>
            <div class="rpc__row">
                <button
                    v-for="preset in group.presets"
                    :key="preset.key"
                    type="button"
                    class="rpc__chip"
                    :class="{'rpc__chip--active': isPresetActive(preset, condition)}"
                    :aria-pressed="isPresetActive(preset, condition)"
                    @click="emit('pick', preset.config)"
                >
                    <i :class="['rpc__icon', preset.icon]" aria-hidden="true" />
                    {{ preset.label }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {AlertRuleKind, AlertRuleTemplate} from '@api/alert';
import {computed, onMounted, ref} from 'vue';
import {
    groupPresets,
    isPresetActive,
    presetsForDevices,
    presetsForKind
} from '@/helpers/rulePresets';
import {useAlertsStore} from '@/stores/alerts';

// Both refinements are optional: the chips work from the kind alone, and a
// caller that knows nothing about scope or condition still gets a usable row.
const props = withDefaults(
    defineProps<{
        kind: AlertRuleKind;
        /** The condition as it stands, so the chosen chip can mark itself. */
        condition?: Record<string, unknown>;
        /** Component families the scoped devices report. Empty = not known. */
        availableComponents?: ReadonlySet<string>;
    }>(),
    {
        condition: () => ({}),
        availableComponents: () => new Set<string>()
    }
);

const emit = defineEmits<{pick: [config: Record<string, unknown>]}>();

// Quick-picks come from the backend starters — the single source for config.
const store = useAlertsStore();
const templates = ref<AlertRuleTemplate[]>([]);

onMounted(async () => {
    templates.value = await store.listTemplates();
});

// Two narrowings: the kind decides which quick-picks exist at all, the chosen
// devices decide which of those are worth offering.
const presets = computed(() =>
    presetsForDevices(
        presetsForKind(templates.value, props.kind),
        props.availableComponents
    )
);

// Grouped by the family a person would look under, so a long row is scanned
// rather than read end to end.
const groups = computed(() => groupPresets(presets.value));

const showGroupLabels = computed(() => groups.value.length > 1);
</script>

<style scoped>
.rpc {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.rpc__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.rpc__group-label {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}

.rpc__row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.rpc__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background-color var(--motion-hover);
}

.rpc__chip:hover {
    background: var(--color-surface-3);
    border-color: var(--color-primary);
}

/* The chip that matches the condition. Same accent the strip and the signal
   list use, so "chosen" reads the same everywhere in the modal. */
.rpc__chip--active {
    color: var(--color-primary-text);
    background: color-mix(
        in srgb,
        var(--color-primary-text) 12%,
        var(--color-surface-2)
    );
    border-color: color-mix(
        in srgb,
        var(--color-primary-text) 45%,
        transparent
    );
    font-weight: var(--font-semibold);
}

.rpc__chip--active .rpc__icon {
    color: var(--color-primary-text);
}

.rpc__chip:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.rpc__icon {
    color: var(--color-primary-text);
}
</style>
