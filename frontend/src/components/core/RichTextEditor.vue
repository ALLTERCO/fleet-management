<template>
    <div class="rte">
        <header class="rte__bar">
            <!-- Mode toggle. The editor body below swaps view in place;
                 toggle-button pattern fits better than tab without panel. -->
            <nav class="rte__modes" role="group" aria-label="Editor mode">
                <button
                    type="button"
                    class="rte__mode"
                    :aria-pressed="mode === 'visual'"
                    :class="{'rte__mode--active': mode === 'visual'}"
                    @click="mode = 'visual'"
                >
                    <i class="fas fa-paragraph" /> Visual
                </button>
                <button
                    type="button"
                    class="rte__mode"
                    :aria-pressed="mode === 'code'"
                    :class="{'rte__mode--active': mode === 'code'}"
                    @click="mode = 'code'"
                >
                    <i class="fas fa-code" /> Code
                </button>
            </nav>

            <div v-if="mode === 'visual' && tiptap" class="rte__toolbar">
                <button
                    v-for="action in toolbarActions"
                    :key="action.id"
                    type="button"
                    class="rte__action"
                    :class="{'rte__action--active': action.active()}"
                    :title="action.label"
                    :aria-label="action.label"
                    @click="action.run()"
                >
                    <i :class="action.icon" />
                </button>
            </div>

            <!-- Token button stays available in both Visual and Code. -->
            <button
                type="button"
                class="rte__action rte__action--token"
                title="Insert template token"
                aria-haspopup="menu"
                :aria-expanded="tokenMenuOpen"
                @click="tokenMenuOpen = !tokenMenuOpen"
            >
                <i class="fas fa-code-branch" />
                <span>Token</span>
            </button>

            <Button type="blue-hollow" size="xs" @click="copyContent">
                Copy
            </Button>
        </header>

        <div
            v-if="tokenMenuOpen"
            class="rte__token-menu"
            role="menu"
            @click.self="tokenMenuOpen = false"
        >
            <button
                v-for="token in props.tokens"
                :key="token.token"
                type="button"
                class="rte__token-item"
                role="menuitem"
                @click="insertToken(token.token)"
            >
                <span class="rte__token-name">{{ token.label }}</span>
                <code class="rte__token-code">{{ tokenDisplay(token.token) }}</code>
            </button>
        </div>

        <div v-show="mode === 'visual'" class="rte__surface">
            <EditorContent :editor="tiptapEditor" class="rte__visual" />
        </div>

        <div v-show="mode === 'code'" class="rte__surface">
            <div ref="codeHost" class="rte__code" />
        </div>
    </div>
</template>

<script setup lang="ts">
import StarterKit from '@tiptap/starter-kit';
import {EditorContent, useEditor} from '@tiptap/vue-3';
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import {useCodeMirror} from '@/composables/useCodeMirror';
import {
    TEMPLATE_TOKENS,
    type TemplateTokenDescriptor
} from '@/helpers/templateTokens';
import {useToastStore} from '@/stores/toast';

const props = withDefaults(
    defineProps<{
        modelValue: string;
        placeholder?: string;
        tokens?: readonly TemplateTokenDescriptor[];
    }>(),
    {tokens: () => TEMPLATE_TOKENS}
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

const toast = useToastStore();

type Mode = 'visual' | 'code';
const mode = ref<Mode>('visual');
const tokenMenuOpen = ref(false);

// ── Visual editor (TipTap) ─────────────────────────────────────────────
const tiptap = useEditor({
    content: props.modelValue,
    extensions: [StarterKit],
    editorProps: {
        attributes: {
            class: 'rte__prose'
        }
    },
    onUpdate({editor}) {
        const html = editor.getHTML();
        if (html !== props.modelValue) emit('update:modelValue', html);
    }
});

// vue-tsc needs an explicitly unwrapped binding for <EditorContent>;
// ShallowRef doesn't pass the prop-type check in the template.
const tiptapEditor = computed(() => tiptap.value);

onBeforeUnmount(() => {
    tiptap.value?.destroy();
});

// Sync external changes (preset selection, reset) into TipTap.
watch(
    () => props.modelValue,
    (next) => {
        if (!tiptap.value) return;
        if (tiptap.value.getHTML() === next) return;
        tiptap.value.commands.setContent(next, {emitUpdate: false});
    }
);

// ── Code editor (CodeMirror HTML) ──────────────────────────────────────
const codeHost = ref<HTMLElement | null>(null);
const codeContent = shallowRef(props.modelValue);
const codeTokens = shallowRef([...props.tokens]);
watch(
    () => props.tokens,
    (next) => {
        codeTokens.value = [...next];
    }
);

const {setContent: setCodeContent, insertText: insertCode} = useCodeMirror({
    container: codeHost,
    content: codeContent,
    language: 'html',
    variableSyntax: 'mustache',
    tokens: codeTokens,
    placeholder: props.placeholder,
    onChange(text) {
        if (text !== props.modelValue) emit('update:modelValue', text);
    }
});

// Mode switch — keep both editors in sync with modelValue.
watch(mode, (next) => {
    tokenMenuOpen.value = false;
    if (next === 'code') setCodeContent(props.modelValue);
    else tiptap.value?.commands.setContent(props.modelValue, {emitUpdate: false});
});

watch(
    () => props.modelValue,
    (next) => {
        if (mode.value === 'code') setCodeContent(next);
    }
);

// ── Toolbar actions ────────────────────────────────────────────────────
interface ToolbarAction {
    id: string;
    label: string;
    icon: string;
    active: () => boolean;
    run: () => void;
}

const toolbarActions: ToolbarAction[] = [
    {
        id: 'bold',
        label: 'Bold',
        icon: 'fas fa-bold',
        active: () => !!tiptap.value?.isActive('bold'),
        run: () => tiptap.value?.chain().focus().toggleBold().run()
    },
    {
        id: 'italic',
        label: 'Italic',
        icon: 'fas fa-italic',
        active: () => !!tiptap.value?.isActive('italic'),
        run: () => tiptap.value?.chain().focus().toggleItalic().run()
    },
    {
        id: 'strike',
        label: 'Strikethrough',
        icon: 'fas fa-strikethrough',
        active: () => !!tiptap.value?.isActive('strike'),
        run: () => tiptap.value?.chain().focus().toggleStrike().run()
    },
    {
        id: 'code',
        label: 'Inline code',
        icon: 'fas fa-terminal',
        active: () => !!tiptap.value?.isActive('code'),
        run: () => tiptap.value?.chain().focus().toggleCode().run()
    },
    {
        id: 'h2',
        label: 'Heading',
        icon: 'fas fa-heading',
        active: () => !!tiptap.value?.isActive('heading', {level: 2}),
        run: () =>
            tiptap.value?.chain().focus().toggleHeading({level: 2}).run()
    },
    {
        id: 'bullet',
        label: 'Bulleted list',
        icon: 'fas fa-list-ul',
        active: () => !!tiptap.value?.isActive('bulletList'),
        run: () => tiptap.value?.chain().focus().toggleBulletList().run()
    },
    {
        id: 'ordered',
        label: 'Numbered list',
        icon: 'fas fa-list-ol',
        active: () => !!tiptap.value?.isActive('orderedList'),
        run: () => tiptap.value?.chain().focus().toggleOrderedList().run()
    },
    {
        id: 'quote',
        label: 'Blockquote',
        icon: 'fas fa-quote-right',
        active: () => !!tiptap.value?.isActive('blockquote'),
        run: () => tiptap.value?.chain().focus().toggleBlockquote().run()
    }
];

function insertToken(token: string) {
    const text = tokenDisplay(token);
    // Insert into whichever editor is showing — visual (tiptap) or code.
    if (mode.value === 'code') insertCode(text);
    else tiptap.value?.chain().focus().insertContent(text).run();
    tokenMenuOpen.value = false;
}

// Wrapped in a function so Vue's template parser doesn't see `{{` as an
// interpolation marker — routing the mustache-literal through JS avoids it.
function tokenDisplay(name: string): string {
    return `{{${name}}}`;
}

async function copyContent() {
    try {
        await navigator.clipboard.writeText(props.modelValue);
        toast.success('Copied');
    } catch {
        toast.error('Copy failed');
    }
}
</script>

<style scoped>
.rte {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    position: relative;
}

.rte__bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.rte__modes {
    display: inline-flex;
    gap: var(--space-1);
    padding: var(--space-0-5);
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
}

.rte__mode {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
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

.rte__mode:hover {
    color: var(--color-text-primary);
}

.rte__mode--active {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    box-shadow: var(--shadow-brand-ring);
}

.rte__toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    flex-wrap: wrap;
}

.rte__action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-width: var(--space-8);
    min-height: var(--space-8);
    padding: 0 var(--space-2);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}

.rte__action:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}

.rte__action--active {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    color: var(--color-primary-text);
}

.rte__action--token {
    padding: 0 var(--space-3);
    color: var(--color-primary-text);
}

.rte__sep {
    width: 1px;
    height: var(--space-5);
    background: var(--color-border-medium);
    margin: 0 var(--space-1);
}

.rte__token-menu {
    position: absolute;
    top: 3rem;
    left: 0;
    right: 0;
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

.rte__token-item {
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

.rte__token-item:hover {
    background: var(--color-surface-3);
}

.rte__token-name {
    font-weight: var(--font-medium);
}

.rte__token-code {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    background: var(--color-surface-0);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
}

.rte__surface {
    min-height: 18rem;
    display: flex;
    flex-direction: column;
}

.rte__visual {
    flex: 1;
    display: flex;
    flex-direction: column;
}

.rte__code {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 18rem;
}

.rte__code :deep(.cm-editor) {
    flex: 1;
    min-height: 18rem;
    border-radius: var(--radius-md);
}

/* TipTap content styling — matches the design-system typography. */
.rte__visual :deep(.rte__prose) {
    flex: 1;
    min-height: 18rem;
    padding: var(--space-3);
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    line-height: 1.6;
    outline: none;
    transition: border-color var(--motion-hover);
    overflow-y: auto;
}

.rte__visual :deep(.rte__prose:focus) {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px
        color-mix(in srgb, var(--color-primary) 25%, transparent);
}

.rte__visual :deep(.rte__prose p) {
    margin: 0 0 var(--space-2);
}

.rte__visual :deep(.rte__prose h1),
.rte__visual :deep(.rte__prose h2),
.rte__visual :deep(.rte__prose h3) {
    margin: var(--space-4) 0 var(--space-2);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: 1.25;
}

.rte__visual :deep(.rte__prose ul),
.rte__visual :deep(.rte__prose ol) {
    padding-left: var(--space-5);
    margin: 0 0 var(--space-2);
}

.rte__visual :deep(.rte__prose blockquote) {
    padding: var(--space-1) var(--space-4);
    margin: var(--space-3) 0;
    border-left: 3px solid var(--color-primary);
    color: var(--color-text-secondary);
    font-style: italic;
}

.rte__visual :deep(.rte__prose code) {
    font-family: var(--font-mono);
    background: var(--color-surface-2);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-status-on);
}

.rte__visual :deep(.rte__prose a) {
    color: var(--color-primary-text);
    text-decoration: underline;
}
</style>
