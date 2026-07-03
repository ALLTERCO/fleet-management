// Targeting a BLU sensor for a component_state rule WITHOUT promotion: the rule
// uses component "component:<id>" + field "value".

import {describe, expect, it} from 'vitest';
import {
    bluSensorStateConfig,
    listBluSensorTargets
} from '@/helpers/componentStateTargets';
import type {entity_t} from '@/types/entities';

function entity(
    id: string,
    type: string,
    source: string,
    name: string,
    addr?: string
): entity_t {
    return {id, type, source, name, properties: {addr}} as entity_t;
}

const ENTITIES: entity_t[] = [
    entity('e-door', 'bthomesensor', 'gw-1', 'Front Door'),
    entity('e-window', 'bthomesensor', 'gw-1', 'Kitchen Window'),
    entity('sw-1', 'switch', 'dev-2', 'Relay 0')
];

describe('listBluSensorTargets', () => {
    it('returns only the BLU (bthomesensor) entities, with their gateway source', () => {
        expect(listBluSensorTargets(ENTITIES)).toEqual([
            {entityId: 'e-door', source: 'gw-1', label: 'Front Door'},
            {entityId: 'e-window', source: 'gw-1', label: 'Kitchen Window'}
        ]);
    });

    it('falls back to the id when the entity has no name', () => {
        const [t] = listBluSensorTargets([
            entity('e-x', 'bthomesensor', 'gw-9', '')
        ]);
        expect(t.label).toBe('e-x');
    });

    it('drops sensors already promoted to a device (matched by MAC)', () => {
        const entities = [
            entity('e-door', 'bthomesensor', 'gw-1', 'Front Door', 'AA:BB:CC:DD:EE:01'),
            entity('e-window', 'bthomesensor', 'gw-1', 'Kitchen Window', 'AA:BB:CC:DD:EE:02')
        ];
        // e-door's MAC is promoted; only the un-promoted window sensor remains.
        const promotedMacs = new Set(['aabbccddee01']);
        expect(listBluSensorTargets(entities, promotedMacs)).toEqual([
            {entityId: 'e-window', source: 'gw-1', label: 'Kitchen Window'}
        ]);
    });

    it('keeps every sensor when no MACs are promoted', () => {
        expect(listBluSensorTargets(ENTITIES, new Set())).toHaveLength(2);
    });
});

describe('bluSensorStateConfig', () => {
    it('builds a component_state config on the component:<id> path', () => {
        expect(bluSensorStateConfig('e-door', true)).toEqual({
            component: 'component:e-door',
            field: 'value',
            equals: true
        });
        expect(bluSensorStateConfig('e-door', false)).toEqual({
            component: 'component:e-door',
            field: 'value',
            equals: false
        });
    });
});
