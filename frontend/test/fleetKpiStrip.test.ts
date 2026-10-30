import {mount, type VueWrapper} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
    locationsStore: {
        locations: {
            10: {id: 10, kind: 'site', parentLocationId: null}
        },
        assignmentsByLocation: {} as Record<
            number,
            Array<{subjectType: string; subjectId: string}>
        >,
        fetchLocations: async () => {},
        fetchAssignmentsBulk: async () => ({})
    },
    devicesStore: {
        devices: {
            assigned: {
                shellyID: 'assigned',
                online: true,
                status: {'switch:0': {apower: 10}}
            },
            'unassigned-offline': {
                shellyID: 'unassigned-offline',
                online: false,
                status: {'switch:0': {apower: 20}}
            },
            'unassigned-online': {
                shellyID: 'unassigned-online',
                online: true,
                status: {'switch:0': {apower: 30}}
            }
        }
    },
    entityStore: {entities: {}},
    alertsStore: {
        instancesLoading: false,
        instances: {},
        fetchInstances: async () => {}
    }
}));

vi.mock('@/stores/locations', () => ({
    useLocationsStore: () => state.locationsStore
}));
vi.mock('@/stores/devices', () => ({
    useDevicesStore: () => state.devicesStore
}));
vi.mock('@/stores/entities', () => ({
    useEntityStore: () => state.entityStore
}));
vi.mock('@/stores/alerts', () => ({
    useAlertsStore: () => state.alertsStore
}));

import FleetKpiStrip from '@/components/cards/CardValue_FleetKPIStrip.vue';

function renderFleetKpis(
    assignmentsByLocation: Record<
        number,
        Array<{subjectType: string; subjectId: string}>
    >
): VueWrapper {
    state.locationsStore.assignmentsByLocation = assignmentsByLocation;
    return mount(FleetKpiStrip, {
        props: {config: {id: 'fleet_kpi_strip_widget'}},
        global: {
            stubs: {
                CardShell: {template: '<div><slot /></div>'},
                RouterLink: {template: '<a><slot /></a>'}
            }
        }
    });
}

function tileText(wrapper: VueWrapper, label: string): string {
    const tile = wrapper
        .findAll('.fkpi-tile')
        .find((candidate) => candidate.find('.fkpi-label').text() === label);
    if (!tile) throw new Error(`missing Fleet KPI tile: ${label}`);
    return tile.text();
}

describe('Fleet KPI strip fleet-wide scope', () => {
    it('keeps unassigned devices in the online denominator after site assignments load', () => {
        const beforeAssignments = renderFleetKpis({});
        expect(tileText(beforeAssignments, 'Online')).toContain('2/3');
        beforeAssignments.unmount();

        const afterAssignments = renderFleetKpis({
            10: [{subjectType: 'device', subjectId: 'assigned'}]
        });
        expect(tileText(afterAssignments, 'Online')).toContain('2/3');
        afterAssignments.unmount();
    });

    it('keeps fleet power independent of location assignment membership', () => {
        const wrapper = renderFleetKpis({
            10: [{subjectType: 'device', subjectId: 'assigned'}]
        });

        expect(tileText(wrapper, 'Power')).toContain('60 W');
        wrapper.unmount();
    });
});
