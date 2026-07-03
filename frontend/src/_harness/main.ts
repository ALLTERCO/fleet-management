// Standalone preview harness — mounts the REAL "New alert" modal with the
// kind catalog seeded and every network call stubbed, so the modal renders
// 1:1 and is fully interactive without a backend. Not part of the app build.
import {createPinia, setActivePinia} from 'pinia';
import {createApp, defineComponent, h, ref} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import EditAlertRuleModal from '@/components/modals/EditAlertRuleModal.vue';
import {listAllRuleKinds} from '@/helpers/ruleKinds';
import {useAlertsStore} from '@/stores/alerts';
import {useDestinationsStore} from '@/stores/destinations';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import '../styles/style.css';

const pinia = createPinia();
setActivePinia(pinia);

const noop = async () => undefined;

// Seed the kind catalog so steps 2/3 are reachable after a pick.
const alerts = useAlertsStore();
alerts.kinds = listAllRuleKinds().map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description ?? '',
    configSchema: {type: 'object', properties: {}},
    supportedScopeTypes: ['device', 'group', 'location', 'tag']
})) as never;

// Neutralize every network action the modal subtree calls.
Object.assign(alerts, {
    fetchKinds: async () => alerts.kinds,
    fetchRules: noop,
    fetchInstances: noop,
    fetchTemplates: noop,
    checkDuplicate: async () => null
});
(alerts as never as {templates: unknown}).templates = {
    1: {
        id: 1,
        name: 'Critical incident',
        description: null,
        bodies: {email: {subject: '', html: '', text: ''}, slack: {blocks: ''}},
        fallbackText: 'x',
        createdAt: '',
        updatedAt: null
    },
    2: {
        id: 2,
        name: 'Quiet info note',
        description: null,
        bodies: {email: {subject: '', html: '', text: ''}},
        fallbackText: 'x',
        createdAt: '',
        updatedAt: null
    }
};
Object.assign(useDestinationsStore(), {fetchDestinations: noop});
(useDestinationsStore() as never as {destinations: unknown}).destinations = {
    1: {id: 1, name: 'Critical Pager', enabled: true, counts: {members: 3}},
    2: {id: 2, name: 'Ops Email', enabled: true, counts: {members: 8}},
    3: {id: 3, name: 'Slack #alerts', enabled: false, counts: {members: 0}}
};
Object.assign(useDevicesStore(), {fetchDevices: noop});
Object.assign(useGroupsStore(), {fetchGroups: noop});
Object.assign(useLocationsStore(), {fetchLocations: noop});
Object.assign(useTagsStore(), {fetchTags: noop});

// Seed a little scope data so the Where step shows real rows.
const DEVICE_NAMES = [
    'Front door sensor',
    'Warehouse freezer',
    'Office thermostat',
    'Loading bay light',
    'Rooftop gateway',
    'Server room meter'
];
const devices: Record<string, unknown> = {};
DEVICE_NAMES.forEach((name, i) => {
    const id = `shelly-${i}`;
    devices[id] = {
        shellyID: id,
        online: true,
        info: {name, model: 'SNSW-001X16EU'},
        status: {}
    };
});
(useDevicesStore() as never as {devices: unknown}).devices = devices;
const grp = (id: number, name: string) => ({
    id,
    name,
    devices: [],
    kind: null,
    parentGroupId: null,
    metadata: {}
});
(useGroupsStore() as never as {groups: unknown}).groups = {
    1: grp(1, 'Cold storage'),
    2: grp(2, 'North warehouse'),
    3: grp(3, 'Office floor')
};
const loc = (id: number, name: string) => ({
    id,
    name,
    devices: [],
    deviceIds: [],
    children: [],
    metadata: {}
});
(useLocationsStore() as never as {locations: unknown}).locations = {
    1: loc(1, 'Berlin DC'),
    2: loc(2, 'Munich hub')
};
const tag = (id: number, name: string) => ({
    id,
    name,
    key: name,
    color: '#7aa8c0',
    devices: [],
    deviceIds: [],
    metadata: {}
});
(useTagsStore() as never as {tags: unknown}).tags = {
    1: tag(1, 'critical'),
    2: tag(2, 'outdoor')
};

const Root = defineComponent({
    setup() {
        const open = ref(true);
        return () =>
            h(
                'div',
                {
                    style: 'min-height:100vh;padding:20px;display:flex;flex-direction:column;gap:16px'
                },
                [
                    h(
                        'button',
                        {
                            onClick: () => {
                                open.value = true;
                            },
                            style: 'align-self:flex-start;padding:9px 16px;border-radius:8px;border:1px solid var(--color-primary);background:var(--color-primary);color:#fff;font-weight:600;cursor:pointer'
                        },
                        'Open "New alert" modal'
                    ),
                    h(EditAlertRuleModal, {
                        modelValue: open.value,
                        'onUpdate:modelValue': (v: boolean) => {
                            open.value = v;
                        },
                        mode: 'create'
                    })
                ]
            );
    }
});

const app = createApp(Root);
app.directive('lazyload', {});
app.use(pinia);
app.use(
    createRouter({
        history: createMemoryHistory(),
        routes: [{path: '/:catchAll(.*)*', component: {render: () => null}}]
    })
);
app.mount('#app');
