<template>
    <div v-if="field.kind === 'toggle'" class="ls-field ls-field--toggle">
        <span class="ls-field__label">{{ label }}</span>
        <CardToggle
            size="row"
            :is-on="boolValue"
            :disabled="disabled"
            :aria-label="label"
            @toggle="emit('change', !boolValue)"
        />
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
        <div class="ls-color" role="group" :aria-label="`${label} color`">
            <button
                v-for="preset in COLOR_PRESETS"
                :key="preset"
                type="button"
                class="ls-color__swatch"
                :class="{'ls-color__swatch--active': rgbAsHex(rgbValue) === preset}"
                :style="{background: preset}"
                :aria-label="`Set ${label} to ${preset}`"
                :title="preset"
                :disabled="disabled"
                @click="emit('change', hexToRgb(preset))"
            />
            <label class="ls-color__custom" title="Pick a custom color">
                <input
                    type="color"
                    :value="rgbAsHex(rgbValue)"
                    :disabled="disabled"
                    :aria-label="`Pick a custom ${label} color`"
                    @input="emitColorChange"
                />
            </label>
            <span class="ls-color__hex">{{ rgbAsHex(rgbValue) }}</span>
        </div>
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
import CardToggle from '../cards/CardToggle.vue';

// Classic LED strip palette — one click for the common cases, the custom
// picker for everything else.
const COLOR_PRESETS = [
    '#ffffff',
    '#ff3b30',
    '#ff9500',
    '#ffcc00',
    '#34c759',
    '#00c7be',
    '#007aff',
    '#af52de',
    '#ff2d55'
];

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
// hexToRgb/rgbAsHex also serve the preset swatches in the template.

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
    min-height: var(--touch-target-min);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: var(--space-px) solid var(--color-border-subtle);
}

.ls-field:last-of-type {
    border-bottom: 0;
}

.ls-field--multi {
    flex-direction: column;
    align-items: stretch;
}

.ls-field__label {
    flex: 1;
    min-width: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
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

/* Color chooser — preset swatches plus the native custom picker. */
.ls-color {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
}

.ls-color__swatch {
    width: var(--icon-size-lg);
    height: var(--icon-size-lg);
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
        transform var(--duration-fast) var(--ease-default),
        box-shadow var(--duration-fast) var(--ease-default);
}

.ls-color__swatch:hover {
    transform: scale(1.12);
}

.ls-color__swatch--active {
    box-shadow: 0 0 0 2px var(--color-surface-0),
        0 0 0 4px var(--color-text-primary);
}

.ls-color__custom {
    position: relative;
    display: grid;
    width: var(--icon-size-lg);
    height: var(--icon-size-lg);
    place-items: center;
    overflow: hidden;
    border: var(--space-px) dashed var(--color-border-medium);
    border-radius: var(--radius-full);
    background: conic-gradient(
        red,
        yellow,
        lime,
        cyan,
        blue,
        magenta,
        red
    );
    cursor: pointer;
}

.ls-color__custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.ls-color__hex {
    min-width: 4.5rem;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    text-align: right;
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
