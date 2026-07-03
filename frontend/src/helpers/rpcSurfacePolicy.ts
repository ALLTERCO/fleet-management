export type RpcSurfaceCategory =
    | 'read'
    | 'admin-change'
    | 'access-change'
    | 'backend-job'
    | 'instant-command'
    | 'pending-command'
    | 'transport-infrastructure';

export type RpcSurfaceClassification = {
    category: RpcSurfaceCategory;
    reason: string;
};

type RpcSurfaceRule = {
    category: RpcSurfaceCategory;
    reason: string;
    matches(method: string): boolean;
};

const INSTANT_COMMAND_METHODS = new Set([
    'Entity.InvokeAction',
    'Switch.Toggle',
    'virtualdevice.Command.Invoke'
]);

const TRANSPORT_INFRASTRUCTURE_METHODS = new Set([
    'System.Subscribe',
    'System.Unsubscribe',
    'System.SubmitTelemetry',
    'Storage.GetAll',
    'Storage.GetItem',
    'Storage.SetItem',
    'Storage.RemoveItem',
    'Storage.Keys',
    'User.RotateToken'
]);

const BACKEND_JOB_METHODS = new Set([
    'Backup.StartDownloadJob',
    'Backup.StartRestoreJob',
    'Firmware.StartUpdateJob',
    'certificate.pushToDevices',
    'credential.set',
    'credential.rotate',
    'report.generate',
    'report.cancel',
    'reporttemplate.run'
]);

const ACCESS_READ_METHODS = new Set([
    'Identity.GetJwtIntentSettings',
    'Identity.GetScimSettings',
    'Identity.GetSmtpSettings',
    'Identity.ListIdentityProviders',
    'User.GetAuthMethods',
    'User.GetConfig',
    'User.GetEffectivePermissionsV2',
    'User.GetInstanceInfo',
    'User.ListPATs',
    'User.ListScopedPATs',
    'User.ListServiceUsers',
    'User.ListSessions',
    'User.ListZitadelUsers',
    'User.ProfilePicture.GetUrl',
    'User.PreviewScopedPAT',
    'User.SimulateV2',
    'User.ZitadelAvailable',
    'assignment.list',
    'assignment.listforpersona',
    'assignment.listforresource',
    'assignment.listforsubject',
    'authz_audit.list',
    'permission.GetIdentityPolicies',
    'permission.GetRoles',
    'persona.get',
    'persona.list',
    'user_group.get',
    'user_group.list',
    'user_group.listmembers'
]);

const READ_METHODS = new Set([
    'Analytics.AttributeWindow',
    'Discovery.Probe',
    'Report.SuggestTimeShift',
    'virtualdevice.Binding.ReplacementReport',
    'virtualdevice.Profile.SuggestFromDevice'
]);

const ACCESS_CHANGE_METHODS = new Set([
    'Identity.SetSmtpSettings',
    'Identity.TestSmtpSettings',
    'User.AttachCustomPersona',
    'User.BulkRotatePATs',
    'User.CreatePAT',
    'User.CreateScopedPAT',
    'User.CreateServiceUser',
    'User.CreateZitadelUser',
    'User.DeactivateUser',
    'User.DeleteServiceUser',
    'User.DeleteSession',
    'User.DeleteZitadelUser',
    'User.ReactivateUser',
    'User.RevokePAT',
    'User.RevokeScopedPAT',
    'User.RotatePAT',
    'User.SendPasswordReset',
    'User.SetAllowDebug',
    'User.UpdateZitadelUser',
    'assignment.create',
    'assignment.delete',
    'permission.GrantRoles',
    'permission.RevokeRoles',
    'persona.create',
    'persona.delete',
    'persona.update',
    'user_group.addmembers',
    'user_group.create',
    'user_group.delete',
    'user_group.removemembers',
    'user_group.update'
]);

const ACCESS_CHANGE_NAMESPACES = [
    'User.',
    'assignment.',
    'persona.',
    'user_group.',
    'permission.',
    'Identity.',
    'authz_audit.'
];

const ADMIN_CHANGE_NAMESPACES = [
    'Branding.',
    'Privacy.',
    'Restrictions.',
    'domain_policy.',
    'notification_policy.',
    'login_text.',
    'message_text.',
    'Plugin.',
    'System.DbWrites.',
    'System.Observability.',
    'System.Log.',
    'Mail.'
];

const PENDING_COMMAND_VERBS = [
    '.SetConfig',
    '.Update',
    '.Create',
    '.Delete',
    '.Remove',
    '.Add',
    '.Save',
    '.Rename',
    '.Reset',
    '.Start',
    '.Stop',
    '.Reboot',
    '.Calib',
    '.Calibrate',
    '.PhaseToPhaseCalib',
    '.PhaseToPhaseCalibReset',
    '.RevertToFactoryCalibration',
    '.Scan',
    '.OneWireScan',
    '.Pairing',
    '.Reload',
    '.SetProfile',
    '.SetDefault',
    '.SetKey',
    '.SetAutoUpdateMode',
    '.SetSensor',
    '.Call',
    '.Send',
    '.Activate',
    '.Accept',
    '.Approve',
    '.Reject',
    '.Clone',
    '.LiveTrack',
    '.TiltCalibrate',
    '.PutCode',
    '.Pin',
    '.Unpin',
    '.Clear',
    '.Reorder',
    '.Ack',
    '.Unack',
    '.Silence',
    '.Unsilence',
    '.Resolve',
    '.Replace',
    '.Retire',
    '.Backfill',
    '.Apply',
    '.PromoteFromGateway',
    '.Set',
    '.AdmitDevice'
];

const LOWERCASE_PENDING_COMMAND_VERBS = [
    '.create',
    '.update',
    '.delete',
    '.import',
    '.issue',
    '.push',
    '.set',
    '.clear',
    '.reveal',
    '.reset',
    '.remove',
    '.add',
    '.mark',
    '.ack',
    '.unack',
    '.silence',
    '.unsilence',
    '.resolvemanual',
    '.requeue',
    '.start',
    '.test'
];

const READ_PREFIXES = [
    'Get',
    'List',
    'Query',
    'Preview',
    'Check',
    'Describe',
    'Export'
];

const READ_VERBS = [
    '.Get',
    '.List',
    '.Query',
    '.Preview',
    '.Check',
    '.GetStatus',
    '.GetConfig',
    '.GetCapabilities',
    '.GetFile',
    '.GetUrl',
    '.GetKnown',
    '.GetRemote',
    '.List',
    '.Query',
    '.Preview',
    '.Export',
    '.CaptureImage',
    '.Search',
    '.Fetch',
    '.Validate',
    '.ValidateDraft',
    '.ReadRole',
    '.ReadProvenance',
    '.ReplacementReport',
    '.Plan'
];

const LOWERCASE_READ_VERBS = [
    '.get',
    '.list',
    '.query',
    '.preview',
    '.export',
    '.history',
    '.topology',
    '.children',
    '.path',
    '.eventreplay',
    '.signalheatmap',
    '.generateenergyreport',
    '.generatereport',
    '.checkduplicate',
    '.pushstatus',
    '.renderemailpreview',
    '.rendertemplate',
    '.evaluate'
];

const RPC_SURFACE_RULES: readonly RpcSurfaceRule[] = [
    setRule(
        TRANSPORT_INFRASTRUCTURE_METHODS,
        'transport and local storage infrastructure',
        'transport-infrastructure'
    ),
    setRule(
        BACKEND_JOB_METHODS,
        'backend-owned durable operation job',
        'backend-job'
    ),
    setRule(
        INSTANT_COMMAND_METHODS,
        'catalog-owned instant command surface',
        'instant-command'
    ),
    setRule(
        ACCESS_READ_METHODS,
        'identity or permission read-only RPC',
        'read'
    ),
    setRule(READ_METHODS, 'backend-authoritative read or report RPC', 'read'),
    setRule(
        ACCESS_CHANGE_METHODS,
        'identity or permission access-changing RPC',
        'access-change'
    ),
    namespaceRule(
        ACCESS_CHANGE_NAMESPACES,
        'identity or permission access-changing RPC',
        'access-change'
    ),
    namespaceRule(
        ADMIN_CHANGE_NAMESPACES,
        'tenant or instance admin configuration change',
        'admin-change'
    ),
    namespaceRule(
        ['bluassist.'],
        'BLE-bus device command pass-through',
        'pending-command'
    ),
    httpUploadRule(),
    httpAuthSessionRule(),
    verbRule(
        [...PENDING_COMMAND_VERBS, ...LOWERCASE_PENDING_COMMAND_VERBS],
        'server-authoritative mutation or device command',
        'pending-command'
    ),
    readRule()
];

export function classifyRpcSurface(
    method: string
): RpcSurfaceClassification | undefined {
    return RPC_SURFACE_RULES.find((rule) => rule.matches(method));
}

export function isInstantCommandRpc(method: string): boolean {
    return classifyRpcSurface(method)?.category === 'instant-command';
}

function setRule(
    methods: ReadonlySet<string>,
    reason: string,
    category: RpcSurfaceCategory
): RpcSurfaceRule {
    return {
        category,
        reason,
        matches: (method) => methods.has(method)
    };
}

function namespaceRule(
    namespaces: readonly string[],
    reason: string,
    category: RpcSurfaceCategory
): RpcSurfaceRule {
    return {
        category,
        reason,
        matches: (method) =>
            namespaces.some((namespace) => method.startsWith(namespace))
    };
}

function verbRule(
    verbs: readonly string[],
    reason: string,
    category: RpcSurfaceCategory
): RpcSurfaceRule {
    return {
        category,
        reason,
        matches: (method) => verbs.some((verb) => method.includes(verb))
    };
}

function httpUploadRule(): RpcSurfaceRule {
    return {
        category: 'pending-command',
        reason: 'http upload endpoint',
        matches: (method) => method.startsWith('/api/uploads/')
    };
}

function httpAuthSessionRule(): RpcSurfaceRule {
    return {
        category: 'transport-infrastructure',
        reason: 'session cookie exchange endpoint',
        matches: (method) => method === '/api/auth/session'
    };
}

function readRule(): RpcSurfaceRule {
    return {
        category: 'read',
        reason: 'backend-authoritative read or report RPC',
        matches: (method) =>
            READ_PREFIXES.some((prefix) => method.startsWith(prefix)) ||
            [...READ_VERBS, ...LOWERCASE_READ_VERBS].some((verb) =>
                method.includes(verb)
            )
    };
}
