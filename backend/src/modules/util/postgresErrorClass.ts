// Is a PostgreSQL failure worth retrying, or is the data itself the problem?
//
// Every drainer has to answer this, and it must answer identically everywhere:
// a transient failure must be retried or the reading is lost, while a permanent
// one must be quarantined or it is re-read from the head of the stream forever
// and blocks every entry behind it.

/**
 * SQLSTATE classes a retry can never fix, because the value is unacceptable:
 * 22 (data exception, e.g. a string longer than its column) and 23 (integrity
 * constraint violation). Every other class - connection loss, shutdown,
 * deadlock, serialization failure, insufficient resources - can succeed later.
 */
const PERMANENT_DATA_ERROR_CLASSES = new Set(['22', '23']);

/**
 * SQLSTATEs meaning the database could not do the work now, whatever the
 * data: 08 connection exception, 53 insufficient resources, 58 system error,
 * 57P01/57P02/57P03/57P05 shutdown, crash, starting up, idle session ended,
 * 40001 serialization failure, 40P01 deadlock, 55P03 lock not available.
 */
const TRANSIENT_SQLSTATE_CLASSES = new Set(['08', '53', '58']);
/** Lock conflicts: this transaction lost to another, the database is fine. */
const LOCK_CONFLICT_SQLSTATES = new Set(['40001', '40P01', '55P03']);
const TRANSIENT_SQLSTATES = new Set([
    '57P01',
    '57P02',
    '57P03',
    '57P05',
    ...LOCK_CONFLICT_SQLSTATES
]);

/** Socket failures reaching the database host. */
const TRANSIENT_SOCKET_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    // Stored-procedure bridge refusing calls while the pool shuts down.
    'DB_BRIDGE_STOPPED'
]);

// node-postgres and pg-pool raise these connection failures with no code.
const TRANSIENT_DRIVER_MESSAGES = new Set([
    'Connection terminated',
    'Connection terminated unexpectedly',
    'Connection terminated due to connection timeout',
    'timeout exceeded when trying to connect',
    'timeout expired',
    'Client has encountered a connection error and is not queryable',
    'Client was closed and is not queryable'
]);

const MAX_CAUSE_DEPTH = 5;

export function isPermanentDataError(error: unknown): boolean {
    const code = (error as {code?: unknown} | null | undefined)?.code;
    return (
        typeof code === 'string' &&
        code.length === 5 &&
        PERMANENT_DATA_ERROR_CLASSES.has(code.slice(0, 2))
    );
}

/**
 * True when the database was unreachable or temporarily unable to work. The
 * same write will succeed once it recovers, so the data must stay queued.
 */
export function isTransientDatabaseError(error: unknown): boolean {
    return isTransientAt(error, 0);
}

/**
 * True when the database itself could not do the work: unreachable, shutting
 * down, out of resources or out of pool connections. A lock conflict is
 * transient too, but a smaller or later transaction can pass where it failed.
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
    return isTransientDatabaseError(error) && !isLockConflict(error);
}

function isLockConflict(error: unknown): boolean {
    const code = (error as {code?: unknown} | null | undefined)?.code;
    return typeof code === 'string' && LOCK_CONFLICT_SQLSTATES.has(code);
}

function isTransientAt(error: unknown, depth: number): boolean {
    if (depth > MAX_CAUSE_DEPTH) return false;
    if (typeof error !== 'object' || error === null) return false;
    const {code, message, cause, errors} = error as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
        errors?: unknown;
    };
    if (typeof code === 'string') {
        if (TRANSIENT_SOCKET_CODES.has(code)) return true;
        if (
            code.length === 5 &&
            (TRANSIENT_SQLSTATES.has(code) ||
                TRANSIENT_SQLSTATE_CLASSES.has(code.slice(0, 2)))
        ) {
            return true;
        }
    }
    if (typeof message === 'string' && TRANSIENT_DRIVER_MESSAGES.has(message)) {
        return true;
    }
    // A multi-address connect fails with one socket error per address.
    if (Array.isArray(errors) && errors.length > 0) {
        return errors.every((inner) => isTransientAt(inner, depth + 1));
    }
    return cause !== undefined && isTransientAt(cause, depth + 1);
}
