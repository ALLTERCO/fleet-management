<template>
    <Modal :visible="visible" wide tall @close="emit('close')">
        <template #title>
            <ModalHeader
                title="Preview"
                description="How this template looks once the variables are filled in"
            />
        </template>

        <div class="tpv">
            <ViewToggle v-model="channel" :options="TEMPLATE_CHANNEL_OPTIONS" />

            <div v-if="subject" class="tpv__field">
                <span class="tpv__label">Subject</span>
                <div class="tpv__subject">{{ subject }}</div>
            </div>

            <p v-if="loading" class="tpv__empty">Rendering…</p>

            <template v-else>
                <p v-if="missingTokens.length > 0" class="tpv__warn">
                    <i class="fas fa-circle-exclamation" aria-hidden="true" />
                    {{ missingTokens.length }} unknown
                    {{ missingTokens.length === 1 ? 'variable' : 'variables' }}:
                    {{ missingTokens.join(', ') }}
                </p>

                <p v-if="!hasBody" class="tpv__empty">
                    Nothing written for this channel yet.
                </p>

                <!-- Email is markup the mail client renders. Sandboxed with no
                     permissions: shows the layout, runs none of its script. -->
                <iframe
                    v-else-if="mode === 'html'"
                    class="tpv__frame"
                    sandbox=""
                    :srcdoc="rendered"
                    title="Email preview"
                />
                <!-- Slack and Teams take a JSON payload; draw it the way the
                     destination app will, and fall back to the raw payload when
                     it does not parse so a half-written body still shows. -->
                <SlackBlocksPreview
                    v-else-if="channel === 'slack' && parsed"
                    :payload="parsed"
                />
                <TeamsCardPreview
                    v-else-if="channel === 'teams' && parsed"
                    :payload="parsed"
                />
                <pre v-else-if="mode === 'json'" class="tpv__text">{{ pretty }}</pre>
                <pre v-else class="tpv__text">{{ rendered }}</pre>
            </template>
        </div>

        <template #footer>
            <div class="tpv__foot">
                <Button type="blue-hollow" @click="emit('close')">Close</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import SlackBlocksPreview from '@/components/core/SlackBlocksPreview.vue';
import TeamsCardPreview from '@/components/core/TeamsCardPreview.vue';
import ViewToggle from '@/components/core/ViewToggle.vue';
import Modal from '@/components/modals/Modal.vue';
import type {MultiChannelTemplate} from '@/components/core/MultiChannelTemplateEditor.vue';
import {
    TEMPLATE_CHANNEL_BODY_KEY,
    TEMPLATE_CHANNEL_OPTIONS,
    TEMPLATE_CHANNEL_PREVIEW_MODE,
    type TemplateChannel
} from '@/helpers/templateChannels';
import {useNotificationsStore} from '@/stores/notifications';

const props = defineProps<{
    visible: boolean;
    /** Per-channel template bodies, as edited by MultiChannelTemplateEditor. */
    bodies: MultiChannelTemplate;
    ruleKind?: string;
    ruleName?: string;
}>();

const emit = defineEmits<{close: []}>();

const notificationsStore = useNotificationsStore();
const channel = ref<TemplateChannel>('email');
const rendered = ref('');
const subject = ref('');
const missingTokens = ref<string[]>([]);
const loading = ref(false);

const mode = computed(() => TEMPLATE_CHANNEL_PREVIEW_MODE[channel.value]);
const hasBody = computed(() => rawBody.value.trim().length > 0);

/** The written template for this channel, before rendering. */
const rawBody = computed(() => readString(TEMPLATE_CHANNEL_BODY_KEY[channel.value]));

function readString(key: string): string {
    const section = props.bodies?.[channel.value] as
        | Record<string, unknown>
        | undefined;
    const value = section?.[key];
    return typeof value === 'string' ? value : '';
}

/** Parsed payload for the visual renderers; null while the body is invalid. */
const parsed = computed<unknown | null>(() => {
    if (mode.value !== 'json') return null;
    try {
        return JSON.parse(rendered.value);
    } catch {
        return null;
    }
});

// JSON reads far better indented. A body still being written may not parse, so
// fall back to the raw string rather than hiding it behind an error.
const pretty = computed(() => {
    try {
        return JSON.stringify(JSON.parse(rendered.value), null, 2);
    } catch {
        return rendered.value;
    }
});

// Rendering is the backend's job — the same RenderTemplate call the delivery
// path uses, so this shows what will actually be sent.
async function renderOne(template: string): Promise<string> {
    if (!template.trim()) return '';
    const result = await notificationsStore.renderTemplate({
        template,
        ruleKind: props.ruleKind,
        ruleName: props.ruleName
    });
    missingTokens.value = result?.missingTokens ?? [];
    return result?.rendered ?? '';
}

async function refresh(): Promise<void> {
    loading.value = true;
    missingTokens.value = [];
    try {
        rendered.value = await renderOne(rawBody.value);
        subject.value =
            channel.value === 'email'
                ? await renderOne(readString('subject'))
                : '';
    } finally {
        loading.value = false;
    }
}

watch(
    () => [props.visible, channel.value] as const,
    ([open]) => {
        if (open) void refresh();
    },
    {immediate: true}
);
</script>

<style scoped>
.tpv {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.tpv__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.tpv__label {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tpv__subject {
    font-weight: var(--font-weight-medium);
}
.tpv__warn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--glass-input);
    color: var(--color-warning-text);
    font-size: var(--type-caption);
}
.tpv__frame {
    width: 100%;
    min-height: 360px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background: #fff;
}
.tpv__text {
    margin: 0;
    padding: var(--space-3);
    background: var(--glass-input);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
}
.tpv__empty {
    margin: 0;
    color: var(--color-text-secondary);
}
.tpv__foot {
    display: flex;
    justify-content: flex-end;
    width: 100%;
}
</style>
