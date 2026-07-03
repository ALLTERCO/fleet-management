<template>
    <div v-if="field.kind === 'toggle'" class="ls-field ls-field--toggle">
        <button
            type="button"
            class="ls-field__power"
            :class="boolValue && 'ls-field__power--on'"
            :disabled="disabled"
            @click="emit('change', !boolValue)"
        >
            <i class="fas fa-power-off" />
            <span>{{ boolValue ? 'On' : 'Off' }}</span>
        </button>
    </div>

    <div v-else-if="field.kind === 'slider'" class="ls-field ls-field--slider">
        <span class="ls-field__label">{{ label }}</span>
        <span class="ls-field__value"
            >{{ numValue }}{{ field.unit ?? '' }}</span
        >
        <input
            type="range"
            :min="field.min ?? 0"
            :max="field.max ?? 100"
            :value="numValue"
            :disabled="disabled"
            @change="emitRangeChange"
        />
    </div>

    <div v-else-if="field.kind === 'color'" class="ls-field ls-field--color">
        <span class="ls-field__label">{{ label }}</span>
        <input
            type="color"
            :value="rgbAsHex(rgbValue)"
            :disabled="disabled"
            @change="emitColorChange"
        />
    </div>

    <div
        v-else-if="field.kind === 'enum' && options.length"
        class="ls-field ls-field--enum"
    >
        <span class="ls-field__label">{{ label }}</span>
        <select
            class="ls-field__select"
            :value="stringValue"
            :disabled="disabled"
            @change="emitSelectChange"
        >
            <option v-for="opt in options" :key="opt.key" :value="opt.key">
                {{ opt.name || opt.key }}
            </option>
        </select>
        <slot name="trailing" />
    </div>

    <div
        v-else-if="field.kind === 'multiEnum' && options.length"
        class="ls-field ls-field--multi"
    >
        <div class="ls-field__section-label">{{ label }}</div>
        <label
            v-for="opt in options"
            :key="opt.key"
            class="ls-field__checkrow"
        >
            <input
                type="checkbox"
                :checked="multiValue.includes(opt.key)"
                :disabled="disabled"
                @change="emitMultiToggle(opt.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="ls-field__checklabel">{{ opt.name || opt.key }}</span>
        </label>
    </div>

    <div v-else-if="field.kind === 'text'" class="ls-field ls-field--text">
        <span class="ls-field__label">{{ label }}</span>
        <input
            type="text"
            class="ls-field__input"
            :value="stringValue"
            :disabled="disabled"
            @input="emitTextChange"
        />
    </div>

    <div v-else-if="field.kind === 'number'" class="ls-field ls-field--number">
        <span class="ls-field__label">{{ label }}</span>
        <input
            type="number"
            class="ls-field__input"
            :value="numValue"
            :min="field.min"
            :max="field.max"
            :disabled="disabled"
            @input="emitNumberChange"
        />
    </div>
</template>

<script setup lang="ts">
import type {LedStripCatalogEntry, LedStripUiField} from '@api/ledstrip';
import {computed} from 'vue';
import {labelizeKey} from '@/helpers/labelize';

type CatalogList = (string | LedStripCatalogEntry)[];

const props = defineProps<{
    field: LedStripUiField;
    value: unknown;
    catalog?: Record<string, CatalogList | undefined>;
    allowlist?: string[] | null;
    disabled?: boolean;
}>();

const emit = defineEmits<{change: [value: unknown]}>();

const label = computed(() => labelizeKey(props.field.key));

const boolValue = computed(() => props.value === true);

const numValue = computed(() =>
    typeof props.value === 'number' ? props.value : Number(props.value ?? 0)
);

const stringValue = computed(() =>
    typeof props.value === 'string' ? props.value : ''
);

const multiValue = computed<string[]>(() =>
    Array.isArray(props.value) ? (props.value as string[]) : []
);

const rgbValue = computed<number[]>(() =>
    Array.isArray(props.value) ? (props.value as number[]) : [0, 0, 0]
);

const options = computed<LedStripCatalogEntry[]>(() => {
    const key = props.field.catalogKey;
    if (!key) return [];
    const raw = props.catalog?.[key] ?? [];
    const normalized = raw.map((item) =>
        typeof item === 'string'
            ? ({key: item, name: item} as LedStripCatalogEntry)
            : item
    );
    const allow = props.allowlist;
    if (!allow) return normalized;
    return normalized.filter((e) => allow.includes(e.key));
});

function rgbAsHex(rgb: number[]): string {
    const [r = 0, g = 0, b = 0] = rgb;
    return `#${clamp8(r)}${clamp8(g)}${clamp8(b)}`;
}

function clamp8(n: number): string {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return v.toString(16).padStart(2, '0');
}

function hexToRgb(hex: string): number[] {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return [0, 0, 0];
    return [
        Number.parseInt(clean.slice(0, 2), 16),
        Number.parseInt(clean.slice(2, 4), 16),
        Number.parseInt(clean.slice(4, 6), 16)
    ];
}

function emitRangeChange(e: Event): void {
    emit('change', Number((e.target as HTMLInputElement).value));
}

function emitColorChange(e: Event): void {
    emit('change', hexToRgb((e.target as HTMLInputElement).value));
}

function emitSelectChange(e: Event): void {
    emit('change', (e.target as HTMLSelectElement).value);
}

function emitTextChange(e: Event): void {
    emit('change', (e.target as HTMLInputElement).value);
}

function emitNumberChange(e: Event): void {
    emit('change', Number((e.target as HTMLInputElement).value));
}

function emitMultiToggle(optKey: string, on: boolean): void {
    const current = multiValue.value;
    const next = on
        ? current.includes(optKey)
            ? current
            : [...current, optKey]
        : current.filter((k) => k !== optKey);
    emit('change', next);
}
</script>

<style scoped>
.ls-field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}

.ls-field--multi {
    flex-direction: column;
    align-items: stretch;
}

.ls-field__label {
    flex: 0 0 auto;
    min-width: 5rem;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.ls-field__value {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    min-width: 3rem;
    text-align: right;
}

.ls-field__select,
.ls-field__input {
    flex: 1 1 auto;
    padding: var(--space-1) var(--space-2);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    color: var(--color-text-primary);
    font-size: var(--input-font-size);
}

.ls-field__power {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-weight: var(--font-semibold);
    cursor: pointer;
}

.ls-field__power--on {
    background: rgba(var(--color-success-rgb), 0.15);
    color: var(--color-success-text);
    border-color: rgba(var(--color-success-rgb), 0.35);
}

.ls-field__section-label {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-tertiary);
}

.ls-field__checkrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
}

.ls-field__checklabel {
    font-size: var(--type-caption);
    color: var(--color-text-primary);
}
</style>
