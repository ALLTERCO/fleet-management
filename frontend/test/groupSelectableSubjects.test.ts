import {describe, expect, it} from 'vitest';
import {buildGroupSelectableSubjects} from '@/helpers/groupSelectableSubjects';
import type {entity_t, shelly_device_t} from '@/types';

function device(shellyID: string): shelly_device_t {
    return {
        id: 1,
        shellyID,
        online: true,
        sleeping: false,
        selected: false,
        info: {name: `Device ${shellyID}`},
        settings: {},
        status: {},
        entities: []
    } as shelly_device_t;
}

function bthomeEntity(id: string): entity_t {
    return {
        id,
        type: 'bthomedevice',
        name: 'BLU Button',
        source: 'gateway-1',
        status: {},
        properties: {
            id: 1,
            addr: 'AA:BB',
            productName: 'Shelly BLU Button',
            modelId: 'SBBT-002C',
            paired: true,
            controls: [],
            childSensorIds: [],
            eventObjIds: []
        }
    } as entity_t;
}

describe('group selectable subjects', () => {
    it('exposes physical devices and BTHome device entities as group members', () => {
        const subjects = buildGroupSelectableSubjects({
            devices: [device('shelly-1')],
            entities: [bthomeEntity('bthomedevice:1')],
            deviceName: (dev) => dev.info.name
        });

        expect(subjects.map((subject) => subject.ref)).toEqual([
            {subjectType: 'device', subjectId: 'shelly-1'},
            {subjectType: 'entity', subjectId: 'bthomedevice:1'}
        ]);
    });
});
