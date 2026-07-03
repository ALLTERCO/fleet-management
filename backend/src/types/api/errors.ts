/**
 * Numeric domain error codes for the public contract.
 *
 * Code-range layout:
 *   - JSON-RPC protocol codes (-32700 to -32000) are reserved for transport
 *     errors — owned by `RpcError.ts` and surfaced by the dispatcher.
 *   - Domain error codes live in the 1000+ range and are owned by this file.
 *     Each new component that ships with its own errors registers them here.
 *   - HTTP status codes are derived from the domain code by
 *     `httpStatusFor(code)` on the `/rpc` transport.
 *
 * Coding convention:
 *   1000-1099  shared / cross-domain
 *   1100-1199  entity.*
 *   1200-1299  device.*
 *   1300-1399  energy.*
 *   1400-1499  report.*
 *   1500-1599  dashboard.*
 *   1600-1699  plugin.*
 *   1700-1799  notification.*
 *   1800-1899  admin.*
 *   1900-1999  audit.*
 *   2000-2099  firmware.*
 *   2100-2199  backup.*
 *   2200-2299  waitingroom.*
 *   2300-2399  storage.*
 *   2400-2499  media.*
 *   2500-2599  group.*
 *   2600-2699  system.*
 *   2700-2799  mail / mdns / web / grafana / alexa (integrations block)
 *   2800-2899  organization.*
 *   2900-2999  location.*
 *   3000-3099  tag.*
 *   3300-3399  policy.*
 *   3400-3499  discovery.*
 *   3500-3599  deviceIngress.*
 *
 * Blocks reserved for future domains stay empty on purpose so codes never
 * need to be renumbered when a namespace is added.
 */

export type DomainErrorKind = keyof typeof DOMAIN_ERRORS;

/** High-level error category — UI switches on this (`data.type`). */
export type ErrorCategory =
    | 'validation'
    | 'permission'
    | 'auth'
    | 'not_found'
    | 'conflict'
    | 'rate_limit'
    | 'device'
    | 'unavailable'
    | 'server';

export interface DomainErrorDescriptor {
    code: number;
    message: string;
    /** HTTP status on `POST /rpc`. WS transport ignores this. */
    httpStatus: 400 | 401 | 403 | 404 | 409 | 429 | 500;
    /** UI-facing category, surfaced as `data.type`. */
    category: ErrorCategory;
}

/**
 * All domain errors. Keep alphabetized within each numeric block so a
 * PR adds predictable context.
 */
export const DOMAIN_ERRORS = {
    // --- Shared / cross-domain (1000-1099) -------------------------------
    ValidationFailed: {
        code: 1000,
        message: 'Request params failed validation',
        httpStatus: 400,
        category: 'validation'
    },
    PermissionDenied: {
        code: 1001,
        message: 'Caller is not authorized for this operation',
        httpStatus: 403,
        category: 'permission'
    },
    ResourceNotFound: {
        code: 1002,
        message: 'Resource not found',
        httpStatus: 404,
        category: 'not_found'
    },
    ResourceConflict: {
        code: 1003,
        message: 'Resource already exists or is in a conflicting state',
        httpStatus: 409,
        category: 'conflict'
    },
    UnsupportedOperation: {
        code: 1005,
        message: 'Operation is not supported for this resource',
        httpStatus: 400,
        category: 'validation'
    },
    OperationFailed: {
        code: 1006,
        message: 'Operation failed',
        httpStatus: 500,
        category: 'server'
    },
    ServiceUnavailable: {
        code: 1007,
        message: 'Service is temporarily unavailable',
        httpStatus: 500,
        category: 'unavailable'
    },
    RateLimitExceeded: {
        code: 1008,
        message: 'Caller is issuing requests too fast — retry later',
        httpStatus: 429,
        category: 'rate_limit'
    },
    // Scope-layer cross-domain errors (spec §9).
    OrgScopeRequired: {
        code: 1010,
        message: 'organizationId is required for this operation',
        httpStatus: 400,
        category: 'validation'
    },
    CrossOrgReference: {
        code: 1011,
        message: 'Reference crosses organization boundary',
        httpStatus: 400,
        category: 'validation'
    },
    InvalidSubjectType: {
        code: 1012,
        message: 'Subject type is not allowed for this operation',
        httpStatus: 400,
        category: 'validation'
    },
    InvalidPatchField: {
        code: 1013,
        message: 'Patch contains an unsupported or immutable field',
        httpStatus: 400,
        category: 'validation'
    },

    // --- entity.* (1100-1199) --------------------------------------------
    EntityCapabilityUnknown: {
        code: 1100,
        message: 'Entity does not expose the requested capability',
        httpStatus: 400,
        category: 'validation'
    },

    // --- device.* (1200-1299) --------------------------------------------
    DeviceOffline: {
        code: 1200,
        message: 'Device is offline — command cannot be delivered',
        httpStatus: 409,
        category: 'device'
    },
    DeviceOperationFailed: {
        code: 1201,
        message: 'Device operation failed',
        httpStatus: 500,
        category: 'device'
    },

    // --- dashboard.* (1500-1599) -----------------------------------------
    DashboardNotFound: {
        code: 1500,
        message: 'Dashboard not found',
        httpStatus: 404,
        category: 'not_found'
    },
    DashboardTemplateNotFound: {
        code: 1501,
        message: 'Dashboard template not found',
        httpStatus: 404,
        category: 'not_found'
    },
    DashboardTemplateBuiltinReadonly: {
        code: 1502,
        message: 'Builtin dashboard template cannot be modified or deleted',
        httpStatus: 409,
        category: 'conflict'
    },
    DashboardItemNotFound: {
        code: 1503,
        message: 'Dashboard item not found',
        httpStatus: 404,
        category: 'not_found'
    },
    DashboardScopeMismatch: {
        code: 1504,
        message: 'Item references a resource outside the dashboard scope',
        httpStatus: 400,
        category: 'validation'
    },
    DashboardImportSchemaMismatch: {
        code: 1505,
        message: 'Import JSON does not match expected format',
        httpStatus: 400,
        category: 'validation'
    },
    DashboardImportUnsupportedGrafanaVersion: {
        code: 1506,
        message: 'Grafana schemaVersion is below supported floor',
        httpStatus: 400,
        category: 'validation'
    },
    DashboardDefaultConflict: {
        code: 1507,
        message: 'Another dashboard is already default for this organization',
        httpStatus: 409,
        category: 'conflict'
    },
    DashboardItemRefInvalid: {
        code: 1508,
        message: 'Dashboard item refers to a missing or cross-org subject',
        httpStatus: 400,
        category: 'validation'
    },

    // --- admin.* (1800-1899) ---------------------------------------------
    AdminCommandFailed: {
        code: 1800,
        message: 'Device RPC command failed',
        httpStatus: 500,
        category: 'device'
    },

    // --- group.* (2500-2599) ---------------------------------------------
    GroupNotFound: {
        code: 2500,
        message: 'Group not found',
        httpStatus: 404,
        category: 'not_found'
    },
    GroupParentNotFound: {
        code: 2501,
        message: 'Parent group not found',
        httpStatus: 400,
        category: 'validation'
    },
    GroupParentCycle: {
        code: 2502,
        message: 'Parent change would create a cycle',
        httpStatus: 400,
        category: 'validation'
    },
    GroupNameConflict: {
        code: 2503,
        message: 'A group with this name already exists at this parent',
        httpStatus: 409,
        category: 'conflict'
    },
    GroupDeleteBlockedHasChildren: {
        code: 2504,
        message: 'Group has child groups',
        httpStatus: 409,
        category: 'conflict'
    },
    GroupMembershipModeUnsupported: {
        code: 2505,
        message: 'Membership mode is not supported in phase 1',
        httpStatus: 400,
        category: 'validation'
    },
    GroupLegacyHierarchyLocked: {
        code: 2506,
        message:
            'Legacy group hierarchy is locked — create a new group to reorganize',
        httpStatus: 409,
        category: 'conflict'
    },

    // --- location.* (2900-2999) ------------------------------------------
    LocationNotFound: {
        code: 2900,
        message: 'Location not found',
        httpStatus: 404,
        category: 'not_found'
    },
    LocationParentNotFound: {
        code: 2901,
        message: 'Parent location not found',
        httpStatus: 400,
        category: 'validation'
    },
    LocationParentCycle: {
        code: 2902,
        message: 'Parent change would create a cycle',
        httpStatus: 400,
        category: 'validation'
    },
    LocationNameConflict: {
        code: 2903,
        message: 'A location with this name already exists at this parent',
        httpStatus: 409,
        category: 'conflict'
    },
    LocationCodeConflict: {
        code: 2904,
        message: 'locationCode is already in use in this organization',
        httpStatus: 409,
        category: 'conflict'
    },
    LocationDeleteBlockedHasChildren: {
        code: 2905,
        message: 'Location has child locations',
        httpStatus: 409,
        category: 'conflict'
    },
    LocationDeleteBlockedHasAssignments: {
        code: 2906,
        message: 'Location has direct device/entity assignments',
        httpStatus: 409,
        category: 'conflict'
    },

    // --- tag.* (3000-3099) -----------------------------------------------
    TagNotFound: {
        code: 3000,
        message: 'Tag not found',
        httpStatus: 404,
        category: 'not_found'
    },
    TagKeyConflict: {
        code: 3001,
        message: 'Tag key already exists in this organization',
        httpStatus: 409,
        category: 'conflict'
    },
    TagKeyInvalid: {
        code: 3002,
        message: 'Tag key is not valid per `^[a-z0-9][a-z0-9._-]{1,63}$`',
        httpStatus: 400,
        category: 'validation'
    },

    // --- notification.destination.* (3100-3199) --------------------------
    DestinationNotFound: {
        code: 3100,
        message: 'Destination group not found',
        httpStatus: 404,
        category: 'not_found'
    },
    DestinationNameConflict: {
        code: 3101,
        message: 'A destination group with this name already exists',
        httpStatus: 409,
        category: 'conflict'
    },
    DestinationInUseByRule: {
        code: 3102,
        message:
            'Destination group is still referenced by one or more alert rules',
        httpStatus: 409,
        category: 'conflict'
    },

    // --- notification.history.* (3200-3299) ------------------------------
    DeliveryJobNotFound: {
        code: 3200,
        message: 'Delivery job not found',
        httpStatus: 404,
        category: 'not_found'
    },

    // --- policy.* (3300-3399) -------------------------------------------
    PolicyGroupTypeUnknown: {
        code: 3300,
        message: 'groupType is not a known type',
        httpStatus: 400,
        category: 'validation'
    },
    PolicyFieldUnknown: {
        code: 3301,
        message: 'field key is not editable via policy API',
        httpStatus: 400,
        category: 'validation'
    },
    PolicyValueInvalid: {
        code: 3302,
        message: "value violates the policy field's shape constraint",
        httpStatus: 400,
        category: 'validation'
    },
    PolicyDefaultsStaleUpdate: {
        code: 3303,
        message:
            'policy defaults changed since getdefaults — refresh and retry',
        httpStatus: 409,
        category: 'conflict'
    },
    NotAShellyDevice: {
        code: 3401,
        message: 'response did not match the Shelly RPC contract',
        httpStatus: 400,
        category: 'validation'
    },
    UnsupportedDeviceGen: {
        code: 3402,
        message: 'device generation is not supported by Discovery.AdmitDevice',
        httpStatus: 400,
        category: 'validation'
    },
    FirmwareTooOld: {
        code: 3403,
        message: 'device firmware is below the minimum required by FM',
        httpStatus: 400,
        category: 'validation'
    },
    AuthRequired: {
        code: 3404,
        message:
            'device has authentication enabled; re-invoke AdmitDevice with the device password',
        httpStatus: 401,
        category: 'auth'
    },
    AuthFailed: {
        code: 3405,
        message: 'device rejected the supplied credentials',
        httpStatus: 401,
        category: 'auth'
    },
    HostNotAllowed: {
        code: 3406,
        message:
            'host resolves to a reserved address range and cannot be admitted; set FM_DISCOVERY_ALLOW_PRIVATE=true for office-LAN installs',
        httpStatus: 400,
        category: 'validation'
    },

    // --- deviceIngress.* (3500-3599) ------------------------------------
    IngressRejected: {
        code: 3500,
        message: 'Device ingress connection was rejected',
        httpStatus: 403,
        category: 'auth'
    }

    // Report / dashboard / plugin / notification / audit / backup /
    // firmware / etc. — most component-specific failures now flow
    // through the generic `ResourceNotFound` / `OperationFailed` /
    // `DeviceOperationFailed` / `ServiceUnavailable` categories above,
    // with the specific resource/operation carried in `data.details`.
    // Add dedicated entries here only when a caller genuinely needs to
    // dispatch on a distinct HTTP status or semantic.
} satisfies Record<string, DomainErrorDescriptor>;

/** Per-field validation failure (`data.fieldErrors`). */
export interface FieldError {
    field: string;
    error: string;
    code: string;
}

/** Unified error payload — every RPC error response uses this shape. */
export interface RpcErrorPayload {
    code: number;
    message: string;
    data?: {
        type?: ErrorCategory; // high-level category (set by Commander)
        operation?: string; // namespace.method that failed
        field?: string; // single bad field shortcut (legacy)
        fieldErrors?: FieldError[]; // multi-field validation
        deviceCode?: number; // device's JSON-RPC code (when relayed)
        deviceMessage?: string; // device's verbatim message
        shellyID?: string; // when device-relevant
        requestId?: string; // log correlation (set by Commander)
        details?: unknown; // free-form supplemental info
    };
}

/**
 * Build an error payload from a registered domain error. Accepts an
 * optional override carrying any of the structured `data` keys.
 */
export function makeDomainError(
    kind: DomainErrorKind,
    override?: {
        message?: string;
        operation?: string;
        field?: string;
        fieldErrors?: FieldError[];
        deviceCode?: number;
        deviceMessage?: string;
        shellyID?: string;
        details?: unknown;
    }
): RpcErrorPayload {
    const descriptor = DOMAIN_ERRORS[kind];
    const data: RpcErrorPayload['data'] = {};
    if (override?.operation !== undefined) data.operation = override.operation;
    if (override?.field !== undefined) data.field = override.field;
    if (override?.fieldErrors !== undefined)
        data.fieldErrors = override.fieldErrors;
    if (override?.deviceCode !== undefined)
        data.deviceCode = override.deviceCode;
    if (override?.deviceMessage !== undefined)
        data.deviceMessage = override.deviceMessage;
    if (override?.shellyID !== undefined) data.shellyID = override.shellyID;
    if (override?.details !== undefined) data.details = override.details;
    const hasData = Object.keys(data).length > 0;
    return {
        code: descriptor.code,
        message: override?.message ?? descriptor.message,
        ...(hasData ? {data} : {})
    };
}

/**
 * JSON-RPC protocol codes — descriptor parallels DOMAIN_ERRORS so
 * lookups are uniform. Registry is the single source of truth.
 */
const PROTOCOL_DESCRIPTORS: Record<
    number,
    {httpStatus: number; category: ErrorCategory}
> = {
    [-32600]: {httpStatus: 400, category: 'validation'}, // InvalidRequest
    [-32601]: {httpStatus: 404, category: 'not_found'}, // MethodNotFound
    [-32602]: {httpStatus: 400, category: 'validation'}, // InvalidParams
    [-32700]: {httpStatus: 400, category: 'validation'}, // ParseError
    [-32800]: {httpStatus: 504, category: 'unavailable'}, // TimeoutError
    [-32900]: {httpStatus: 404, category: 'not_found'}, // DeviceNotFound
    [-32000]: {httpStatus: 401, category: 'auth'}, // Unauthorized
    [-32001]: {httpStatus: 500, category: 'server'} // ServerError
};

const DOMAIN_ERROR_BY_CODE = new Map<number, DomainErrorDescriptor>(
    Object.values(DOMAIN_ERRORS).map((d) => [d.code, d])
);

function findDomainDescriptor(code: number): DomainErrorDescriptor | undefined {
    return DOMAIN_ERROR_BY_CODE.get(code);
}

/** HTTP status for an RPC code. Unknown → 500 (a bug, not auth). */
export function httpStatusFor(code: number): number {
    if (code in PROTOCOL_DESCRIPTORS)
        return PROTOCOL_DESCRIPTORS[code].httpStatus;
    return findDomainDescriptor(code)?.httpStatus ?? 500;
}

/** Category for an RPC code (`data.type`). Unknown → 'server'. */
export function categoryFor(code: number): ErrorCategory {
    if (code in PROTOCOL_DESCRIPTORS)
        return PROTOCOL_DESCRIPTORS[code].category;
    return findDomainDescriptor(code)?.category ?? 'server';
}

/**
 * Public contract snapshot — the inventory generator consumes this to
 * surface every domain code in the generated docs.
 */
export function describeErrors(): Array<
    DomainErrorDescriptor & {kind: string}
> {
    return Object.entries(DOMAIN_ERRORS).map(([kind, descriptor]) => ({
        kind,
        ...descriptor
    }));
}

/**
 * Shape the frontend receives from a failed JSON-RPC call — the transport
 * adapter normalizes both HTTP and WS errors to this.
 */
export interface RpcCallError {
    code?: number;
    message?: string;
    data?: {
        field?: string;
        details?: {
            resourceType?: string;
            operation?: string;
            service?: string;
            reason?: string;
            identifier?: string | number;
            cause?: string;
            [key: string]: unknown;
        };
    };
}

/** True when `err` is a ResourceNotFound for the given resource type. */
export function isResourceNotFound(
    err: RpcCallError | null | undefined,
    resourceType?: string
): boolean {
    if (err?.code !== DOMAIN_ERRORS.ResourceNotFound.code) return false;
    if (resourceType === undefined) return true;
    return err.data?.details?.resourceType === resourceType;
}

/** True when `err` is an OperationFailed matching the given operation label. */
export function isOperationFailed(
    err: RpcCallError | null | undefined,
    operation?: string
): boolean {
    if (err?.code !== DOMAIN_ERRORS.OperationFailed.code) return false;
    if (operation === undefined) return true;
    return err.data?.details?.operation === operation;
}

/** True when `err` is a DeviceOperationFailed. */
export function isDeviceOperationFailed(
    err: RpcCallError | null | undefined
): boolean {
    return err?.code === DOMAIN_ERRORS.DeviceOperationFailed.code;
}

/** True when `err` is a ServiceUnavailable for the given service name. */
export function isServiceUnavailable(
    err: RpcCallError | null | undefined,
    service?: string
): boolean {
    if (err?.code !== DOMAIN_ERRORS.ServiceUnavailable.code) return false;
    if (service === undefined) return true;
    return err.data?.details?.service === service;
}
