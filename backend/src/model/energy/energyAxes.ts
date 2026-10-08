import type {
    ElectricalSource,
    EnergyBalancePosition,
    EnergyCurrentType,
    EnergyMeterConnection
} from '../../types/api/energy';

export function currentTypeForLegacySource(
    source: ElectricalSource | string | null | undefined
): EnergyCurrentType | null {
    if (source === 'ac_mains') return 'ac';
    if (source === 'dc_pv' || source === 'dc_battery' || source === 'dc_bus') {
        return 'dc';
    }
    return null;
}

export function legacyEnergySource(
    source: ElectricalSource | string | null | undefined
): string | null {
    if (source === 'dc_pv') return 'solar';
    if (source === 'dc_battery') return 'battery';
    return null;
}

export function deriveBalancePosition(
    connections: ReadonlyArray<EnergyMeterConnection>
): EnergyBalancePosition {
    const generatorSides = new Set<'input' | 'output'>();
    for (const connection of connections) {
        if (
            connection.toNode === 'generator' &&
            connection.fromNode !== 'generator'
        ) {
            generatorSides.add('input');
        }
        if (
            connection.fromNode === 'generator' &&
            connection.toNode !== 'generator'
        ) {
            generatorSides.add('output');
        }
    }
    if (generatorSides.size > 1) {
        throw new Error(
            'one logical meter cannot be both a transformation input and output'
        );
    }
    if (generatorSides.has('input')) return 'transformation_input';
    if (generatorSides.has('output')) return 'transformation_output';
    // IRES 5.45: fuel used to make heat for the same premises is final
    // consumption. In particular gas_supply -> thermal_loop stays here.
    return 'final_consumption';
}
