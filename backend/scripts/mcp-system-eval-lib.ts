import {type ChildProcess, execFileSync, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import * as path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ResourceUpdatedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';

export type TargetId = 'baseline' | 'candidate';
export type RunStatus = 'passed' | 'failed' | 'unavailable' | 'skipped';
export type ReportStatus = 'passed' | 'failed' | 'partial' | 'unavailable';

interface MeasuredStep {
    id: string;
    tool: string;
    method: string;
}

interface FixtureStep extends MeasuredStep {
    tool:
        | 'fm_read'
        | 'fm_write'
        | 'fm_get_operation'
        | 'get_api_method'
        | 'list_operation_coverage'
        | 'fm_reconcile_operation';
}

interface ScenarioFixture {
    id: string;
    kind:
        | 'fleet-group-crud'
        | 'node-red-graph-crud'
        | 'asset-transfer-crud'
        | 'durable-operation-replay'
        | 'file-transfer-durable'
        | 'simulated-device-control';
    testDataPrefix: string;
    steps: FixtureStep[];
}

export interface EvalFixture {
    schemaVersion: number;
    suiteId: string;
    executionMode: 'deterministic-real-system';
    writeAuthorization: 'explicit-preview-confirm';
    scenarios: ScenarioFixture[];
}

export interface TargetConfig {
    id: TargetId;
    mcpUrl: URL;
    versionUrl: URL;
    token: string;
    sourceId: string;
    expectedBuildCommit: string;
    expectedConfigurationFingerprint: string;
    policyId: string;
    configId: string;
    hostHeader?: string;
    simulator?: {
        entryPath: string;
        wsUrl: URL;
        profile: string;
        pidFile?: string;
    };
}

export interface EvalConfig {
    targets: Record<TargetId, TargetConfig>;
    repetitions: number;
    includeNodeRed: boolean;
    writesAuthorized: true;
    outputPath?: string;
}

export interface ConfigResult {
    ok: boolean;
    config?: EvalConfig;
    issues: string[];
}

export interface StepResult {
    id: string;
    tool: string;
    method?: string;
    status: 'passed' | 'failed';
    latencyMs: number;
    error?: string;
}

export interface CleanupResult {
    attempted: boolean;
    status: 'passed' | 'failed' | 'not_needed';
    errors: string[];
}

export interface ScenarioRunResult {
    scenarioId: string;
    target: TargetId;
    repetition: number;
    order: number;
    status: RunStatus;
    latencyMs: number;
    steps: StepResult[];
    createdNames: string[];
    cleanup: CleanupResult;
    error?: string;
}

export interface SourceIdentityResult {
    sourceId: string;
    source: 'http-version-endpoint';
    expectedBuildCommit: string;
    observedBuildCommit?: string;
    expectedConfigurationFingerprint: string;
    observedConfigurationFingerprint?: string;
    appVersion?: string;
    verified: boolean;
    error?: string;
}

export interface PolicyIdentityResult {
    configuredPolicyId: string;
    observedCapabilitiesSha256?: string;
    level?: string;
    role?: string | null;
    writeAllowed?: boolean;
    durableOperationCredentialBound?: boolean;
    verified: boolean;
    error?: string;
}

export interface TargetResult {
    id: TargetId;
    endpoint: string;
    configId: string;
    source: SourceIdentityResult;
    policy: PolicyIdentityResult;
    server?: {name?: string; version?: string; protocolVersion?: string};
    status: 'ready' | 'unavailable';
    error?: string;
}

export interface ScenarioComparison {
    scenarioId: string;
    baseline: RunTotals;
    candidate: RunTotals;
    performanceClaim: false;
    note: string;
}

export interface RunTotals {
    passed: number;
    failed: number;
    unavailable: number;
    skipped: number;
    errors: string[];
    latencyMs: {
        samples: number[];
        min?: number;
        median?: number;
        max?: number;
    };
}

export interface EvalReport {
    schemaVersion: 1;
    reportKind: 'deterministic-real-http-mcp-ab';
    status: ReportStatus;
    startedAt: string;
    finishedAt: string;
    fixture: {
        suiteId: string;
        sha256: string;
        path: string;
        executionMode: string;
        writeAuthorization: string;
    };
    setup: {
        repetitions: number;
        targetOrder: TargetId[][];
        nodeRedRequested: boolean;
        checks: string[];
    };
    targets: Record<TargetId, TargetResult>;
    runs: ScenarioRunResult[];
    comparisons: ScenarioComparison[];
    modelEvaluation: {
        status: 'not_run';
        reason: string;
    };
    limitations: string[];
}

interface ConnectedTarget {
    config: TargetConfig;
    client: Client;
    transport: StreamableHTTPClientTransport;
    tools: Set<string>;
    result: TargetResult;
    eventStream: {status?: number};
}

interface ToolBody {
    [key: string]: unknown;
}

interface ScenarioState {
    operationIds?: Map<string, string>;
    steps: StepResult[];
    createdNames: string[];
}

const FIXTURE_PATH = path.resolve(
    __dirname,
    '../test/fixtures/mcp-system-eval-scenarios.json'
);
const REQUEST_TIMEOUT_MS = 60_000;

class ScenarioUnavailable extends Error {}

export class CleanupFailure extends Error {
    constructor(
        message: string,
        readonly bodyError: unknown,
        readonly cleanupError: unknown
    ) {
        super(message);
    }
}

function requiredEnv(
    env: NodeJS.ProcessEnv,
    name: string,
    issues: string[]
): string {
    const value = env[name]?.trim();
    if (!value) issues.push(`${name} is required`);
    return value ?? '';
}

function optionalUrl(value: string | undefined, fallback: URL, name: string) {
    if (!value?.trim()) return fallback;
    try {
        return new URL(value);
    } catch {
        throw new Error(`${name} must be an absolute URL`);
    }
}

function targetConfig(
    env: NodeJS.ProcessEnv,
    id: TargetId,
    issues: string[]
): TargetConfig | undefined {
    const prefix = `MCP_AB_${id.toUpperCase()}_`;
    const urlText = requiredEnv(env, `${prefix}URL`, issues);
    const token = requiredEnv(env, `${prefix}TOKEN`, issues);
    const sourceId = requiredEnv(env, `${prefix}SOURCE_ID`, issues);
    const expectedBuildCommit = requiredEnv(
        env,
        `${prefix}EXPECTED_BUILD_COMMIT`,
        issues
    );
    const expectedConfigurationFingerprint = requiredEnv(
        env,
        `${prefix}EXPECTED_CONFIG_FINGERPRINT`,
        issues
    );
    const policyId = requiredEnv(env, `${prefix}POLICY_ID`, issues);
    const configId = requiredEnv(env, `${prefix}CONFIG_ID`, issues);
    if (!urlText) return undefined;
    let mcpUrl: URL;
    try {
        mcpUrl = new URL(urlText);
    } catch {
        issues.push(`${prefix}URL must be an absolute URL`);
        return undefined;
    }
    if (mcpUrl.protocol !== 'http:' && mcpUrl.protocol !== 'https:') {
        issues.push(`${prefix}URL must use http or https`);
    }
    if (!mcpUrl.pathname.endsWith('/mcp')) {
        issues.push(`${prefix}URL must end with /mcp`);
    }
    const defaultVersionUrl = new URL('/version', mcpUrl);
    let versionUrl: URL;
    try {
        versionUrl = optionalUrl(
            env[`${prefix}VERSION_URL`],
            defaultVersionUrl,
            `${prefix}VERSION_URL`
        );
    } catch (error) {
        issues.push(errorText(error));
        return undefined;
    }
    const simulatorEntry = env[`${prefix}SIMULATOR_ENTRY`]?.trim();
    const simulatorUrlText = env[`${prefix}SIMULATOR_WS_URL`]?.trim();
    const simulatorPidFile = env[`${prefix}SIMULATOR_PID_FILE`]?.trim();
    let simulator: TargetConfig['simulator'];
    if (simulatorEntry || simulatorUrlText) {
        if (!simulatorEntry || !path.isAbsolute(simulatorEntry)) {
            issues.push(`${prefix}SIMULATOR_ENTRY must be an absolute path`);
        }
        if (!simulatorUrlText) {
            issues.push(
                `${prefix}SIMULATOR_WS_URL is required with simulator entry`
            );
        } else {
            try {
                const wsUrl = new URL(simulatorUrlText);
                if (wsUrl.protocol !== 'ws:' && wsUrl.protocol !== 'wss:') {
                    issues.push(`${prefix}SIMULATOR_WS_URL must use ws or wss`);
                } else if (simulatorEntry && path.isAbsolute(simulatorEntry)) {
                    simulator = {
                        entryPath: simulatorEntry,
                        wsUrl,
                        profile:
                            env[`${prefix}SIMULATOR_PROFILE`]?.trim() ||
                            'shelly-1pm-g3',
                        ...(simulatorPidFile ? {pidFile: simulatorPidFile} : {})
                    };
                }
            } catch {
                issues.push(
                    `${prefix}SIMULATOR_WS_URL must be an absolute URL`
                );
            }
        }
    }
    return {
        id,
        mcpUrl,
        versionUrl,
        token,
        sourceId,
        expectedBuildCommit,
        expectedConfigurationFingerprint,
        policyId,
        configId,
        ...(simulator ? {simulator} : {}),
        ...(env[`${prefix}HOST_HEADER`]?.trim()
            ? {hostHeader: env[`${prefix}HOST_HEADER`]?.trim()}
            : {})
    };
}

export function readEvalConfig(env: NodeJS.ProcessEnv): ConfigResult {
    const issues: string[] = [];
    const baseline = targetConfig(env, 'baseline', issues);
    const candidate = targetConfig(env, 'candidate', issues);
    const repetitionsText = env.MCP_AB_REPETITIONS?.trim() || '2';
    const repetitions = Number(repetitionsText);
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
        issues.push('MCP_AB_REPETITIONS must be an integer from 1 to 20');
    }
    if (env.MCP_AB_CONFIRM_WRITES !== '1') {
        issues.push(
            'MCP_AB_CONFIRM_WRITES=1 is required to authorize the named zz-verify-* fixture mutations'
        );
    }
    const includeNodeRed = env.MCP_AB_INCLUDE_NODE_RED !== '0';
    if (issues.length > 0 || !baseline || !candidate) {
        return {ok: false, issues};
    }
    return {
        ok: true,
        issues: [],
        config: {
            targets: {baseline, candidate},
            repetitions,
            includeNodeRed,
            writesAuthorized: true,
            ...(env.MCP_AB_OUTPUT?.trim()
                ? {outputPath: env.MCP_AB_OUTPUT.trim()}
                : {})
        }
    };
}

function validateFixture(value: unknown): EvalFixture {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('MCP system fixture must be an object');
    }
    const fixture = value as Partial<EvalFixture>;
    if (
        fixture.schemaVersion !== 1 ||
        fixture.executionMode !== 'deterministic-real-system' ||
        fixture.writeAuthorization !== 'explicit-preview-confirm' ||
        !fixture.suiteId ||
        !Array.isArray(fixture.scenarios)
    ) {
        throw new Error('MCP system fixture metadata is invalid');
    }
    const ids = new Set<string>();
    for (const scenario of fixture.scenarios) {
        if (
            !scenario.id ||
            !scenario.testDataPrefix.startsWith('zz-verify-') ||
            !Array.isArray(scenario.steps) ||
            scenario.steps.length === 0
        ) {
            throw new Error(
                `MCP system scenario ${scenario.id || '<unknown>'} is invalid`
            );
        }
        if (ids.has(scenario.id)) {
            throw new Error(`Duplicate MCP system scenario ${scenario.id}`);
        }
        ids.add(scenario.id);
        for (const step of scenario.steps) {
            if (!step.id || !step.method || !step.tool) {
                throw new Error(`Scenario ${scenario.id} has an invalid step`);
            }
        }
    }
    return fixture as EvalFixture;
}

export function loadFixture(filePath = FIXTURE_PATH): {
    fixture: EvalFixture;
    sha256: string;
    path: string;
} {
    const raw = readFileSync(filePath, 'utf8');
    return {
        fixture: validateFixture(JSON.parse(raw)),
        sha256: createHash('sha256').update(raw).digest('hex'),
        path: filePath
    };
}

export function buildTargetOrder(repetitions: number): TargetId[][] {
    return Array.from({length: repetitions}, (_, index) =>
        index % 2 === 0
            ? (['baseline', 'candidate'] as TargetId[])
            : (['candidate', 'baseline'] as TargetId[])
    );
}

export async function runWithCleanup<T>(
    body: () => Promise<T>,
    cleanup: () => Promise<void>
): Promise<T> {
    let bodyResult: T | undefined;
    let bodyError: unknown;
    try {
        bodyResult = await body();
    } catch (error) {
        bodyError = error;
    }
    let cleanupError: unknown;
    try {
        await cleanup();
    } catch (error) {
        cleanupError = error;
    }
    if (cleanupError !== undefined) {
        throw new CleanupFailure(
            bodyError === undefined
                ? `cleanup failed: ${errorText(cleanupError)}`
                : `scenario failed (${errorText(bodyError)}); cleanup also failed (${errorText(cleanupError)})`,
            bodyError,
            cleanupError
        );
    }
    if (bodyError !== undefined) throw bodyError;
    return bodyResult as T;
}

function sanitizeEndpoint(url: URL): string {
    const clean = new URL(url.toString());
    clean.username = '';
    clean.password = '';
    clean.search = '';
    clean.hash = '';
    return clean.toString();
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stableValue(item)])
    );
}

function valueHash(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(stableValue(value)))
        .digest('hex');
}

function requestHeaders(config: TargetConfig): Record<string, string> {
    return {
        Authorization: `Bearer ${config.token}`,
        ...(config.hostHeader ? {Host: config.hostHeader} : {})
    };
}

async function probeSource(
    config: TargetConfig
): Promise<SourceIdentityResult> {
    const base: SourceIdentityResult = {
        sourceId: config.sourceId,
        source: 'http-version-endpoint',
        expectedBuildCommit: config.expectedBuildCommit,
        expectedConfigurationFingerprint:
            config.expectedConfigurationFingerprint,
        verified: false
    };
    try {
        const response = await fetch(config.versionUrl, {
            headers: requestHeaders(config),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
            throw new Error(`/version returned HTTP ${response.status}`);
        }
        const data = (await response.json()) as Record<string, unknown>;
        const observedBuildCommit = String(data.build_commit ?? '');
        const observedConfigurationFingerprint = String(
            data.configuration_fingerprint ?? ''
        );
        if (data.service !== 'fleet-manager') {
            throw new Error('/version did not identify fleet-manager');
        }
        if (!observedBuildCommit || observedBuildCommit === 'unknown') {
            throw new Error('/version did not expose a usable build_commit');
        }
        if (observedBuildCommit !== config.expectedBuildCommit) {
            throw new Error(
                `build_commit mismatch: expected ${config.expectedBuildCommit}, observed ${observedBuildCommit}`
            );
        }
        if (
            observedConfigurationFingerprint !==
            config.expectedConfigurationFingerprint
        ) {
            throw new Error(
                `configuration_fingerprint mismatch: expected ${config.expectedConfigurationFingerprint}, observed ${observedConfigurationFingerprint || '<missing>'}`
            );
        }
        return {
            ...base,
            observedBuildCommit,
            observedConfigurationFingerprint,
            appVersion: String(data.app_version ?? ''),
            verified: true
        };
    } catch (error) {
        return {...base, error: errorText(error)};
    }
}

class ToolCallFailure extends Error {
    constructor(
        message: string,
        readonly rpcCode?: number
    ) {
        super(message);
    }
}

function toolBody(result: unknown): ToolBody {
    const value = result as {
        isError?: boolean;
        structuredContent?: unknown;
        content?: Array<{type?: string; text?: string}>;
    };
    let body: unknown = value.structuredContent;
    if (!body) {
        const text = value.content?.find((item) => item.type === 'text')?.text;
        if (!text) throw new Error('MCP tool returned no JSON text content');
        try {
            body = JSON.parse(text);
        } catch {
            throw new Error('MCP tool returned non-JSON text content');
        }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('MCP tool returned a non-object result');
    }
    if (value.isError) {
        const detail = body as Record<string, unknown>;
        throw new ToolCallFailure(
            `MCP tool error${detail.reason ? ` (${String(detail.reason)})` : ''}: ${String(detail.error ?? 'unknown error')}`,
            typeof detail.rpcCode === 'number' ? detail.rpcCode : undefined
        );
    }
    return body as ToolBody;
}

async function connectTarget(config: TargetConfig): Promise<ConnectedTarget> {
    const source = await probeSource(config);
    const initial: TargetResult = {
        id: config.id,
        endpoint: sanitizeEndpoint(config.mcpUrl),
        configId: config.configId,
        source,
        policy: {
            configuredPolicyId: config.policyId,
            verified: false
        },
        status: 'unavailable'
    };
    if (!source.verified) {
        throw Object.assign(new Error(source.error), {targetResult: initial});
    }
    const client = new Client(
        {name: `fleet-mcp-system-ab-${config.id}`, version: '1.0.0'},
        {capabilities: {}}
    );
    const eventStream: {status?: number} = {};
    try {
        const transport = new StreamableHTTPClientTransport(config.mcpUrl, {
            requestInit: {headers: requestHeaders(config)},
            fetch: async (input, init) => {
                const response = await fetch(input, init);
                if (init?.method === 'GET') {
                    eventStream.status = response.status;
                    process.stderr.write(
                        `MCP system: ${config.id} event stream HTTP ${response.status}\n`
                    );
                }
                return response;
            }
        });
        await client.connect(transport, {timeout: REQUEST_TIMEOUT_MS});
        const tools = await client.listTools(undefined, {
            timeout: REQUEST_TIMEOUT_MS
        });
        const names = new Set(tools.tools.map((tool) => tool.name));
        for (const required of [
            'fm_capabilities',
            'fm_read',
            'fm_write',
            'fm_confirm_write'
        ]) {
            if (!names.has(required)) {
                throw new Error(`live MCP server does not expose ${required}`);
            }
        }
        const capabilities = toolBody(
            await client.callTool(
                {name: 'fm_capabilities', arguments: {}},
                undefined,
                {timeout: REQUEST_TIMEOUT_MS}
            )
        );
        if (capabilities.writeAllowed !== true) {
            throw new Error('live MCP credential does not allow writes');
        }
        const policy: PolicyIdentityResult = {
            configuredPolicyId: config.policyId,
            observedCapabilitiesSha256: valueHash(capabilities),
            level:
                typeof capabilities.level === 'string'
                    ? capabilities.level
                    : undefined,
            role:
                typeof capabilities.role === 'string' ||
                capabilities.role === null
                    ? capabilities.role
                    : undefined,
            writeAllowed: true,
            durableOperationCredentialBound:
                capabilities.durableOperationCredentialBound === true,
            verified: true
        };
        const serverVersion = client.getServerVersion();
        return {
            config,
            client,
            eventStream,
            transport,
            tools: names,
            result: {
                ...initial,
                policy,
                server: {
                    name: serverVersion?.name,
                    version: serverVersion?.version,
                    protocolVersion: transport.protocolVersion
                },
                status: 'ready'
            }
        };
    } catch (error) {
        await client.close().catch(() => undefined);
        initial.error = errorText(error);
        throw Object.assign(new Error(initial.error), {targetResult: initial});
    }
}

function methodFor(scenario: ScenarioFixture, stepId: string): FixtureStep {
    const step = scenario.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`Scenario ${scenario.id} has no ${stepId} step`);
    return step;
}

async function measured<T>(
    state: ScenarioState,
    step: MeasuredStep,
    fn: () => Promise<T>
): Promise<T> {
    const started = performance.now();
    try {
        const result = await fn();
        state.steps.push({
            id: step.id,
            tool: step.tool,
            method: step.method,
            status: 'passed',
            latencyMs: elapsedMs(started)
        });
        return result;
    } catch (error) {
        state.steps.push({
            id: step.id,
            tool: step.tool,
            method: step.method,
            status: 'failed',
            latencyMs: elapsedMs(started),
            error: errorText(error)
        });
        throw error;
    }
}

async function readMethod(
    target: ConnectedTarget,
    state: ScenarioState,
    step: FixtureStep,
    params: Record<string, unknown>
): Promise<unknown> {
    const body = await measured(state, step, async () =>
        toolBody(
            await target.client.callTool(
                {
                    name: 'fm_read',
                    arguments: {method: step.method, params}
                },
                undefined,
                {timeout: REQUEST_TIMEOUT_MS}
            )
        )
    );
    if (body.method !== step.method || !('result' in body)) {
        throw new Error(`${step.method} returned an invalid read envelope`);
    }
    return body.result;
}

async function writeMethod(
    target: ConnectedTarget,
    state: ScenarioState,
    step: FixtureStep,
    params: Record<string, unknown>
): Promise<unknown> {
    const previewStep = {...step, id: `${step.id}:prepare`};
    const preview = await measured(state, previewStep, async () =>
        toolBody(
            await target.client.callTool(
                {
                    name: 'fm_write',
                    arguments: {method: step.method, params, mode: 'prepare'}
                },
                undefined,
                {timeout: REQUEST_TIMEOUT_MS}
            )
        )
    );
    if (
        preview.status !== 'confirmation_required' ||
        typeof preview.confirmationToken !== 'string' ||
        !preview.confirmationToken
    ) {
        throw new Error(
            `${step.method} did not return an explicit confirmation token`
        );
    }
    const confirmStep = {
        ...step,
        id: `${step.id}:confirm`,
        tool: 'fm_confirm_write'
    };
    const confirmed = await measured(state, confirmStep, async () =>
        toolBody(
            await target.client.callTool(
                {
                    name: 'fm_confirm_write',
                    arguments: {
                        confirmationToken: preview.confirmationToken
                    }
                },
                undefined,
                {timeout: REQUEST_TIMEOUT_MS}
            )
        )
    );
    if (
        confirmed.status !== 'executed' ||
        typeof confirmed.method !== 'string' ||
        confirmed.method.toLowerCase() !== step.method.toLowerCase() ||
        !('result' in confirmed)
    ) {
        throw new Error(`${step.method} returned an invalid execute envelope`);
    }
    return confirmed.result;
}

async function callMeasuredTool(
    target: ConnectedTarget,
    state: ScenarioState,
    step: FixtureStep,
    arguments_: Record<string, unknown>
): Promise<ToolBody> {
    return measured(state, step, async () =>
        toolBody(
            await target.client.callTool(
                {name: step.tool, arguments: arguments_},
                undefined,
                {timeout: REQUEST_TIMEOUT_MS}
            )
        )
    );
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) {
        throw new Error(`${label} is not a non-empty string`);
    }
    return value;
}

function operationRecord(value: unknown, label: string) {
    const operation = record(value, label);
    return {
        body: operation,
        id: text(operation.operationId, `${label}.operationId`),
        status: text(operation.status, `${label}.status`)
    };
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} did not return an object`);
    }
    return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
    const object = record(value, label);
    if (!Array.isArray(object.items)) {
        throw new Error(`${label} did not return an items array`);
    }
    return object.items.map((item, index) =>
        record(item, `${label}[${index}]`)
    );
}

function integer(value: unknown, label: string): number {
    if (!Number.isInteger(value)) throw new Error(`${label} is not an integer`);
    return value as number;
}

async function runGroupCrud(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    cleanup: {id?: number; verifiedDeleted: boolean}
): Promise<void> {
    const created = record(
        await writeMethod(target, state, methodFor(scenario, 'create'), {
            name: testName,
            description: `${testName} created`,
            groupType: 'standard',
            kind: 'manual',
            metadata: {mcpSystemEval: true}
        }),
        'group.Create'
    );
    cleanup.id = integer(created.id, 'group.Create id');
    const readCreated = record(
        await readMethod(target, state, methodFor(scenario, 'read-created'), {
            id: cleanup.id
        }),
        'group.Get'
    );
    if (readCreated.name !== testName) {
        throw new Error('group.Create state was not readable by group.Get');
    }
    const updatedName = `${testName}-updated`;
    await writeMethod(target, state, methodFor(scenario, 'update'), {
        id: cleanup.id,
        patch: {
            name: updatedName,
            description: `${testName} updated`,
            metadata: {mcpSystemEval: true, updated: true}
        }
    });
    const readUpdated = record(
        await readMethod(target, state, methodFor(scenario, 'read-updated'), {
            id: cleanup.id
        }),
        'group.Get'
    );
    if (
        readUpdated.name !== updatedName ||
        readUpdated.description !== `${testName} updated`
    ) {
        throw new Error('group.Update state did not match stored readback');
    }
    await writeMethod(target, state, methodFor(scenario, 'delete'), {
        id: cleanup.id
    });
    const afterDelete = records(
        await readMethod(target, state, methodFor(scenario, 'verify-deleted'), {
            query: updatedName,
            limit: 100
        }),
        'group.List'
    );
    if (afterDelete.some((item) => item.id === cleanup.id)) {
        throw new Error('group.Delete state remained visible in group.List');
    }
    cleanup.verifiedDeleted = true;
}

async function cleanupGroup(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    cleanup: {id?: number; verifiedDeleted: boolean}
): Promise<void> {
    if (cleanup.id === undefined || cleanup.verifiedDeleted) return;
    await writeMethod(
        target,
        state,
        {...methodFor(scenario, 'delete'), id: 'cleanup-delete'},
        {id: cleanup.id}
    );
    const rows = records(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'verify-deleted'), id: 'cleanup-verify'},
            {query: 'zz-verify-', limit: 1000}
        ),
        'group.List cleanup'
    );
    if (rows.some((item) => item.id === cleanup.id)) {
        throw new Error(`cleanup could not delete group ${cleanup.id}`);
    }
    cleanup.verifiedDeleted = true;
}

interface AssetCleanupState {
    id?: string;
    label: string;
    verifiedDeleted: boolean;
}

function assetFixture(testName: string): Buffer {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>${testName}</title><rect width="1" height="1" fill="#123456"/></svg>`,
        'utf8'
    );
}

async function listedAssets(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    stepId: string,
    label: string
): Promise<Record<string, unknown>[]> {
    return records(
        await readMethod(target, state, methodFor(scenario, stepId), {
            search: label,
            limit: 100
        }),
        'asset.List'
    );
}

async function runAssetTransferCrud(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    cleanup: AssetCleanupState
): Promise<void> {
    const uploaded = record(
        await writeMethod(target, state, methodFor(scenario, 'upload'), {
            contentType: 'image/svg+xml',
            data: assetFixture(testName).toString('base64'),
            label: testName,
            context: 'general'
        }),
        'asset.Upload'
    );
    cleanup.id = text(uploaded.id, 'asset.Upload.id');
    const expectedSha = text(uploaded.sha256, 'asset.Upload.sha256');
    if (
        uploaded.label !== testName ||
        uploaded.contentType !== 'image/svg+xml'
    ) {
        throw new Error('asset.Upload metadata did not match the fixture');
    }
    const listed = await listedAssets(
        target,
        scenario,
        state,
        'list-created',
        testName
    );
    if (!listed.some((item) => item.id === cleanup.id)) {
        throw new Error('asset.Upload state was not readable by asset.List');
    }

    const chunks: Buffer[] = [];
    let offset = 0;
    for (let index = 0; index < 100; index++) {
        const chunk = record(
            await readMethod(
                target,
                state,
                {
                    ...methodFor(scenario, 'read-chunk'),
                    id: `read-chunk:${index}`
                },
                {id: cleanup.id, offset, maxBytes: 16}
            ),
            'asset.ReadChunk'
        );
        if (
            chunk.id !== cleanup.id ||
            chunk.sha256 !== expectedSha ||
            chunk.offset !== offset
        ) {
            throw new Error('asset.ReadChunk metadata changed between chunks');
        }
        const encoded = text(chunk.data, 'asset.ReadChunk.data');
        const decoded = Buffer.from(encoded, 'base64');
        if (decoded.toString('base64') !== encoded) {
            throw new Error('asset.ReadChunk returned non-canonical base64');
        }
        chunks.push(decoded);
        const nextOffset = integer(
            chunk.nextOffset,
            'asset.ReadChunk.nextOffset'
        );
        if (nextOffset <= offset) {
            throw new Error('asset.ReadChunk did not advance nextOffset');
        }
        offset = nextOffset;
        if (chunk.eof === true) break;
        if (index === 99) throw new Error('asset.ReadChunk did not reach eof');
    }
    const readbackSha = createHash('sha256')
        .update(Buffer.concat(chunks))
        .digest('hex');
    if (readbackSha !== expectedSha) {
        throw new Error(
            'asset.ReadChunk bytes did not match the stored sha256'
        );
    }

    const deleted = record(
        await writeMethod(target, state, methodFor(scenario, 'delete'), {
            id: cleanup.id
        }),
        'asset.Delete'
    );
    if (deleted.deleted !== true || deleted.id !== cleanup.id) {
        throw new Error('asset.Delete returned an invalid deletion receipt');
    }
    const afterDelete = await listedAssets(
        target,
        scenario,
        state,
        'verify-deleted',
        testName
    );
    if (afterDelete.some((item) => item.id === cleanup.id)) {
        throw new Error('asset.Delete state remained visible in asset.List');
    }
    cleanup.verifiedDeleted = true;
}

async function cleanupAsset(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    cleanup: AssetCleanupState
): Promise<void> {
    if (!cleanup.id || cleanup.verifiedDeleted) return;
    const existing = await listedAssets(
        target,
        scenario,
        state,
        'verify-deleted',
        cleanup.label
    );
    if (!existing.some((item) => item.id === cleanup.id)) {
        cleanup.verifiedDeleted = true;
        return;
    }
    await writeMethod(
        target,
        state,
        {...methodFor(scenario, 'delete'), id: 'cleanup-delete'},
        {id: cleanup.id}
    );
    const afterDelete = await listedAssets(
        target,
        scenario,
        state,
        'verify-deleted',
        cleanup.label
    );
    if (afterDelete.some((item) => item.id === cleanup.id)) {
        throw new Error(`cleanup could not delete asset ${cleanup.id}`);
    }
    cleanup.verifiedDeleted = true;
}

async function pollOperation(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    operationId: string
): Promise<Record<string, unknown>> {
    const step = methodFor(scenario, 'poll');
    for (let attempt = 0; attempt < 100; attempt++) {
        const operation = operationRecord(
            await callMeasuredTool(
                target,
                state,
                {...step, id: `poll:${attempt}`},
                {operationId}
            ),
            'fm_get_operation'
        );
        if (operation.status === 'succeeded') return operation.body;
        if (operation.status !== 'reserved' && operation.status !== 'running') {
            throw new Error(
                `durable operation reached ${operation.status} instead of succeeded`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('durable operation polling timed out');
}

async function runDurableOperationReplay(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    cleanup: {id?: number; verifiedDeleted: boolean}
): Promise<void> {
    if (!target.tools.has('fm_get_operation')) {
        throw new ScenarioUnavailable(
            'The target does not expose fm_get_operation'
        );
    }
    if (target.result.policy.durableOperationCredentialBound !== true) {
        throw new ScenarioUnavailable(
            'The authenticated target credential is not tenant, user, and credential bound'
        );
    }
    const params = {
        name: testName,
        description: `${testName} durable`,
        groupType: 'standard',
        kind: 'manual',
        metadata: {mcpSystemEval: true, durable: true}
    };
    const idempotencyKey = `${testName}-idempotency`;
    const started = operationRecord(
        await callMeasuredTool(target, state, methodFor(scenario, 'execute'), {
            method: methodFor(scenario, 'execute').method,
            params,
            mode: 'execute',
            idempotencyKey
        }),
        'fm_write durable execution'
    );
    const settled = operationRecord(
        await pollOperation(target, scenario, state, started.id),
        'fm_get_operation settled'
    );
    const result = record(settled.body.result, 'durable operation result');
    cleanup.id = integer(result.id, 'durable group.Create id');
    const stored = record(
        await readMethod(target, state, methodFor(scenario, 'read-created'), {
            id: cleanup.id
        }),
        'group.Get durable result'
    );
    if (stored.name !== testName) {
        throw new Error('durable group.Create state was not readable');
    }
    const replay = operationRecord(
        await callMeasuredTool(target, state, methodFor(scenario, 'replay'), {
            method: methodFor(scenario, 'execute').method,
            params,
            mode: 'execute',
            idempotencyKey
        }),
        'fm_write durable replay'
    );
    if (replay.id !== started.id || replay.status !== 'succeeded') {
        throw new Error('durable replay did not return the settled operation');
    }
    const replayResult = record(replay.body.result, 'durable replay result');
    if (replayResult.id !== cleanup.id) {
        throw new Error('durable replay returned a different mutation result');
    }
    await writeMethod(target, state, methodFor(scenario, 'delete'), {
        id: cleanup.id
    });
    const afterDelete = records(
        await readMethod(target, state, methodFor(scenario, 'verify-deleted'), {
            query: testName,
            limit: 100
        }),
        'group.List durable cleanup'
    );
    if (afterDelete.some((item) => item.id === cleanup.id)) {
        throw new Error('durable scenario group remained after deletion');
    }
    cleanup.verifiedDeleted = true;
}

interface FileTransferCleanupState {
    label: string;
    groupId?: number;
    uploadId?: string;
    assetId?: string;
    finalized: boolean;
    assetDeleted: boolean;
    groupDeleted: boolean;
}

function pngFixture(): Buffer {
    return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
}

async function durableFileWrite(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    step: FixtureStep,
    params: Record<string, unknown>,
    idempotencyKey: string
): Promise<Record<string, unknown>> {
    let response = await callMeasuredTool(target, state, step, {
        method: step.method,
        params,
        mode: 'execute',
        idempotencyKey
    });
    if (response.status === 'confirmation_required') {
        const confirmationToken = text(
            response.confirmationToken,
            `${step.method}.confirmationToken`
        );
        response = await measured(
            state,
            {
                ...step,
                id: `${step.id}:confirm`,
                tool: 'fm_confirm_write'
            },
            async () =>
                toolBody(
                    await target.client.callTool(
                        {
                            name: 'fm_confirm_write',
                            arguments: {confirmationToken}
                        },
                        undefined,
                        {timeout: REQUEST_TIMEOUT_MS}
                    )
                )
        );
    }
    const started = operationRecord(
        response,
        `${step.method} durable execution`
    );
    const settled = operationRecord(
        await pollOperation(target, scenario, state, started.id),
        `${step.method} settled operation`
    );
    if (settled.id !== started.id || settled.status !== 'succeeded') {
        throw new Error(`${step.method} did not settle successfully`);
    }
    state.operationIds ??= new Map();
    state.operationIds.set(step.id, started.id);
    return record(settled.body.result, `${step.method} result`);
}

async function fileTransferAvailable(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState
): Promise<void> {
    if (!target.tools.has('get_api_method')) {
        throw new ScenarioUnavailable(
            'The target does not expose get_api_method for file-transfer discovery'
        );
    }
    try {
        await callMeasuredTool(
            target,
            state,
            methodFor(scenario, 'availability'),
            {method: 'fileTransfer.Begin'}
        );
    } catch (error) {
        throw new ScenarioUnavailable(
            `fileTransfer.Begin is unavailable on this target: ${errorText(error)}`
        );
    }
    if (!target.tools.has('fm_get_operation')) {
        throw new ScenarioUnavailable(
            'fileTransfer.Begin exists but durable operation polling is unavailable'
        );
    }
    if (target.result.policy.durableOperationCredentialBound !== true) {
        throw new ScenarioUnavailable(
            'fileTransfer.Begin exists but the authenticated session cannot bind durable receipts'
        );
    }
}

async function runFileTransferDurable(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    cleanup: FileTransferCleanupState
): Promise<void> {
    await fileTransferAvailable(target, scenario, state);
    const coverage = await callMeasuredTool(
        target,
        state,
        methodFor(scenario, 'coverage'),
        {
            surface: 'http',
            query: 'asset',
            limit: 1
        }
    );
    if (!Array.isArray(coverage.items) || coverage.items.length !== 1) {
        throw new Error(
            'Operation coverage did not return the bounded HTTP mapping'
        );
    }
    const group = record(
        await writeMethod(target, state, methodFor(scenario, 'group-create'), {
            name: testName,
            description: `${testName} file target`,
            groupType: 'standard',
            kind: 'manual',
            metadata: {mcpSystemEval: true, fileTransfer: true}
        }),
        'group.Create file-transfer target'
    );
    cleanup.groupId = integer(group.id, 'file-transfer group id');
    const bytes = pngFixture();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const begin = await durableFileWrite(
        target,
        scenario,
        state,
        methodFor(scenario, 'begin'),
        {
            kind: 'visual_asset',
            fileName: `${testName}.png`,
            sizeBytes: bytes.length,
            sha256,
            contentType: 'image/png',
            target: {
                resourceKind: 'group',
                resourceId: String(cleanup.groupId)
            },
            options: {label: testName, context: 'general'}
        },
        `${testName}-begin`
    );
    cleanup.uploadId = text(begin.uploadId, 'fileTransfer.Begin.uploadId');
    if (begin.nextOffset !== 0) {
        throw new Error('fileTransfer.Begin did not start at offset zero');
    }
    const split = Math.ceil(bytes.length / 2);
    let offset = 0;
    for (const [index, chunk] of [
        bytes.subarray(0, split),
        bytes.subarray(split)
    ].entries()) {
        const written = await durableFileWrite(
            target,
            scenario,
            state,
            {
                ...methodFor(scenario, 'write-chunk'),
                id: `write-chunk:${index}`
            },
            {
                uploadId: cleanup.uploadId,
                offset,
                data: chunk.toString('base64')
            },
            `${testName}-chunk-${index}`
        );
        offset = integer(
            written.nextOffset,
            'fileTransfer.WriteChunk.nextOffset'
        );
        if (written.uploadId !== cleanup.uploadId || offset > bytes.length) {
            throw new Error(
                'fileTransfer.WriteChunk returned invalid progress'
            );
        }
    }
    if (offset !== bytes.length) {
        throw new Error('fileTransfer.WriteChunk did not store every byte');
    }
    const openUpload = record(
        await readMethod(target, state, methodFor(scenario, 'upload-get'), {
            uploadId: cleanup.uploadId
        }),
        'fileTransfer.Get open upload'
    );
    if (
        openUpload.status !== 'open' ||
        openUpload.nextOffset !== bytes.length ||
        openUpload.sha256 !== sha256
    ) {
        throw new Error(
            'fileTransfer.Get did not expose authoritative progress'
        );
    }
    const finalized = await durableFileWrite(
        target,
        scenario,
        state,
        methodFor(scenario, 'finalize'),
        {uploadId: cleanup.uploadId},
        `${testName}-finalize`
    );
    cleanup.finalized = true;
    const reconciled = await callMeasuredTool(
        target,
        state,
        methodFor(scenario, 'reconcile'),
        {
            operationId: state.operationIds?.get('finalize')
        }
    );
    if (
        reconciled.supported !== true ||
        reconciled.state !== 'completed' ||
        record(reconciled.target, 'reconciled target').id !==
            cleanup.uploadId ||
        !Array.isArray(reconciled.actions) ||
        reconciled.actions.length !== 0
    ) {
        throw new Error('Reconciliation did not prove the completed upload');
    }
    const asset = record(finalized.result, 'fileTransfer.Finalize.result');
    cleanup.assetId = text(asset.id, 'fileTransfer visual asset id');
    const storedSha256 = text(asset.sha256, 'fileTransfer visual asset sha256');
    const storedSizeBytes = integer(
        asset.sizeBytes,
        'fileTransfer visual asset sizeBytes'
    );
    if (
        finalized.kind !== 'visual_asset' ||
        finalized.sha256 !== sha256 ||
        finalized.sizeBytes !== bytes.length ||
        asset.contentType !== 'image/png' ||
        storedSha256.length !== 64 ||
        storedSizeBytes < 1
    ) {
        throw new Error(
            'fileTransfer.Finalize metadata did not match the upload'
        );
    }
    const finalizedUpload = record(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'upload-get'), id: 'upload-get-finalized'},
            {uploadId: cleanup.uploadId}
        ),
        'fileTransfer.Get finalized upload'
    );
    const persistedAsset = record(
        finalizedUpload.result,
        'fileTransfer.Get finalized result'
    );
    if (
        finalizedUpload.status !== 'finalized' ||
        finalizedUpload.nextOffset !== bytes.length ||
        persistedAsset.id !== cleanup.assetId ||
        persistedAsset.sha256 !== storedSha256 ||
        persistedAsset.sizeBytes !== storedSizeBytes
    ) {
        throw new Error('fileTransfer.Get did not expose finalized state');
    }
    const chunks: Buffer[] = [];
    let readOffset = 0;
    for (let index = 0; index < 100; index++) {
        const read = record(
            await readMethod(
                target,
                state,
                {
                    ...methodFor(scenario, 'read-chunk'),
                    id: `read-chunk:${index}`
                },
                {
                    kind: 'visual_asset',
                    artifactId: cleanup.assetId,
                    offset: readOffset,
                    maxBytes: 16
                }
            ),
            'fileTransfer.ReadChunk'
        );
        if (
            read.offset !== readOffset ||
            read.sha256 !== storedSha256 ||
            read.sizeBytes !== storedSizeBytes
        ) {
            throw new Error(
                'fileTransfer.ReadChunk metadata changed between chunks'
            );
        }
        chunks.push(Buffer.from(text(read.dataBase64, 'dataBase64'), 'base64'));
        readOffset = integer(
            read.nextOffset,
            'fileTransfer.ReadChunk.nextOffset'
        );
        if (read.eof === true) break;
        if (index === 99)
            throw new Error('fileTransfer.ReadChunk did not reach eof');
    }
    const storedBytes = Buffer.concat(chunks);
    if (
        storedBytes.byteLength !== storedSizeBytes ||
        createHash('sha256').update(storedBytes).digest('hex') !== storedSha256
    ) {
        throw new Error(
            'fileTransfer.ReadChunk bytes did not match the stored asset'
        );
    }
    await writeMethod(target, state, methodFor(scenario, 'asset-delete'), {
        id: cleanup.assetId
    });
    const remainingAssets = records(
        await readMethod(target, state, methodFor(scenario, 'asset-verify'), {
            search: testName,
            limit: 100
        }),
        'asset.List file-transfer cleanup'
    );
    if (remainingAssets.some((item) => item.id === cleanup.assetId)) {
        throw new Error('file-transfer asset remained after asset.Delete');
    }
    cleanup.assetDeleted = true;
    await writeMethod(target, state, methodFor(scenario, 'group-delete'), {
        id: cleanup.groupId
    });
    const remainingGroups = records(
        await readMethod(target, state, methodFor(scenario, 'group-verify'), {
            query: testName,
            limit: 100
        }),
        'group.List file-transfer cleanup'
    );
    if (remainingGroups.some((item) => item.id === cleanup.groupId)) {
        throw new Error('file-transfer group remained after group.Delete');
    }
    cleanup.groupDeleted = true;
}

async function cleanupFileTransfer(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    cleanup: FileTransferCleanupState
): Promise<void> {
    if (cleanup.uploadId && !cleanup.finalized) {
        const cancelled = record(
            await writeMethod(
                target,
                state,
                {...methodFor(scenario, 'cancel'), id: 'cleanup-cancel'},
                {uploadId: cleanup.uploadId}
            ),
            'fileTransfer.Cancel cleanup'
        );
        if (cancelled.cancelled !== true) {
            throw new Error('fileTransfer.Cancel did not confirm cancellation');
        }
    }
    if (cleanup.finalized && !cleanup.assetId) {
        throw new Error(
            'finalized file transfer did not expose an asset id for cleanup'
        );
    }
    if (cleanup.assetId && !cleanup.assetDeleted) {
        await writeMethod(
            target,
            state,
            {...methodFor(scenario, 'asset-delete'), id: 'cleanup-asset'},
            {id: cleanup.assetId}
        );
        const remainingAssets = records(
            await readMethod(
                target,
                state,
                {
                    ...methodFor(scenario, 'asset-verify'),
                    id: 'cleanup-asset-verify'
                },
                {search: cleanup.label, limit: 100}
            ),
            'asset.List file-transfer final cleanup'
        );
        if (remainingAssets.some((item) => item.id === cleanup.assetId)) {
            throw new Error(
                `cleanup could not delete asset ${cleanup.assetId}`
            );
        }
        cleanup.assetDeleted = true;
    }
    if (cleanup.groupId !== undefined && !cleanup.groupDeleted) {
        await writeMethod(
            target,
            state,
            {...methodFor(scenario, 'group-delete'), id: 'cleanup-group'},
            {id: cleanup.groupId}
        );
        const remainingGroups = records(
            await readMethod(
                target,
                state,
                {
                    ...methodFor(scenario, 'group-verify'),
                    id: 'cleanup-group-verify'
                },
                {query: cleanup.label, limit: 100}
            ),
            'group.List file-transfer final cleanup'
        );
        if (remainingGroups.some((item) => item.id === cleanup.groupId)) {
            throw new Error(
                `cleanup could not delete group ${cleanup.groupId}`
            );
        }
        cleanup.groupDeleted = true;
    }
}

interface SimulatorCleanupState {
    child?: ChildProcess;
    pidFile?: string;
    deviceId?: string;
    admitted: boolean;
    verifiedDeleted: boolean;
    stderr: string;
    spawnError?: string;
}

function simulatorEnvironment(): NodeJS.ProcessEnv {
    return {
        PATH: process.env.PATH,
        LANG: 'C.UTF-8',
        NODE_ENV: 'development',
        FM_CLIENT_ID: `mcp-system-eval-${process.pid}`
    };
}

function simulatorDeviceId(
    config: NonNullable<TargetConfig['simulator']>
): string {
    const cwd = path.dirname(path.dirname(path.dirname(config.entryPath)));
    const output = execFileSync(
        process.execPath,
        [
            config.entryPath,
            '--profile',
            config.profile,
            '--count',
            '1',
            '--print-ids'
        ],
        {
            cwd,
            env: simulatorEnvironment(),
            encoding: 'utf8',
            timeout: REQUEST_TIMEOUT_MS,
            maxBuffer: 16 * 1024
        }
    );
    const ids = output.trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1) {
        throw new Error('simulator did not resolve exactly one device id');
    }
    return ids[0];
}

function startSimulator(
    config: NonNullable<TargetConfig['simulator']>,
    deviceId: string,
    testName: string,
    cleanup: SimulatorCleanupState
): void {
    const cwd = path.dirname(path.dirname(path.dirname(config.entryPath)));
    const child = spawn(
        process.execPath,
        [
            config.entryPath,
            '--ws-url',
            config.wsUrl.toString(),
            '--profile',
            config.profile,
            '--count',
            '1',
            '--names-json',
            JSON.stringify({[deviceId]: testName})
        ],
        {
            cwd,
            env: simulatorEnvironment(),
            stdio: ['ignore', 'ignore', 'pipe']
        }
    );
    cleanup.child = child;
    if (config.pidFile) cleanup.pidFile = config.pidFile;
    if (!child.pid) throw new Error('simulator process did not expose a pid');
    if (config.pidFile) {
        writeFileSync(config.pidFile, `${child.pid}\n`, {
            encoding: 'utf8',
            mode: 0o600
        });
    }
    child.stderr?.on('data', (chunk: Buffer) => {
        cleanup.stderr = `${cleanup.stderr}${chunk.toString('utf8')}`.slice(
            -4096
        );
    });
    child.once('error', (error) => {
        cleanup.spawnError = errorText(error);
    });
}

async function stopSimulator(cleanup: SimulatorCleanupState): Promise<void> {
    const child = cleanup.child;
    if (!child) return;
    const configuredPidFile = cleanup.pidFile;
    const removePidFile = (): void => {
        if (!configuredPidFile) return;
        try {
            unlinkSync(configuredPidFile);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    };
    if (child.exitCode !== null || child.signalCode !== null) {
        removePidFile();
        return;
    }
    const waitForExit = (timeoutMs: number): Promise<boolean> =>
        new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    try {
        const gracefulExit = waitForExit(5_000);
        child.kill('SIGTERM');
        if (await gracefulExit) return;
        const forcedExit = waitForExit(5_000);
        child.kill('SIGKILL');
        if (!(await forcedExit)) {
            throw new Error(
                `simulator process ${child.pid ?? '<unknown>'} survived cleanup`
            );
        }
    } finally {
        removePidFile();
    }
}

function simulatorAlive(cleanup: SimulatorCleanupState): void {
    if (cleanup.spawnError) {
        throw new Error(`simulator failed to start: ${cleanup.spawnError}`);
    }
    if (
        cleanup.child &&
        (cleanup.child.exitCode !== null || cleanup.child.signalCode !== null)
    ) {
        throw new Error(
            `simulator exited before the workflow completed${cleanup.stderr ? `: ${cleanup.stderr}` : ''}`
        );
    }
}

async function pollListFor(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    stepId: string,
    params: Record<string, unknown>,
    select: (
        items: Record<string, unknown>[]
    ) => Record<string, unknown> | undefined,
    cleanup: SimulatorCleanupState
): Promise<Record<string, unknown>> {
    const step = methodFor(scenario, stepId);
    for (let attempt = 0; attempt < 100; attempt++) {
        simulatorAlive(cleanup);
        const items = records(
            await readMethod(
                target,
                state,
                {...step, id: `${stepId}:${attempt}`},
                params
            ),
            step.method
        );
        const found = select(items);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`${step.method} did not observe the simulator in time`);
}

async function readDeviceRpc(
    target: ConnectedTarget,
    state: ScenarioState,
    step: FixtureStep,
    deviceId: string,
    method: string,
    params: Record<string, unknown>
): Promise<unknown> {
    const body = await measured(state, step, async () =>
        toolBody(
            await target.client.callTool(
                {
                    name: 'fm_read',
                    arguments: {
                        method: 'device.Call',
                        params: {shellyID: deviceId, method, params}
                    }
                },
                undefined,
                {timeout: REQUEST_TIMEOUT_MS}
            )
        )
    );
    if (
        typeof body.method !== 'string' ||
        body.method.toLowerCase() !== method.toLowerCase() ||
        !('result' in body)
    ) {
        throw new Error(`${method} returned an invalid read envelope`);
    }
    return body.result;
}

async function writeDeviceRpc(
    target: ConnectedTarget,
    state: ScenarioState,
    step: FixtureStep,
    deviceId: string,
    method: string,
    params: Record<string, unknown>
): Promise<unknown> {
    const preview = await measured(
        state,
        {...step, id: `${step.id}:prepare`},
        async () =>
            toolBody(
                await target.client.callTool(
                    {
                        name: 'fm_write',
                        arguments: {
                            method: 'device.Call',
                            params: {shellyID: deviceId, method, params},
                            mode: 'prepare'
                        }
                    },
                    undefined,
                    {timeout: REQUEST_TIMEOUT_MS}
                )
            )
    );
    if (
        preview.status !== 'confirmation_required' ||
        typeof preview.confirmationToken !== 'string' ||
        !preview.confirmationToken
    ) {
        throw new Error(`${method} did not return a confirmation token`);
    }
    const confirmed = await measured(
        state,
        {...step, id: `${step.id}:confirm`, tool: 'fm_confirm_write'},
        async () =>
            toolBody(
                await target.client.callTool(
                    {
                        name: 'fm_confirm_write',
                        arguments: {
                            confirmationToken: preview.confirmationToken
                        }
                    },
                    undefined,
                    {timeout: REQUEST_TIMEOUT_MS}
                )
            )
    );
    if (
        confirmed.status !== 'executed' ||
        typeof confirmed.method !== 'string' ||
        confirmed.method.toLowerCase() !== method.toLowerCase() ||
        !('result' in confirmed)
    ) {
        throw new Error(`${method} returned an invalid execute envelope`);
    }
    return confirmed.result;
}

async function verifyDeviceEventDelivery(
    target: ConnectedTarget,
    state: ScenarioState,
    deviceId: string,
    trigger: () => Promise<void>
): Promise<void> {
    const uri = `fm://events?deviceId=${encodeURIComponent(deviceId)}`;
    if (target.eventStream.status !== 200) {
        throw new Error(
            `MCP event stream unavailable: HTTP ${target.eventStream.status ?? 'not opened'}`
        );
    }
    const request = {timeout: REQUEST_TIMEOUT_MS};
    const before = await measured(
        state,
        {id: 'events-before', tool: 'resources/read', method: 'resources/read'},
        () => target.client.readResource({uri}, request)
    );
    const content = before.contents[0];
    if (!content || !('text' in content))
        throw new Error('Event feed did not return JSON text');
    const previous = record(JSON.parse(content.text), 'event feed');
    const cursor = text(previous.cursor, 'event feed cursor');
    let changed = false;
    target.client.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        async (notification) => {
            if (notification.params.uri === uri) changed = true;
        }
    );
    let subscribed = false;
    try {
        await measured(
            state,
            {
                id: 'events-subscribe',
                tool: 'resources/subscribe',
                method: 'resources/subscribe'
            },
            () => target.client.subscribeResource({uri}, request)
        );
        subscribed = true;
        const triggerStartedAt = Date.now();
        await trigger();
        await measured(
            state,
            {
                id: 'events-live-delivery',
                tool: 'notifications/resources/updated',
                method: 'notifications/resources/updated'
            },
            async () => {
                const deadline = Date.now() + REQUEST_TIMEOUT_MS;
                while (!changed && Date.now() < deadline)
                    await new Promise((resolve) => setTimeout(resolve, 50));
                if (!changed) {
                    const retained = await target.client.readResource(
                        {uri: `${uri}&cursor=${encodeURIComponent(cursor)}`},
                        request
                    );
                    const retainedContent = retained.contents[0];
                    const retainedFeed =
                        retainedContent && 'text' in retainedContent
                            ? record(
                                  JSON.parse(retainedContent.text),
                                  'event delivery diagnosis'
                              )
                            : {};
                    const retainedEvents = Array.isArray(retainedFeed.events)
                        ? retainedFeed.events.map(
                              (event) =>
                                  record(event, 'retained event').eventType
                          )
                        : [];
                    throw new Error(
                        `No event resource notification arrived after simulator disconnect; retained event types: ${JSON.stringify(retainedEvents)}`
                    );
                }
            }
        );
        await measured(
            state,
            {
                id: 'events-replay-read',
                tool: 'resources/read',
                method: 'resources/read'
            },
            async () => {
                const reply = await target.client.readResource(
                    {uri: `${uri}&cursor=${encodeURIComponent(cursor)}`},
                    request
                );
                const item = reply.contents[0];
                if (!item || !('text' in item))
                    throw new Error('Event replay did not return text');
                const feed = record(JSON.parse(item.text), 'event replay');
                const events = feed.events;
                if (
                    feed.historyGap !== false ||
                    !Array.isArray(events) ||
                    events.length === 0
                ) {
                    throw new Error(
                        'Event replay did not retain the observed simulator event'
                    );
                }
                for (const value of events) {
                    const event = record(value, 'event row');
                    if (
                        typeof event.id !== 'string' ||
                        !/^\d+$/.test(event.id) ||
                        !Array.isArray(event.deviceIds) ||
                        !event.deviceIds.includes(deviceId)
                    ) {
                        throw new Error(
                            'Event replay returned an unbound event'
                        );
                    }
                }
                if (
                    !events.some((value) => {
                        const event = record(value, 'event row');
                        return (
                            event.eventType === 'Shelly.Disconnect' &&
                            typeof event.timestamp === 'string' &&
                            Date.parse(event.timestamp) >= triggerStartedAt
                        );
                    })
                )
                    throw new Error(
                        'Retained events did not include the simulator disconnect caused by this trial'
                    );
            }
        );
    } finally {
        target.client.removeNotificationHandler(
            'notifications/resources/updated'
        );
        if (subscribed)
            await measured(
                state,
                {
                    id: 'events-unsubscribe',
                    tool: 'resources/unsubscribe',
                    method: 'resources/unsubscribe'
                },
                () => target.client.unsubscribeResource({uri}, request)
            );
    }
}

async function verifyScopedAutomationCrud(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    deviceId: string
): Promise<void> {
    const definition = {
        name: `${testName}-automation`,
        deviceIds: [deviceId],
        schedule: {kind: 'timer', seconds: 86400},
        method: 'Switch.Set',
        params: {id: 0, on: false}
    };
    let automation: Record<string, unknown> | undefined;
    await runWithCleanup(
        async () => {
            automation = record(
                await writeMethod(
                    target,
                    state,
                    methodFor(scenario, 'scoped-create'),
                    {
                        ...definition,
                        idempotencyKey: randomUUID()
                    }
                ),
                'scopedautomation.Create'
            );
            const initialRevision = automation.revision;
            const created = record(
                await readMethod(
                    target,
                    state,
                    methodFor(scenario, 'scoped-get'),
                    {id: automation.id}
                ),
                'scopedautomation.Get'
            );
            if (
                created.name !== definition.name ||
                created.enabled !== true ||
                JSON.stringify(created.deviceIds) !== JSON.stringify([deviceId])
            ) {
                throw new Error(
                    'Scoped automation did not retain its fixed target and enabled state'
                );
            }
            if (
                'executionToken' in created ||
                'tokenHash' in created ||
                'authority' in created
            ) {
                throw new Error(
                    'Scoped automation exposed private execution data'
                );
            }
            automation = record(
                await writeMethod(
                    target,
                    state,
                    methodFor(scenario, 'scoped-update'),
                    {
                        ...definition,
                        name: `${definition.name}-updated`,
                        id: automation.id,
                        expectedRevision: initialRevision
                    }
                ),
                'scopedautomation.Update'
            );
            const updated = record(
                await readMethod(
                    target,
                    state,
                    {
                        ...methodFor(scenario, 'scoped-get'),
                        id: 'scoped-get-updated'
                    },
                    {id: automation.id}
                ),
                'scopedautomation.Get updated'
            );
            if (
                updated.name !== `${definition.name}-updated` ||
                updated.revision === initialRevision
            ) {
                throw new Error(
                    'Scoped automation update did not advance its revision'
                );
            }
        },
        async () => {
            if (!automation) {
                for (let offset = 0; ; offset += 100) {
                    const listing = record(
                        await readMethod(
                            target,
                            state,
                            {
                                ...methodFor(scenario, 'scoped-list'),
                                id: `scoped-recover-create:${offset}`
                            },
                            {limit: 100, offset}
                        ),
                        'scopedautomation.List recovery'
                    );
                    const items = records(
                        listing.items,
                        'scopedautomation.List recovery items'
                    );
                    automation = items.find(
                        (item) => item.name === definition.name
                    );
                    if (automation || items.length < 100) break;
                }
            }
            if (!automation) return;
            let latest: Record<string, unknown>;
            try {
                latest = record(
                    await readMethod(
                        target,
                        state,
                        {
                            ...methodFor(scenario, 'scoped-get'),
                            id: 'scoped-cleanup-get'
                        },
                        {id: automation.id}
                    ),
                    'scopedautomation.Get cleanup'
                );
            } catch (error) {
                if (error instanceof ToolCallFailure && error.rpcCode === 1002)
                    return;
                throw error;
            }
            await writeMethod(
                target,
                state,
                methodFor(scenario, 'scoped-delete'),
                {id: latest.id, expectedRevision: latest.revision}
            );
            const listing = record(
                await readMethod(
                    target,
                    state,
                    methodFor(scenario, 'scoped-list'),
                    {limit: 100}
                ),
                'scopedautomation.List'
            );
            if (
                !Array.isArray(listing.items) ||
                listing.items.some(
                    (item) => record(item, 'scoped automation').id === latest.id
                )
            ) {
                throw new Error(
                    'Scoped automation deletion did not remove the owned record'
                );
            }
        }
    );
}

async function runSimulatedDeviceControl(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    cleanup: SimulatorCleanupState
): Promise<void> {
    const simulator = target.config.simulator;
    if (!simulator) {
        throw new ScenarioUnavailable(
            'No disposable host simulator entry and WebSocket URL were configured'
        );
    }
    cleanup.deviceId = simulatorDeviceId(simulator);
    startSimulator(simulator, cleanup.deviceId, testName, cleanup);
    const pending = await pollListFor(
        target,
        scenario,
        state,
        'wait-pending',
        {state: 'open', limit: 500},
        (items) => items.find((item) => item.shellyID === cleanup.deviceId),
        cleanup
    );
    const entryId = text(pending.entryId, 'waitingroom.List entryId');
    await writeMethod(target, state, methodFor(scenario, 'approve'), {
        entryId,
        action: 'create_new_device'
    });
    cleanup.admitted = true;
    await pollListFor(
        target,
        scenario,
        state,
        'wait-online',
        {filters: {shellyID: cleanup.deviceId}, limit: 10},
        (items) =>
            items.find(
                (item) =>
                    item.shellyID === cleanup.deviceId &&
                    item.presence === 'online'
            ),
        cleanup
    );
    const device = record(
        await readMethod(target, state, methodFor(scenario, 'read-status'), {
            shellyID: cleanup.deviceId
        }),
        'device.Get'
    );
    if (device.presence !== 'online' || device.shellyID !== cleanup.deviceId) {
        throw new Error(
            'admitted simulator was not readable as an online device'
        );
    }
    await writeDeviceRpc(
        target,
        state,
        methodFor(scenario, 'control'),
        cleanup.deviceId,
        'Switch.Set',
        {id: 0, on: true}
    );
    const switchStatus = record(
        await readDeviceRpc(
            target,
            state,
            methodFor(scenario, 'verify-control'),
            cleanup.deviceId,
            'Switch.GetStatus',
            {id: 0}
        ),
        'Switch.GetStatus'
    );
    if (switchStatus.output !== true) {
        throw new Error('Switch.Set state was not visible in Switch.GetStatus');
    }
    await verifyScopedAutomationCrud(
        target,
        scenario,
        state,
        testName,
        cleanup.deviceId
    );
    await verifyDeviceEventDelivery(target, state, cleanup.deviceId, () =>
        stopSimulator(cleanup)
    );
    const disconnectStep = methodFor(scenario, 'verify-disconnected');
    let disconnected = false;
    for (let attempt = 0; attempt < 100; attempt++) {
        const afterStop = record(
            await readMethod(
                target,
                state,
                {...disconnectStep, id: `verify-disconnected:${attempt}`},
                {shellyID: cleanup.deviceId}
            ),
            'device.Get disconnected'
        );
        if (afterStop.presence === 'offline') {
            disconnected = true;
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!disconnected)
        throw new Error('device remained online after simulator exit');
    await writeMethod(target, state, methodFor(scenario, 'delete'), {
        shellyID: cleanup.deviceId
    });
    const afterDelete = records(
        await readMethod(target, state, methodFor(scenario, 'verify-deleted'), {
            filters: {shellyID: cleanup.deviceId},
            limit: 10
        }),
        'device.List deleted simulator'
    );
    if (afterDelete.some((item) => item.shellyID === cleanup.deviceId)) {
        throw new Error(
            'device.Delete left the simulator visible in device.List'
        );
    }
    cleanup.verifiedDeleted = true;
}

async function cleanupSimulatorDevice(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    cleanup: SimulatorCleanupState
): Promise<void> {
    await stopSimulator(cleanup);
    if (!cleanup.admitted || !cleanup.deviceId || cleanup.verifiedDeleted)
        return;
    await writeMethod(
        target,
        state,
        {...methodFor(scenario, 'delete'), id: 'cleanup-delete'},
        {shellyID: cleanup.deviceId}
    );
    const remaining = records(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'verify-deleted'), id: 'cleanup-verify'},
            {filters: {shellyID: cleanup.deviceId}, limit: 10}
        ),
        'device.List simulator cleanup'
    );
    if (remaining.some((item) => item.shellyID === cleanup.deviceId)) {
        throw new Error(`cleanup could not delete device ${cleanup.deviceId}`);
    }
    cleanup.verifiedDeleted = true;
}

function graphNodeId(): string {
    return randomUUID().replaceAll('-', '').slice(0, 16);
}

function testGraph(testName: string): Record<string, unknown> {
    const injectId = graphNodeId();
    const debugId = graphNodeId();
    return {
        properties: {label: testName, disabled: true},
        nodes: [
            {
                id: injectId,
                type: 'inject',
                name: '',
                props: [],
                repeat: '',
                crontab: '',
                once: false,
                x: 160,
                y: 120,
                wires: [[debugId]]
            },
            {
                id: debugId,
                type: 'debug',
                name: '',
                active: true,
                tosidebar: true,
                console: false,
                complete: 'payload',
                targetType: 'msg',
                x: 380,
                y: 120,
                wires: []
            }
        ],
        configs: [],
        subflows: []
    };
}

function graphRevision(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) {
        throw new Error(`${label} did not return a revision`);
    }
    return value;
}

async function runNodeRedGraphCrud(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    testName: string,
    cleanup: {flowId?: string; revision?: string; verifiedDeleted: boolean}
): Promise<void> {
    const engines = records(
        await readMethod(
            target,
            state,
            methodFor(scenario, 'availability'),
            {}
        ),
        'automation.ListEngines'
    );
    const nodeRed = engines.find((item) => item.engine === 'node_red');
    if (nodeRed?.available !== true || nodeRed.canCreate !== true) {
        throw new ScenarioUnavailable(
            'Node-RED is not available for real automation authoring'
        );
    }
    const graph = testGraph(testName);
    const validation = record(
        await readMethod(target, state, methodFor(scenario, 'validate'), {
            graph
        }),
        'automation.Graph.Validate'
    );
    if (validation.valid !== true) {
        throw new Error(
            `automation.Graph.Validate refused the fixture: ${JSON.stringify(validation.issues ?? [])}`
        );
    }
    const coverage = record(validation.coverage, 'graph validation coverage');
    if (
        coverage.evaluatesEditorJavaScript !== false ||
        !Array.isArray(coverage.unvalidatedInstalledNodeTypes)
    ) {
        throw new Error(
            'Graph validation did not report static validation coverage'
        );
    }
    const invalidGraph = {
        ...graph,
        nodes: [
            ...graph.nodes,
            {
                id: 'invalid-reference',
                type: 'fm-rpc',
                server: 'missing-server',
                x: 1,
                y: 1,
                wires: [[]]
            }
        ]
    };
    const invalid = record(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'validate'), id: 'validate-missing-config'},
            {graph: invalidGraph}
        ),
        'invalid graph validation'
    );
    if (
        invalid.valid !== false ||
        !Array.isArray(invalid.issues) ||
        !invalid.issues.some(
            (value) =>
                record(value, 'validation issue').code ===
                'config_reference_missing'
        )
    ) {
        throw new Error(
            'Graph validation accepted a missing Fleet server config'
        );
    }
    const created = record(
        await writeMethod(target, state, methodFor(scenario, 'create'), {
            graph
        }),
        'automation.Graph.Create'
    );
    cleanup.flowId = String(created.flowId ?? '');
    cleanup.revision = graphRevision(
        created.revision,
        'automation.Graph.Create'
    );
    if (!cleanup.flowId) {
        throw new Error('automation.Graph.Create returned no flowId');
    }
    const readCreated = record(
        await readMethod(target, state, methodFor(scenario, 'read-created'), {
            flowId: cleanup.flowId
        }),
        'automation.Graph.Get'
    );
    cleanup.revision = graphRevision(
        readCreated.revision,
        'automation.Graph.Get'
    );
    const storedGraph = record(readCreated.graph, 'automation.Graph.Get graph');
    const properties = record(
        storedGraph.properties,
        'automation.Graph.Get graph.properties'
    );
    const storedNodes = Array.isArray(storedGraph.nodes)
        ? storedGraph.nodes.map((node, index) =>
              record(node, `automation.Graph.Get graph.nodes[${index}]`)
          )
        : [];
    if (
        properties.label !== testName ||
        properties.disabled !== true ||
        storedNodes.length !== 2 ||
        storedNodes.some((node) => node.z !== cleanup.flowId)
    ) {
        throw new Error(
            'automation.Graph.Create state did not match stored readback'
        );
    }
    if (readCreated.complete !== true)
        throw new Error('Graph.Get did not return a complete graph');
    const originalRevision = cleanup.revision;
    const updatedName = `${testName}-updated`;
    const updatedGraph = {
        ...storedGraph,
        properties: {...properties, label: updatedName, info: testName}
    };
    await writeMethod(target, state, methodFor(scenario, 'update'), {
        flowId: cleanup.flowId,
        expectedRevision: cleanup.revision,
        graph: updatedGraph,
        complete: true
    });
    const readUpdated = record(
        await readMethod(target, state, methodFor(scenario, 'read-updated'), {
            flowId: cleanup.flowId
        }),
        'automation.Graph.Get'
    );
    cleanup.revision = graphRevision(
        readUpdated.revision,
        'automation.Graph.Get updated'
    );
    const storedUpdatedGraph = record(
        readUpdated.graph,
        'automation.Graph.Get updated graph'
    );
    const updatedProperties = record(
        storedUpdatedGraph.properties,
        'automation.Graph.Get updated graph.properties'
    );
    if (
        updatedProperties.label !== updatedName ||
        updatedProperties.disabled !== true ||
        updatedProperties.info !== testName ||
        valueHash(storedUpdatedGraph.nodes) !== valueHash(storedGraph.nodes)
    ) {
        throw new Error(
            'automation.Graph.Update did not preserve nodes and stored properties'
        );
    }
    let staleRejected = false;
    try {
        await writeMethod(
            target,
            state,
            {...methodFor(scenario, 'update'), id: 'reject-stale-update'},
            {
                flowId: cleanup.flowId,
                expectedRevision: originalRevision,
                complete: true,
                graph: {
                    ...updatedGraph,
                    properties: {
                        ...updatedGraph.properties,
                        label: `${testName}-stale`
                    }
                }
            }
        );
    } catch (error) {
        if (!(error instanceof ToolCallFailure) || error.rpcCode !== 1003)
            throw error;
        staleRejected = true;
    }
    if (!staleRejected)
        throw new Error('A stale Node-RED editor overwrote the current graph');
    const afterConflict = record(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'read-updated'), id: 'read-after-conflict'},
            {flowId: cleanup.flowId}
        ),
        'automation.Graph.Get after conflict'
    );
    if (
        afterConflict.revision !== cleanup.revision ||
        valueHash(afterConflict.graph) !== valueHash(storedUpdatedGraph)
    )
        throw new Error('Rejected stale update changed the stored graph');
    await writeMethod(target, state, methodFor(scenario, 'delete'), {
        flowId: cleanup.flowId,
        expectedRevision: cleanup.revision
    });
    const afterDelete = records(
        await readMethod(target, state, methodFor(scenario, 'verify-deleted'), {
            includeDisabled: true,
            engine: 'node_red'
        }),
        'automation.List'
    );
    if (afterDelete.some((item) => item.id === cleanup.flowId)) {
        throw new Error(
            'automation.Graph.Delete state remained visible in automation.List'
        );
    }
    cleanup.verifiedDeleted = true;
}

async function cleanupNodeRed(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    state: ScenarioState,
    cleanup: {flowId?: string; revision?: string; verifiedDeleted: boolean}
): Promise<void> {
    if (!cleanup.flowId || cleanup.verifiedDeleted) return;
    const listStep = {
        ...methodFor(scenario, 'verify-deleted'),
        id: 'cleanup-list'
    };
    const existing = records(
        await readMethod(target, state, listStep, {
            includeDisabled: true,
            engine: 'node_red'
        }),
        'automation.List cleanup preflight'
    );
    if (!existing.some((item) => item.id === cleanup.flowId)) {
        cleanup.verifiedDeleted = true;
        return;
    }
    const current = record(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'read-updated'), id: 'cleanup-get'},
            {flowId: cleanup.flowId}
        ),
        'automation.Graph.Get cleanup'
    );
    cleanup.revision = graphRevision(
        current.revision,
        'automation.Graph.Get cleanup'
    );
    await writeMethod(
        target,
        state,
        {...methodFor(scenario, 'delete'), id: 'cleanup-delete'},
        {flowId: cleanup.flowId, expectedRevision: cleanup.revision}
    );
    const rows = records(
        await readMethod(
            target,
            state,
            {...methodFor(scenario, 'verify-deleted'), id: 'cleanup-verify'},
            {includeDisabled: true, engine: 'node_red'}
        ),
        'automation.List cleanup'
    );
    if (rows.some((item) => item.id === cleanup.flowId)) {
        throw new Error(
            `cleanup could not delete automation ${cleanup.flowId}`
        );
    }
    cleanup.verifiedDeleted = true;
}

function testDataName(
    scenario: ScenarioFixture,
    target: TargetId,
    repetition: number
): string {
    return `${scenario.testDataPrefix}-${target}-${repetition}-${randomUUID().slice(0, 8)}`;
}

async function runScenario(
    target: ConnectedTarget,
    scenario: ScenarioFixture,
    repetition: number,
    order: number
): Promise<ScenarioRunResult> {
    const started = performance.now();
    const state: ScenarioState = {steps: [], createdNames: []};
    const name = testDataName(scenario, target.config.id, repetition);
    state.createdNames.push(name);
    const cleanupResult: CleanupResult = {
        attempted: false,
        status: 'not_needed',
        errors: []
    };
    let status: RunStatus = 'passed';
    let error: string | undefined;
    let body: () => Promise<void>;
    let cleanupBody: () => Promise<void>;
    if (
        scenario.kind === 'fleet-group-crud' ||
        scenario.kind === 'durable-operation-replay'
    ) {
        const cleanup = {
            id: undefined as number | undefined,
            verifiedDeleted: false
        };
        body = () =>
            scenario.kind === 'fleet-group-crud'
                ? runGroupCrud(target, scenario, state, name, cleanup)
                : runDurableOperationReplay(
                      target,
                      scenario,
                      state,
                      name,
                      cleanup
                  );
        cleanupBody = async () => {
            if (cleanup.id === undefined || cleanup.verifiedDeleted) return;
            cleanupResult.attempted = true;
            await cleanupGroup(target, scenario, state, cleanup);
            cleanupResult.status = 'passed';
        };
    } else if (scenario.kind === 'asset-transfer-crud') {
        const cleanup: AssetCleanupState = {
            label: name,
            verifiedDeleted: false
        };
        body = () =>
            runAssetTransferCrud(target, scenario, state, name, cleanup);
        cleanupBody = async () => {
            if (!cleanup.id || cleanup.verifiedDeleted) return;
            cleanupResult.attempted = true;
            await cleanupAsset(target, scenario, state, cleanup);
            cleanupResult.status = 'passed';
        };
    } else if (scenario.kind === 'file-transfer-durable') {
        const cleanup: FileTransferCleanupState = {
            label: name,
            finalized: false,
            assetDeleted: false,
            groupDeleted: false
        };
        body = () =>
            runFileTransferDurable(target, scenario, state, name, cleanup);
        cleanupBody = async () => {
            if (
                (!cleanup.uploadId || cleanup.finalized) &&
                (!cleanup.assetId || cleanup.assetDeleted) &&
                (cleanup.groupId === undefined || cleanup.groupDeleted)
            ) {
                return;
            }
            cleanupResult.attempted = true;
            await cleanupFileTransfer(target, scenario, state, cleanup);
            cleanupResult.status = 'passed';
        };
    } else if (scenario.kind === 'simulated-device-control') {
        const cleanup: SimulatorCleanupState = {
            admitted: false,
            verifiedDeleted: false,
            stderr: ''
        };
        body = () =>
            runSimulatedDeviceControl(target, scenario, state, name, cleanup);
        cleanupBody = async () => {
            if (
                (!cleanup.child ||
                    cleanup.child.exitCode !== null ||
                    cleanup.child.signalCode !== null) &&
                (!cleanup.admitted || cleanup.verifiedDeleted)
            ) {
                return;
            }
            cleanupResult.attempted = true;
            await cleanupSimulatorDevice(target, scenario, state, cleanup);
            cleanupResult.status = 'passed';
        };
    } else {
        const cleanup = {
            flowId: undefined as string | undefined,
            revision: undefined as string | undefined,
            verifiedDeleted: false
        };
        body = () =>
            runNodeRedGraphCrud(target, scenario, state, name, cleanup);
        cleanupBody = async () => {
            if (!cleanup.flowId || cleanup.verifiedDeleted) return;
            cleanupResult.attempted = true;
            await cleanupNodeRed(target, scenario, state, cleanup);
            cleanupResult.status = 'passed';
        };
    }
    try {
        await runWithCleanup(body, cleanupBody);
    } catch (caught) {
        status =
            caught instanceof ScenarioUnavailable ? 'unavailable' : 'failed';
        error = errorText(caught);
        if (caught instanceof CleanupFailure) {
            cleanupResult.status = 'failed';
            cleanupResult.errors.push(errorText(caught.cleanupError));
        }
    }
    return {
        scenarioId: scenario.id,
        target: target.config.id,
        repetition,
        order,
        status,
        latencyMs: elapsedMs(started),
        steps: state.steps,
        createdNames: state.createdNames,
        cleanup: cleanupResult,
        ...(error ? {error} : {})
    };
}

function unavailableRun(
    scenario: ScenarioFixture,
    target: TargetId,
    repetition: number,
    order: number,
    reason: string
): ScenarioRunResult {
    return {
        scenarioId: scenario.id,
        target,
        repetition,
        order,
        status: 'unavailable',
        latencyMs: 0,
        steps: [],
        createdNames: [],
        cleanup: {attempted: false, status: 'not_needed', errors: []},
        error: reason
    };
}

function skippedRun(
    scenario: ScenarioFixture,
    target: TargetId,
    repetition: number,
    order: number
): ScenarioRunResult {
    return {
        scenarioId: scenario.id,
        target,
        repetition,
        order,
        status: 'skipped',
        latencyMs: 0,
        steps: [],
        createdNames: [],
        cleanup: {attempted: false, status: 'not_needed', errors: []},
        error: 'MCP_AB_INCLUDE_NODE_RED=0'
    };
}

function median(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? roundMs((sorted[middle - 1] + sorted[middle]) / 2)
        : sorted[middle];
}

function totals(runs: ScenarioRunResult[]): RunTotals {
    const samples = runs
        .filter((run) => run.status === 'passed')
        .map((run) => run.latencyMs);
    return {
        passed: runs.filter((run) => run.status === 'passed').length,
        failed: runs.filter((run) => run.status === 'failed').length,
        unavailable: runs.filter((run) => run.status === 'unavailable').length,
        skipped: runs.filter((run) => run.status === 'skipped').length,
        errors: runs.flatMap((run) => (run.error ? [run.error] : [])),
        latencyMs: {
            samples,
            ...(samples.length > 0
                ? {
                      min: Math.min(...samples),
                      median: median(samples),
                      max: Math.max(...samples)
                  }
                : {})
        }
    };
}

export function summarizeComparisons(
    scenarioIds: string[],
    runs: ScenarioRunResult[]
): ScenarioComparison[] {
    return scenarioIds.map((scenarioId) => ({
        scenarioId,
        baseline: totals(
            runs.filter(
                (run) =>
                    run.scenarioId === scenarioId && run.target === 'baseline'
            )
        ),
        candidate: totals(
            runs.filter(
                (run) =>
                    run.scenarioId === scenarioId && run.target === 'candidate'
            )
        ),
        performanceClaim: false,
        note: 'Raw latency is recorded for diagnosis. This deterministic harness does not establish model quality or a performance improvement.'
    }));
}

function reportStatus(runs: ScenarioRunResult[]): ReportStatus {
    const executed = runs.filter((run) => run.status !== 'skipped');
    if (
        executed.length === 0 ||
        executed.every((run) => run.status === 'unavailable')
    ) {
        return 'unavailable';
    }
    if (executed.some((run) => run.status === 'failed')) return 'failed';
    if (
        executed.some((run) => run.status === 'unavailable') ||
        runs.some((run) => run.status === 'skipped')
    ) {
        return 'partial';
    }
    return 'passed';
}

function targetFailureResult(
    config: TargetConfig,
    error: unknown
): TargetResult {
    const supplied = (error as {targetResult?: TargetResult})?.targetResult;
    if (supplied) return supplied;
    return {
        id: config.id,
        endpoint: sanitizeEndpoint(config.mcpUrl),
        configId: config.configId,
        source: {
            sourceId: config.sourceId,
            source: 'http-version-endpoint',
            expectedBuildCommit: config.expectedBuildCommit,
            expectedConfigurationFingerprint:
                config.expectedConfigurationFingerprint,
            verified: false,
            error: errorText(error)
        },
        policy: {configuredPolicyId: config.policyId, verified: false},
        status: 'unavailable',
        error: errorText(error)
    };
}

export async function runEvaluation(config: EvalConfig): Promise<EvalReport> {
    const startedAt = new Date().toISOString();
    const loaded = loadFixture();
    const order = buildTargetOrder(config.repetitions);
    const connected: Partial<Record<TargetId, ConnectedTarget>> = {};
    const targetResults = {} as Record<TargetId, TargetResult>;
    for (const id of ['baseline', 'candidate'] as const) {
        try {
            connected[id] = await connectTarget(config.targets[id]);
            targetResults[id] = connected[id].result;
        } catch (error) {
            targetResults[id] = targetFailureResult(config.targets[id], error);
        }
    }
    const runs: ScenarioRunResult[] = [];
    try {
        for (
            let repetition = 0;
            repetition < config.repetitions;
            repetition++
        ) {
            for (const scenario of loaded.fixture.scenarios) {
                for (
                    let orderIndex = 0;
                    orderIndex < order[repetition].length;
                    orderIndex++
                ) {
                    const targetId = order[repetition][orderIndex];
                    if (
                        scenario.kind === 'node-red-graph-crud' &&
                        !config.includeNodeRed
                    ) {
                        runs.push(
                            skippedRun(
                                scenario,
                                targetId,
                                repetition,
                                orderIndex
                            )
                        );
                        continue;
                    }
                    const target = connected[targetId];
                    if (!target) {
                        runs.push(
                            unavailableRun(
                                scenario,
                                targetId,
                                repetition,
                                orderIndex,
                                targetResults[targetId].error ??
                                    'target connection unavailable'
                            )
                        );
                        continue;
                    }
                    process.stderr.write(
                        `MCP system: ${targetId} ${scenario.id} repetition ${repetition + 1} starting\n`
                    );
                    const run = await runScenario(
                        target,
                        scenario,
                        repetition,
                        orderIndex
                    );
                    runs.push(run);
                    process.stderr.write(
                        `MCP system: ${targetId} ${scenario.id} ${run.status}\n`
                    );
                }
            }
        }
    } finally {
        for (const target of Object.values(connected)) {
            if (!target) continue;
            try {
                await target.transport.terminateSession();
            } catch (error) {
                const lastRun = runs.findLast(
                    (run) => run.target === target.config.id
                );
                if (lastRun) {
                    lastRun.status = 'failed';
                    lastRun.cleanup.status = 'failed';
                    lastRun.cleanup.errors.push(
                        `MCP session cleanup: ${errorText(error)}`
                    );
                } else {
                    target.result.status = 'unavailable';
                    target.result.error = `MCP session cleanup: ${errorText(error)}`;
                }
            } finally {
                await target.client.close();
            }
        }
    }
    return {
        schemaVersion: 1,
        reportKind: 'deterministic-real-http-mcp-ab',
        status: reportStatus(runs),
        startedAt,
        finishedAt: new Date().toISOString(),
        fixture: {
            suiteId: loaded.fixture.suiteId,
            sha256: loaded.sha256,
            path: loaded.path,
            executionMode: loaded.fixture.executionMode,
            writeAuthorization: loaded.fixture.writeAuthorization
        },
        setup: {
            repetitions: config.repetitions,
            targetOrder: order,
            nodeRedRequested: config.includeNodeRed,
            checks: [
                'GET /version source and configuration identity verification',
                'real @modelcontextprotocol/sdk Streamable HTTP initialization',
                'authenticated fm_capabilities policy observation',
                'zz-verify-* mutation through preview and confirmation token',
                'asset upload, bounded chunk readback, digest verification, and deletion',
                'credential-bound durable operation execution, polling, and same-key replay',
                'durable file-transfer begin, chunk writes, finalize, chunk readback, and canonical cleanup',
                'one host simulator waiting-room admission, live status, confirmed control, disconnect, and deletion',
                'stored-state readback and finally cleanup'
            ]
        },
        targets: targetResults,
        runs,
        comparisons: summarizeComparisons(
            loaded.fixture.scenarios.map((scenario) => scenario.id),
            runs
        ),
        modelEvaluation: {
            status: 'not_run',
            reason: 'This run executes fixed scenarios. No language model selected tools or planned steps.'
        },
        limitations: [
            'Success proves the named real HTTP MCP scenarios on the recorded builds and configuration fingerprints only.',
            'Latency samples are reported without a performance or model-quality claim.',
            'The Node-RED graph scenario verifies a disabled graph round trip, revision-checked update, preservation, and cleanup; it does not claim runtime execution.',
            'The simulated-device scenario proves the bundled host simulator over the disposable plain WebSocket ingress; it does not prove physical hardware, TLS ingress, or credential provisioning.'
        ]
    };
}

export function unavailableReport(issues: string[]): {
    schemaVersion: 1;
    reportKind: 'deterministic-real-http-mcp-ab';
    status: 'unavailable';
    issues: string[];
    modelEvaluation: {status: 'not_run'; reason: string};
} {
    return {
        schemaVersion: 1,
        reportKind: 'deterministic-real-http-mcp-ab',
        status: 'unavailable',
        issues,
        modelEvaluation: {
            status: 'not_run',
            reason: 'No deterministic system run or live model evaluation executed.'
        }
    };
}

function roundMs(value: number): number {
    return Math.round(value * 100) / 100;
}

function elapsedMs(started: number): number {
    return roundMs(performance.now() - started);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
