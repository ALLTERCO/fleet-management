// Per-channel message bodies for an alert rule: the draft the editor binds to,
// which channels it may write, and the saved template the rule ends up on.

import type {MessageTemplate, MessageTemplateBodies} from '@api/notification';
import {
    computed,
    type ComputedRef,
    type MaybeRefOrGetter,
    type Ref,
    ref,
    toValue,
    watch
} from 'vue';
import type {MultiChannelTemplate} from '@/components/core/MultiChannelTemplateEditor.vue';
import type {TemplateSummary} from '@/components/core/TemplatePicker.vue';
import type {TemplateChannel} from '@/helpers/templateChannels';
import {type MessageTemplateDraft, useAlertsStore} from '@/stores/alerts';

// Order the editor shows its tabs in.
const CHANNEL_ORDER: TemplateChannel[] = [
    'email',
    'slack',
    'teams',
    'fallback'
];

const MISSING_FALLBACK_ERROR =
    'Add text fallback for channels without a rich body.';
const TEMPLATE_DESCRIPTION = 'Created from the alert rule builder.';
const UNNAMED_RULE = 'Alert';
// Renders the alert's own message, so an empty fallback still says something.
const DEFAULT_FALLBACK_TEXT = '{{alert.message}}';

/** A channel as this module reads it — only the body it renders matters. */
export interface BodyRenderingChannel {
    bodyKind: TemplateChannel;
}

/** What decides whether the rich draft can be saved. */
export interface RichMessageState {
    enabled: boolean;
    templateId: number | null;
    fallbackText: string;
}

/** The store calls this needs — tests pass a stub instead of Pinia. */
export interface RichMessageTemplatePort {
    readonly templates: Record<number, MessageTemplate>;
    createTemplate(
        draft: MessageTemplateDraft
    ): Promise<MessageTemplate | null>;
}

export interface UseRichMessageTemplatesOptions {
    /** Channels the rule notifies — decides which bodies are editable. */
    chosenChannels: MaybeRefOrGetter<readonly BodyRenderingChannel[]>;
    /** The plain message; seeds the fallback body when rich mode turns on. */
    plainMessage: MaybeRefOrGetter<string>;
    /** A saved template already picked for the rule, if any. */
    templateId: MaybeRefOrGetter<number | null>;
    /** Names the template created on save. */
    ruleName: MaybeRefOrGetter<string>;
    store?: RichMessageTemplatePort;
}

export interface RichMessageTemplates {
    richMessage: Ref<boolean>;
    richBodies: Ref<MultiChannelTemplate>;
    richChannel: Ref<TemplateChannel>;
    editableChannels: ComputedRef<TemplateChannel[]>;
    templateSummaries: ComputedRef<TemplateSummary[]>;
    richMessageError: ComputedRef<string>;
    reset: () => void;
    ensureTemplateId: () => Promise<number | null | undefined>;
}

/** A draft with every channel present and nothing written. */
export function emptyRichBodies(): MultiChannelTemplate {
    return {
        email: {subject: '', html: ''},
        slack: {blocks: ''},
        teams: {card: ''},
        fallback: {text: ''}
    };
}

/** Answer: the bodies worth editing. Text is always one of them — it is what
 *  every channel without a body of its own falls back to. */
export function templateChannelsFor(
    channels: readonly BodyRenderingChannel[]
): TemplateChannel[] {
    const kinds = new Set<TemplateChannel>(['fallback']);
    for (const channel of channels) {
        if (channel.bodyKind !== 'fallback') kinds.add(channel.bodyKind);
    }
    return CHANNEL_ORDER.filter((kind) => kinds.has(kind));
}

/** Answer: the bodies worth saving — written, and for a channel in play. */
export function buildRichBodies(
    draft: MultiChannelTemplate,
    editableChannels: readonly TemplateChannel[]
): MessageTemplateBodies {
    const allowed = new Set(editableChannels);
    const bodies: MessageTemplateBodies = {};
    if (
        allowed.has('email') &&
        (draft.email.subject.trim() || draft.email.html.trim())
    ) {
        // The plain-text alternative comes from the template's fallback.
        bodies.email = {
            subject: draft.email.subject,
            html: draft.email.html,
            text: ''
        };
    }
    if (allowed.has('slack') && draft.slack.blocks.trim()) {
        bodies.slack = {blocks: draft.slack.blocks};
    }
    if (allowed.has('teams') && draft.teams.card.trim()) {
        bodies.teams = {card: draft.teams.card};
    }
    return bodies;
}

/** Answer: why the rich draft cannot be saved, or '' when it can. */
export function richMessageErrorFor(state: RichMessageState): string {
    if (!state.enabled || state.templateId != null) return '';
    return state.fallbackText.trim() ? '' : MISSING_FALLBACK_ERROR;
}

/** Answer: saved templates as the picker lists them. */
export function summariseTemplates(
    templates: readonly MessageTemplate[]
): TemplateSummary[] {
    return templates.map((template) => ({
        id: template.id,
        name: template.name,
        channels: Object.keys(template.bodies)
    }));
}

function templateNameFor(ruleName: string): string {
    return `${ruleName.trim() || UNNAMED_RULE} message`;
}

export function useRichMessageTemplates(
    options: UseRichMessageTemplatesOptions
): RichMessageTemplates {
    const store = options.store ?? useAlertsStore();

    const richMessage = ref(false);
    const richBodies = ref<MultiChannelTemplate>(emptyRichBodies());
    const richChannel = ref<TemplateChannel>('fallback');

    const editableChannels = computed(() =>
        templateChannelsFor(toValue(options.chosenChannels))
    );

    const templateSummaries = computed(() =>
        summariseTemplates(Object.values(store.templates))
    );

    const richMessageError = computed(() =>
        richMessageErrorFor({
            enabled: richMessage.value,
            templateId: toValue(options.templateId),
            fallbackText: richBodies.value.fallback.text
        })
    );

    // Rich mode with an empty fallback fails its own validation, so opening it
    // carries the plain message across instead of showing an error.
    watch(richMessage, (enabled) => {
        if (!enabled) return;
        if (richBodies.value.fallback.text.trim()) return;
        richBodies.value = {
            ...richBodies.value,
            fallback: {
                text:
                    toValue(options.plainMessage).trim() ||
                    DEFAULT_FALLBACK_TEXT
            }
        };
    });

    function reset(): void {
        richMessage.value = false;
        richBodies.value = emptyRichBodies();
        richChannel.value = 'fallback';
    }

    /**
     * Save step: the template id the rule should point at. A number points at
     * that template, `undefined` means no template at all, and `null` means the
     * draft cannot be saved and the caller must stop.
     */
    async function ensureTemplateId(): Promise<number | null | undefined> {
        const chosen = toValue(options.templateId);
        if (!richMessage.value) return chosen ?? undefined;
        if (chosen != null) return chosen;
        return saveDraftAsTemplate();
    }

    async function saveDraftAsTemplate(): Promise<number | null | undefined> {
        const bodies = buildRichBodies(
            richBodies.value,
            editableChannels.value
        );
        if (Object.keys(bodies).length === 0) return undefined;
        const fallbackText = richBodies.value.fallback.text.trim();
        // null refuses the save. Rich bodies with nothing to fall back on
        // would reach a channel that cannot render them and send nothing.
        if (!fallbackText) return null;
        const created = await store.createTemplate({
            name: templateNameFor(toValue(options.ruleName)),
            description: TEMPLATE_DESCRIPTION,
            bodies,
            fallbackText
        });
        return created?.id ?? null;
    }

    return {
        richMessage,
        richBodies,
        richChannel,
        editableChannels,
        templateSummaries,
        richMessageError,
        reset,
        ensureTemplateId
    };
}
