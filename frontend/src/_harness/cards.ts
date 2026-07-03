// Standalone preview for the alert-rule card (verifies the on/off toggle,
// severity icon, footer states). Not part of the app build.
import {createPinia, setActivePinia} from 'pinia';
import {createApp, defineComponent, h, ref} from 'vue';
import AlertRuleCard from '@/components/cards/AlertRuleCard.vue';
import '../styles/style.css';

const pinia = createPinia();
setActivePinia(pinia);

const rule = (over: Record<string, unknown>) =>
    ({
        id: 1,
        organizationId: 'o',
        name: 'Battery low',
        kind: 'battery_below',
        enabled: true,
        severity: 'critical',
        scope: {},
        dedupeWindowSec: 0,
        cooldownSec: 0,
        destinationGroupIds: [],
        deliveryMode: 'instant',
        digestWindowMinutes: null,
        ownerUserId: null,
        summaryTemplate: null,
        messageTemplate: null,
        autoResolve: false,
        config: {},
        groupBy: null,
        runbookUrl: null,
        createdAt: '',
        updatedAt: null,
        ...over
    }) as never;

const SAMPLES = [
    {
        rule: rule({
            name: 'Battery low',
            severity: 'critical',
            kind: 'battery_below'
        }),
        firingCount: 3
    },
    {
        rule: rule({
            name: 'Power overload on the main feed',
            severity: 'warning',
            kind: 'component_threshold',
            enabled: true
        }),
        firingCount: 0
    },
    {
        rule: rule({
            name: 'Offline check on rooftop gateways',
            severity: 'critical',
            kind: 'device_offline',
            enabled: false
        }),
        firingCount: 0
    },
    {
        rule: rule({
            name: 'Firmware update available',
            severity: 'info',
            kind: 'firmware_operation_failed'
        }),
        firingCount: 1
    }
];

const Root = defineComponent({
    setup() {
        const items = ref(SAMPLES.map((s) => ({...s})));
        return () =>
            h('div', {style: 'padding:24px'}, [
                h(
                    'div',
                    {class: 'dc-grid'},
                    items.value.map((s, i) =>
                        h(AlertRuleCard, {
                            key: i,
                            rule: s.rule,
                            firingCount: s.firingCount,
                            onToggle: () => {
                                const r = s.rule as {enabled: boolean};
                                r.enabled = !r.enabled;
                            }
                        })
                    )
                )
            ]);
    }
});

const app = createApp(Root);
app.directive('lazyload', {});
app.use(pinia);
app.mount('#app');
