import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {Pool} from 'pg';
import {request} from 'undici';
import {
    applyDeviceNames,
    expandDeviceProfiles
} from '../src/devSimulation/profiles';
import {ShellySimulatorClient} from '../src/devSimulation/ShellySimulatorClient';
import {
    NODE_RED_USER_HEADER,
    signNodeRedUserToken
} from '../src/modules/nodeRed/editorUserToken';
import {DOMAIN_ERRORS} from '../src/types/api/errors';
import {
    type CredentialReply,
    sessionLostFleetAccess,
    waitForAccessEnd
} from './scoped-automation-revocation';

interface ZitadelConfig {
    url: string;
    host?: string;
    token: string;
    organizationId: string;
    projectId: string;
    roleKey: string;
}

interface Config {
    baseUrl: string;
    adminToken?: string;
    nodeRedServiceToken: string;
    nodeRedUrl: string;
    nodeRedProxySecret: string;
    simulatorWsUrl: string;
    dbHost: string;
    dbPort: number;
    dbPassword: string;
    authorUserId: string;
    outputPath?: string;
    accountStateTtlMs: number;
    zitadel?: ZitadelConfig;
}

interface RpcErrorBody {
    code?: number;
    message?: string;
}

interface ZitadelUser {
    userId: string;
    authorizationId: string;
}

interface OwnedAutomation {
    id: string;
    flowId: string;
    executionToken: string;
}

interface AuthorCredential {
    userId: string;
    tokenId: string;
    token: string;
}

type IdentityRevocation =
    | 'zitadel-user-deactivated'
    | 'zitadel-user-locked'
    | 'zitadel-authorization-removed'
    | 'zitadel-user-removed';

interface InteractiveCredentials {
    scopedKey: string;
    mcpKey: string;
    session: string;
}

class RpcFailure extends Error {
    constructor(
        readonly method: string,
        readonly status: number,
        readonly rpc: RpcErrorBody
    ) {
        super(
            `${method} failed with HTTP ${status}, RPC code ${rpc.code ?? 'unknown'}`
        );
    }
}

const IDENTITY_REVOCATIONS: readonly IdentityRevocation[] = [
    'zitadel-user-deactivated',
    'zitadel-user-locked',
    'zitadel-authorization-removed',
    'zitadel-user-removed'
];
const REVOKED_OBSERVATION_MS = 4_000;

const config = readConfig();
const startedAt = new Date().toISOString();
const automationName = `zz-verify-scoped-system-${randomUUID()}`;
let adminToken = config.adminToken ?? '';
let simulator: ShellySimulatorClient | undefined;
let deviceId: string | undefined;
let toggleDeliveries = 0;
let database: Pool | undefined;
const ownedAutomations: OwnedAutomation[] = [];
const zitadelUsers: string[] = [];

const report: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'scoped-automation-disposable-system-proof',
    identityProvider: config.zitadel
        ? 'zitadel-real-deployment'
        : 'simulated-http-idp-production-adapter',
    startedAt,
    status: 'failed',
    checks: []
};

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function optional(name: string): string | undefined {
    return process.env[name]?.trim() || undefined;
}

function readZitadelConfig(): ZitadelConfig | undefined {
    if (!optional('FM_SCOPED_SYSTEM_ZITADEL_URL')) return undefined;
    return {
        url: required('FM_SCOPED_SYSTEM_ZITADEL_URL').replace(/\/+$/, ''),
        host: optional('FM_SCOPED_SYSTEM_ZITADEL_HOST'),
        token: required('FM_SCOPED_SYSTEM_ZITADEL_TOKEN'),
        organizationId: required('FM_SCOPED_SYSTEM_ZITADEL_ORG_ID'),
        projectId: required('FM_SCOPED_SYSTEM_ZITADEL_PROJECT_ID'),
        roleKey: optional('FM_SCOPED_SYSTEM_ZITADEL_ROLE') ?? 'admin'
    };
}

function readConfig(): Config {
    const zitadel = readZitadelConfig();
    return {
        baseUrl: required('FM_SCOPED_SYSTEM_BASE_URL').replace(/\/+$/, ''),
        // A real identity provider mints a disposable administrator instead.
        adminToken: zitadel
            ? optional('FM_SCOPED_SYSTEM_ADMIN_TOKEN')
            : required('FM_SCOPED_SYSTEM_ADMIN_TOKEN'),
        nodeRedServiceToken: required(
            'FM_SCOPED_SYSTEM_NODE_RED_SERVICE_TOKEN'
        ),
        nodeRedUrl: required('FM_SCOPED_SYSTEM_NODE_RED_URL').replace(
            /\/+$/,
            ''
        ),
        nodeRedProxySecret: required('FM_SCOPED_SYSTEM_NODE_RED_PROXY_SECRET'),
        simulatorWsUrl: required('FM_SCOPED_SYSTEM_SIMULATOR_WS_URL'),
        dbHost: optional('FM_SCOPED_SYSTEM_DB_HOST') ?? '127.0.0.1',
        dbPort: requiredInteger('FM_SCOPED_SYSTEM_DB_PORT'),
        dbPassword: required('FM_SCOPED_SYSTEM_DB_PASSWORD'),
        authorUserId: optional('FM_SCOPED_SYSTEM_AUTHOR_USER_ID') ?? 'admin',
        outputPath: optional('FM_SCOPED_SYSTEM_OUTPUT'),
        // Must match the stack's FM_ACCOUNT_STATE_TTL_MS: the promised bound.
        accountStateTtlMs: positiveInteger(
            'FM_SCOPED_SYSTEM_ACCOUNT_STATE_TTL_MS',
            30_000
        ),
        zitadel
    };
}

function positiveInteger(name: string, fallback: number): number {
    const raw = optional(name);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

function requiredInteger(name: string): number {
    const parsed = Number(required(name));
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error(`${name} must be a TCP port`);
    }
    return parsed;
}

async function rpc<T>(
    token: string,
    method: string,
    params: unknown
): Promise<T> {
    const response = await fetch(`${config.baseUrl}/rpc`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({method, params}),
        signal: AbortSignal.timeout(15_000)
    });
    const body = (await response.json()) as {
        result?: T;
        error?: RpcErrorBody;
    } & T;
    const rpcError =
        body.error &&
        !Array.isArray(body.error) &&
        typeof body.error.code === 'number'
            ? body.error
            : undefined;
    if (!response.ok || rpcError) {
        throw new RpcFailure(method, response.status, rpcError ?? {});
    }
    return body as T;
}

function zitadelConfig(): ZitadelConfig {
    if (!config.zitadel) throw new Error('Zitadel mode is not configured');
    return config.zitadel;
}

// Direct identity-provider calls stand in for an administrator using Zitadel.
// undici.request, not fetch: fetch drops the Host header Zitadel routes on.
async function zitadel<T>(
    method: 'DELETE' | 'POST',
    path: string,
    body?: unknown
): Promise<T> {
    const target = zitadelConfig();
    const response = await request(`${target.url}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${target.token}`,
            'content-type': 'application/json',
            ...(target.host ? {host: target.host} : {})
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        signal: AbortSignal.timeout(15_000)
    });
    const text = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
            `Zitadel ${method} ${path} failed with HTTP ${response.statusCode}`
        );
    }
    return (text ? JSON.parse(text) : {}) as T;
}

async function createZitadelUser(
    label: string,
    roleKey: string
): Promise<ZitadelUser> {
    const target = zitadelConfig();
    const created = await zitadel<{id: string}>('POST', '/v2/users/new', {
        organizationId: target.organizationId,
        username: `${automationName}-${label}`,
        machine: {
            name: `zz-verify scoped ${label}`,
            accessTokenType: 'ACCESS_TOKEN_TYPE_BEARER'
        }
    });
    zitadelUsers.push(created.id);
    const authorization = await zitadel<{id: string}>(
        'POST',
        '/zitadel.authorization.v2.AuthorizationService/CreateAuthorization',
        {
            userId: created.id,
            projectId: target.projectId,
            organizationId: target.organizationId,
            roleKeys: [roleKey]
        }
    );
    return {userId: created.id, authorizationId: authorization.id};
}

// A Zitadel-issued token takes the same introspection path as a browser session.
async function createZitadelAccessToken(userId: string): Promise<string> {
    const pat = await zitadel<{token: string}>(
        'POST',
        `/v2/users/${userId}/pats`,
        {expirationDate: new Date(Date.now() + 86_400_000).toISOString()}
    );
    return pat.token;
}

async function createZitadelAdministrator(): Promise<string> {
    const administrator = await createZitadelUser('admin', 'admin');
    const token = await createZitadelAccessToken(administrator.userId);
    await rpc(token, 'User.GetMe', {});
    return token;
}

async function revokeInZitadel(
    revocation: IdentityRevocation,
    user: ZitadelUser
): Promise<void> {
    if (revocation === 'zitadel-user-deactivated') {
        await zitadel('POST', `/v2/users/${user.userId}/deactivate`, {});
    } else if (revocation === 'zitadel-user-locked') {
        await zitadel('POST', `/v2/users/${user.userId}/lock`, {});
    } else if (revocation === 'zitadel-authorization-removed') {
        await zitadel(
            'POST',
            '/zitadel.authorization.v2.AuthorizationService/DeleteAuthorization',
            {id: user.authorizationId}
        );
    } else {
        await zitadel('DELETE', `/v2/users/${user.userId}`);
        zitadelUsers.splice(zitadelUsers.indexOf(user.userId), 1);
    }
}

async function switchOutput(): Promise<boolean> {
    if (!deviceId) throw new Error('simulator device is not initialized');
    const result = await rpc<Record<string, unknown>>(
        adminToken,
        'Device.Call',
        {shellyID: deviceId, method: 'Switch.GetStatus', params: {id: 0}}
    );
    if (typeof result.output !== 'boolean') {
        throw new Error('Switch.GetStatus response omitted boolean output');
    }
    return result.output;
}

async function waitForTransition(
    previous: boolean,
    timeoutMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const current = await switchOutput();
        if (current !== previous) return current;
        await delay(100);
    }
    throw new Error(`simulator output did not change within ${timeoutMs}ms`);
}

async function assertStable(
    expected: boolean,
    durationMs: number
): Promise<void> {
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
        if ((await switchOutput()) !== expected) {
            throw new Error(
                'simulator received a device action after credential revocation'
            );
        }
        await delay(100);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ownsRunCall(item: Record<string, unknown>, id: string): boolean {
    if (item.operation !== 'ScopedAutomation.Run') return false;
    try {
        return (
            (JSON.parse(String(item.paramsJson)) as {id?: unknown}).id === id
        );
    } catch {
        return false;
    }
}

async function executionToken(automationId: string): Promise<string> {
    const body = await fetchFlows();
    const flow = body.flows.find((item) => ownsRunCall(item, automationId));
    if (!flow)
        throw new Error(
            'owned scoped automation flow was not found in Node-RED'
        );
    const params = JSON.parse(String(flow.paramsJson)) as {
        executionToken?: unknown;
    };
    if (typeof params.executionToken !== 'string') {
        throw new Error('owned scoped automation flow omitted executionToken');
    }
    return params.executionToken;
}

// Node-RED's adminAuth refuses admin calls that name no signed user.
function nodeRedAdminUser(): Record<string, string> {
    return {
        [NODE_RED_USER_HEADER]: signNodeRedUserToken(
            {username: 'scoped-automation-system'},
            {secret: config.nodeRedProxySecret}
        )
    };
}

async function fetchFlows(): Promise<{
    rev: string;
    flows: Array<Record<string, unknown>>;
}> {
    const response = await fetch(`${config.nodeRedUrl}/flows`, {
        headers: {
            'node-red-api-version': 'v2',
            'x-fm-node-red-proxy-secret': config.nodeRedProxySecret,
            ...nodeRedAdminUser()
        },
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok)
        throw new Error(
            `Node-RED flows read failed with HTTP ${response.status}`
        );
    const body = (await response.json()) as {
        rev?: unknown;
        flows?: unknown;
    };
    if (typeof body.rev !== 'string' || !Array.isArray(body.flows)) {
        throw new Error('Node-RED returned an invalid v2 flow response');
    }
    return {rev: body.rev, flows: body.flows as Array<Record<string, unknown>>};
}

async function deployFlows(
    rev: string,
    flows: Array<Record<string, unknown>>
): Promise<void> {
    const response = await fetch(`${config.nodeRedUrl}/flows`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'node-red-api-version': 'v2',
            'node-red-deployment-type': 'flows',
            'x-fm-node-red-proxy-secret': config.nodeRedProxySecret,
            ...nodeRedAdminUser()
        },
        body: JSON.stringify({rev, flows}),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
        throw new Error(
            `Node-RED flow deploy failed with HTTP ${response.status}`
        );
    }
    const result = (await response.json()) as {rev?: unknown};
    if (typeof result.rev !== 'string') {
        throw new Error('Node-RED flow deploy omitted its revision');
    }
}

// Every change refuses a flow tab whose Run call names another automation.
async function changeOwnedFlow(
    owned: OwnedAutomation,
    change: (
        flows: Array<Record<string, unknown>>,
        tab: Record<string, unknown>
    ) => Array<Record<string, unknown>>
): Promise<void> {
    const current = await fetchFlows();
    const ownedCall = current.flows.some(
        (item) => item.z === owned.flowId && ownsRunCall(item, owned.id)
    );
    const tab = current.flows.find(
        (item) => item.id === owned.flowId && item.type === 'tab'
    );
    if (!ownedCall || !tab)
        throw new Error('refusing to change an unowned Node-RED flow');
    await deployFlows(current.rev, change(current.flows, tab));
}

async function setOwnedFlowDisabled(
    owned: OwnedAutomation,
    disabled: boolean
): Promise<void> {
    await changeOwnedFlow(owned, (flows, tab) =>
        flows.map((item) => (item === tab ? {...item, disabled} : item))
    );
}

async function removeOwnedFlow(owned: OwnedAutomation): Promise<void> {
    await changeOwnedFlow(owned, (flows) =>
        flows.filter(
            (item) => item.id !== owned.flowId && item.z !== owned.flowId
        )
    );
}

async function waitForDeliveryQuiescence(automationId: string): Promise<void> {
    if (!database) throw new Error('database pool is not initialized');
    for (let attempt = 0; attempt < 20; attempt++) {
        const state = await database.query<{execution_state: string}>(
            'SELECT execution_state FROM fm.scoped_automation WHERE id = $1',
            [automationId]
        );
        if (state.rows[0]?.execution_state === 'idle') return;
        await delay(250);
    }
    throw new Error(
        'simulator device actions did not settle after pausing the flow'
    );
}

async function deniedInvocationCount(automationId: string): Promise<number> {
    if (!database) throw new Error('database pool is not initialized');
    const result = await database.query<{count: string}>(
        `SELECT count(*)::text AS count
           FROM fm.scoped_automation_invocation
          WHERE automation_id = $1 AND status = 'denied'`,
        [automationId]
    );
    return Number(result.rows[0]?.count ?? 0);
}

function addCheck(id: string, evidence: Record<string, unknown>): void {
    (report.checks as Array<unknown>).push({id, status: 'passed', ...evidence});
}

function records(
    value: unknown,
    label: string
): Array<Record<string, unknown>> {
    const candidate = Array.isArray(value)
        ? value
        : (value as {items?: unknown} | null)?.items;
    if (!Array.isArray(candidate))
        throw new Error(`${label} did not return a list`);
    return candidate as Array<Record<string, unknown>>;
}

async function waitForDevice(
    method: string,
    params: Record<string, unknown>,
    select: (
        items: Array<Record<string, unknown>>
    ) => Record<string, unknown> | undefined
): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const found = select(
            records(await rpc(adminToken, method, params), method)
        );
        if (found) return found;
        await delay(50);
    }
    throw new Error(`${method} did not observe the disposable simulator`);
}

async function startAndAdmitSimulator(): Promise<string> {
    // A high random ordinal keeps clear of a shared stack's own simulators.
    const [unnamedProfile] = expandDeviceProfiles({
        profiles: ['shelly-1pm-g4'],
        count: 1,
        firstOrdinal: 0x1000 + Math.floor(Math.random() * 0xe000)
    });
    const [profile] = applyDeviceNames([unnamedProfile], {
        [unnamedProfile.shellyID]: automationName
    }).profiles;
    const existing = records(
        await rpc(adminToken, 'Device.List', {
            filters: {shellyID: profile.shellyID},
            limit: 10
        }),
        'Device.List'
    );
    if (existing.some((item) => item.shellyID === profile.shellyID)) {
        throw new Error('refusing to reuse an existing device identity');
    }
    deviceId = profile.shellyID;
    simulator = new ShellySimulatorClient({
        wsUrl: config.simulatorWsUrl,
        profile,
        onRpcRequest: (method) => {
            if (method === 'Switch.Toggle') toggleDeliveries++;
        },
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined
        }
    });
    simulator.start();
    const pending = await waitForDevice(
        'WaitingRoom.List',
        {state: 'open', limit: 500},
        (items) => items.find((item) => item.shellyID === profile.shellyID)
    );
    if (typeof pending.entryId !== 'string') {
        throw new Error('waiting-room entry omitted entryId');
    }
    await rpc(adminToken, 'WaitingRoom.Approve', {
        entryId: pending.entryId,
        action: 'create_new_device'
    });
    await waitForDevice(
        'Device.List',
        {filters: {shellyID: profile.shellyID}, limit: 10},
        (items) =>
            items.find(
                (item) =>
                    item.shellyID === profile.shellyID &&
                    item.presence === 'online'
            )
    );
    return profile.shellyID;
}

async function createScopedKey(
    userId: string,
    key: {actions: string[]; audience?: string[]}
): Promise<AuthorCredential> {
    if (!deviceId) throw new Error('simulator device is not initialized');
    const pat = await rpc<{tokenId: string; token: string}>(
        adminToken,
        'User.CreateScopedPAT',
        {
            userId,
            boundaryScope: {device_ids: [deviceId], actions: key.actions},
            ...(key.audience ? {audience: key.audience} : {}),
            purpose: 'disposable scoped automation system proof',
            expirationDays: 1
        }
    );
    return {userId, tokenId: pat.tokenId, token: pat.token};
}

function createAuthorCredential(userId: string): Promise<AuthorCredential> {
    return createScopedKey(userId, {
        actions: ['automation:update', 'device:read', 'device:execute']
    });
}

// Creates a one-second schedule and proves its timer reaches the simulator.
async function createDispatchingAutomation(
    label: string,
    author: AuthorCredential
): Promise<OwnedAutomation> {
    const automation = await rpc<Record<string, unknown>>(
        author.token,
        'ScopedAutomation.Create',
        {
            idempotencyKey: randomUUID(),
            name: `${automationName}-${label}`,
            deviceIds: [deviceId],
            schedule: {kind: 'timer', seconds: 1},
            method: 'Switch.Toggle',
            params: {id: 0}
        }
    );
    const id = String(automation.id);
    const flowId = String(automation.flowId);
    ownedAutomations.push({id, flowId, executionToken: ''});
    const deliveriesBefore = toggleDeliveries;
    const initial = await switchOutput();
    const afterTimer = await waitForTransition(initial, 2_500);
    if (toggleDeliveries <= deliveriesBefore) {
        throw new Error(
            'timer state changed without a counted Switch.Toggle delivery'
        );
    }
    addCheck(`${label}:timer-dispatched-device-action`, {
        deviceId,
        automationId: id,
        observedTransition: [initial, afterTimer],
        countedDeliveries: toggleDeliveries - deliveriesBefore
    });
    const owned = {id, flowId, executionToken: await executionToken(id)};
    ownedAutomations[ownedAutomations.length - 1] = owned;
    return owned;
}

async function pause(owned: OwnedAutomation): Promise<void> {
    await setOwnedFlowDisabled(owned, true);
    await waitForDeliveryQuiescence(owned.id);
}

async function proveCompletedRetryDeduplicated(
    label: string,
    owned: OwnedAutomation
): Promise<void> {
    const invocationId = randomUUID();
    const beforeReplay = await switchOutput();
    const deliveriesBeforeReplay = toggleDeliveries;
    const run = () =>
        rpc(config.nodeRedServiceToken, 'ScopedAutomation.Run', {
            id: owned.id,
            executionToken: owned.executionToken,
            invocationId
        });
    await run();
    const afterFirst = await switchOutput();
    if (
        afterFirst === beforeReplay ||
        toggleDeliveries !== deliveriesBeforeReplay + 1
    ) {
        throw new Error(
            'first explicit invocation did not produce a device action'
        );
    }
    await run();
    const afterRetry = await switchOutput();
    if (
        afterRetry !== afterFirst ||
        toggleDeliveries !== deliveriesBeforeReplay + 1
    ) {
        throw new Error(
            'completed invocation retry redispatched the device action'
        );
    }
    addCheck(`${label}:completed-invocation-retry-deduplicated`, {
        invocationId
    });
}

// Resumes the paused timer and proves no later firing reaches the device.
async function proveRevokedAuthorBlocked(
    label: string,
    owned: OwnedAutomation
): Promise<void> {
    const deniedBeforeResume = await deniedInvocationCount(owned.id);
    await setOwnedFlowDisabled(owned, false);
    addCheck(`${label}:owned-timer-resumed-after-revocation`, {
        flowId: owned.flowId
    });
    const afterRevocation = await switchOutput();
    const deliveriesAfterRevocation = toggleDeliveries;
    await assertStable(afterRevocation, REVOKED_OBSERVATION_MS);
    if (toggleDeliveries !== deliveriesAfterRevocation) {
        throw new Error(
            'simulator counted a device action after credential revocation'
        );
    }
    addCheck(`${label}:revoked-author-blocked-later-timers`, {
        observationMs: REVOKED_OBSERVATION_MS,
        countedDeliveries: deliveriesAfterRevocation
    });
    const deniedDuringObservation =
        (await deniedInvocationCount(owned.id)) - deniedBeforeResume;
    if (deniedDuringObservation < 2) {
        throw new Error(
            `expected at least 2 denied timer receipts, observed ${deniedDuringObservation}`
        );
    }
    addCheck(`${label}:revoked-author-timer-attempts-recorded`, {
        deniedDuringObservation
    });
    await pause(owned);
    let replayDenied = false;
    try {
        await rpc(config.nodeRedServiceToken, 'ScopedAutomation.Run', {
            id: owned.id,
            executionToken: owned.executionToken,
            invocationId: randomUUID()
        });
    } catch (error) {
        replayDenied =
            error instanceof RpcFailure &&
            error.rpc.code === DOMAIN_ERRORS.PermissionDenied.code;
    }
    if (!replayDenied)
        throw new Error('new invocation was accepted after author revocation');
    if (toggleDeliveries !== deliveriesAfterRevocation) {
        throw new Error('denied explicit run still reached the simulator');
    }
    addCheck(`${label}:revoked-author-blocked-explicit-run`, {});
}

async function proveFleetCredentialRevocation(userId: string): Promise<void> {
    const label = 'fleet-scoped-pat-revoked';
    const author = await createAuthorCredential(userId);
    addCheck(`${label}:author-credential-created`, {
        credentialId: author.tokenId
    });
    const authorContext = await rpc<{
        roles: string[];
        effectiveShape: unknown;
    }>(author.token, 'User.GetMe', {});
    report.authorContext = {
        roles: authorContext.roles,
        effectiveShape: authorContext.effectiveShape
    };
    const owned = await createDispatchingAutomation(label, author);
    await pause(owned);
    addCheck(`${label}:owned-timer-paused-for-replay-proof`, {
        flowId: owned.flowId
    });
    await proveCompletedRetryDeduplicated(label, owned);
    await rpc(adminToken, 'User.RevokeScopedPAT', {tokenId: author.tokenId});
    addCheck(`${label}:original-author-credential-revoked`, {
        credentialId: author.tokenId
    });
    await proveRevokedAuthorBlocked(label, owned);
}

async function rpcReply(token: string): Promise<CredentialReply> {
    try {
        const me = await rpc<{roles?: unknown}>(token, 'User.GetMe', {});
        return {httpStatus: 200, roles: me.roles};
    } catch (error) {
        if (!(error instanceof RpcFailure)) throw error;
        return {httpStatus: error.status, rpcCode: error.rpc.code};
    }
}

// A device call the session could make while it held its Fleet role.
async function privilegedReply(token: string): Promise<CredentialReply> {
    try {
        await rpc(token, 'Device.Call', {
            shellyID: deviceId,
            method: 'Switch.GetStatus',
            params: {id: 0}
        });
        return {httpStatus: 200};
    } catch (error) {
        if (!(error instanceof RpcFailure)) throw error;
        return {httpStatus: error.status, rpcCode: error.rpc.code};
    }
}

async function sessionReply(token: string): Promise<CredentialReply> {
    return {
        ...(await rpcReply(token)),
        privileged: await privilegedReply(token)
    };
}

async function mcpReply(token: string): Promise<CredentialReply> {
    const response = await fetch(`${config.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': '2025-06-18'
        },
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}),
        signal: AbortSignal.timeout(15_000)
    });
    const body = (await response.json().catch(() => ({}))) as {
        error?: RpcErrorBody;
    };
    return {httpStatus: response.status, rpcCode: body.error?.code};
}

async function createInteractiveCredentials(
    revocation: IdentityRevocation,
    author: AuthorCredential
): Promise<InteractiveCredentials> {
    const mcp = await createScopedKey(author.userId, {
        actions: ['device:read'],
        audience: ['mcp:read']
    });
    const credentials = {
        scopedKey: author.token,
        mcpKey: mcp.token,
        session: await createZitadelAccessToken(author.userId)
    };
    const before = {
        scopedKey: await rpcReply(credentials.scopedKey),
        mcpKey: await mcpReply(credentials.mcpKey),
        session: await rpcReply(credentials.session),
        sessionDeviceCall: await privilegedReply(credentials.session)
    };
    for (const [kind, reply] of Object.entries(before)) {
        if (reply.httpStatus !== 200) {
            throw new Error(
                `${revocation}: ${kind} did not work before revocation (HTTP ${reply.httpStatus})`
            );
        }
    }
    addCheck(`${revocation}:interactive-credentials-worked`, {
        mcpCredentialId: mcp.tokenId
    });
    return credentials;
}

// Every interactive credential must end within the documented account bound.
async function proveInteractiveCredentialsEnded(
    revocation: IdentityRevocation,
    credentials: InteractiveCredentials
): Promise<void> {
    const boundMs = config.accountStateTtlMs;
    const scopedKey = await waitForAccessEnd({
        probe: () => rpcReply(credentials.scopedKey),
        boundMs
    });
    addCheck(`${revocation}:scoped-key-refused`, {boundMs, ...scopedKey});
    const mcpKey = await waitForAccessEnd({
        probe: () => mcpReply(credentials.mcpKey),
        boundMs
    });
    addCheck(`${revocation}:mcp-key-refused`, {boundMs, ...mcpKey});
    // A session whose grant is gone stays signed in with no Fleet role.
    const grantRemoved = revocation === 'zitadel-authorization-removed';
    const session = await waitForAccessEnd({
        probe: () => sessionReply(credentials.session),
        boundMs,
        ended: grantRemoved ? sessionLostFleetAccess : undefined
    });
    addCheck(`${revocation}:session-token-ended`, {boundMs, ...session});
}

async function proveIdentityRevocation(
    revocation: IdentityRevocation
): Promise<void> {
    const user = await createZitadelUser(revocation, zitadelConfig().roleKey);
    const author = await createAuthorCredential(user.userId);
    addCheck(`${revocation}:author-created-in-zitadel`, {
        userId: user.userId,
        credentialId: author.tokenId
    });
    const owned = await createDispatchingAutomation(revocation, author);
    await pause(owned);
    const credentials = await createInteractiveCredentials(revocation, author);
    await revokeInZitadel(revocation, user);
    addCheck(`${revocation}:revoked-directly-in-zitadel`, {
        userId: user.userId
    });
    await proveInteractiveCredentialsEnded(revocation, credentials);
    await proveRevokedAuthorBlocked(revocation, owned);
}

async function main(): Promise<void> {
    database = new Pool({
        host: config.dbHost,
        port: config.dbPort,
        database: 'fleet',
        user: 'postgres',
        password: config.dbPassword,
        max: 1
    });
    if (!adminToken) adminToken = await createZitadelAdministrator();
    deviceId = await startAndAdmitSimulator();
    addCheck('disposable-simulator-admitted', {deviceId});
    const fleetAuthor = config.zitadel
        ? (await createZitadelUser('fleet-pat', zitadelConfig().roleKey)).userId
        : config.authorUserId;
    await proveFleetCredentialRevocation(fleetAuthor);
    if (config.zitadel) {
        for (const revocation of IDENTITY_REVOCATIONS) {
            await proveIdentityRevocation(revocation);
        }
    }
    report.status = 'passed';
}

function recordCleanupError(key: string, error: unknown): void {
    report.status = 'failed';
    report[key] = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
}

// Revoked owners cannot delete their own records, so cleanup goes direct.
async function removeOwnedAutomations(): Promise<void> {
    for (const owned of ownedAutomations) {
        await removeOwnedFlow(owned);
        await database?.query(
            'DELETE FROM fm.scoped_automation WHERE id = $1',
            [owned.id]
        );
    }
}

async function cleanup(): Promise<void> {
    try {
        await removeOwnedAutomations();
    } catch (error) {
        recordCleanupError('automationCleanupError', error);
    }
    if (simulator) {
        try {
            await simulator.close();
            if (deviceId) {
                await rpc(adminToken, 'Device.Delete', {shellyID: deviceId});
            }
        } catch (error) {
            recordCleanupError('cleanupError', error);
        }
    }
    for (const userId of [...zitadelUsers]) {
        try {
            await zitadel('DELETE', `/v2/users/${userId}`);
            zitadelUsers.splice(zitadelUsers.indexOf(userId), 1);
        } catch (error) {
            recordCleanupError('identityCleanupError', error);
        }
    }
    if (database) {
        try {
            await database.end();
        } catch (error) {
            recordCleanupError('databaseCleanupError', error);
        }
    }
}

async function runSystem(): Promise<void> {
    try {
        await main();
    } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
        process.exitCode = 1;
    } finally {
        await cleanup();
        adminToken = '';
        report.finishedAt = new Date().toISOString();
        report.cleanup = {
            status: 'removed-owned-records',
            automationIds: ownedAutomations.map((owned) => owned.id),
            deviceId,
            remainingIdentityProviderUsers: zitadelUsers.length
        };
        const serialized = `${JSON.stringify(report, null, 2)}\n`;
        if (config.outputPath)
            writeFileSync(config.outputPath, serialized, {mode: 0o600});
        process.stdout.write(serialized);
    }
}

void runSystem().catch((error: unknown) => {
    process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
});
