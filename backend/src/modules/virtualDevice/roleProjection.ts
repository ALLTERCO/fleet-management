import type {VirtualDeviceHistoryMode} from '../../types/api/virtualdevice';
import {
    applyTransform,
    type ProjectionTransform,
    parseTransform
} from './projectionTransform';

export type VirtualRoleHistorySeries =
    | 'status'
    | 'sensor_numeric'
    | 'sensor_event'
    | 'energy';

export interface VirtualRoleProjection {
    /** Leaf inside the source component used for the live value. */
    valuePath: string;
    /** Canonical retained store and field used for historical reads. */
    series: VirtualRoleHistorySeries;
    field: string;
    sensorSource?: string;
    commodity?: string;
    electricalSource?: string;
    transform: ProjectionTransform;
}

export interface RoleProjectionBinding {
    roleKey: string;
    sourceComponentKey: string;
    mode?: VirtualDeviceHistoryMode;
    unit?: string | null;
    valueType?: string | null;
    sourceSnapshot?: Record<string, unknown> | null;
    roleMetadata?: Record<string, unknown> | null;
    transformJson?: Record<string, unknown> | null;
}

/**
 * Resolve one binding to an immutable logical reading definition. New
 * bindings persist this object in role_metadata_json. The inference fallback
 * keeps pre-existing bindings readable without a destructive migration.
 */
export function resolveRoleProjection(
    binding: RoleProjectionBinding
): VirtualRoleProjection {
    const persisted = recordValue(binding.roleMetadata?.projection);
    const inferred = inferRoleProjection(binding);
    return {
        valuePath: safeField(persisted?.valuePath) ?? inferred.valuePath,
        series: safeSeries(persisted?.series) ?? inferred.series,
        field: safeField(persisted?.field) ?? inferred.field,
        ...((safeString(persisted?.sensorSource) ?? inferred.sensorSource)
            ? {
                  sensorSource:
                      safeString(persisted?.sensorSource) ??
                      inferred.sensorSource
              }
            : {}),
        ...((safeString(persisted?.commodity) ?? inferred.commodity)
            ? {
                  commodity:
                      safeString(persisted?.commodity) ?? inferred.commodity
              }
            : {}),
        ...((safeString(persisted?.electricalSource) ??
        inferred.electricalSource)
            ? {
                  electricalSource:
                      safeString(persisted?.electricalSource) ??
                      inferred.electricalSource
              }
            : {}),
        transform: projectionTransform(binding, persisted, inferred)
    };
}

export function persistedProjectionMetadata(
    binding: RoleProjectionBinding
): Record<string, unknown> {
    const projection = resolveRoleProjection(binding);
    return {
        ...(binding.roleMetadata ?? {}),
        projection: {
            valuePath: projection.valuePath,
            series: projection.series,
            field: projection.field,
            ...(projection.sensorSource
                ? {sensorSource: projection.sensorSource}
                : {}),
            ...(projection.commodity ? {commodity: projection.commodity} : {}),
            ...(projection.electricalSource
                ? {electricalSource: projection.electricalSource}
                : {}),
            transform: projection.transform
        }
    };
}

export function projectRoleScalar(
    componentStatus: unknown,
    projection: VirtualRoleProjection
): unknown {
    const raw = readPath(componentStatus, projection.valuePath);
    const transformed = applyTransform(raw, projection.transform);
    return 'skip' in transformed ? null : transformed.value;
}

/** Shape a scalar as the component contract existing frontend cards consume. */
export function shapeProjectedRoleStatus(
    entityType: string,
    scalar: unknown
): Record<string, unknown> {
    switch (entityType) {
        case 'temperature':
            return {tC: scalar};
        case 'humidity':
            return {rh: scalar};
        case 'illuminance':
            return {lux: scalar};
        case 'voltmeter':
            return {voltage: scalar};
        case 'switch':
        case 'light':
            return {output: scalar};
        case 'input':
            return {state: scalar};
        case 'cover':
            return {current_pos: scalar};
        case 'flood':
        case 'smoke':
            return {alarm: scalar};
        default:
            return {value: scalar};
    }
}

function inferRoleProjection(
    binding: RoleProjectionBinding
): Omit<VirtualRoleProjection, 'transform'> {
    const componentType = binding.sourceComponentKey.split(':')[0] ?? '';
    const role = binding.roleKey.toLowerCase();
    const objName =
        safeString(binding.roleMetadata?.objName) ??
        safeString(binding.sourceSnapshot?.objName);
    const semanticRole =
        safeString(binding.roleMetadata?.historyField) ??
        safeString(binding.roleMetadata?.metric) ??
        safeString(binding.roleMetadata?.tag) ??
        safeString(binding.roleMetadata?.componentType) ??
        objName ??
        role;
    const explicitSeries = safeSeries(binding.roleMetadata?.historySeries);
    const explicitField = safeField(
        binding.roleMetadata?.historyField ?? binding.roleMetadata?.metric
    );
    const explicitValuePath = safeField(
        binding.roleMetadata?.valuePath ?? binding.roleMetadata?.sourceField
    );
    if (explicitSeries && explicitField && explicitValuePath) {
        return {
            valuePath: explicitValuePath,
            series: explicitSeries,
            field: explicitField,
            ...(safeString(binding.roleMetadata?.sensorSource)
                ? {
                      sensorSource: safeString(
                          binding.roleMetadata?.sensorSource
                      )!
                  }
                : {}),
            ...(safeString(binding.roleMetadata?.commodity)
                ? {commodity: safeString(binding.roleMetadata?.commodity)!}
                : {}),
            ...(safeString(binding.roleMetadata?.electricalSource)
                ? {
                      electricalSource: safeString(
                          binding.roleMetadata?.electricalSource
                      )!
                  }
                : {})
        };
    }

    if (componentType === 'em' || componentType === 'em1') {
        const energy = energyFieldForRole(semanticRole, binding.unit);
        return {
            valuePath: liveEmEnergyPath(energy),
            series: 'energy',
            field: energy,
            commodity: 'electricity'
        };
    }
    if (componentType === 'emdata' || componentType === 'em1data') {
        const energy = counterFieldForRole(semanticRole);
        return {
            valuePath: energy,
            series: 'energy',
            field: energy,
            commodity: 'electricity'
        };
    }
    if (componentType === 'currentmonitor') {
        return {
            valuePath: 'current',
            series: 'energy',
            field: 'current',
            commodity: 'electricity'
        };
    }
    if (componentType === 'temperature') {
        return sensorNumeric('tC', 'temperature');
    }
    if (componentType === 'humidity') {
        return sensorNumeric('rh', 'humidity');
    }
    if (componentType === 'illuminance') {
        return sensorNumeric('lux', 'illuminance');
    }
    if (componentType === 'voltmeter') {
        return {
            valuePath: 'voltage',
            series: 'energy',
            field: 'voltage',
            commodity: 'electricity'
        };
    }
    if (componentType === 'bthomesensor') {
        const kind = objName ?? role;
        if (isEnergyRole(kind.toLowerCase(), binding.unit)) {
            const energy = energyFieldForRole(kind.toLowerCase(), binding.unit);
            return {
                valuePath: 'value',
                series: 'energy',
                field: energy,
                commodity: 'electricity'
            };
        }
        return binding.valueType === 'event' || isEventKind(kind)
            ? {valuePath: 'value', series: 'sensor_event', field: kind}
            : sensorNumeric('value', kind);
    }
    if (componentType === 'input') {
        return {valuePath: 'state', series: 'sensor_event', field: role};
    }
    if (componentType === 'presencezone') {
        return {valuePath: 'value', series: 'status', field: 'value'};
    }
    if (componentType === 'smoke' || componentType === 'flood') {
        return {
            valuePath: 'alarm',
            series: 'sensor_event',
            field: componentType
        };
    }
    if (SINGLE_PHASE_ENERGY_COMPONENTS.has(componentType)) {
        const energy = energyFieldForRole(semanticRole, binding.unit);
        if (
            componentType !== 'switch' &&
            componentType !== 'light' &&
            componentType !== 'cover' &&
            componentType !== 'rgb' &&
            componentType !== 'rgbw' &&
            componentType !== 'cct' &&
            componentType !== 'rgbcct'
        ) {
            return {
                valuePath: liveSinglePhaseEnergyPath(energy),
                series: 'energy',
                field: energy,
                commodity: 'electricity'
            };
        }
        if (isEnergyRole(role, binding.unit)) {
            return {
                valuePath: liveSinglePhaseEnergyPath(energy),
                series: 'energy',
                field: energy,
                commodity: 'electricity'
            };
        }
        return {valuePath: 'output', series: 'status', field: 'output'};
    }
    if (componentType === 'number') {
        return {valuePath: 'value', series: 'status', field: 'value'};
    }
    if (componentType === 'boolean') {
        return {valuePath: 'value', series: 'status', field: 'value'};
    }
    return {
        valuePath: defaultValuePath(binding.valueType),
        series: 'status',
        field: defaultValuePath(binding.valueType)
    };
}

function projectionTransform(
    binding: RoleProjectionBinding,
    persisted: Record<string, unknown> | null,
    inferred: Omit<VirtualRoleProjection, 'transform'>
): ProjectionTransform {
    const explicit = recordValue(persisted?.transform) ?? binding.transformJson;
    if (explicit && Object.keys(explicit).length > 0) {
        return parseTransform(explicit);
    }
    if (
        inferred.series === 'energy' &&
        (inferred.field === 'total_act_energy' ||
            inferred.field === 'total_act_ret_energy') &&
        binding.unit?.toLowerCase() === 'kwh' &&
        !binding.sourceComponentKey.startsWith('bthome')
    ) {
        return {kind: 'scale', factor: 0.001};
    }
    return {kind: 'none'};
}

function energyFieldForRole(role: string, unit?: string | null): string {
    const normalizedUnit = unit?.trim().toLowerCase();
    if (normalizedUnit === 'w' || normalizedUnit === 'kw') return 'power';
    if (normalizedUnit === 'va' || normalizedUnit === 'kva') {
        return 'apparent_power';
    }
    if (normalizedUnit === 'v') return 'voltage';
    if (normalizedUnit === 'a') return 'current';
    if (normalizedUnit === 'hz') return 'frequency';
    if (normalizedUnit === 'kwh' || normalizedUnit === 'wh') {
        return role.includes('returned') || role.includes('export')
            ? 'total_act_ret_energy'
            : 'total_act_energy';
    }
    if (role.includes('voltage')) return 'voltage';
    if (role.includes('current')) return 'current';
    if (role.includes('apparent')) return 'apparent_power';
    if (role.includes('frequency')) return 'frequency';
    if (role.includes('power_factor')) return 'power_factor';
    if (role.includes('returned') || role.includes('export')) {
        return 'total_act_ret_energy';
    }
    if (role.includes('energy') || role.includes('consumption')) {
        return 'total_act_energy';
    }
    return 'power';
}

function liveEmEnergyPath(field: string): string {
    if (field === 'power') return 'act_power';
    if (field === 'apparent_power') return 'aprt_power';
    if (field === 'power_factor') return 'pf';
    if (field === 'frequency') return 'freq';
    if (field === 'total_act_energy') return 'total_act_energy';
    if (field === 'total_act_ret_energy') return 'total_act_ret_energy';
    return field;
}

function liveSinglePhaseEnergyPath(field: string): string {
    if (field === 'power') return 'apower';
    if (field === 'apparent_power') return 'aprtpower';
    if (field === 'power_factor') return 'pf';
    if (field === 'frequency') return 'freq';
    if (field === 'total_act_ret_energy') return 'ret_aenergy.total';
    if (field === 'total_act_energy') return 'aenergy.total';
    return field;
}

function counterFieldForRole(role: string): string {
    return role.includes('returned') || role.includes('export')
        ? 'total_act_ret_energy'
        : 'total_act_energy';
}

function sensorNumeric(
    valuePath: string,
    field: string
): Omit<VirtualRoleProjection, 'transform'> {
    return {valuePath, series: 'sensor_numeric', field};
}

function defaultValuePath(valueType: string | null | undefined): string {
    return valueType === 'boolean' ? 'state' : 'value';
}

function isEnergyRole(role: string, unit?: string | null): boolean {
    const normalizedUnit = unit?.trim().toLowerCase();
    if (
        ['w', 'kw', 'va', 'kva', 'v', 'a', 'hz', 'wh', 'kwh'].includes(
            normalizedUnit ?? ''
        )
    ) {
        return true;
    }
    return [
        'power',
        'energy',
        'consumption',
        'voltage',
        'current',
        'frequency',
        'power_factor',
        'returned',
        'export'
    ].some((semantic) => role.includes(semantic));
}

const SINGLE_PHASE_ENERGY_COMPONENTS = new Set([
    'switch',
    'light',
    'cover',
    'rgb',
    'rgbw',
    'cct',
    'rgbcct',
    'pm1'
]);

function isEventKind(kind: string): boolean {
    return [
        'button',
        'contact',
        'door',
        'flood',
        'motion',
        'occupancy',
        'presence',
        'smoke',
        'tamper',
        'window'
    ].includes(kind);
}

function readPath(value: unknown, path: string): unknown {
    if (!path) return value;
    let current = value;
    for (const part of path.split('.')) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            return null;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current === undefined ? null : current;
}

function safeSeries(value: unknown): VirtualRoleHistorySeries | null {
    return value === 'status' ||
        value === 'sensor_numeric' ||
        value === 'sensor_event' ||
        value === 'energy'
        ? value
        : null;
}

function safeField(value: unknown): string | null {
    const field = safeString(value);
    return field && /^[a-zA-Z][\w:.-]*$/.test(field) ? field : null;
}

function safeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}
