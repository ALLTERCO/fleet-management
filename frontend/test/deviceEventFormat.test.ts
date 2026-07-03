import {describe, expect, it} from 'vitest';
import {
    changeColor,
    componentLabel,
    type DeviceChange,
    rawChange,
    splitComponent,
    summarizeChange
} from '@/tools/deviceEventFormat';

function change(over: Partial<DeviceChange>): DeviceChange {
    return {
        component: 'switch:0',
        field: 'output',
        prev: false,
        next: true,
        kind: 'state_change',
        source: 'device',
        ...over
    };
}

describe('splitComponent / componentLabel', () => {
    it('splits a keyed component', () => {
        expect(splitComponent('switch:0')).toEqual({
            type: 'switch',
            index: '0'
        });
        expect(componentLabel('switch:0')).toBe('Switch 0');
    });
    it('handles a singleton component', () => {
        expect(splitComponent('wifi')).toEqual({type: 'wifi'});
        expect(componentLabel('wifi')).toBe('Wifi');
    });
});

describe('summarizeChange', () => {
    it('reads boolean output as ON/OFF', () => {
        expect(summarizeChange(change({next: true}))).toBe(
            'Switch 0 turned ON'
        );
        expect(summarizeChange(change({prev: true, next: false}))).toBe(
            'Switch 0 turned OFF'
        );
    });
    it('renders numeric fields as prev to next', () => {
        expect(
            summarizeChange(
                change({
                    component: 'temperature:0',
                    field: 'tC',
                    prev: 20,
                    next: 21
                })
            )
        ).toBe('Temperature 0 tC: 20 → 21');
    });
    it('falls back to raw for an unknown dotless path', () => {
        const c = change({component: 'sys', field: '', prev: 1, next: 2});
        expect(summarizeChange(c)).toContain('sys: 1 → 2');
    });
    it('renders a device event as a point-in-time arrow', () => {
        const c = change({
            component: 'input:0',
            field: 'single_push',
            prev: null,
            next: null,
            kind: 'event'
        });
        expect(summarizeChange(c)).toBe('Input 0 → single_push');
    });
});

describe('rawChange', () => {
    it('always shows the unparsed truth', () => {
        expect(rawChange(change({prev: false, next: true}))).toBe(
            'switch:0.output: false → true'
        );
    });
    it('marks null/undefined explicitly', () => {
        expect(rawChange(change({prev: null, next: 5}))).toBe(
            'switch:0.output: ∅ → 5'
        );
    });
});

describe('changeColor', () => {
    it('is stable per component type', () => {
        expect(changeColor('switch:0')).toBe(changeColor('switch:1'));
        expect(changeColor('unknowntype:0')).toBe(changeColor('unknowntype:9'));
    });
});
