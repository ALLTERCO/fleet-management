import {getLogger, type Logger} from 'log4js';
import * as components from '../../config/components';
import {configRc, DEV_MODE} from '../../config/index';
import {
    canPerformComponentOperationAsync,
    canUsePlatformAdmin,
    hasTenantAdminAuthority,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import type {RequestContext} from '../../modules/RequestContext';
import {
    notifyComponentEvent,
    notifyComponentStatus
} from '../../modules/ShellyEvents';
import type {ConnectionContext} from '../../modules/web/ws/ConnectionContext';
import RpcError from '../../rpc/RpcError';
import type {Context} from '../../types';
import type CommandSender from '../CommandSender';
import type {ComponentName, CrudOperation} from '../permissions';
import {mapLegacyComponentName, methodToCrudOperation} from '../permissions';
import type {
    ComponentEventAttr,
    ComponentEventDescriptor
} from './componentEventTypes';

export type {ComponentEventAttr, ComponentEventDescriptor};

// Lazy require() shims — Component sits at the base of the dependency graph;
// these defer load until the wrapped method first runs, avoiding circular
// init. Kept as runtime functions, NOT static imports.
type RequireOrgFn = (
    sender: CommandSender,
    params?: {organizationId?: string}
) => string;
let _requireOrgFn: RequireOrgFn | undefined;
function requireOrgLazy(): RequireOrgFn {
    if (!_requireOrgFn)
        _requireOrgFn = require('../../rpc/scope').requireOrganizationId;
    return _requireOrgFn as RequireOrgFn;
}
type RegisterPoolFn = (method: string, pool: 'general' | 'expensive') => void;
let _registerPoolFn: RegisterPoolFn | undefined;
function rateLimitPoolRegisterLazy(): RegisterPoolFn {
    if (!_registerPoolFn)
        _registerPoolFn =
            require('../../modules/web/rateLimit').registerRateLimitPool;
    return _registerPoolFn as RegisterPoolFn;
}
type RegisterScopedTokenMethodFn = (method: string, purpose: string) => void;
let _registerScopedTokenFn: RegisterScopedTokenMethodFn | undefined;
function scopedTokenRegisterLazy(): RegisterScopedTokenMethodFn {
    if (!_registerScopedTokenFn)
        _registerScopedTokenFn =
            require('../../modules/auth/scopedTokenAccess').registerScopedTokenMethod;
    return _registerScopedTokenFn as RegisterScopedTokenMethodFn;
}

interface ComponentProperties {
    auto_apply_config?: boolean;
    set_config_methods?: boolean;
    config_base?: Record<string, any>;
    /**
     * When true, this component's aggregated `getStatus` / `getConfig`
     * values are exposed to non-admin callers via `system.getstatus` /
     * `system.getconfig`. Default false — opt-in, so a newly added
     * component doesn't automatically start leaking its internal state
     * to viewers. UI-facing components (mdns, grafana, dashboards, etc.)
     * pass `{viewerVisible: true}` from their constructor.
     */
    viewer_visible?: boolean;
    /**
     * Doc-grounded list of `NotifyEvent`s this component can emit.
     * Source of truth for events Shelly's `Webhook.ListAllSupported`
     * leaves out (notification-only) — same pattern Matter cluster XML
     * and openHAB thing-type XML use. The runtime device catalog is
     * consulted as a fallback / discovery signal, not the truth.
     */
    events?: ReadonlyArray<ComponentEventDescriptor>;
}

// Recursively freezes events + each descriptor + each attr so a buggy
// plugin or test can't mutate the schema at runtime.
function deepFreezeEvents(
    events: ReadonlyArray<ComponentEventDescriptor>
): ReadonlyArray<ComponentEventDescriptor> {
    for (const ev of events) {
        if (ev.attrs) {
            for (const attr of ev.attrs) Object.freeze(attr);
            Object.freeze(ev.attrs);
        }
        Object.freeze(ev);
    }
    return Object.freeze(events);
}

type DecoratedRpcMethod = {
    name?: string;
    checkParams?: (params?: unknown) => boolean;
    checkPermissions?: (
        sender: CommandSender,
        params?: unknown
    ) => boolean | Promise<boolean>;
    noAudit?: boolean;
    /** @RequiresOrganization — framework asserts sender has org context. */
    requiresOrganization?: boolean;
    /** @RateLimit('expensive') — declares the bucket; replaces the CSV. */
    rateLimitPool?: 'general' | 'expensive';
    /** @AcceptsScopedToken('<purpose>') — Bearer scoped token consumes here. */
    acceptsScopedToken?: string;
};

const DEFAULT_PROPERTIES = Object.freeze({
    auto_apply_config: true,
    set_config_methods: true,
    config_base: Object.freeze({}),
    viewer_visible: false
} as const);

function configuredDefaultConfig<T extends Record<string, any>>(
    name: string
): T | undefined {
    const configured =
        configRc.components[name as keyof typeof configRc.components];
    if (!isRecord(configured)) return undefined;
    return configured as T;
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function canPerformCrudOperation(
    sender: CommandSender,
    component: ComponentName,
    operation: CrudOperation,
    itemId: string | number | undefined
): Promise<boolean> {
    const decision = await canPerformComponentOperationAsync(
        sender,
        component,
        operation,
        itemId
    );
    return isComponentPermissionAllowed(decision);
}

export default abstract class Component<
    T extends Record<string, any> = Record<string, any>
> {
    readonly name: string;
    protected methods: Map<
        string,
        {
            exec: (
                params: any,
                sender: CommandSender,
                ctx?: ConnectionContext,
                req?: RequestContext
            ) => any;
            checkParams: (params: any) => boolean;
            checkPermissions: (
                sender: CommandSender,
                params?: any
            ) => boolean | Promise<boolean>;
            /**
             * When true, Commander skips audit-log emission for this
             * method. Set via `@Component.NoAudit` decorator or
             * per-method option on `addMethod`. Used for high-volume
             * reads (getstatus/getconfig/listmethods/list-surfaces)
             * whose audit value is below the log-volume cost.
             */
            noAudit: boolean;
            // Set on the param-less default getstatus/getconfig only. A device
            // RPC getstatus (@Expose('GetStatus')) leaves it unset, so the
            // System aggregate skips it.
            aggregateSafe?: boolean;
        }
    >;
    protected config: T;
    readonly logger: Logger;
    readonly viewerVisible: boolean;
    readonly events: ReadonlyArray<ComponentEventDescriptor>;

    constructor(name: string, properties?: ComponentProperties) {
        this.name = name;
        name = name.toLowerCase();
        this.methods = new Map();
        this.logger = getLogger(`Component ${name}`);
        const props = Object.assign({}, DEFAULT_PROPERTIES, properties);
        this.viewerVisible = props.viewer_visible;
        this.events = deepFreezeEvents(properties?.events ?? []);
        const defaultConfig =
            configuredDefaultConfig<T>(name) ?? this.getDefaultConfig();
        this.config = Object.assign(
            {},
            props.config_base,
            components.getConfigSync(name, defaultConfig)
        );
        this.logger.debug(
            'CONFIG:[%s]',
            JSON.stringify(this.config, (key, value) => {
                if (
                    /secret|password|token|key/i.test(key) &&
                    typeof value === 'string'
                )
                    return '***';
                return value;
            })
        );

        this.addDefaultMethods(props.set_config_methods);

        if (props.auto_apply_config) {
            this.setConfig(this.config, true);
        }

        const metadata = this.constructor[Symbol.metadata];
        if (metadata) {
            this.#registerDecoratorMethods(metadata);
        }

        if (DEV_MODE) {
            this.addDebugMethods();
        }
    }

    #registerDecoratorMethods(metadata: DecoratorMetadataObject) {
        for (const key in metadata) {
            if (key.startsWith('_')) continue;
            const methodInfo = metadata[key] as DecoratedRpcMethod;
            const handler = (this as Record<string, unknown>)[key];
            if (methodInfo.name && typeof handler === 'function') {
                this.addMethod(
                    methodInfo.name,
                    (params, sender, ctx, req) => {
                        if (methodInfo.requiresOrganization) {
                            requireOrgLazy()(
                                sender,
                                params as {organizationId?: string} | undefined
                            );
                        }
                        return handler.call(this, params, sender, ctx, req);
                    },
                    methodInfo
                );
                if (methodInfo.rateLimitPool) {
                    // Fully qualified method name as the rate-limit gate
                    // sees it (lowercased component + method).
                    const fq = `${this.name}.${methodInfo.name}`.toLowerCase();
                    rateLimitPoolRegisterLazy()(fq, methodInfo.rateLimitPool);
                }
                if (methodInfo.acceptsScopedToken) {
                    const fq = `${this.name}.${methodInfo.name}`.toLowerCase();
                    scopedTokenRegisterLazy()(
                        fq,
                        methodInfo.acceptsScopedToken
                    );
                }
            }
        }
    }

    protected addDefaultMethods(configMethods: boolean) {
        // Default introspection methods are skipped from audit: they
        // fire on every dashboard mount and carry no forensic value that
        // the per-component surface methods don't already cover.
        this.addMethod('ListMethods', () => this.listMethods(), {
            noAudit: true
        });
        if (!configMethods) return;
        // Trusted callers bypass; viewer_visible exposes getconfig at admin.
        const viewerVisible = this.viewerVisible;
        this.addMethod('getstatus', (params) => this.getStatus(params), {
            noAudit: true,
            aggregateSafe: true
        });
        this.addMethod('getconfig', (params) => this.getConfig(params), {
            noAudit: true,
            aggregateSafe: true,
            checkPermissions: (sender) =>
                sender.isTrusted() ||
                (viewerVisible
                    ? hasTenantAdminAuthority(sender)
                    : canUsePlatformAdmin(sender))
        });
        this.addMethod<{config: any}>(
            'setconfig',
            (params) => this.setConfig(params.config),
            {
                checkPermissions: (sender) =>
                    sender.isTrusted() || canUsePlatformAdmin(sender)
            }
        );
        this.configureDefaultReadMethods();
    }

    protected configureDefaultReadMethods(): void {}

    protected replaceDefaultReadMethods(input: {
        getStatus: (params: any, sender: CommandSender) => any;
        getConfig: (params: any, sender: CommandSender) => any;
    }): void {
        const status = this.methods.get('getstatus');
        if (status) {
            this.methods.set('getstatus', {
                ...status,
                exec: (params, sender) => input.getStatus(params, sender)
            });
        }
        const config = this.methods.get('getconfig');
        if (config) {
            this.methods.set('getconfig', {
                ...config,
                exec: (params, sender) => input.getConfig(params, sender)
            });
        }
    }

    protected addDebugMethods() {
        this.addMethod('readconfig', () => {
            return this.config;
        });
        this.addMethod<{
            config?: any;
            init?: boolean;
        }>('writeconfig', (params) => {
            const newConfig = params?.config;
            const init = typeof params?.init === 'boolean' ? params.init : true;
            if (newConfig && typeof newConfig === 'object') {
                this.setConfig(newConfig, init);
            }
        });
        this.addMethod<{init?: boolean}>('resetconfig', (params) => {
            const init = typeof params?.init === 'boolean' ? params.init : true;
            this.setConfig(this.getDefaultConfig(), init);
        });
    }

    /**
     * Whether the given submethod is opted out of the RPC audit log.
     * Returns false for unknown methods (so Commander logs them as
     * attempted-but-unknown method errors).
     */
    shouldAuditMethod(method: string): boolean {
        const bundle = this.methods.get(method);
        if (!bundle) return true;
        return !bundle.noAudit;
    }

    async call(
        sender: CommandSender,
        method: string,
        params?: any,
        ctx?: ConnectionContext,
        req?: RequestContext
    ) {
        const bundle = this.methods.get(method);

        if (!bundle) {
            throw RpcError.MethodNotFound();
        }

        const {exec, checkParams, checkPermissions} = bundle;

        if (!(await checkPermissions(sender, params))) {
            throw RpcError.PermissionDenied(sender.isAuthenticated());
        }

        if (!checkParams(params)) {
            throw RpcError.InvalidParams();
        }

        // Extra args harmless to shorter handler signatures.
        let response = await exec.apply(this, [params, sender, ctx, req]);
        if (response === undefined) {
            response = null;
        }

        return response;
    }

    protected addMethod<Params>(
        method: string,
        exec: (
            params: Params,
            sender: CommandSender,
            ctx?: ConnectionContext,
            req?: RequestContext
        ) => any,
        options?: {
            checkParams?: (params: any) => boolean;
            checkPermissions?: (
                sender: CommandSender,
                params?: Params
            ) => boolean | Promise<boolean>;
            noAudit?: boolean;
            aggregateSafe?: boolean;
        }
    ) {
        const checkParams =
            options?.checkParams ||
            ((params: any) => this.checkParams(method, params));
        const checkPermissions =
            options?.checkPermissions ||
            ((sender: CommandSender, params?: any) =>
                this.checkPermissions(sender, method, params));
        const noAudit = options?.noAudit ?? false;
        this.methods.set(method.toLowerCase(), {
            exec,
            checkParams,
            checkPermissions,
            noAudit,
            aggregateSafe: options?.aggregateSafe
        });
    }

    // True when getstatus/getconfig is the param-less default, not a device RPC.
    hasAggregateSafeRead(kind: 'getstatus' | 'getconfig'): boolean {
        return this.methods.get(kind)?.aggregateSafe === true;
    }

    /**
     * Method names that indicate write operations.
     * Viewers are blocked from these by default.
     */
    private static readonly WRITE_METHODS = new Set([
        'create',
        'add',
        'update',
        'delete',
        'remove',
        'set',
        'call',
        'send',
        'execute',
        'trigger',
        'rename',
        'enable',
        'disable',
        'accept',
        'reject',
        'upload',
        'purge',
        'start',
        'stop'
    ]);

    /**
     * Check if a method name indicates a write operation
     */
    protected static isWriteMethod(method: string): boolean {
        const methodLower = method.toLowerCase();
        for (const writeMethod of Component.WRITE_METHODS) {
            if (
                methodLower.startsWith(writeMethod) ||
                methodLower.endsWith(writeMethod)
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the component name for CRUD permission checks.
     * Can be overridden by subclasses for custom mapping.
     */
    protected getComponentName(): ComponentName | null {
        return mapLegacyComponentName(this.name);
    }

    /**
     * Extract item ID from params for scoped permission checks.
     * Can be overridden by subclasses for custom extraction.
     */
    protected extractItemId(params?: any): string | number | undefined {
        if (!params) return undefined;
        return (
            params.id ?? params.shellyID ?? params.shellyId ?? params.groupId
        );
    }

    /**
     * Check permissions using the new CRUD model.
     * Falls back to legacy permission checks if CRUD mapping isn't available.
     */
    protected async checkPermissions(
        sender: CommandSender,
        method: string,
        params?: any
    ): Promise<boolean> {
        const componentName = this.getComponentName();
        const operation = methodToCrudOperation(method);

        if (componentName && operation) {
            const itemId = this.extractItemId(params);
            return canPerformCrudOperation(
                sender,
                componentName,
                operation,
                itemId
            );
        }

        // Fall back to legacy permission check
        const hasSpecificPermission = sender.hasPermission(
            `${this.name}.${method}`
        );

        // For write operations, also require canWrite()
        if (Component.isWriteMethod(method)) {
            return hasSpecificPermission && sender.canWrite();
        }

        return hasSpecificPermission;
    }

    public checkParams(method: string, params?: any): boolean {
        // `setconfig` is shared across components and has no per-method
        // schema — guard it here; everything else validates in-handler.
        if (method === 'setconfig' && this.methods.has('setconfig')) {
            return (
                typeof params === 'object' &&
                typeof params.config === 'object' &&
                Object.keys(params.config).length > 0
            );
        }
        return true;
    }

    public listMethods() {
        return Array.from(this.methods.keys());
    }

    // Access a component's Describe output without going through Commander
    // (avoids per-component audit rows in System.Describe aggregation).
    public async tryGetDescribe(
        sender: CommandSender
    ): Promise<unknown | undefined> {
        const method = this.methods.get('describe');
        if (!method) return undefined;
        if (!(await method.checkPermissions(sender))) return undefined;
        try {
            return await method.exec({}, sender);
        } catch (err: unknown) {
            // Surface broken describes — silent swallow hid them.
            this.logger.warn(
                'describe() failed for component %s: %s',
                this.name,
                err instanceof Error ? err.message : String(err)
            );
            return undefined;
        }
    }

    // allow to be overridden
    protected checkConfigKey(_key: string, _value: any) {
        return false;
    }

    // allow to be overridden
    protected applyConfigKey(
        key: string,
        value: any,
        _config: Partial<T>,
        _init?: boolean
    ): void | Promise<void> {
        (this.config as Record<string, any>)[key] = value;
    }

    protected configChanged() {
        // empty
    }

    protected abstract getDefaultConfig(): T;

    protected emitEvent(event: string) {
        notifyComponentEvent(this.name, event);
    }

    protected emitStatus(patch: object) {
        notifyComponentStatus({[this.name]: patch});
    }

    // allow to be overridden
    getStatus(_params?: any): Record<string, any> {
        return {};
    }

    /**
     * Run a default read method (`getstatus` / `getconfig`) under that method's
     * own permission gate. Returns `undefined` when the sender may not call it,
     * so aggregators omit the component instead of leaking its state.
     */
    async getAggregatedView(
        sender: CommandSender,
        kind: 'getstatus' | 'getconfig'
    ): Promise<Record<string, any> | undefined> {
        const method = this.methods.get(kind);
        if (!method) {
            return kind === 'getstatus' ? this.getStatus() : this.getConfig();
        }
        if (!(await method.checkPermissions(sender))) return undefined;
        const response = await method.exec(undefined, sender);
        return response ?? {};
    }

    getConfig(_params?: any): Partial<T> {
        return Object.assign({}, this.config);
    }

    getFullConfig() {
        return Object.assign({}, this.config);
    }

    protected async _persistConfig() {
        return await components.saveConfig(this.name, this.config);
    }

    async setConfig(config: Partial<T>, init = false) {
        for (const key in config) {
            if (this.checkConfigKey(key, config[key])) {
                await this.applyConfigKey(key, config[key], config, init);
            }
        }
        await this._persistConfig();
        this.configChanged();
        // fire config changed event
        this.emitEvent('config_changed');
    }

    // ========================================================================
    // Decorators
    // ========================================================================

    static Expose(name?: string) {
        return (_target: (...args: any) => any, context: Context) => {
            const methodName = (name || context.name).toLowerCase();
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].name = methodName;
        };
    }

    static CheckParams(predicate: (params: any) => boolean) {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].checkParams = predicate;
        };
    }

    static CheckPermissions(
        predicate: (
            sender: CommandSender,
            params: any
        ) => boolean | Promise<boolean>
    ) {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].checkPermissions = predicate;
        };
    }

    /**
     * Bypass permission checks but still enforce write restrictions for viewers.
     * Use @Component.ReadOnly for read operations that should be accessible to viewers.
     */
    static NoPermissions(_target: (...args: any) => any, context: Context) {
        context.metadata ??= {};
        context.metadata[context.name] ??= {};
        const methodName = String(context.name);
        context.metadata[context.name].checkPermissions = (
            sender: CommandSender
        ) => {
            // If it's a write operation, still require canWrite()
            if (Component.isWriteMethod(methodName)) {
                return sender.canWrite();
            }
            return true;
        };
    }

    static RequiredPermission(permission: string) {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].checkPermissions = (
                sender: CommandSender
            ) => {
                return sender.hasPermission(permission.toLowerCase());
            };
        };
    }

    /**
     * Decorator to mark a method as a write operation.
     * Only users with write permissions (admins) can execute this method.
     * Viewers will receive a 403 Forbidden error.
     */
    static WriteOperation(_target: (...args: any) => any, context: Context) {
        context.metadata ??= {};
        context.metadata[context.name] ??= {};
        context.metadata[context.name].checkPermissions = (
            sender: CommandSender
        ) => {
            return sender.canWrite();
        };
    }

    /**
     * Decorator to mark a method as read-only (viewers can access).
     * Both admins and viewers can execute this method.
     */
    static ReadOnly(_target: (...args: any) => any, context: Context) {
        context.metadata ??= {};
        context.metadata[context.name] ??= {};
        context.metadata[context.name].checkPermissions = () => true;
    }

    /**
     * Decorator declaring a deprecated RPC method name that should route
     * to this handler. Registered at component-registration time — the
     * Commander rewrites `oldname` → `component.newname` before dispatch
     * and emits a deprecation warning in the application log. Each
     * invocation is captured in the audit trail with the original method
     * name (suffixed with the rewrite target) for forensic queries.
     *
     * Example — allow mobile clients still on the pre-Phase-7 namespace
     * to reach the new method:
     *
     *   @Component.Expose('Subscribe')
     *   @Component.Alias('fleetmanager.subscribetonotifications')
     *   async subscribe(...) { ... }
     *
     * Multiple aliases can be stacked on one method. Remove the decorator
     * once every known caller has migrated.
     */
    static Alias(oldMethodName: string) {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            const info = context.metadata[context.name] as {
                aliases?: string[];
            };
            info.aliases ??= [];
            info.aliases.push(oldMethodName.toLowerCase());
        };
    }

    /**
     * Imperative alias registration for default methods that don't go
     * through `@Component.Expose` (e.g., the auto-generated `getstatus` /
     * `getconfig` / `listmethods` registered by `addDefaultMethods`).
     * Components declare these in their constructor; Commander reads
     * them alongside decorator-declared aliases at registration time.
     */
    readonly #imperativeAliases = new Map<string, string>();
    protected addAlias(oldMethod: string, newMethod: string) {
        this.#imperativeAliases.set(
            oldMethod.toLowerCase(),
            newMethod.toLowerCase()
        );
    }

    /**
     * Return the `oldMethodName → newMethodName` map this component
     * declares via `@Component.Alias` (decorator) and/or `addAlias`
     * (imperative). Called by Commander at registration time to populate
     * the global alias lookup.
     */
    getMethodAliases(): Map<string, string> {
        const out = new Map<string, string>(this.#imperativeAliases);
        const metadata = this.constructor[Symbol.metadata];
        if (!metadata) return out;
        const nsLower = this.name.toLowerCase();
        for (const key in metadata) {
            const info = metadata[key] as {
                name?: string;
                aliases?: string[];
            };
            if (!info.name || !info.aliases) continue;
            const target = `${nsLower}.${info.name.toLowerCase()}`;
            for (const alias of info.aliases) {
                out.set(alias, target);
            }
        }
        return out;
    }

    /**
     * Decorator to opt a method out of the SUCCESS half of the RPC audit log.
     *
     * Use on high-volume reads that fire many times per dashboard load
     * (entity.list, device.getstatushistory, fleet.getmetrics, etc.) —
     * where the forensic value is below the audit-log write cost.
     *
     * Failures are ALWAYS audited regardless of this flag. OWASP A09:2021
     * mandates logging all security-relevant failures (authn/authz, errors);
     * the asymmetry — failures-always, success-opt-in — matches the standard.
     * Commander.recordSuccess() checks the flag; Commander.recordFailure()
     * ignores it. Observability counters still fire so rate/error metrics
     * remain visible whether or not the audit row is written.
     *
     * Mutating and security-sensitive methods (energy.query, device.call,
     * anything that returns per-user data from an external system) must
     * NOT use this decorator — their successful-call audit trail is a
     * compliance signal in its own right.
     */
    static NoAudit(_target: (...args: any) => any, context: Context) {
        context.metadata ??= {};
        context.metadata[context.name] ??= {};
        context.metadata[context.name].noAudit = true;
    }

    // Assert sender has org context before dispatch. Framework calls
    // requireOrganizationId(sender) — throws Unauthorized if absent.
    // Industry parallel: spring @PreAuthorize, nestjs @UseGuards.
    static RequiresOrganization(
        _target: (...args: any) => any,
        context: Context
    ) {
        context.metadata ??= {};
        context.metadata[context.name] ??= {};
        context.metadata[context.name].requiresOrganization = true;
    }

    // Declare which rate-limit bucket the method consumes. Today the CSV
    // tuning.http.rateLimitExpensiveMethods drives this; the decorator is the
    // strongly-typed replacement and the source of truth going forward.
    static RateLimit(pool: 'general' | 'expensive') {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].rateLimitPool = pool;
        };
    }

    // Allow a Bearer scoped token with the given purpose to authenticate
    // for this RPC. Single-use; the HTTP middleware consumes the token row
    // and builds a synthetic CommandSender pinned to the token's org.
    static AcceptsScopedToken(purpose: string) {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].acceptsScopedToken = purpose;
        };
    }

    /**
     * Decorator for CRUD permission checking.
     * Uses the new permission model with component and operation.
     *
     * @param component - The component name (e.g., 'devices', 'groups')
     * @param operation - The CRUD operation (e.g., 'read', 'create', 'execute')
     * @param extractItemId - Optional function to extract item ID from params
     */
    static CrudPermission(
        component: ComponentName,
        operation: CrudOperation,
        extractItemId?: (params: any) => string | number | undefined
    ) {
        return (_target: (...args: any) => any, context: Context) => {
            context.metadata ??= {};
            context.metadata[context.name] ??= {};
            context.metadata[context.name].checkPermissions = (
                sender: CommandSender,
                params?: any
            ) => {
                const itemId = extractItemId
                    ? extractItemId(params)
                    : (params?.id ??
                      params?.shellyID ??
                      params?.shellyId ??
                      params?.groupId);
                return canPerformCrudOperation(
                    sender,
                    component,
                    operation,
                    itemId
                );
            };
        };
    }
}
