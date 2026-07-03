<template>
    <div class="ite">
        <nav v-if="fields.length > 1" class="ite__tabs" role="group" aria-label="Template field">
            <button
                v-for="f in fields"
                :key="f.key"
                type="button"
                class="ite__tab"
                :aria-pressed="activeField === f.key"
                :class="{
                    'ite__tab--active': activeField === f.key,
                    'ite__tab--invalid': !isFieldValid(f)
                }"
                @click="activeField = f.key"
            >
                <span class="ite__tab-label">{{ f.label }}</span>
                <span
                    v-if="!isFieldValid(f)"
                    class="ite__tab-dot ite__tab-dot--err"
                    aria-label="Invalid"
                />
                <span
                    v-else-if="hasContent(f.key)"
                    class="ite__tab-dot ite__tab-dot--ok"
                    aria-label="Has content"
                />
            </button>
        </nav>
        <!-- HTML keeps its label above its own (RichText) toolbar. -->
        <header
            v-else-if="currentField?.mode === 'html'"
            class="ite__solo"
        >
            <h4 class="ite__solo-title">
                {{ currentField?.label ?? 'Template' }}
            </h4>
        </header>

        <p v-if="currentField?.hint" class="ite__hint">
            {{ currentField.hint }}
        </p>

        <!-- HTML fields get the Visual + Code toggle via RichTextEditor.
             Everything else uses CodeMirror-backed inline editor below. -->
        <RichTextEditor
            v-if="currentField?.mode === 'html'"
            :model-value="currentValue"
            :placeholder="currentField.placeholder"
            @update:model-value="onRichTextUpdate"
        />

        <template v-else>
            <!-- Label + token button sit directly on top of the editor. -->
            <div class="ite__toolbar">
                <span v-if="fields.length <= 1" class="ite__toolbar-label">
                    {{ currentField?.label }}
                </span>
                <span class="ite__mode-tag">
                    {{ modeLabel(currentField?.mode) }}
                </span>
                <button
                    type="button"
                    class="ite__token-btn"
                    aria-haspopup="menu"
                    :aria-expanded="tokenMenuOpen"
                    @click="tokenMenuOpen = !tokenMenuOpen"
                >
                    <i class="fas fa-code-branch" /> Token
                </button>
                <Button
                    v-if="currentField?.mode === 'json'"
                    type="blue-hollow"
                    size="xs"
                    :disabled="!isCurrentValid"
                    @click="formatJson"
                >
                    Format
                </Button>
                <span
                    v-if="!isCurrentValid"
                    class="ite__status ite__status--err"
                    role="status"
                >
                    <i class="fas fa-triangle-exclamation" /> Invalid JSON
                </span>
                <span
                    v-else-if="currentField?.mode === 'json' && hasContent(currentField.key)"
                    class="ite__status ite__status--ok"
                >
                    <i class="fas fa-circle-check" /> Valid JSON
                </span>
            </div>

            <div
                v-if="tokenMenuOpen"
                class="ite__token-menu"
                role="menu"
            >
                <button
                    v-for="t in tokens"
                    :key="t.token"
                    type="button"
                    class="ite__token-item"
                    role="menuitem"
                    @click="insertTokenCode(t.token)"
                >
                    <span class="ite__token-name">{{ t.label }}</span>
                    <code class="ite__token-code">{{ tokenDisplay(t.token) }}</code>
                </button>
            </div>

            <div
                ref="editorHost"
                class="ite__editor"
                :class="{'ite__editor--invalid': !isCurrentValid}"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, ref, shallowRef, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import RichTextEditor from '@/components/core/RichTextEditor.vue';
import {
    type CodeMirrorLanguage,
    useCodeMirror
} from '@/composables/useCodeMirror';
import {TEMPLATE_TOKENS} from '@/helpers/templateTokens';

export type TemplateMode = 'json' | 'html' | 'markdown' | 'plain';

export interface TemplateField {
    key: string;
    label: string;
    mode: TemplateMode;
    placeholder?: string;
    hint?: string;
}

const props = defineProps<{
    modelValue: Record<string, unknown>;
    fields: TemplateField[];
}>();

const emit = defineEmits<{
    'update:modelValue': [Record<string, unknown>];
    'update:validity': [Record<string, boolean>];
}>();

const activeField = ref<string>(props.fields[0]?.key ?? '');
const editorHost = ref<HTMLElement | null>(null);

// One CodeMirror instance for the active field. Switching tabs resets its
// state — that's cheap and keeps the impl simple.
const editorContent = ref(readString(activeField.value));
const tokens = shallowRef([...TEMPLATE_TOKENS]);

const currentField = computed<TemplateField | undefined>(
    () =>
        props.fields.find((f) => f.key === activeField.value) ??
        props.fields[0]
);

const currentValue = computed(() => readString(activeField.value));

function onRichTextUpdate(next: string) {
    writeString(activeField.value, next);
    emitValidity();
}

// Field `mode` → CodeMirror language. Reactive so tab switches rebuild
// the editor with the right extensions.
const activeLanguage = computed<CodeMirrorLanguage>(() => {
    const mode = currentField.value?.mode ?? 'plain';
    if (mode === 'json') return 'json';
    if (mode === 'html') return 'html';
    if (mode === 'markdown') return 'markdown';
    return 'plain';
});

const tokenMenuOpen = ref(false);

const {isValid, formatJson, setContent, getContent, insertText} = useCodeMirror({
    container: editorHost,
    content: editorContent,
    language: activeLanguage,
    variableSyntax: 'mustache',
    tokens,
    placeholder: currentField.value?.placeholder,
    onChange(text) {
        writeString(activeField.value, text);
        emitValidity();
    }
});

const isCurrentValid = computed(() => isValid.value);

onMounted(() => {
    rebindEditor(activeField.value);
});

watch(activeField, (next) => {
    rebindEditor(next);
});

watch(
    () => props.modelValue,
    (next) => {
        const key = activeField.value;
        const external = stringOf(next[key]);
        if (external !== getContent()) setContent(external);
    },
    {deep: true}
);

function rebindEditor(key: string) {
    editorContent.value = readString(key);
    nextTick(() => setContent(editorContent.value));
    emitValidity();
}

function readString(key: string): string {
    return stringOf(props.modelValue[key]);
}

function writeString(key: string, value: string): void {
    if (stringOf(props.modelValue[key]) === value) return;
    emit('update:modelValue', {...props.modelValue, [key]: value});
}

function stringOf(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

function hasContent(key: string): boolean {
    return readString(key).trim().length > 0;
}

function isFieldValid(field: TemplateField): boolean {
    if (field.mode !== 'json') return true;
    const text = readString(field.key);
    if (text.trim().length === 0) return true;
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

function emitValidity() {
    const map: Record<string, boolean> = {};
    for (const f of props.fields) map[f.key] = isFieldValid(f);
    emit('update:validity', map);
}

function modeLabel(mode: TemplateMode | undefined): string {
    if (mode === 'json') return 'JSON';
    if (mode === 'html') return 'HTML';
    return 'TEXT';
}

// Routed through JS so the template parser never sees a literal `{{`.
function tokenDisplay(name: string): string {
    return `{{${name}}}`;
}

function insertTokenCode(name: string) {
    insertText(tokenDisplay(name));
    tokenMenuOpen.value = false;
}
</script>

<style scoped>
.ite {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Tabs */
.ite__tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-0-5);
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    align-self: flex-start;
}

.ite__tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}

.ite__tab:hover {
    color: var(--color-text-primary);
}

.ite__tab--active {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    box-shadow: var(--shadow-brand-ring);
}

.ite__tab--invalid {
    color: var(--color-danger-text);
}

.ite__tab-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    display: inline-block;
}

.ite__tab-dot--ok {
    background: var(--color-success);
}

.ite__tab-dot--err {
    background: var(--color-danger);
}

.ite__solo {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.ite__solo-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.ite__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.45;
}

.ite {
    position: relative;
}

.ite__toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ite__toolbar-label {
    margin-right: auto;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.ite__token-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-primary-text);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}
.ite__token-btn:hover {
    background: var(--color-surface-3);
}

.ite__token-menu {
    z-index: var(--z-dropdown);
    max-height: 18rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
}
.ite__token-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
}
.ite__token-item:hover {
    background: var(--color-surface-3);
}
.ite__token-code {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-primary-text);
}

.ite__mode-tag {
    padding: var(--space-0-5) var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.ite__status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.ite__status--ok {
    color: var(--color-success-text);
}

.ite__status--err {
    color: var(--color-danger-text);
}

.ite__editor {
    min-height: 18rem;
    display: flex;
    flex-direction: column;
}

.ite__editor :deep(.cm-editor) {
    flex: 1;
    min-height: 18rem;
    border-radius: var(--radius-md);
}

.ite__editor--invalid :deep(.cm-editor) {
    border-color: var(--color-danger);
}
</style>
