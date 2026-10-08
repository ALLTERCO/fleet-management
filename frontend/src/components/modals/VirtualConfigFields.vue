<template>
    <div class="vcf">
        <template v-if="family === 'boolean'">
            <div class="vcf__pair">
                <FormField label="Title when off">
                    <input
                        v-model.trim="form.titleFalse"
                        type="text"
                        class="vcf__input vcf__title-false"
                        placeholder="Off"
                    />
                </FormField>
                <FormField label="Title when on">
                    <input
                        v-model.trim="form.titleTrue"
                        type="text"
                        class="vcf__input vcf__title-true"
                        placeholder="On"
                    />
                </FormField>
            </div>
            <Checkbox
                v-model="form.booleanDefault"
                class="vcf__default-boolean"
                label="Default to on"
                hint="Value applied on reboot when not persisted"
            />
        </template>

        <template v-else-if="family === 'number'">
            <div class="vcf__pair">
                <FormField label="Minimum">
                    <input
                        v-model.trim="form.min"
                        type="number"
                        class="vcf__input vcf__min"
                        placeholder="No minimum"
                    />
                </FormField>
                <FormField label="Maximum">
                    <input
                        v-model.trim="form.max"
                        type="number"
                        class="vcf__input vcf__max"
                        placeholder="No maximum"
                    />
                </FormField>
            </div>
            <div class="vcf__pair">
                <FormField label="Step">
                    <input
                        v-model.trim="form.step"
                        type="number"
                        class="vcf__input vcf__step"
                        placeholder="1"
                    />
                </FormField>
                <FormField label="Unit">
                    <input
                        v-model.trim="form.unit"
                        type="text"
                        class="vcf__input vcf__unit"
                        placeholder="W, %, ..."
                    />
                </FormField>
            </div>
            <FormField
                label="Default value"
                hint="Value applied on reboot when not persisted"
            >
                <input
                    v-model.trim="form.numberDefault"
                    type="number"
                    class="vcf__input vcf__default-number"
                />
            </FormField>
        </template>

        <template v-else-if="family === 'text'">
            <FormField label="Maximum length">
                <input
                    v-model.trim="form.maxLen"
                    type="number"
                    min="0"
                    class="vcf__input vcf__max-len"
                    placeholder="No limit"
                />
            </FormField>
            <FormField
                label="Default value"
                hint="Value applied on reboot when not persisted"
            >
                <input
                    v-model="form.textDefault"
                    type="text"
                    class="vcf__input vcf__default-text"
                />
            </FormField>
        </template>

        <template v-else>
            <FormField label="Options" :error="optionsError">
                <div class="vcf__options">
                    <div
                        v-for="(option, index) in form.options"
                        :key="index"
                        class="vcf__option-row"
                    >
                        <input
                            v-model.trim="option.value"
                            type="text"
                            class="vcf__input vcf__option-value"
                            placeholder="value"
                            :aria-label="`Option ${index + 1} value`"
                        />
                        <input
                            v-model.trim="option.title"
                            type="text"
                            class="vcf__input vcf__option-title"
                            placeholder="Display title (optional)"
                            :aria-label="`Option ${index + 1} title`"
                        />
                        <button
                            type="button"
                            class="vcf__option-remove"
                            :aria-label="`Remove option ${index + 1}`"
                            @click="removeOption(index)"
                        >
                            <i class="fas fa-xmark" />
                        </button>
                    </div>
                    <Button
                        type="white"
                        size="sm"
                        class="vcf__add-option"
                        @click="addOption"
                    >
                        <i class="fas fa-plus" /> Add option
                    </Button>
                </div>
            </FormField>
            <FormField
                v-if="enumValues.length"
                label="Default option"
                hint="Option applied on reboot when not persisted"
            >
                <Dropdown
                    class="vcf__default-enum"
                    :options="enumValues"
                    placeholder="None"
                    :default="form.enumDefault || undefined"
                    aria-label="Default option"
                    @selected="(value) => (form.enumDefault = String(value))"
                />
            </FormField>
        </template>

        <FormField label="Display as">
            <Dropdown
                class="vcf__view"
                :options="viewChoices"
                placeholder="Device default"
                :default="form.view || undefined"
                aria-label="Display as"
                @selected="(value) => (form.view = String(value))"
            />
        </FormField>
        <Checkbox
            v-model="form.persisted"
            class="vcf__persisted"
            label="Keep value across reboots"
        />
    </div>
</template>

<script lang="ts">
// Draft <-> device-config mapping for virtual component SetConfig payloads.
// Single source used by VirtualEditModal (edit) and VirtualComponentManager
// (create), so both surfaces build identical wire payloads.

export type VirtualConfigFamily = 'boolean' | 'number' | 'text' | 'enum';

export interface EnumOptionDraft {
    value: string;
    title: string;
}

// Numeric fields are string | number: v-model on type="number" inputs
// coerces parseable text to numbers.
export interface VirtualConfigDraft {
    persisted: boolean;
    view: string;
    titleFalse: string;
    titleTrue: string;
    booleanDefault: boolean;
    min: string | number;
    max: string | number;
    step: string | number;
    unit: string;
    numberDefault: string | number;
    maxLen: string | number;
    textDefault: string;
    enumDefault: string;
    options: EnumOptionDraft[];
}

// Valid meta.ui.view values per family, from the device firmware docs.
export const FAMILY_VIEWS: Record<VirtualConfigFamily, string[]> = {
    boolean: ['label', 'toggle'],
    number: ['label', 'field', 'slider', 'progressbar'],
    text: ['label', 'field', 'image'],
    enum: ['label', 'dropdown']
};

export function emptyVirtualConfigDraft(): VirtualConfigDraft {
    return {
        persisted: false,
        view: '',
        titleFalse: '',
        titleTrue: '',
        booleanDefault: false,
        min: '',
        max: '',
        step: '',
        unit: '',
        numberDefault: '',
        maxLen: '',
        textDefault: '',
        enumDefault: '',
        options: []
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function numberToInput(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : '';
}

function inputToNumber(value: string | number): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function setOrDeleteKey(
    target: Record<string, unknown>,
    key: string,
    value: unknown
): void {
    if (value === undefined) delete target[key];
    else target[key] = value;
}

function includeNumberIfChanged(
    delta: Record<string, unknown>,
    key: string,
    input: string | number,
    baseValue: unknown
): void {
    const next = inputToNumber(input);
    const prev = typeof baseValue === 'number' ? baseValue : undefined;
    if (next !== undefined && next !== prev) delta[key] = next;
}

export function draftFromVirtualConfig(
    family: VirtualConfigFamily,
    config: Record<string, unknown>
): VirtualConfigDraft {
    const draft = emptyVirtualConfigDraft();
    const ui = asRecord(asRecord(config.meta).ui);
    draft.persisted = config.persisted === true;
    draft.view = typeof ui.view === 'string' ? ui.view : '';
    if (family === 'boolean') {
        // Device contract: boolean titles is a [whenFalse, whenTrue] pair.
        const titles = Array.isArray(ui.titles) ? ui.titles : [];
        draft.titleFalse = typeof titles[0] === 'string' ? titles[0] : '';
        draft.titleTrue = typeof titles[1] === 'string' ? titles[1] : '';
        draft.booleanDefault = config.default_value === true;
    } else if (family === 'number') {
        draft.min = numberToInput(config.min);
        draft.max = numberToInput(config.max);
        draft.step = numberToInput(ui.step);
        draft.unit = typeof ui.unit === 'string' ? ui.unit : '';
        draft.numberDefault = numberToInput(config.default_value);
    } else if (family === 'text') {
        draft.maxLen = numberToInput(config.max_len);
        draft.textDefault =
            typeof config.default_value === 'string'
                ? config.default_value
                : '';
    } else {
        const titles = asRecord(ui.titles);
        const options = Array.isArray(config.options) ? config.options : [];
        draft.options = options.map((value) => {
            const key = String(value);
            const title = titles[key];
            return {
                value: key,
                title: typeof title === 'string' ? title : ''
            };
        });
        draft.enumDefault =
            typeof config.default_value === 'string'
                ? config.default_value
                : '';
    }
    return draft;
}

/**
 * Build the SetConfig payload as a delta against the device-reported config,
 * so only fields the user actually changed go on the wire. Pass an empty
 * base for create flows. An empty result means the draft is clean.
 */
export function virtualConfigDelta(
    family: VirtualConfigFamily,
    draft: VirtualConfigDraft,
    baseConfig: Record<string, unknown>
): Record<string, unknown> {
    const delta: Record<string, unknown> = {};
    const baseMeta = asRecord(baseConfig.meta);
    const baseUi = asRecord(baseMeta.ui);
    const ui: Record<string, unknown> = {...baseUi};
    setOrDeleteKey(ui, 'view', draft.view || undefined);

    if (draft.persisted !== (baseConfig.persisted === true)) {
        delta.persisted = draft.persisted;
    }

    if (family === 'boolean') {
        const titles =
            draft.titleFalse || draft.titleTrue
                ? [draft.titleFalse, draft.titleTrue]
                : undefined;
        setOrDeleteKey(ui, 'titles', titles);
        if (draft.booleanDefault !== (baseConfig.default_value === true)) {
            delta.default_value = draft.booleanDefault;
        }
    } else if (family === 'number') {
        includeNumberIfChanged(delta, 'min', draft.min, baseConfig.min);
        includeNumberIfChanged(delta, 'max', draft.max, baseConfig.max);
        includeNumberIfChanged(
            delta,
            'default_value',
            draft.numberDefault,
            baseConfig.default_value
        );
        setOrDeleteKey(ui, 'step', inputToNumber(draft.step));
        setOrDeleteKey(ui, 'unit', draft.unit || undefined);
    } else if (family === 'text') {
        includeNumberIfChanged(
            delta,
            'max_len',
            draft.maxLen,
            baseConfig.max_len
        );
        const baseDefault =
            typeof baseConfig.default_value === 'string'
                ? baseConfig.default_value
                : '';
        if (draft.textDefault !== baseDefault) {
            delta.default_value = draft.textDefault;
        }
    } else {
        const values = draft.options
            .map((option) => option.value.trim())
            .filter((value) => value.length > 0);
        const baseOptions = Array.isArray(baseConfig.options)
            ? baseConfig.options
            : [];
        if (JSON.stringify(values) !== JSON.stringify(baseOptions)) {
            delta.options = values;
        }
        const titles: Record<string, string> = {};
        for (const option of draft.options) {
            const value = option.value.trim();
            if (value && option.title.trim()) {
                titles[value] = option.title.trim();
            }
        }
        setOrDeleteKey(
            ui,
            'titles',
            Object.keys(titles).length ? titles : undefined
        );
        // A default that no longer matches an option must not survive.
        const nextDefault = values.includes(draft.enumDefault)
            ? draft.enumDefault
            : null;
        const baseDefault =
            typeof baseConfig.default_value === 'string'
                ? baseConfig.default_value
                : null;
        if (nextDefault !== baseDefault) delta.default_value = nextDefault;
    }

    if (JSON.stringify(ui) !== JSON.stringify(baseUi)) {
        delta.meta = {...baseMeta, ui};
    }
    return delta;
}
</script>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';

const props = defineProps<{
    family: VirtualConfigFamily;
    optionsError?: string;
}>();

const form = defineModel<VirtualConfigDraft>({required: true});

const viewChoices = computed(() => FAMILY_VIEWS[props.family]);

const enumValues = computed(() =>
    form.value.options
        .map((option) => option.value.trim())
        .filter((value) => value.length > 0)
);

function addOption(): void {
    form.value.options.push({value: '', title: ''});
}

function removeOption(index: number): void {
    form.value.options.splice(index, 1);
}
</script>

<style scoped>
.vcf {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.vcf__pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
}

.vcf__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    color: var(--color-text-primary);
    font-size: var(--input-font-size);
}

.vcf__options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.vcf__option-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: var(--space-2);
    align-items: center;
}

.vcf__option-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    background: transparent;
    cursor: pointer;
}

.vcf__option-remove:hover {
    color: var(--color-danger-text);
    background: var(--color-surface-3);
}

.vcf__add-option {
    align-self: flex-start;
}
</style>
