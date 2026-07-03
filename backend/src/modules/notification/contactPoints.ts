import {readObject, readString} from './rowReaders';

export function readContactPointIds(
    contactPoints: unknown[],
    expectedType: string
): number[] {
    return contactPoints.flatMap((contactPoint) => {
        const record = readObject(contactPoint);
        const type = readString(record.type ?? record.kind);
        if (type !== expectedType) return [];
        const id = readPositiveInteger(
            record.id ??
                record.destinationGroupId ??
                record.channelId ??
                record.scheduleId
        );
        return id == null ? [] : [id];
    });
}

export function readPositiveIntegerArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        const id = readPositiveInteger(entry);
        return id == null ? [] : [id];
    });
}

export function readPositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
    return Number(value);
}
