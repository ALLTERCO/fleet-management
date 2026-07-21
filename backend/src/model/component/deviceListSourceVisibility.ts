import type {ShellyDeviceExternal} from '../../types';

export function hideExtractedSourceComponents(
    row: ShellyDeviceExternal,
    hiddenKeys: Set<string> | undefined
): ShellyDeviceExternal {
    if (!hiddenKeys || hiddenKeys.size === 0) return row;

    const status = {...row.status};
    const settings = {...row.settings};
    for (const key of hiddenKeys) {
        delete status[key];
        delete settings[key];
    }

    if (!Array.isArray(row.entities)) return {...row, status, settings};
    const hiddenEntityIds = new Set(
        [...hiddenKeys].map((key) => sourceKeyToEntityId(row, key))
    );
    return {
        ...row,
        status,
        settings,
        entities: row.entities.filter(
            (entityId) =>
                typeof entityId !== 'string' || !hiddenEntityIds.has(entityId)
        )
    };
}

function sourceKeyToEntityId(row: ShellyDeviceExternal, key: string): string {
    const [type, id] = key.split(':');
    if (type === 'service') return `${row.shellyID}_${id}:service`;
    return `${row.id}_${id}:${type}`;
}
