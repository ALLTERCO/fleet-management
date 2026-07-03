// Preview for the multi-channel template editor + the rule template picker.
import {createPinia, setActivePinia} from 'pinia';
import {createApp, defineComponent, h, ref} from 'vue';
import MultiChannelTemplateEditor, {
    type MultiChannelTemplate
} from '@/components/core/MultiChannelTemplateEditor.vue';
import TemplatePicker, {
    type TemplateSummary
} from '@/components/core/TemplatePicker.vue';
import '../styles/style.css';

const pinia = createPinia();
setActivePinia(pinia);

const SAMPLE: MultiChannelTemplate = {
    email: {
        subject: '{{rule.name}} — {{subject.name}}',
        html: '<h2>{{subject.name}} is offline</h2><p>Since {{alert.activeSince}}.</p>'
    },
    slack: {
        blocks: '[\n  {"type":"section","text":{"type":"mrkdwn","text":"*{{subject.name}}* is offline"}}\n]'
    },
    teams: {card: ''},
    fallback: {text: '{{subject.name}} is offline ({{rule.severity}}).'}
};

const TEMPLATES: TemplateSummary[] = [
    {id: 1, name: 'Device offline — standard', channels: ['email', 'slack']},
    {id: 2, name: 'Critical incident', channels: ['email', 'slack', 'teams']},
    {id: 3, name: 'Quiet info note', channels: ['email']}
];

const Root = defineComponent({
    setup() {
        const tpl = ref<MultiChannelTemplate>(SAMPLE);
        const picked = ref<number | null>(2);
        return () =>
            h('div', {style: 'max-width:900px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:28px'}, [
                h('section', [
                    h('h2', {style: 'font-size:var(--type-subheading);font-weight:700;margin:0 0 4px'}, 'Template skeleton — one template, every channel'),
                    h('p', {style: 'color:var(--color-text-tertiary);margin:0 0 16px'}, 'Email, Slack, Teams each get their own body; everything else uses the Text body.'),
                    h(MultiChannelTemplateEditor, {modelValue: tpl.value, 'onUpdate:modelValue': (v: MultiChannelTemplate) => { tpl.value = v; }})
                ]),
                h('section', [
                    h('h2', {style: 'font-size:var(--type-subheading);font-weight:700;margin:0 0 4px'}, 'Rule → template picker (Wording step)'),
                    h('p', {style: 'color:var(--color-text-tertiary);margin:0 0 16px'}, 'A rule chooses a template skeleton, or uses its own wording.'),
                    h(TemplatePicker, {modelValue: picked.value, templates: TEMPLATES, 'onUpdate:modelValue': (v: number | null) => { picked.value = v; }})
                ])
            ]);
    }
});

const app = createApp(Root);
app.directive('lazyload', {});
app.use(pinia);
app.mount('#app');
