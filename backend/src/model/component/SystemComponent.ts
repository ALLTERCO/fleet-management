import {DEV_MODE} from '../../config';
import {tuning} from '../../config/tuning';
import {
    canUseAuthenticatedRead,
    canUsePlatformAdmin,
    hasTenantAdminAuthority
} from '../../modules/authz/evaluator';
import * as Commander from '../../modules/Commander';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import * as Observability from '../../modules/Observability';
import {buildSystemBootstrap} from '../../modules/runtimeBootstrap';
import {
    getDbWrites,
    getDebugReport,
    getFullHealth,
    getLogLevels,
    getStreamsHealth,
    resetObservability,
    setDbWrites,
    setLogLevel,
    setObservability
} from '../../modules/systemControls';
import {UNAUTHORIZED_USER} from '../../modules/user';
import {ConnectionContext} from '../../modules/web/ws/ConnectionContext';
import {getSessionStream} from '../../modules/web/ws/sessionStreamRegistry';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {event_data_t, json_rpc_event} from '../../types';
import {
    type EntityCapabilityDescribe,
    SYSTEM_BOOTSTRAP_PARAMS_SCHEMA,
    SYSTEM_DB_WRITES_SET_PARAMS_SCHEMA,
    SYSTEM_DESCRIBE,
    SYSTEM_GET_CONNECTION_INSPECTOR_PARAMS_SCHEMA,
    SYSTEM_GET_MODULE_HISTORY_PARAMS_SCHEMA,
    SYSTEM_GET_SLOW_BUILDS_PARAMS_SCHEMA,
    SYSTEM_GET_SLOW_CLIENTS_PARAMS_SCHEMA,
    SYSTEM_GET_SLOW_DEVICE_COMMANDS_PARAMS_SCHEMA,
    SYSTEM_GET_SLOW_RPCS_PARAMS_SCHEMA,
    SYSTEM_GET_TOPOLOGY_DIFF_PARAMS_SCHEMA,
    SYSTEM_GET_VARIABLES_PARAMS_SCHEMA,
    SYSTEM_LOG_SET_LEVEL_PARAMS_SCHEMA,
    SYSTEM_OBSERVABILITY_SET_PARAMS_SCHEMA,
    SYSTEM_SUBMIT_TELEMETRY_PARAMS_SCHEMA,
    SYSTEM_SUBSCRIBE_PARAMS_SCHEMA,
    SYSTEM_UNSUBSCRIBE_PARAMS_SCHEMA,
    type SystemDescribeOutput,
    type SystemSubscribeParams,
    type SystemUnsubscribeParams
} from '../../types/api/system';
import type CommandSender from '../CommandSender';
import {
    actionsForEntityType,
    shellyMethodForAction
} from '../entity/actionAdapter';
import {
    ENTITY_TYPE_TO_SHELLY_COMPONENT,
    listRegisteredEntityTypes
} from '../entity/capabilities';
import Component from './Component';

// Allowed shape for telemetry keys; cardinality cap lives in tuning.
const TELEMETRY_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const SESSION_EVENT_DELIVERIES = Symbol('sessionEventDeliveries');

function markSessionEventDelivery(
    eventData: event_data_t,
    connectionId: string,
    eventName: string,
    payload: string
): boolean {
    const deliveryState = eventData as event_data_t & {
        [SESSION_EVENT_DELIVERIES]?: Set<string>;
    };
    let delivered = deliveryState[SESSION_EVENT_DELIVERIES];
    if (!delivered) {
        delivered = new Set<string>();
        deliveryState[SESSION_EVENT_DELIVERIES] = delivered;
    }
    const key = `${connectionId}\0${eventName}\0${payload}`;
    if (delivered.has(key)) return false;
    delivered.add(key);
    return true;
}

function isAuthenticated(sender: CommandSender): boolean {
    return sender.isAuthenticated();
}

function controlError(err: unknown): RpcError {
    return RpcError.InvalidParams(
        err instanceof Error ? err.message : String(err)
    );
}

export default class SystemComponent extends Component<any> {
    #knownTelemetryKeys = new Set<string>();

    constructor() {
        super('system', {auto_apply_config: false});
        this.methods.delete('setconfig');
        // Legacy alias for external clients (plugins, Node-RED) that
        // still call `fleetmanager.getstatus` / `fleetmanager.getconfig`.
        // `@Component.Alias` covers decorator-declared methods only; the
        // base-class `getstatus` / `getconfig` need this imperative hook.
        this.addAlias('fleetmanager.getstatus', 'system.getstatus');
        this.addAlias('fleetmanager.getconfig', 'system.getconfig');
    }

    @Component.NoAudit
    @Component.Expose('Bootstrap')
    @Component.NoPermissions
    async bootstrap(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return await buildSystemBootstrap(sender);
    }

    @Component.NoAudit
    @Component.Expose('GetVariables')
    @Component.Alias('fleetmanager.getvariables')
    @Component.NoPermissions
    getVariables(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_GET_VARIABLES_PARAMS_SCHEMA
        );
        return {
            'login-strategy': DEV_MODE ? 'local' : 'zitadel-introspection',
            'dev-mode': DEV_MODE
        };
    }

    /**
     * Frontend telemetry ingest. Any authenticated client can submit batched
     * interaction counts; the backend maps them into Prometheus counters
     * under the `ui_*` prefix. Key allowlist + cardinality cap prevent a
     * misbehaving client from blowing up the metrics surface.
     *
     * Each counter increment is fire-and-forget from the RPC caller's
     * perspective: returns void (JSON-RPC `result: null`). The backend has
     * no persistent state for telemetry beyond the in-memory known-keys set
     * (which resets on process restart — that's fine for Prometheus).
     */
    @Component.NoAudit
    @Component.Expose('SubmitTelemetry')
    @Component.NoPermissions
    submitTelemetry(rawParams: unknown): void {
        const params = validateOrThrow<{
            counts?: Record<string, number>;
            clicks?: number;
            wsTelemetry?: {
                patchBufferMaxDepth?: number;
                droppedFrameCount?: number;
                rafFrameTimeMaxMs?: number;
            };
        }>(rawParams ?? {}, SYSTEM_SUBMIT_TELEMETRY_PARAMS_SCHEMA);
        const {counts, clicks, wsTelemetry} = params;
        if (counts && typeof counts === 'object') {
            for (const [key, val] of Object.entries(counts)) {
                if (typeof val !== 'number' || val <= 0) continue;
                if (!TELEMETRY_KEY_RE.test(key)) continue;
                if (
                    !this.#knownTelemetryKeys.has(key) &&
                    this.#knownTelemetryKeys.size >=
                        tuning.observability.telemetryMaxKeys
                ) {
                    continue;
                }
                this.#knownTelemetryKeys.add(key);
                Observability.incrementCounter(`ui_${key}`, val);
            }
        }
        if (typeof clicks === 'number' && clicks > 0) {
            Observability.incrementCounter('ui_clicks_total', clicks);
        }
        // §4-B4: WS-patch telemetry snapshot pushed from the FE. Max
        // depth + max raf duration are gauges (latest-wins via
        // incrementCounter — Prom counter is fine here since each push
        // is a sample); dropped-frame is cumulative.
        if (wsTelemetry && typeof wsTelemetry === 'object') {
            const depth = wsTelemetry.patchBufferMaxDepth;
            const dropped = wsTelemetry.droppedFrameCount;
            const rafMs = wsTelemetry.rafFrameTimeMaxMs;
            if (typeof depth === 'number' && depth >= 0) {
                Observability.incrementCounter(
                    'ui_ws_patch_buffer_max_depth',
                    depth
                );
            }
            if (typeof dropped === 'number' && dropped > 0) {
                Observability.incrementCounter(
                    'ui_ws_dropped_frame_count',
                    dropped
                );
            }
            if (typeof rafMs === 'number' && rafMs > 0) {
                Observability.incrementCounter(
                    'ui_ws_raf_frame_time_max_ms',
                    Math.round(rafMs)
                );
            }
        }
    }

    @Component.NoAudit
    @Component.Expose('Subscribe')
    @Component.Alias('fleetmanager.subscribe')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async subscribe(
        rawParams: unknown,
        sender: CommandSender,
        ctx?: ConnectionContext
    ) {
        const params = validateOrThrow<SystemSubscribeParams>(
            rawParams,
            SYSTEM_SUBSCRIBE_PARAMS_SCHEMA
        );
        const events = params.events;
        const options = params.options as Record<string, any> | undefined;
        const subscribedEvents: [string, number][] = [];

        // HTTP /rpc has no ctx; only WS callers can subscribe.
        if (!ctx) {
            throw RpcError.Unavailable(
                'telemetry_channel',
                'System.Subscribe requires a websocket transport'
            );
        }
        const socket = ctx.socket;
        const {sink, connectionId, resyncRequired} = await getSessionStream(
            ctx,
            {
                connectionId: params.connectionId,
                lastSeenStreamId: params.lastSeenStreamId
            }
        );
        for (const event of events) {
            const eventOptions = options?.events?.[event];
            const shellyIDs = options?.shellyIDs;
            // Per-event path filter. Server emits only field-level dot-paths
            // the subscriber declared; absent = today's full payload.
            const paths = Array.isArray(eventOptions?.paths)
                ? eventOptions.paths.filter(
                      (p: unknown): p is string =>
                          typeof p === 'string' && p.length > 0
                  )
                : undefined;
            const event_id = EventDistributor.addEventListener(
                sender,
                event,
                {...eventOptions, shellyIDs, paths},
                (evt: json_rpc_event, eventData: event_data_t) => {
                    if (socket.readyState !== 1) return;
                    const payload =
                        eventData?.serialized || JSON.stringify(evt);
                    if (
                        !markSessionEventDelivery(
                            eventData,
                            connectionId,
                            event,
                            payload
                        )
                    ) {
                        return;
                    }
                    // Fire-and-forget; either streams to Redis or sends direct.
                    void sink.append(event, payload);
                }
            );
            subscribedEvents.push([event, event_id]);
            this.logger.mark(
                'added event event_name:[%s] event_id:[%s] options:[%s]',
                event,
                event_id,
                eventOptions
            );
        }
        // Drain exactly this call's listener ids on close.
        ctx.onClose(() => {
            for (const [eventName, id] of subscribedEvents) {
                EventDistributor.removeEventListener(id, eventName);
            }
        });

        // Pre-warm device access cache (fire-and-forget, non-blocking).
        // Eliminates async DB fallback in EventDistributor hot loop for
        // first events. Log warn on failure so cold-cache slowness shows up
        // in monitoring instead of an unexplained latency bump.
        if (!hasTenantAdminAuthority(sender)) {
            const allIds = Array.from(DeviceCollector.getAllShellyIDs());
            sender.filterAccessibleDevices(allIds).catch((err) => {
                this.logger.warn(
                    'access-cache pre-warm failed user=%s: %s',
                    sender.getUserId() ?? '<anon>',
                    err
                );
            });
        }

        return {
            ids: subscribedEvents.map(([, id]) => id),
            connectionId,
            ...(resyncRequired ? {resyncRequired} : {})
        };
    }

    @Component.NoAudit
    @Component.Expose('Unsubscribe')
    @Component.Alias('fleetmanager.unsubscribe')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    unsubscribe(rawParams: unknown) {
        const params = validateOrThrow<SystemUnsubscribeParams>(
            rawParams,
            SYSTEM_UNSUBSCRIBE_PARAMS_SCHEMA
        );
        this.logger.debug('unsubscribing', params.ids.join(','));
        params.ids.forEach((id) => {
            EventDistributor.removeEventListener(id, '');
        });
    }

    // One-call bootstrap of the full self-describing contract across every
    // component. Each component's own Describe is called directly — this
    // avoids per-component audit rows and permission prompts on the
    // aggregate itself.
    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    async describe(
        _params: unknown,
        sender: CommandSender
    ): Promise<SystemDescribeOutput> {
        validateOrThrow(_params, SYSTEM_BOOTSTRAP_PARAMS_SCHEMA);
        const components: Record<string, unknown> = {};
        for (const [name, comp] of Commander.getComponents().entries()) {
            if (comp === this) continue;
            const output = await comp.tryGetDescribe(sender);
            if (output !== undefined) components[name] = output;
        }
        const entityCapabilities: Record<string, EntityCapabilityDescribe> = {};
        for (const type of listRegisteredEntityTypes()) {
            entityCapabilities[type] = {
                shellyComponent: ENTITY_TYPE_TO_SHELLY_COMPONENT[type] ?? null,
                actions: actionsForEntityType(type).map((action) => ({
                    action,
                    rpc: shellyMethodForAction(type, action) ?? ''
                }))
            };
        }
        return {...SYSTEM_DESCRIBE, components, entityCapabilities};
    }

    @Component.NoAudit
    @Component.Expose('Health.GetFull')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    async healthGetFull(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return await getFullHealth();
    }

    @Component.NoAudit
    @Component.Expose('GetTopology')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getTopology(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return Observability.getCachedTopologySnapshot();
    }

    @Component.NoAudit
    @Component.Expose('ListConnections')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    listConnections(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        const all = ConnectionContext.listAll();
        return {
            connections: all.map((ctx) => ({
                connectionId: ctx.connectionId,
                user: ctx.user?.username ?? null,
                organizationId: ctx.sender.getOrganizationId() ?? null,
                connectedAt: ctx.connectedAt,
                ageSec: Math.floor((Date.now() - ctx.connectedAt) / 1000)
            }))
        };
    }

    @Component.NoAudit
    @Component.Expose('GetConnectionInspector')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getConnectionInspector(params: unknown) {
        const p = validateOrThrow<{connectionId: string}>(
            params,
            SYSTEM_GET_CONNECTION_INSPECTOR_PARAMS_SCHEMA
        );
        const ctx = ConnectionContext.byConnectionId(p.connectionId);
        if (!ctx) {
            throw RpcError.InvalidParams(
                `connection ${p.connectionId} not found`
            );
        }
        return {
            connectionId: ctx.connectionId,
            user: ctx.user?.username ?? null,
            organizationId: ctx.sender.getOrganizationId() ?? null,
            connectedAt: ctx.connectedAt,
            ageSec: Math.floor((Date.now() - ctx.connectedAt) / 1000),
            recentEvents: ctx.recentEvents().map((e) => ({
                kind: e.kind,
                method: e.method,
                ts: e.ts,
                ms: e.ms ?? null
            }))
        };
    }

    @Component.NoAudit
    @Component.Expose('GetTopologyDiff')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getTopologyDiff(params: unknown) {
        const p = validateOrThrow<{windowMin?: number}>(
            params ?? {},
            SYSTEM_GET_TOPOLOGY_DIFF_PARAMS_SCHEMA
        );
        return Observability.getTopologyDiff(p.windowMin ?? 5);
    }

    @Component.NoAudit
    @Component.Expose('GetModuleHistory')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getModuleHistory(params: unknown) {
        const p = validateOrThrow<{name: string; windowSec?: number}>(
            params,
            SYSTEM_GET_MODULE_HISTORY_PARAMS_SCHEMA
        );
        return {
            samples: Observability.getModuleHistory(p.name, p.windowSec ?? 300)
        };
    }

    @Component.NoAudit
    @Component.Expose('GetSlowRpcs')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getSlowRpcs(params: unknown) {
        const p = validateOrThrow<{windowSec?: number; limit?: number}>(
            params ?? {},
            SYSTEM_GET_SLOW_RPCS_PARAMS_SCHEMA
        );
        const entries = Observability.getSlowRpcs({
            windowSec: p.windowSec ?? 300,
            limit: p.limit ?? 50
        });
        return {
            entries: entries.map((e) => ({
                method: e.method,
                ms: e.ms,
                ts: e.ts,
                sender: e.sender ?? null,
                senderType: e.senderType ?? 'user',
                organizationId: e.organizationId ?? null,
                p95Ms: Observability.getRpcMethodP95(e.method)
            }))
        };
    }

    @Component.NoAudit
    @Component.Expose('GetSlowBuilds')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getSlowBuilds(params: unknown) {
        const p = validateOrThrow<{windowSec?: number; limit?: number}>(
            params ?? {},
            SYSTEM_GET_SLOW_BUILDS_PARAMS_SCHEMA
        );
        const entries = Observability.querySlowBuilds({
            windowSec: p.windowSec ?? 300,
            limit: p.limit ?? 50
        });
        return {
            entries: entries.map((e) => ({
                shellyID: e.shellyID,
                totalMs: e.totalMs,
                componentPages: e.componentPages,
                ts: e.ts,
                stages: e.stages.map((s) => ({name: s.name, ms: s.ms}))
            }))
        };
    }

    @Component.NoAudit
    @Component.Expose('GetSlowDeviceCommands')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getSlowDeviceCommands(params: unknown) {
        const p = validateOrThrow<{windowSec?: number; limit?: number}>(
            params ?? {},
            SYSTEM_GET_SLOW_DEVICE_COMMANDS_PARAMS_SCHEMA
        );
        const entries = Observability.querySlowDeviceCommands({
            windowSec: p.windowSec ?? 300,
            limit: p.limit ?? 50
        });
        return {
            entries: entries.map((e) => ({
                label: e.label,
                method: e.method,
                ms: e.ms,
                outcome: e.outcome,
                ts: e.ts
            }))
        };
    }

    @Component.NoAudit
    @Component.Expose('GetSlowClients')
    @Component.CheckPermissions(hasTenantAdminAuthority)
    getSlowClients(params: unknown) {
        const p = validateOrThrow<{windowSec?: number; limit?: number}>(
            params ?? {},
            SYSTEM_GET_SLOW_CLIENTS_PARAMS_SCHEMA
        );
        const entries = Observability.queryStrugglingClients({
            windowSec: p.windowSec ?? 300,
            limit: p.limit ?? 50
        });
        return {
            entries: entries.map((e) => ({
                clientId: e.clientId,
                bufferedBytes: e.bufferedBytes,
                action: e.action,
                ts: e.ts
            }))
        };
    }

    @Component.NoAudit
    @Component.Expose('Health.GetDebugReport')
    @Component.CheckPermissions(isAuthenticated)
    healthGetDebugReport(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return getDebugReport();
    }

    @Component.NoAudit
    @Component.Expose('Health.GetStreams')
    @Component.CheckPermissions(isAuthenticated)
    async healthGetStreams(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return await getStreamsHealth();
    }

    // Ring of getMetrics() snapshots — sparkline source for the monitoring
    // page. Replaces the legacy unauthenticated GET /health/history route.
    @Component.NoAudit
    @Component.Expose('Health.GetHistory')
    @Component.CheckPermissions(isAuthenticated)
    healthGetHistory(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return {history: Observability.getMetricHistory()};
    }

    @Component.NoAudit
    @Component.Expose('DbWrites.Get')
    @Component.CheckPermissions(isAuthenticated)
    dbWritesGet(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return getDbWrites();
    }

    @Component.Expose('DbWrites.Set')
    @Component.CheckPermissions(canUsePlatformAdmin)
    dbWritesSet(params: unknown) {
        const p = validateOrThrow<{disabled: boolean}>(
            params,
            SYSTEM_DB_WRITES_SET_PARAMS_SCHEMA
        );
        try {
            return setDbWrites(p.disabled);
        } catch (err) {
            throw controlError(err);
        }
    }

    @Component.Expose('Observability.Set')
    @Component.CheckPermissions(canUsePlatformAdmin)
    observabilitySet(params: unknown) {
        const p = validateOrThrow<{level?: number; enabled?: boolean}>(
            params,
            SYSTEM_OBSERVABILITY_SET_PARAMS_SCHEMA
        );
        try {
            return setObservability(p);
        } catch (err) {
            throw controlError(err);
        }
    }

    @Component.Expose('Observability.Reset')
    @Component.CheckPermissions(canUsePlatformAdmin)
    observabilityReset(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return resetObservability();
    }

    @Component.NoAudit
    @Component.Expose('Log.ListLevels')
    @Component.CheckPermissions(isAuthenticated)
    logListLevels(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            SYSTEM_BOOTSTRAP_PARAMS_SCHEMA
        );
        return getLogLevels();
    }

    @Component.Expose('Log.SetLevel')
    @Component.CheckPermissions(canUsePlatformAdmin)
    logSetLevel(params: unknown) {
        const p = validateOrThrow<{category: string; level: string}>(
            params,
            SYSTEM_LOG_SET_LEVEL_PARAMS_SCHEMA
        );
        try {
            return setLogLevel(p);
        } catch (err) {
            throw controlError(err);
        }
    }

    // System-wide aggregates: readable by any authenticated user. Admin
    // (including `CommandSender.INTERNAL`, which has no `username`) bypasses
    // the sentinel check.
    protected override async checkPermissions(
        sender: CommandSender,
        method: string,
        params?: any
    ): Promise<boolean> {
        if (
            method === 'getstatus' ||
            method === 'getconfig' ||
            method === 'listmethods'
        ) {
            if (hasTenantAdminAuthority(sender)) return true;
            const user = sender.getUser();
            return !!user && user.username !== UNAUTHORIZED_USER.username;
        }
        return await super.checkPermissions(sender, method, params);
    }

    // The base Component's addDefaultMethods registers getstatus/getconfig
    // wrappers that discard `sender`. Re-register here with sender-aware
    // wrappers so the aggregate can hide internal component names from
    // non-admins.
    protected override addDefaultMethods(configMethods: boolean) {
        super.addDefaultMethods(configMethods);
        if (!configMethods) return;
        this.methods.set('getstatus', {
            exec: (_params, sender) =>
                this.#aggregate(
                    'getstatus',
                    (n) => Commander.getStatus(n, sender),
                    sender
                ),
            checkParams: () => true,
            checkPermissions: (sender, params) =>
                this.checkPermissions(sender, 'getstatus', params),
            noAudit: true
        });
        this.methods.set('getconfig', {
            exec: (_params, sender) =>
                this.#aggregate(
                    'getconfig',
                    (n) => Commander.getConfig(n, sender),
                    sender
                ),
            checkParams: () => true,
            checkPermissions: (sender, params) =>
                this.checkPermissions(sender, 'getconfig', params),
            noAudit: true
        });
    }

    /**
     * Walks every registered component, collects each one's status/config,
     * and returns the merged object. Non-admins only see components that
     * opted in via `{viewer_visible: true}` in their constructor — so
     * adding a new component is safe by default (it stays hidden from
     * viewers until the author explicitly opts in). Errors from individual
     * components are logged and omitted, never surfaced as `{error: ...}`
     * (which previously leaked DB error messages and stack fragments).
     */
    async #aggregate(
        kind: 'getstatus' | 'getconfig',
        fetchOne: (name: string) => Promise<Record<string, any> | undefined>,
        sender: CommandSender
    ) {
        // Only provider support aggregates non-viewer-visible components.
        const seeAll = canUsePlatformAdmin(sender);
        const out: Record<string, any> = {};
        for (const [name, comp] of Commander.getComponents().entries()) {
            if (comp === this) continue;
            if (!seeAll && !comp.viewerVisible) continue;
            // Skip device RPC components; their getstatus/getconfig needs a
            // shellyID and is not an aggregate-safe read.
            if (!comp.hasAggregateSafeRead(kind)) continue;
            try {
                // undefined = caller failed this component's own method
                // permission gate; omit it rather than leak its state.
                const value = await fetchOne(name);
                if (value && Object.keys(value).length) out[name] = value;
            } catch (err) {
                this.logger.warn(
                    'aggregate: %s failed — %s',
                    name,
                    err instanceof Error ? err.message : String(err)
                );
            }
        }
        return out;
    }

    protected override getDefaultConfig() {
        return {};
    }
}
