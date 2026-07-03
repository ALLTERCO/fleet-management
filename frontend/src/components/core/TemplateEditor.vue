<template>
    <div class="te">
        <div class="te__hdr">
            <label v-if="label" class="te__label">{{ label }}</label>
            <VariablePicker
                :context="context"
                :action-vars="actionVars"
                @insert="insertAtCursor"
            />
        </div>
        <textarea
            ref="taRef"
            v-model="model"
            class="te__textarea"
            :rows="rows"
            :placeholder="placeholder"
        />
        <details v-if="!noPreview" class="te__preview">
            <summary class="te__preview-summary">
                <i class="fas fa-eye" /> Preview
                <span v-if="missingTokens.length > 0" class="te__warn"
                    :title="`Unknown tokens: ${missingTokens.join(', ')}`">
                    <i class="fas fa-circle-exclamation" />
                    {{ missingTokens.length }} unknown
                </span>
            </summary>
            <pre class="te__preview-body">{{ rendered }}</pre>
            <p v-if="hint" class="te__hint">{{ hint }}</p>
        </details>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import VariablePicker from '@/components/core/VariablePicker.vue';
import {UI_CONFIG} from '@/config/ui';
import {fetchActionVariables} from '@/helpers/substituteVariables';
import {
    type ContextVariable,
    getContextVariables,
    previewRender, 
    type TemplateContextKind
} from '@/helpers/templateContext';
import {useNotificationsStore} from '@/stores/notifications';

const props = withDefaults(
    defineProps<{
        label?: string;
        placeholder?: string;
        hint?: string;
        rows?: number;
        /** Hide the built-in per-field preview (use a shared one instead). */
        noPreview?: boolean;
        contextKind?: TemplateContextKind;
        descriptorVariables?: ContextVariable[];
        // When ruleKind is set, use backend RenderTemplate (authoritative).
        ruleKind?: string;
        ruleName?: string;
        sampleAlertId?: number;
    }>(),
    {rows: 3, contextKind: 'alert'}
);

const model = defineModel<string>({required: true});

const taRef = ref<HTMLTextAreaElement | null>(null);
const actionVars = ref<Record<string, string>>({});
const backendRendered = ref('');
const missingTokens = ref<string[]>([]);
const notificationsStore = useNotificationsStore();

const context = computed<ContextVariable[]>(() =>
    getContextVariables(props.contextKind, props.descriptorVariables)
);

const useBackend = computed(() => !!props.ruleKind || !!props.sampleAlertId);

onMounted(async () => {
    actionVars.value = await fetchActionVariables();
});

const rendered = computed(() => {
    if (useBackend.value) return backendRendered.value;
    return previewRender(model.value ?? '', actionVars.value);
});

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(
    [() => model.value, () => props.ruleKind, () => props.sampleAlertId],
    () => {
        if (!useBackend.value) {
            missingTokens.value = [];
            return;
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const template = (model.value ?? '').trim();
            if (!template) {
                backendRendered.value = '';
                missingTokens.value = [];
                return;
            }
            const res = await notificationsStore.renderTemplate({
                template,
                ruleKind: props.ruleKind,
                ruleName: props.ruleName,
                sampleAlertId: props.sampleAlertId
            });
            if (!res) return;
            backendRendered.value = res.rendered;
            missingTokens.value = res.missingTokens;
        }, UI_CONFIG.templatePreviewDebounceMs);
    },
    {immediate: true}
);

onBeforeUnmount(() => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
});

function insertAtCursor(token: string) {
    const ta = taRef.value;
    if (!ta) {
        model.value = (model.value ?? '') + token;
        return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    model.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
    });
}
</script>

<style scoped>
.te {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
}
.te__hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.te__label {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
}
.te__textarea {
    width: 100%;
    padding: var(--space-2);
    font-size: var(--type-body);
    font-family: var(--font-mono, monospace);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    resize: vertical;
    min-height: var(--space-16);
}
.te__textarea:focus {
    outline: none;
    border-color: var(--color-primary);
}
.te__preview {
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    background: var(--color-surface-1);
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-md);
}
.te__preview-summary {
    cursor: pointer;
    user-select: none;
}
.te__preview-body {
    margin: var(--space-2) 0 0 0;
    padding: var(--space-2);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    word-break: break-word;
}
.te__hint {
    margin: var(--space-1) 0 0 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.te__warn {
    display: inline-flex; align-items: center; gap: var(--space-1);
    margin-left: var(--space-2);
    color: var(--color-warning-text);
}
</style>
