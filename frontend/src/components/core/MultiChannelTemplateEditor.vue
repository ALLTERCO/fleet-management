<template>
    <div class="mcte">
        <!-- Pick which channel's body you're editing. -->
        <ViewToggle v-model="channel" :options="channelOptions" class="mcte__tabs" />

        <!-- Email carries a subject line; show it as its own text box. -->
        <div v-if="channel === 'email'" class="mcte__field">
            <label class="mcte__label" :for="subjectId">Subject</label>
            <Input
                :id="subjectId"
                v-model="emailSubject"
                placeholder="{{rule.name}} — {{subject.name}}"
            />
        </div>

        <IntegrationTemplateEditor
            :key="channel"
            v-model="activeBodies"
            :fields="activeFields"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, useId, watch} from 'vue';
import Input from '@/components/core/Input.vue';
import IntegrationTemplateEditor, {
    type TemplateField
} from '@/components/core/IntegrationTemplateEditor.vue';
import ViewToggle, {
    type ViewToggleOption
} from '@/components/core/ViewToggle.vue';

export type TemplateChannel = 'email' | 'slack' | 'teams' | 'fallback';

export interface MultiChannelTemplate {
    email: {subject: string; html: string};
    slack: {blocks: string};
    teams: {card: string};
    fallback: {text: string};
}

const model = defineModel<MultiChannelTemplate>({required: true});

const props = defineProps<{
    channels?: TemplateChannel[];
}>();

const channel = defineModel<TemplateChannel>('channel', {default: 'email'});

const ALL_CHANNEL_OPTIONS: ViewToggleOption<TemplateChannel>[] = [
    {value: 'email', label: 'Email'},
    {value: 'slack', label: 'Slack'},
    {value: 'teams', label: 'Teams'},
    {value: 'fallback', label: 'Text'}
];

const channelOptions = computed<ViewToggleOption<TemplateChannel>[]>(() => {
    const allowed = new Set(props.channels ?? ALL_CHANNEL_OPTIONS.map((o) => o.value));
    return ALL_CHANNEL_OPTIONS.filter((o) => allowed.has(o.value));
});

watch(
    channelOptions,
    (options) => {
        if (options.length === 0) return;
        if (!options.some((o) => o.value === channel.value)) {
            channel.value = options[0].value;
        }
    },
    {immediate: true}
);

// Each channel exposes its own fields + editor mode. Email's subject is
// edited as a plain text box above (see template), so the body editor only
// carries the HTML body.
const FIELDS: Record<TemplateChannel, TemplateField[]> = {
    email: [{key: 'html', label: 'HTML body', mode: 'html'}],
    slack: [{key: 'blocks', label: 'Block Kit JSON', mode: 'json'}],
    teams: [{key: 'card', label: 'Adaptive Card JSON', mode: 'json'}],
    fallback: [{key: 'text', label: 'Text', mode: 'plain'}]
};

const activeFields = computed(() => FIELDS[channel.value] ?? FIELDS.fallback);

const subjectId = useId();
const emailSubject = computed<string>({
    get: () => model.value.email.subject,
    set: (next) => {
        model.value = {
            ...model.value,
            email: {...model.value.email, subject: next}
        };
    }
});

const activeBodies = computed<Record<string, unknown>>({
    get: () => model.value[channel.value] as unknown as Record<string, unknown>,
    set: (next) => {
        model.value = {...model.value, [channel.value]: next};
    }
});
</script>

<style scoped>
.mcte {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.mcte__tabs {
    align-self: flex-start;
}
.mcte__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.mcte__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
</style>
