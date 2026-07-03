import {describe, expect, it} from 'vitest';
import {
    deriveEnergyPhaseMode,
    energyPointKey,
    energyPointLabel,
    energyRolesForUtility,
    energyTagLabel,
    optionalNumber,
    optionalString,
    toLogicalMeterPoint
} from '@/helpers/energyAssignment';
import type {EnergyMeasurementPoint} from '@api/energy';

function point(
    patch: Partial<EnergyMeasurementPoint> = {}
): EnergyMeasurementPoint {
    return {
        deviceId: 7,
        shellyID: 'shellypro3em-aabbcc',
        componentKey: 'em:0',
        channel: 0,
        phase: 'z',
        tag: 'total_act_energy',
        electricalDomain: 'ac_mains',
        source: 'both',
        hasHistory: true,
        isLiveNow: true,
        assignedMeterId: null,
        sample: null,
        ...patch
    };
}

describe('energy assignment helper', () => {
    it('uses electric source roles and resource roles per utility', () => {
        expect(energyRolesForUtility('electric').map((r) => r.role)).toEqual([
            'grid',
            'pv',
            'battery',
            'generator',
            'ev_charge',
            'load',
            'aux'
        ]);
        expect(energyRolesForUtility('water').map((r) => r.role)).toEqual([
            'supply',
            'production',
            'storage',
            'usage',
            'aux'
        ]);
    });

    it('derives phase mode from selected measurement points', () => {
        expect(
            deriveEnergyPhaseMode([
                point({phase: 'a'}),
                point({phase: 'b'}),
                point({phase: 'c'})
            ])
        ).toBe('three_phase');
        expect(deriveEnergyPhaseMode([point({phase: 'z'})])).toBe(
            'single_phase'
        );
        expect(
            deriveEnergyPhaseMode([
                point({channel: 0, phase: 'z'}),
                point({channel: 1, phase: 'z'})
            ])
        ).toBe('unknown');
    });

    it('keeps point identity and nullable componentKey when saving', () => {
        const historyOnly = point({componentKey: null, phase: 'a'});
        expect(energyPointKey(historyOnly)).toBe('7|0|a|total_act_energy');
        expect(energyPointLabel(historyOnly)).toBe('Channel 0, phase A');
        expect(energyTagLabel('volume_flow_m3h')).toBe('Flow');
        expect(toLogicalMeterPoint(historyOnly)).toEqual({
            deviceId: 7,
            componentKey: null,
            channel: 0,
            phase: 'a',
            tag: 'total_act_energy',
            electricalDomain: 'ac_mains'
        });
    });

    it('normalizes optional form fields', () => {
        expect(optionalString('  main_meter  ')).toBe('main_meter');
        expect(optionalString('   ')).toBeNull();
        expect(optionalNumber('42')).toBe(42);
        expect(optionalNumber('')).toBeNull();
        expect(optionalNumber('4.2')).toBeNull();
    });
});
