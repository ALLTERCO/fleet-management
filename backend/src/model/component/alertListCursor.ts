// Opaque keyset cursor for the alert list: the last row's change time (with
// microseconds, as the database wrote it), its id, and a mark of the filters
// that made the page. base64url so a caller keeps it as a token and never
// builds one. The mark stops a cursor from one filter set walking another.
import {createHash} from 'node:crypto';
import RpcError from '../../rpc/RpcError';

export interface AlertListPosition {
    triggeredAt: string;
    id: number;
}

const TRIGGERED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const FILTER_MARK = /^[A-Za-z0-9_-]{16}$/;

/** Stable mark of a filter set: same filters, same mark. Keys are sorted. */
export function alertListFilterMark(filters: Record<string, unknown>): string {
    const canonical = JSON.stringify(
        Object.keys(filters)
            .sort()
            .map((key) => [key, filters[key] ?? null])
    );
    return createHash('sha256')
        .update(canonical)
        .digest('base64url')
        .slice(0, 16);
}

export function encodeAlertListCursor(
    position: AlertListPosition,
    filterMark: string
): string {
    return Buffer.from(
        `${position.triggeredAt}|${position.id}|${filterMark}`
    ).toString('base64url');
}

/** The position, if the cursor was made under these same filters. */
export function decodeAlertListCursor(
    cursor: string,
    filterMark: string
): AlertListPosition {
    const [triggeredAt, idText, mark, ...rest] = Buffer.from(
        cursor,
        'base64url'
    )
        .toString('utf8')
        .split('|');
    const id = Number(idText);
    if (
        rest.length > 0 ||
        !TRIGGERED_AT.test(triggeredAt ?? '') ||
        !Number.isInteger(id) ||
        id < 1 ||
        !FILTER_MARK.test(mark ?? '')
    ) {
        throw cursorError('not a cursor from this list', 'pattern');
    }
    if (mark !== filterMark) {
        throw cursorError(
            'made for other filters; start again without cursor',
            'cursor_filters_changed'
        );
    }
    return {triggeredAt, id};
}

function cursorError(error: string, code: string): RpcError {
    return RpcError.InvalidParams('cursor is not valid', [
        {field: 'cursor', error, code}
    ]);
}
