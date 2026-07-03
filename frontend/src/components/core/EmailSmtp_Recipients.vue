<template>
    <div class="esr">
        <section class="esr__section">
            <header class="esr__section-hdr">
                <h3 class="esr__section-title">Recipients</h3>
                <p class="esr__section-desc">
                    Press <kbd>Enter</kbd> after each address. Separate role
                    addresses go on different lines. Max 50 per field.
                </p>
            </header>

            <ChipField
                :model-value="toAddresses"
                label="To *"
                placeholder="Add recipient and press Enter"
                :max="50"
                @update:model-value="setArray('toAddresses', $event)"
            />
            <ChipField
                :model-value="ccAddresses"
                label="Cc"
                placeholder="Add Cc recipient"
                :max="50"
                @update:model-value="setArray('ccAddresses', $event)"
            />
            <ChipField
                :model-value="bccAddresses"
                label="Bcc"
                placeholder="Add Bcc recipient (hidden from To/Cc)"
                :max="50"
                @update:model-value="setArray('bccAddresses', $event)"
            />
        </section>

        <section class="esr__section">
            <header class="esr__section-hdr">
                <h3 class="esr__section-title">Priority header</h3>
                <p class="esr__section-desc">
                    Sets the <code>X-Priority</code> header. Some clients
                    surface a visual marker; most ignore it.
                </p>
            </header>

            <div class="esr__priority" role="radiogroup">
                <label
                    v-for="opt in PRIORITY_OPTIONS"
                    :key="opt.value"
                    class="esr__priority-opt"
                    :class="{'esr__priority-opt--active': priority === opt.value}"
                >
                    <input
                        type="radio"
                        :value="opt.value"
                        :checked="priority === opt.value"
                        class="esr__priority-input"
                        @change="setString('priority', opt.value)"
                    />
                    <i :class="`fas ${opt.icon}`" />
                    <span>{{ opt.label }}</span>
                </label>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import ChipField from '@/components/core/ChipField.vue';

const config = defineModel<Record<string, unknown>>({required: true});

const PRIORITY_OPTIONS = [
    {value: 'high', label: 'High', icon: 'fa-angles-up'},
    {value: 'normal', label: 'Normal', icon: 'fa-equals'},
    {value: 'low', label: 'Low', icon: 'fa-angles-down'}
] as const;

const toAddresses = computed(() => arrayOf('toAddresses'));
const ccAddresses = computed(() => arrayOf('ccAddresses'));
const bccAddresses = computed(() => arrayOf('bccAddresses'));
const priority = computed(
    () => (config.value.priority as string | undefined) ?? 'normal'
);

function arrayOf(key: string): string[] {
    const v = config.value[key];
    return Array.isArray(v) ? (v as string[]) : [];
}

function mergeConfig(patch: Record<string, unknown>) {
    const next = {...config.value};
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
    }
    config.value = next;
}

function setArray(key: string, value: string[]) {
    mergeConfig({[key]: value.length > 0 ? value : undefined});
}

function setString(key: string, value: string) {
    mergeConfig({[key]: value || undefined});
}
</script>

<style scoped>
.esr {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.esr__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.esr__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.esr__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.esr__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

.esr__section-desc kbd,
.esr__section-desc code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--color-surface-3);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
}

.esr__priority {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
}

.esr__priority-opt {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background var(--motion-hover),
        color var(--motion-hover);
}

.esr__priority-opt:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
}

.esr__priority-opt--active {
    border-color: var(--color-primary);
    background: color-mix(
        in srgb,
        var(--color-primary) 14%,
        var(--color-surface-2)
    );
    color: var(--color-text-primary);
    box-shadow: var(--shadow-brand-ring);
}

.esr__priority-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

@media (max-width: 640px) {
    .esr__priority {
        grid-template-columns: 1fr;
    }
}
</style>
