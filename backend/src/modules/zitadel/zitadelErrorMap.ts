import RpcError from '../../rpc/RpcError';
import {
    DOMAIN_ERRORS,
    type FieldError,
    IDENTITY_FIELD_ERROR_CODES
} from '../../types/api/errors';

// Zitadel answers a refusal with a body that names its own ids. Those ids are
// stable; the English text beside them is not, and it is written for us, not
// for the person filling in the form. Everything here turns an id into one of
// our domain errors so no upstream body can reach a caller.

type DomainErrorKind = keyof typeof DOMAIN_ERRORS;

interface ZitadelErrorEntry {
    kind: DomainErrorKind;
    /** Form field to mark, when the refusal is about one input. */
    field?: string;
    fieldCode?: string;
    message?: string;
}

/** Zitadel detail id to our own error. One home for the whole mapping. */
export const ZITADEL_ERROR_KINDS: Record<string, ZitadelErrorEntry> = {};

export type ZitadelRefusalContext = 'CreateUser';

export const ZITADEL_CONTEXT_ERROR_KINDS: Record<
    ZitadelRefusalContext,
    Record<string, ZitadelErrorEntry>
> = {
    CreateUser: {
        'V3-DKcYh': {
            kind: 'UserAlreadyExists',
            field: 'userName',
            fieldCode: IDENTITY_FIELD_ERROR_CODES.UsernameAlreadyExists,
            message: 'A user with this username already exists'
        }
    }
};

/** Said to a caller when a 409 carries no id we recognise. */
export const UNMAPPED_CONFLICT_KIND: DomainErrorKind = 'ResourceConflict';

/** Stands in when any other 4xx carries no id we recognise. */
export const UNMAPPED_4XX_KIND: DomainErrorKind = 'ValidationFailed';

/** Said to a caller when any other 4xx carries no id we recognise. */
export const UNMAPPED_4XX_MESSAGE =
    'The identity service refused this request. Check the details you entered and try again.';

export interface ZitadelRefusal {
    status: number;
    /** The response body, already sanitized for logging. */
    body: string;
    /** Ties the caller's error to the log line that holds the raw text. */
    reference: string;
}

export interface TranslatedZitadelError {
    /** The domain error a caller receives. Never carries Zitadel's own text. */
    kind: DomainErrorKind;
    /** Set only when the kind's registry message is too vague on its own. */
    message?: string;
    status: number;
    fieldErrors?: FieldError[];
    details: {reference: string};
}

/**
 * Read the detail ids Zitadel sent. A body that is not JSON, or carries no
 * details, yields none; the caller then falls back on the status alone.
 */
function detailIds(body: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return [];
    }
    const details = (parsed as {details?: unknown})?.details;
    if (!Array.isArray(details)) return [];
    return details
        .map((detail) => (detail as {id?: unknown})?.id)
        .filter((id): id is string => typeof id === 'string');
}

function firstKnownEntry(
    body: string,
    context?: ZitadelRefusalContext
): ZitadelErrorEntry | undefined {
    for (const id of detailIds(body)) {
        const entry =
            (context ? ZITADEL_CONTEXT_ERROR_KINDS[context][id] : undefined) ??
            ZITADEL_ERROR_KINDS[id];
        if (entry) return entry;
    }
    return undefined;
}

function fieldErrorsFor(entry: ZitadelErrorEntry): FieldError[] | undefined {
    if (!entry.field) return undefined;
    return [
        {
            field: entry.field,
            error: entry.message ?? DOMAIN_ERRORS[entry.kind].message,
            code: entry.fieldCode ?? entry.kind
        }
    ];
}

/** Turn one Zitadel refusal into an error of ours. Never quotes the body. */
export function zitadelErrorFor(
    refusal: ZitadelRefusal,
    context?: ZitadelRefusalContext
): TranslatedZitadelError {
    const details = {reference: refusal.reference};
    const entry = firstKnownEntry(refusal.body, context);
    if (entry) {
        return {
            kind: entry.kind,
            message: entry.message,
            status: DOMAIN_ERRORS[entry.kind].httpStatus,
            fieldErrors: fieldErrorsFor(entry),
            details
        };
    }
    if (refusal.status === 409) {
        return {
            kind: UNMAPPED_CONFLICT_KIND,
            status: DOMAIN_ERRORS[UNMAPPED_CONFLICT_KIND].httpStatus,
            details
        };
    }
    return {
        kind: UNMAPPED_4XX_KIND,
        message: UNMAPPED_4XX_MESSAGE,
        status: DOMAIN_ERRORS[UNMAPPED_4XX_KIND].httpStatus,
        details
    };
}

let referenceSeq = 0;

/** Short id shared by the log line and the caller's error. */
export function makeZitadelErrorReference(): string {
    referenceSeq = (referenceSeq + 1) >>> 0;
    return `zitadel-${Date.now().toString(36)}-${referenceSeq.toString(36)}`;
}

/** The thrown form of a refusal. Callers of Zitadel use this, not the table. */
export function zitadelRefusalError(
    refusal: ZitadelRefusal,
    context?: ZitadelRefusalContext
): RpcError {
    const translated = zitadelErrorFor(refusal, context);
    return RpcError.Domain(translated.kind, {
        message: translated.message,
        fieldErrors: translated.fieldErrors,
        details: translated.details
    });
}
