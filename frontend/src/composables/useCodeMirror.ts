import {
    autocompletion,
    type CompletionContext,
    type CompletionResult
} from '@codemirror/autocomplete';
import {defaultKeymap, indentWithTab} from '@codemirror/commands';
import {html} from '@codemirror/lang-html';
import {json} from '@codemirror/lang-json';
import {markdown} from '@codemirror/lang-markdown';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {Compartment, EditorState} from '@codemirror/state';
import {
    placeholder as cmPlaceholder,
    Decoration,
    type DecorationSet,
    EditorView,
    keymap,
    ViewPlugin,
    type ViewUpdate
} from '@codemirror/view';
import {tags} from '@lezer/highlight';
import {
    computed,
    isRef,
    onMounted,
    onUnmounted,
    type Ref,
    ref,
    watch
} from 'vue';
import type {TemplateTokenDescriptor} from '@/helpers/templateTokens';

// Dark theme matching the design-system tokens.
function darkTheme() {
    return EditorView.theme(
        {
            '&': {
                backgroundColor: 'var(--color-surface-0)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--type-body)',
                fontFamily: 'var(--font-mono)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-strong)'
            },
            '.cm-content': {
                caretColor: 'var(--color-primary)',
                padding: 'var(--space-3)'
            },
            '.cm-cursor': {
                borderLeftColor: 'var(--color-primary)'
            },
            '&.cm-focused': {
                outline: 'none',
                borderColor: 'var(--color-primary)',
                boxShadow:
                    '0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent)'
            },
            '.cm-selectionBackground': {
                backgroundColor:
                    'color-mix(in srgb, var(--color-primary) 20%, transparent) !important'
            },
            '.cm-gutters': {
                display: 'none'
            },
            '.cm-activeLine': {
                backgroundColor:
                    'color-mix(in srgb, var(--color-primary) 4%, transparent)'
            },
            '.cm-tooltip': {
                backgroundColor: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-medium)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)'
            },
            '.cm-tooltip-autocomplete ul li': {
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--type-body)',
                fontFamily: 'var(--font-mono)'
            },
            '.cm-tooltip-autocomplete ul li[aria-selected]': {
                backgroundColor:
                    'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                color: 'var(--color-primary)'
            },
            '.cm-completionLabel': {
                color: 'var(--color-text-primary)'
            },
            '.cm-completionDetail': {
                color: 'var(--color-text-tertiary)',
                fontStyle: 'normal',
                marginLeft: 'var(--space-2)'
            },
            '.cm-variable-ref': {
                backgroundColor: 'rgba(var(--ar-action), 0.12)',
                borderRadius: '3px',
                padding: '0 2px'
            }
        },
        {dark: true}
    );
}

// Shared highlight — each token tag maps to a palette role.
// Covers JSON, HTML, and Markdown with one style sheet.
function sharedHighlighting() {
    return syntaxHighlighting(
        HighlightStyle.define([
            // JSON
            {tag: tags.propertyName, color: 'var(--color-primary)'},
            {tag: tags.string, color: 'var(--color-status-on)'},
            {tag: tags.number, color: 'var(--color-accent-text)'},
            {tag: tags.bool, color: 'var(--color-warning-text)'},
            {tag: tags.null, color: 'var(--color-text-disabled)'},
            {tag: tags.punctuation, color: 'var(--color-text-tertiary)'},
            // HTML
            {tag: tags.tagName, color: 'var(--color-primary)'},
            {tag: tags.attributeName, color: 'var(--color-accent-text)'},
            {tag: tags.attributeValue, color: 'var(--color-status-on)'},
            {tag: tags.angleBracket, color: 'var(--color-text-tertiary)'},
            {
                tag: tags.comment,
                color: 'var(--color-text-disabled)',
                fontStyle: 'italic'
            },
            // Markdown
            {
                tag: tags.heading,
                color: 'var(--color-primary-text)',
                fontWeight: 'bold'
            },
            {tag: tags.strong, fontWeight: 'bold'},
            {tag: tags.emphasis, fontStyle: 'italic'},
            {
                tag: tags.link,
                color: 'var(--color-primary-text)',
                textDecoration: 'underline'
            },
            {tag: tags.monospace, color: 'var(--color-status-on)'},
            {
                tag: tags.quote,
                color: 'var(--color-text-tertiary)',
                fontStyle: 'italic'
            }
        ])
    );
}

// Two variable patterns so old callers (Automations, ${VAR}) and new
// callers (notification templates, {{token.path}}) coexist.
interface VariablePattern {
    highlight: RegExp;
    match: RegExp;
    apply: (name: string) => string;
}

const VAR_SYNTAX: Record<VariableSyntax, VariablePattern> = {
    dollar: {
        highlight: /\$\{[A-Za-z0-9_]+\}/g,
        match: /\$\{?[A-Za-z0-9_]*/,
        apply: (name) => `\${${name}}`
    },
    mustache: {
        highlight: /\{\{\s*[A-Za-z0-9_.]+\s*\}\}/g,
        match: /\{\{?\s*[A-Za-z0-9_.]*/,
        apply: (name) => `{{${name}}}`
    }
};

const varRefMark = Decoration.mark({class: 'cm-variable-ref'});

function variableHighlighter(pattern: RegExp) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
            }
            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }
            buildDecorations(view: EditorView): DecorationSet {
                const builder: ReturnType<typeof varRefMark.range>[] = [];
                const text = view.state.doc.toString();
                const regex = new RegExp(pattern.source, 'g');
                let match: RegExpExecArray | null;
                // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
                while ((match = regex.exec(text)) !== null) {
                    builder.push(
                        varRefMark.range(
                            match.index,
                            match.index + match[0].length
                        )
                    );
                }
                return Decoration.set(builder);
            }
        },
        {decorations: (v) => v.decorations}
    );
}

export type CodeMirrorLanguage = 'json' | 'html' | 'markdown' | 'plain';
export type VariableSyntax = 'dollar' | 'mustache';

interface UseCodeMirrorOptions {
    container: Ref<HTMLElement | null>;
    content: Ref<string>;
    editable?: Ref<boolean>;
    placeholder?: string;
    /** Language-specific extensions. Accepts a ref so tab-mode switches rebuild. */
    language?: CodeMirrorLanguage | Ref<CodeMirrorLanguage>;
    /** Variable-reference syntax. Default `dollar` for backwards compat. */
    variableSyntax?: VariableSyntax;
    /** Legacy key-value autocomplete (Automations). */
    variables?: Ref<Record<string, string>>;
    /** Legacy variable descriptions (Automations). */
    variableDescriptions?: Ref<Record<string, string>>;
    /** Rich token catalogue for notification templates. */
    tokens?: Ref<readonly TemplateTokenDescriptor[]>;
    onChange?: (value: string) => void;
}

export function useCodeMirror(options: UseCodeMirrorOptions) {
    const {
        container,
        content,
        editable,
        placeholder,
        language = 'json',
        variableSyntax = 'dollar',
        variables,
        variableDescriptions,
        tokens,
        onChange
    } = options;

    let view: EditorView | null = null;
    const editableCompartment = new Compartment();
    const isValid = ref(true);
    const pattern = VAR_SYNTAX[variableSyntax];
    const activeLanguage = computed<CodeMirrorLanguage>(() => {
        if (language == null) return 'json';
        return isRef(language) ? language.value : language;
    });

    function buildCompletionSource() {
        return function completionSource(
            context: CompletionContext
        ): CompletionResult | null {
            const before = context.matchBefore(pattern.match);
            if (!before) return null;

            const firstChar = before.text.charAt(0);
            const trigger = variableSyntax === 'dollar' ? '$' : '{';
            if (firstChar !== trigger) return null;

            const completions = buildCompletionList();
            if (completions.length === 0) return null;

            return {from: before.from, options: completions, filter: true};
        };
    }

    function buildCompletionList() {
        if (tokens?.value) return completionsFromTokens(tokens.value);
        if (variables?.value) {
            return completionsFromVariables(
                variables.value,
                variableDescriptions?.value ?? {}
            );
        }
        return [];
    }

    function completionsFromTokens(list: readonly TemplateTokenDescriptor[]) {
        return list.map((entry) => ({
            label: pattern.apply(entry.token),
            displayLabel: entry.label,
            detail: entry.description,
            info: `${entry.token}\n${entry.example}`,
            apply: pattern.apply(entry.token)
        }));
    }

    function completionsFromVariables(
        vars: Record<string, string>,
        descs: Record<string, string>
    ) {
        return Object.entries(vars).map(([name, value]) => {
            const desc = descs[name];
            const detail =
                desc || (value.length > 30 ? `${value.slice(0, 27)}…` : value);
            return {
                label: pattern.apply(name),
                displayLabel: name,
                detail,
                info: desc ? `${value}\n${desc}` : value,
                apply: pattern.apply(name)
            };
        });
    }

    function buildExtensions(doc: string) {
        const isEditable = editable?.value ?? true;
        const extensions = [
            darkTheme(),
            keymap.of([...defaultKeymap, indentWithTab]),
            editableCompartment.of(EditorView.editable.of(isEditable)),
            EditorView.lineWrapping,
            variableHighlighter(pattern.highlight),
            autocompletion({
                override: [buildCompletionSource()],
                activateOnTyping: true
            }),
            EditorView.updateListener.of((update) => {
                if (!update.docChanged) return;
                const text = update.state.doc.toString();
                isValid.value = validate(text);
                onChange?.(text);
            })
        ];

        const langExtension = languageExtension(activeLanguage.value);
        if (langExtension) extensions.push(langExtension, sharedHighlighting());
        if (placeholder) extensions.push(cmPlaceholder(placeholder));

        // initial validity for the supplied doc
        isValid.value = validate(doc);
        return extensions;
    }

    function languageExtension(lang: CodeMirrorLanguage) {
        if (lang === 'json') return json();
        if (lang === 'html') return html();
        if (lang === 'markdown') return markdown();
        return null;
    }

    function validate(text: string): boolean {
        if (activeLanguage.value !== 'json') return true;
        if (text.trim().length === 0) return true;
        try {
            JSON.parse(text);
            return true;
        } catch {
            return false;
        }
    }

    function createState(doc: string): EditorState {
        return EditorState.create({doc, extensions: buildExtensions(doc)});
    }

    function createView() {
        if (!container.value) return;
        destroyView();
        view = new EditorView({
            state: createState(content.value),
            parent: container.value
        });
    }

    function destroyView() {
        view?.destroy();
        view = null;
    }

    function formatJson() {
        if (!view || activeLanguage.value !== 'json') return;
        const text = view.state.doc.toString();
        try {
            const formatted = JSON.stringify(JSON.parse(text), null, 2);
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: formatted
                }
            });
            isValid.value = true;
        } catch {
            isValid.value = false;
        }
    }

    function setContent(text: string) {
        if (!view) return;
        view.dispatch({
            changes: {from: 0, to: view.state.doc.length, insert: text}
        });
        isValid.value = validate(text);
    }

    function getContent(): string {
        return view?.state.doc.toString() ?? content.value;
    }

    // Insert text at the caret (replacing any selection), then refocus.
    function insertText(text: string) {
        if (!view) return;
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
        isValid.value = validate(view.state.doc.toString());
    }

    onMounted(createView);
    onUnmounted(destroyView);

    // Rebuild on language change — switching tabs between json / html /
    // markdown / plain needs fresh language extensions.
    watch(activeLanguage, () => {
        if (!view) return;
        view.setState(createState(view.state.doc.toString()));
    });

    // Rebuild on variable/token catalogue changes so autocomplete stays fresh.
    const autocompleteDeps = [tokens, variables].filter(
        Boolean
    ) as Ref<unknown>[];
    if (autocompleteDeps.length > 0) {
        watch(
            autocompleteDeps,
            () => {
                if (!view) return;
                view.setState(createState(view.state.doc.toString()));
            },
            {deep: true}
        );
    }

    if (editable) {
        watch(editable, (value) => {
            view?.dispatch({
                effects: editableCompartment.reconfigure(
                    EditorView.editable.of(value)
                )
            });
        });
    }

    return {isValid, formatJson, setContent, getContent, insertText};
}
