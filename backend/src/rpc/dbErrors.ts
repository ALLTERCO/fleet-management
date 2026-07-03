/**
 * Translate a Postgres driver error into an RpcError with a registered
 * domain kind. Each SQL function RAISEs with `DETAIL = '<DomainErrorKind>'`,
 * so the translator is a direct lookup — no message-text pattern matching.
 */

import {DOMAIN_ERRORS, type DomainErrorKind} from './errors';
import RpcError from './RpcError';

interface PgError {
    code?: string;
    detail?: string;
    /** Constraint name set by PG for 23505 / 23503 / 23514 — dedicated field, not parsed from text. */
    constraint?: string;
}

function readPgError(err: unknown): PgError {
    if (err && typeof err === 'object') return err as PgError;
    return {};
}

function isKnownKind(v: string | undefined): v is DomainErrorKind {
    // hasOwn avoids matching Object.prototype members (e.g. "toString").
    return !!v && Object.hasOwn(DOMAIN_ERRORS, v);
}

/**
 * Map PG SQLSTATE 23505 / 23503 / 23514 to per-component kinds. The call
 * site owns this table because the same SQLSTATE means different things
 * per component (23505 → LocationNameConflict vs GroupNameConflict vs …).
 */
export interface SqlStateMap {
    /** SQLSTATE 23505 (unique violation). Resolver receives the PG constraint name. */
    unique?: DomainErrorKind | ((constraint: string) => DomainErrorKind);
    /** SQLSTATE 23503 (foreign_key_violation). Resolver receives the PG constraint name. */
    foreignKey?: DomainErrorKind | ((constraint: string) => DomainErrorKind);
    /** SQLSTATE 23514 (check_violation). Resolver receives the PG constraint name. */
    checkViolation?:
        | DomainErrorKind
        | ((constraint: string) => DomainErrorKind);
    /** Custom ERRCODEs raised by our SQL fns (e.g. 'FM001', 'FM002'). */
    customCodes?: Record<string, DomainErrorKind>;
}

/**
 * Convert a PG error into an RpcError:
 *   1. If RAISE EXCEPTION supplied `DETAIL = '<kind>'` and the kind is
 *      registered, return that kind directly.
 *   2. Else map SQLSTATE via the per-component `stateMap`.
 *   3. Else fall through to `OperationFailed(operationLabel)`.
 */
export function translatePgError(
    err: unknown,
    operationLabel: string,
    stateMap: SqlStateMap = {}
): RpcError {
    // Already an RpcError → pass through unchanged (prevents double-wrap).
    if (err instanceof RpcError) return err;
    const pg = readPgError(err);
    if (isKnownKind(pg.detail)) return RpcError.Domain(pg.detail);

    const code = pg.code ?? '';
    const constraint = pg.constraint ?? '';

    if (code === '23505' && stateMap.unique) {
        const kind =
            typeof stateMap.unique === 'function'
                ? stateMap.unique(constraint)
                : stateMap.unique;
        return RpcError.Domain(kind);
    }
    if (code === '23503' && stateMap.foreignKey) {
        const kind =
            typeof stateMap.foreignKey === 'function'
                ? stateMap.foreignKey(constraint)
                : stateMap.foreignKey;
        return RpcError.Domain(kind);
    }
    if (code === '23514' && stateMap.checkViolation) {
        const kind =
            typeof stateMap.checkViolation === 'function'
                ? stateMap.checkViolation(constraint)
                : stateMap.checkViolation;
        return RpcError.Domain(kind);
    }
    const customKind = stateMap.customCodes?.[code];
    if (customKind) return RpcError.Domain(customKind);

    return RpcError.OperationFailed(operationLabel, err);
}
