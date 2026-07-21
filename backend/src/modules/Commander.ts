import log4js from 'log4js';
import CommandSender from '../model/CommandSender';
import type Component from '../model/component/Component';
import {categoryFor} from '../rpc/errors';
import RpcError from '../rpc/RpcError';
import {ValidationError} from '../rpc/validation';
import type {PrincipalType} from '../types';
import * as AuditLogger from './AuditLogger';
import {BoundedMap} from './boundedMap';
import * as Observability from './Observability';
import {RequestContext} from './RequestContext';
import type {ConnectionContext} from './web/ws/ConnectionContext';

const logger = log4js.getLogger('Commander');

const components: Map<string, Component> = new Map();

/**
 * Legacy → new method aliases assembled from each component's
 * `@Component.Alias(...)` decorators at registration time. A null-
 * prototype map prevents malicious `method` values like `constructor`
 * or `__proto__` from walking Object.prototype and producing a
 * truthy-but-non-string alias target.
 */
const methodAliases: Record<string, string> = Object.create(null);

// In-flight RPC counter + drain gate for graceful shutdown.
let inFlightRpcCount = 0;
let drainResolve: (() => void) | null = null;
let shuttingDown = false;

export async function drain(timeoutMs = 5000): Promise<void> {
    shuttingDown = true;
    if (inFlightRpcCount === 0) return;
    await new Promise<void>((resolve) => {
        drainResolve = resolve;
        setTimeout(() => {
            drainResolve = null;
            resolve();
        }, timeoutMs);
    });
}

interface ResolvedCall {
    /** Canonical (alias-rewritten) method, lowercased. */
    method: string;
    /** Audit label — includes "old (→new)" arrow for legacy aliases. */
    auditMethod: string;
}

/** Per-call id for log correlation; emitted in `data.requestId`. */
let requestSeq = 0;
function makeRequestId(): string {
    requestSeq = (requestSeq + 1) >>> 0;
    return `rpc-${Date.now().toString(36)}-${requestSeq.toString(36)}`;
}

// LRU keyed by the raw request input. Avoids `.toLowerCase()` + the alias
// lookup on every RPC for high-traffic methods. Cleared whenever component
// registration mutates the alias surface (see registerComponent /
// unregisterComponent below).
const RESOLVED_METHOD_CACHE_MAX = 512;
const resolvedMethodCache = new BoundedMap<string, ResolvedCall>({
    maxSize: RESOLVED_METHOD_CACHE_MAX
});

function resolveMethodAlias(requestedMethod: string): ResolvedCall {
    const cached = resolvedMethodCache.get(requestedMethod);
    if (cached) return cached;
    const resolved = computeResolvedMethod(requestedMethod);
    resolvedMethodCache.set(requestedMethod, resolved);
    return resolved;
}

function computeResolvedMethod(requestedMethod: string): ResolvedCall {
    const method = requestedMethod.toLowerCase();
    const alias = Object.hasOwn(methodAliases, method)
        ? methodAliases[method]
        : undefined;
    if (!alias) return {method, auditMethod: method};
    logger.warn(
        'Legacy alias used: %s → %s. Migrate external callers.',
        method,
        alias
    );
    return {method: alias, auditMethod: `${method} (→${alias})`};
}

/** Split on first `.` (nested names OK) → Component. Throws RpcError. */
function lookupComponent(method: string): {
    component: Component;
    submethod: string;
} {
    const dotIdx = method.indexOf('.');
    if (dotIdx < 0) {
        throw RpcError.InvalidRequest("Method must include '.'");
    }
    const componentName = method.slice(0, dotIdx);
    const submethod = method.slice(dotIdx + 1);
    const component = components.get(componentName);
    if (component === undefined) {
        throw RpcError.MethodNotFound();
    }
    return {component, submethod};
}

function errorMessageOf(error: any): string {
    if (error instanceof RpcError) return error.message;
    return error?.message || String(error);
}

function recordConnectionEvent(
    ctx: ConnectionContext | undefined,
    method: string,
    t0: number
): void {
    if (!ctx) return;
    const ms = t0 ? performance.now() - t0 : undefined;
    ctx.recordEvent({kind: 'rpc', method, ts: Date.now(), ms});
}

interface RpcCaller {
    username: string | undefined;
    userId: string | undefined;
    organizationId: string | undefined;
    senderType: PrincipalType;
    sourceIp: string | undefined;
}

function recordSuccess(
    resolved: ResolvedCall,
    t0: number,
    shouldAudit: boolean,
    caller: RpcCaller,
    params: any
): void {
    if (t0) {
        Observability.noteRpcCompletion({
            method: resolved.method,
            ms: performance.now() - t0,
            sender: caller.username,
            senderType: caller.senderType,
            organizationId: caller.organizationId
        });
    }
    Observability.incrementCounter('rpc_success');
    if (shouldAudit) {
        AuditLogger.logRpc({
            username: caller.username,
            actorUserId: caller.userId,
            method: resolved.auditMethod,
            params,
            organizationId: caller.organizationId,
            ipAddress: caller.sourceIp
        });
    }
}

// Failures always audit; @NoAudit suppresses only the success path.
function recordFailure(
    resolved: ResolvedCall,
    t0: number,
    caller: RpcCaller,
    params: any,
    error: any
): void {
    if (t0) {
        Observability.noteRpcCompletion({
            method: resolved.method,
            ms: performance.now() - t0,
            sender: caller.username,
            senderType: caller.senderType,
            organizationId: caller.organizationId
        });
    }
    Observability.incrementCounter('rpc_errors');
    const message = errorMessageOf(error);
    Observability.recordRpcError(resolved.method, message);
    AuditLogger.logRpc({
        username: caller.username,
        actorUserId: caller.userId,
        method: resolved.auditMethod,
        params,
        success: false,
        errorMessage: message,
        organizationId: caller.organizationId,
        ipAddress: caller.sourceIp
    });
}

interface ErrorContext {
    method: string;
    requestId: string;
}

function annotateErrorEnvelope(obj: any, ctx: ErrorContext): any {
    if (!obj) return obj;
    obj.data = {
        ...(obj.data ?? {}),
        type: categoryFor(obj.code),
        operation: ctx.method,
        requestId: ctx.requestId
    };
    return obj;
}

function translateThrownError(error: any, ctx: ErrorContext): any {
    if (error instanceof RpcError) {
        return annotateErrorEnvelope(error.getErrorObject(), ctx);
    }
    if (error instanceof ValidationError) {
        return annotateErrorEnvelope(
            RpcError.InvalidParams(error.message, [
                ...error.failures
            ]).getErrorObject(),
            ctx
        );
    }
    // Raw device JSON-RPC error {code, message}.
    if (
        error &&
        typeof error === 'object' &&
        !(error instanceof Error) &&
        typeof error.code === 'number'
    ) {
        return annotateErrorEnvelope(
            RpcError.DeviceFailed(ctx.method, error).getErrorObject(),
            ctx
        );
    }
    logger.error('Somehow got non-rpc error', error);
    // Generic message — raw err can leak pg detail (constraints, columns).
    return annotateErrorEnvelope(
        RpcError.Server('Internal error').getErrorObject(),
        ctx
    );
}

interface DispatchInput {
    sender: CommandSender;
    resolved: ReturnType<typeof resolveMethodAlias>;
    params: any;
    ctx: ConnectionContext | undefined;
    req: RequestContext;
}

async function dispatchToComponent(
    input: DispatchInput
): Promise<{result: any; shouldAudit: boolean}> {
    const {component, submethod} = lookupComponent(input.resolved.method);
    const shouldAudit = component.shouldAuditMethod(submethod);
    const result = await component.call(
        input.sender,
        submethod,
        input.params,
        input.ctx,
        input.req
    );
    return {result, shouldAudit};
}

// Cap dispose() so a stuck request can't pin inFlightRpcCount > 0 and
// block shutdown drain forever.
const REQUEST_DISPOSE_TIMEOUT_MS = 5_000;

function disposeWithTimeout(req: RequestContext): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            Observability.incrementCounter('request_dispose_timeouts');
            logger.warn(
                'RequestContext dispose timed out after %dms — leaking request resources',
                REQUEST_DISPOSE_TIMEOUT_MS
            );
            finish();
        }, REQUEST_DISPOSE_TIMEOUT_MS);
        timer.unref?.();
        req.dispose().then(finish, (disposeErr) => {
            Observability.incrementCounter('request_dispose_failures');
            logger.warn('RequestContext dispose failed: %s', disposeErr);
            finish();
        });
    });
}

async function finalizeRequest(req: RequestContext): Promise<void> {
    await disposeWithTimeout(req);
    inFlightRpcCount--;
    if (inFlightRpcCount === 0 && drainResolve) {
        const r = drainResolve;
        drainResolve = null;
        r();
    }
}

/** Dispatches an RPC. Throws an RPC error object (duck-typed by transports). */
export async function exec(
    sender: CommandSender,
    method: string,
    params?: any,
    ctx?: ConnectionContext
): Promise<any> {
    if (shuttingDown) {
        // Thrown outside the try/catch below (which converts RpcError
        // via getErrorObject()), so do the conversion inline.
        throw RpcError.Unavailable(
            'server',
            'shutting down — try again later'
        ).getErrorObject();
    }

    const resolved = resolveMethodAlias(method);
    const caller: RpcCaller = {
        username: sender.getUser()?.username,
        userId: sender.getUserId(),
        organizationId: sender.getOrganizationId(),
        senderType: sender.getPrincipalType(),
        sourceIp: sender.getSourceIp()
    };
    const t0 = Observability.isEnabled() ? performance.now() : 0;
    const requestId = makeRequestId();
    const req = new RequestContext({
        method: resolved.method,
        requestId,
        sender,
        connection: ctx
    });

    inFlightRpcCount++;
    try {
        const {result, shouldAudit} = await dispatchToComponent({
            sender,
            resolved,
            params,
            ctx,
            req
        });
        recordSuccess(resolved, t0, shouldAudit, caller, params);
        recordConnectionEvent(ctx, resolved.method, t0);
        return result;
    } catch (error: any) {
        recordFailure(resolved, t0, caller, params, error);
        recordConnectionEvent(ctx, resolved.method, t0);
        throw translateThrownError(error, {method, requestId});
    } finally {
        await finalizeRequest(req);
    }
}

export async function execInternal(method: string, params?: any) {
    return await exec(CommandSender.INTERNAL, method, params);
}

export function registerComponent<T extends Component>(
    component: T,
    allowOverride = false
) {
    const name = component.name.toLowerCase();
    if (components.has(name)) {
        if (!allowOverride) return;
        logger.warn('Overriding component %s', name);
    }
    logger.info(
        "Registering component '%s' with methods:[%s]",
        component.name,
        String(component.listMethods())
    );
    components.set(name, component);
    registerComponentAliases(component);
}

function registerComponentAliases(component: Component) {
    let mutated = false;
    for (const [oldName, target] of component.getMethodAliases()) {
        if (Object.hasOwn(methodAliases, oldName)) {
            const existing = methodAliases[oldName];
            if (existing !== target) {
                logger.warn(
                    'Alias conflict: %s → %s already maps to %s',
                    oldName,
                    target,
                    existing
                );
            }
            continue;
        }
        methodAliases[oldName] = target;
        mutated = true;
        logger.debug('Registered legacy alias %s → %s', oldName, target);
    }
    if (mutated) resolvedMethodCache.clear();
}

export function deleteComponent(name: string) {
    unregisterComponent(name);
}

export function unregisterComponent(name: string) {
    const normalized = name.toLowerCase();
    components.delete(normalized);
    let mutated = false;
    for (const [alias, target] of Object.entries(methodAliases)) {
        if (target.startsWith(`${normalized}.`)) {
            delete methodAliases[alias];
            mutated = true;
        }
    }
    if (mutated) resolvedMethodCache.clear();
}

export function getComponent(name: string) {
    return components.get(name);
}

export function getComponents() {
    return components;
}

export function listCommands() {
    return Array.from(components.keys());
}

// Routes with the caller's sender so each component's per-method permission
// gate applies; an omitted component means the sender may not read it.
export async function getConfig(name: string, sender: CommandSender) {
    const component = getComponent(name);
    if (component === undefined) {
        return {};
    }
    return component.getAggregatedView(sender, 'getconfig');
}

export async function getStatus(name: string, sender: CommandSender) {
    const component = getComponent(name);
    if (component === undefined) {
        return {};
    }
    return component.getAggregatedView(sender, 'getstatus');
}

// Register observability module stats
Observability.registerModule('commander', {
    stats: () => ({
        registered: components.size
    }),
    topology: {
        role: 'transform',
        cluster: 'clients',
        zone: 'command_plane',
        upstreams: ['wsCommands'],
        label: 'Commander',
        description: 'RPC dispatcher to registered components',
        route: '/monitoring/commands'
    }
});
