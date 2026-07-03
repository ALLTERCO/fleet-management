// Presentation layer for spec §9 domain codes. Codes live in @api/errors.

import {DOMAIN_ERRORS, type RpcCallError} from '@api/errors';

// 401 = auth not (yet) settled — the auth state machine owns recovery (silent
// renew, redirect to login), so a toast is wrong. 403/PermissionDenied is the
// opposite: a settled, authenticated caller who is forbidden. That must be
// surfaced ("You do not have permission"), never swallowed as transient auth.
export function isAuthError(err: unknown): boolean {
    const rpc = extractRpcError(err);
    return rpc?.code === 401;
}

const ByCode = Object.fromEntries(
    Object.entries(DOMAIN_ERRORS).map(([kind, d]) => [d.code, kind])
) as Record<number, keyof typeof DOMAIN_ERRORS>;

const MESSAGES: Partial<Record<keyof typeof DOMAIN_ERRORS, string>> = {
    OrgScopeRequired: 'Pick an organization before continuing.',
    CrossOrgReference: 'That resource belongs to a different organization.',
    InvalidSubjectType: 'Unsupported subject type for this operation.',
    InvalidPatchField: 'Some fields in this change cannot be updated.',
    GroupNotFound: 'Group not found — it may have been removed.',
    GroupParentNotFound: 'Parent group not found.',
    GroupParentCycle: 'That parent change would loop back on itself.',
    GroupNameConflict: 'A group with that name already exists at this parent.',
    GroupDeleteBlockedHasChildren:
        'Delete the child groups first, then delete this one.',
    GroupMembershipModeUnsupported: 'That membership mode is not enabled yet.',
    LocationNotFound: 'Location not found — it may have been removed.',
    LocationParentNotFound: 'Parent location not found.',
    LocationParentCycle: 'That parent change would loop back on itself.',
    LocationNameConflict:
        'A location with that name already exists at this parent.',
    LocationCodeConflict:
        'That location code is already in use in this organization.',
    LocationDeleteBlockedHasChildren:
        'Delete the child locations first, then delete this one.',
    LocationDeleteBlockedHasAssignments:
        'Unassign the devices/entities first, then delete this location.',
    TagNotFound: 'Tag not found — it may have been removed.',
    TagKeyConflict: 'A tag with that key already exists.',
    TagKeyInvalid:
        'Tag keys must start with a letter or digit and contain only lowercase letters, digits, dot, underscore, or hyphen.',
    PermissionDenied: 'You do not have permission to perform that operation.',
    ValidationFailed: 'Some fields in this request failed validation.'
};

// Mapped message → backend message (≤240 chars) → fallback; appends the
// called method name so the user sees which RPC failed.
export function formatRpcError(
    err: unknown,
    fallback = 'Something went wrong. Please try again.'
): string {
    const rpc = extractRpcError(err);
    const method = extractMethod(err);
    let msg: string | undefined;
    if (rpc?.code !== undefined) {
        const kind = ByCode[rpc.code];
        if (kind && MESSAGES[kind]) msg = MESSAGES[kind]!;
        else if (
            rpc.message &&
            rpc.message.length > 0 &&
            rpc.message.length < 240
        ) {
            msg = rpc.message;
        }
    }
    if (!msg && err instanceof Error && err.message) msg = err.message;
    if (!msg) msg = fallback;
    return method ? `${msg}: ${method}` : msg;
}

// Single chokepoint for "user-action RPC failed → show toast". Skips 401
// silently so the auth state machine owns the recovery (redirect / silent
// renew); permission denials (403) still toast. Use this everywhere instead
// of toast.error(formatRpcError(...)).
interface ToastApi {
    error: (msg: string) => unknown;
}
export function toastRpcError(
    toast: ToastApi,
    err: unknown,
    fallback = 'Something went wrong. Please try again.'
): void {
    if (isAuthError(err)) return;
    toast.error(formatRpcError(err, fallback));
}

function extractMethod(err: unknown): string | null {
    if (!err || typeof err !== 'object') return null;
    const e = err as Record<string, unknown>;
    return typeof e.method === 'string' && e.method.length > 0
        ? e.method
        : null;
}

export function isDomainError(err: unknown): boolean {
    const rpc = extractRpcError(err);
    if (rpc?.code === undefined) return false;
    return rpc.code in ByCode;
}

export function domainErrorKind(
    err: unknown
): keyof typeof DOMAIN_ERRORS | null {
    const rpc = extractRpcError(err);
    if (rpc?.code === undefined) return null;
    return ByCode[rpc.code] ?? null;
}

function extractRpcError(err: unknown): RpcCallError | null {
    if (!err || typeof err !== 'object') return null;
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'number') return e as RpcCallError;
    if (e.error && typeof e.error === 'object') {
        const inner = e.error as Record<string, unknown>;
        if (typeof inner.code === 'number') return inner as RpcCallError;
    }
    return null;
}
