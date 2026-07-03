<template>
    <div class="etb">
        <!-- Source switch — cleaner radio tile layout -->
        <div class="etb__mode" role="radiogroup" aria-label="Template source">
            <button
                type="button"
                class="etb__mode-opt"
                :class="{'etb__mode-opt--active': mode === 'inline'}"
                @click="setMode('inline')"
            >
                <span class="etb__mode-icon" aria-hidden="true">
                    <i class="fas fa-code" />
                </span>
                <span class="etb__mode-body">
                    <span class="etb__mode-label">Write inline</span>
                    <span class="etb__mode-sub">
                        Subject / HTML / text live with this endpoint.
                    </span>
                </span>
                <i
                    v-if="mode === 'inline'"
                    class="fas fa-circle-check etb__mode-check"
                    aria-hidden="true"
                />
            </button>
            <button
                type="button"
                class="etb__mode-opt"
                :class="{'etb__mode-opt--active': mode === 'library'}"
                @click="setMode('library')"
            >
                <span class="etb__mode-icon" aria-hidden="true">
                    <i class="fas fa-bookmark" />
                </span>
                <span class="etb__mode-body">
                    <span class="etb__mode-label">Use saved template</span>
                    <span class="etb__mode-sub">
                        Pick a reusable template from the shared library.
                    </span>
                </span>
                <i
                    v-if="mode === 'library'"
                    class="fas fa-circle-check etb__mode-check"
                    aria-hidden="true"
                />
            </button>
        </div>

        <!-- Library picker -->
        <div v-if="mode === 'library'" class="etb__library">
            <div class="etb__library-row">
                <div class="etb__library-field">
                    <label class="etb__label" :for="selectId">Saved template</label>
                    <div class="etb__library-select-row">
                        <select
                            :id="selectId"
                            class="core-input etb__select"
                            :value="emailTemplateId ?? ''"
                            :disabled="templatesLoading"
                            @change="onPickTemplate(($event.target as HTMLSelectElement).value)"
                        >
                            <option value="">
                                {{ templatesLoading
                                    ? 'Loading…'
                                    : templates.length === 0
                                      ? 'No saved templates yet'
                                      : '— select —' }}
                            </option>
                            <option
                                v-for="t in templates"
                                :key="t.id"
                                :value="t.id"
                            >
                                {{ t.name }}
                            </option>
                        </select>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            narrow
                            :disabled="templatesLoading"
                            :loading="templatesLoading"
                            @click="refreshTemplates"
                        >
                            Refresh
                        </Button>
                    </div>
                </div>
            </div>

            <article
                v-if="selectedTemplate"
                class="etb__library-summary"
                aria-label="Selected template summary"
            >
                <header class="etb__library-hdr">
                    <h4 class="etb__library-name">
                        <i class="fas fa-bookmark etb__library-icon" />
                        {{ selectedTemplate.name }}
                    </h4>
                </header>
                <p
                    v-if="selectedTemplate.description"
                    class="etb__library-desc"
                >
                    {{ selectedTemplate.description }}
                </p>
                <ul class="etb__library-meta">
                    <li :class="{'etb__library-meta-off': !selectedTemplate.subjectTemplate}">
                        <i class="fas fa-heading" /> subject
                    </li>
                    <li :class="{'etb__library-meta-off': !selectedTemplate.htmlTemplate}">
                        <i class="fas fa-code" /> html
                    </li>
                    <li :class="{'etb__library-meta-off': !selectedTemplate.textTemplate}">
                        <i class="fas fa-align-left" /> text
                    </li>
                    <li
                        :class="{
                            'etb__library-meta-off':
                                selectedTemplate.attachments.length === 0
                        }"
                    >
                        <i class="fas fa-paperclip" />
                        {{ selectedTemplate.attachments.length }}
                        attachment(s)
                    </li>
                </ul>
            </article>

            <p class="etb__hint">
                Inline subject / HTML / text below (if filled) override the
                saved template field-by-field.
            </p>

            <Collapse title="Override specific fields (optional)">
                <IntegrationTemplateEditor
                    :model-value="modelValue"
                    :fields="fields"
                    @update:model-value="onFieldsUpdate"
                    @update:validity="(v) => emit('update:validity', v)"
                />
            </Collapse>
        </div>

        <!-- Inline editor -->
        <IntegrationTemplateEditor
            v-else
            :model-value="modelValue"
            :fields="fields"
            @update:model-value="onFieldsUpdate"
            @update:validity="(v) => emit('update:validity', v)"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, defineAsyncComponent, onMounted, ref, useId} from 'vue';
import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import type {TemplateField} from '@/components/core/IntegrationTemplateEditor.vue';
import {useNotificationsStore} from '@/stores/notifications';

const IntegrationTemplateEditor = defineAsyncComponent(
    () => import('@/components/core/IntegrationTemplateEditor.vue')
);

type Mode = 'inline' | 'library';

const modelValue = defineModel<Record<string, unknown>>({required: true});

defineProps<{
    fields: TemplateField[];
}>();

const emit = defineEmits<{
    'update:validity': [Record<string, boolean>];
}>();

const notificationsStore = useNotificationsStore();
const selectId = useId();
const templatesLoading = ref(false);

const templates = computed(() =>
    Object.values(notificationsStore.emailTemplates)
);

const emailTemplateId = computed<number | undefined>(() => {
    const v = modelValue.value.emailTemplateId;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
});

const selectedTemplate = computed(() =>
    emailTemplateId.value != null
        ? notificationsStore.emailTemplates[emailTemplateId.value]
        : undefined
);

const mode = computed<Mode>(() =>
    emailTemplateId.value ? 'library' : 'inline'
);

onMounted(async () => {
    if (templates.value.length === 0) await refreshTemplates();
});

async function refreshTemplates() {
    templatesLoading.value = true;
    try {
        await notificationsStore.fetchEmailTemplates();
    } finally {
        templatesLoading.value = false;
    }
}

function setMode(next: Mode) {
    if (next === 'inline') {
        const patch = {...modelValue.value};
        delete patch.emailTemplateId;
        modelValue.value = patch;
    }
}

function onPickTemplate(raw: string) {
    const id = Number(raw);
    const patch = {...modelValue.value};
    if (!Number.isFinite(id) || id <= 0) {
        delete patch.emailTemplateId;
    } else {
        patch.emailTemplateId = id;
    }
    modelValue.value = patch;
}

function onFieldsUpdate(next: Record<string, unknown>) {
    modelValue.value = next;
}
</script>

<style scoped>
.etb {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* ─── Mode switch tiles ─────────────────────────────────────────────── */

.etb__mode {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
}

.etb__mode-opt {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    min-height: var(--touch-target-min);
    transition:
        border-color var(--motion-hover),
        background var(--motion-hover);
}

.etb__mode-opt:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-2);
}

.etb__mode-opt--active {
    border-color: var(--color-primary);
    background: color-mix(
        in srgb,
        var(--color-primary) 12%,
        var(--color-surface-2)
    );
    box-shadow: var(--shadow-brand-ring);
}

.etb__mode-opt:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.etb__mode-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-md);
    background: color-mix(
        in srgb,
        var(--color-primary) 14%,
        var(--color-surface-3)
    );
    color: var(--color-primary-text);
    font-size: var(--icon-size-sm);
}

.etb__mode-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}

.etb__mode-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.etb__mode-sub {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}

.etb__mode-check {
    color: var(--color-success-text);
    font-size: var(--icon-size-sm);
}

/* ─── Library picker ────────────────────────────────────────────────── */

.etb__library {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.etb__library-row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.etb__library-field {
    flex: 1;
    min-width: 240px;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.etb__library-select-row {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
}

.etb__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

/* Inherits border + focus ring from .core-input (global). */
.etb__select {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}

.etb__library-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}

.etb__library-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.etb__library-name {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.etb__library-icon {
    color: var(--color-primary-text);
}

.etb__library-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
}

.etb__library-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.etb__library-meta li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.etb__library-meta-off {
    opacity: 0.4;
}

.etb__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.45;
}

@media (max-width: 640px) {
    .etb__mode {
        grid-template-columns: 1fr;
    }
}
</style>
