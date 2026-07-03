import {describe, expect, it} from 'vitest';
import {
    buildButtonEventConfig,
    listBluButtons,
    parseButtonEventConfig
} from '@/helpers/bluButtonRule';
import type {entity} from '@/types/entities';

function bthomeDevice(
    id: number,
    name: string,
    controls: Array<{objId: number; idx: number; kind: string; label: string}>
): entity {
    return {
        name,
        id: `blu_${id}`,
        type: 'bthomedevice',
        source: 'gw',
        properties: {
            id,
            addr: 'AA:BB',
            productName: 'RC Button 4',
            modelId: 'SBRC-004CEU',
            paired: true,
            controls,
            childSensorIds: [],
            eventObjIds: []
        }
    } as unknown as entity;
}

describe('listBluButtons', () => {
    it('lists each button control, keyed by its component, excluding dimmers', () => {
        const buttons = listBluButtons([
            bthomeDevice(200, 'Remote A', [
                {objId: 58, idx: 0, kind: 'button', label: 'Button 1'},
                {objId: 58, idx: 1, kind: 'button', label: 'Button 2'},
                {objId: 60, idx: 0, kind: 'dimmer', label: 'Dimmer'}
            ])
        ]);
        expect(buttons).toHaveLength(2);
        expect(buttons[0]).toEqual({
            componentKey: 'bthomedevice:200',
            idx: 0,
            label: 'Button 1',
            deviceLabel: 'Remote A'
        });
    });

    it('ignores non-bthomedevice entities and missing controls', () => {
        const other = {
            name: 'Relay',
            id: 'switch:0',
            type: 'switch',
            source: 's',
            properties: {id: 0}
        } as unknown as entity;
        expect(listBluButtons([other])).toHaveLength(0);
    });
});

describe('buildButtonEventConfig / parseButtonEventConfig', () => {
    it('builds a device_event config targeting one button', () => {
        expect(
            buildButtonEventConfig({
                componentKey: 'bthomedevice:200',
                idx: 2,
                gesture: 'single_push'
            })
        ).toEqual({
            componentType: 'bthomedevice',
            componentKey: 'bthomedevice:200',
            event: 'single_push',
            predicate: {idx: 2}
        });
    });

    it('parses back exactly what it built (round-trip)', () => {
        const cfg = buildButtonEventConfig({
            componentKey: 'bthomedevice:201',
            idx: 1,
            gesture: 'long_push'
        });
        expect(parseButtonEventConfig(cfg)).toEqual({
            componentKey: 'bthomedevice:201',
            idx: 1,
            gesture: 'long_push'
        });
    });

    it('returns null for a non-button config', () => {
        expect(
            parseButtonEventConfig({componentType: 'em', event: 'alarm'})
        ).toBeNull();
    });
});
