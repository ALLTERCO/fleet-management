import {tuning} from '../../config/tuning';
import {
    canCrossOrganizationBoundary,
    canPerformComponentOperation,
    canUseAuthenticatedWrite,
    hasTenantAdminAuthority,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import {
    listReadableConfigurationProfileKeys,
    readConfigurationProfile,
    readReadableConfigurationProfiles,
    requireConfigurationProfileAccess
} from '../../modules/configurationProfiles';
import * as Registry from '../../modules/Registry';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    STORAGE_DESCRIBE,
    STORAGE_GET_ITEM_PARAMS,
    STORAGE_GETALL_PARAMS,
    STORAGE_KEYS_PARAMS,
    STORAGE_REMOVE_ITEM_PARAMS,
    STORAGE_SET_ITEM_PARAMS
} from '../../types/api/storage';
import type CommandSender from '../CommandSender';
import Component from './Component';

export interface StorageComponentConfig {
    enable: boolean;
    items: Record<string, any>;
}

interface StorageGetItemParams {
    registry?: string;
    key: string;
}
interface StorageSetItemParams {
    registry?: string;
    key: string;
    value: unknown;
}
interface StorageKeysParams {
    registry?: string;
}
interface StorageRemoveItemParams {
    registry?: string;
    key: string;
    value?: any;
}

export default class StorageComponent extends Component<StorageComponentConfig> {
    constructor() {
        super('storage', {viewer_visible: true});
    }

    // Known (registry, key) pairs that have an org-scoped DB handler in
    // modules/Registry.actions. Anything else for these registries falls
    // through to global file writes, so we require provider support for
    // arbitrary keys to close the cross-tenant escape.
    #isOrgScopedRegistryKey(registry: string, key: string): boolean {
        const cc = `${registry}.${key}`.toLowerCase();
        return (
            cc === 'ui.menuitems' ||
            cc === 'ui.config' ||
            cc === 'ui.dashboardsettings' ||
            cc === 'actions.rpc'
        );
    }

    #checkRegistryWritePermission(
        sender: CommandSender,
        registry: string,
        key?: string,
        operation: 'create' | 'update' | 'delete' = 'update',
        _itemId?: string | number
    ) {
        const reg = (registry ?? '').toLowerCase();
        const k = (key ?? '').toLowerCase();
        if (reg === 'memory') return;
        // Dashboards live in DB via DashboardComponent — Storage.* file
        // fallback is legacy and would write to global state.
        if (reg === 'dashboards' || k === 'dashboards') {
            if (!canCrossOrganizationBoundary(sender)) {
                throw RpcError.InvalidRequest(
                    'dashboards: use dashboard.* RPCs; Storage.* fallback is provider-support-only'
                );
            }
            return;
        }
        // Known DB-backed (registry, key) pair → admin baseline.
        if (this.#isOrgScopedRegistryKey(reg, k)) {
            if (hasTenantAdminAuthority(sender)) return;
            if (reg === 'actions') {
                if (!sender.hasCrudPermission('actions', operation)) {
                    throw RpcError.InvalidRequest(
                        `No ${operation} permission on actions`
                    );
                }
            }
            // ui.* keys: admin baseline above; non-admin would only get
            // here through hasCrudPermission for dashboards, which we
            // do not grant via the ui registry.
            return;
        }
        // Configuration profiles are selected by their registry key.
        if (reg === 'configs') {
            if (!key) throw RpcError.InvalidParams('config key required');
            requireConfigurationProfileAccess(sender, key, operation);
            return;
        }
        // Variables registry — file-backed but admin-managed via the
        // actions resource (matches Variables.Set/Delete RPC contract).
        if (reg === 'action-variables' || reg === 'action-variables-meta') {
            if (hasTenantAdminAuthority(sender)) return;
            if (!sender.hasCrudPermission('actions', operation)) {
                throw RpcError.InvalidRequest(
                    `No ${operation} permission on action variables`
                );
            }
            return;
        }
        // Any other (registry, key) — including actions.<not-rpc> and
        // arbitrary ui.<unknown> — falls through to a global file write.
        // provider support only.
        if (!canCrossOrganizationBoundary(sender)) {
            throw RpcError.InvalidRequest(
                `No write permission on registry '${reg}' key '${k || '(none)'}'`
            );
        }
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return STORAGE_DESCRIBE;
    }

    @Component.Expose('SetItem')
    @Component.CheckPermissions(canUseAuthenticatedWrite)
    async setItem(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<StorageSetItemParams>(
            rawParams,
            STORAGE_SET_ITEM_PARAMS
        );
        const registry = (params.registry ?? 'memory').toLowerCase();
        const val = params.value as any;
        const op =
            registry === 'configs'
                ? (await Registry.getFromRegistry(registry, params.key)) ===
                  null
                    ? 'create'
                    : 'update'
                : val?.id
                  ? 'update'
                  : 'create';
        this.#checkRegistryWritePermission(
            sender,
            registry,
            params.key,
            op,
            val?.id
        );
        await Registry.addToRegistry(
            registry,
            params.key,
            params.value,
            sender.getOrganizationId()
        );
        return {updated: params.key};
    }

    // Known registries get downstream per-resource filtering inside
    // getItem/#fetchGetAll. Unknown registries are not org-partitioned —
    // global provider support only.
    #assertRegistryReadable(
        sender: CommandSender,
        registry: string,
        key?: string
    ): void {
        const reg = (registry ?? '').toLowerCase();
        const k = (key ?? '').toLowerCase();
        if (reg === 'memory') return;
        if (reg === 'dashboards') {
            if (!canCrossOrganizationBoundary(sender)) {
                throw RpcError.InvalidRequest(
                    'dashboards: use dashboard.* RPCs; Storage.* fallback is provider-support-only'
                );
            }
            return;
        }
        if (this.#isOrgScopedRegistryKey(reg, k)) return;
        if (reg === 'ui' || reg === 'configs') {
            // ui registry is the frontend's app-state store (loaded on
            // every boot). configs is admin-managed singletons —
            // getItem-level filtering happens downstream.
            return;
        }
        if (reg === 'actions') {
            // actions registry has exactly one known DB-scoped key
            // (rpc) — that path is caught by #isOrgScopedRegistryKey
            // above. Arbitrary actions.<other> keys are global file
            // state; provider support only.
            if (!canCrossOrganizationBoundary(sender)) {
                throw RpcError.InvalidRequest(
                    `No read permission on registry 'actions' key '${k || '(none)'}'`
                );
            }
            return;
        }
        if (reg === 'action-variables' || reg === 'action-variables-meta') {
            // Variables registry is file-backed; can hold secrets. Match
            // the Variables RPC contract: actions:read.
            if (
                !hasTenantAdminAuthority(sender) &&
                !sender.hasCrudPermission('actions', 'read')
            ) {
                throw RpcError.InvalidRequest(
                    `No read permission on registry '${reg}'`
                );
            }
            return;
        }
        if (!canCrossOrganizationBoundary(sender)) {
            throw RpcError.InvalidRequest(
                `No read permission on registry '${reg}'`
            );
        }
    }

    @Component.NoAudit
    @Component.Expose('GetItem')
    @Component.NoPermissions
    async getItem(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<StorageGetItemParams>(
            rawParams,
            STORAGE_GET_ITEM_PARAMS
        );
        const registry = (params.registry ?? 'memory').toLowerCase();
        this.#assertRegistryReadable(sender, registry, params.key);

        if (registry === 'memory') {
            return this.config.items[params.key] ?? null;
        }
        if (registry === 'configs') {
            return readConfigurationProfile(sender, params.key);
        }
        try {
            const registryContent = await Registry.getFromRegistry(
                registry,
                params.key,
                sender.getOrganizationId()
            );

            if (!registryContent) {
                return null;
            }

            // Whole-registry global bypass for global provider support only.
            // Tenant admins flow through the per-resource filters below.
            if (canCrossOrganizationBoundary(sender)) {
                return registryContent;
            }

            const key = (params.key ?? '').toLowerCase();
            if (
                (registry === 'actions' || key === 'rpc') &&
                Array.isArray(registryContent)
            ) {
                if (!sender.hasCrudPermission('actions', 'read')) {
                    return [];
                }

                const allDeviceIds = new Set<string>();
                for (const act of registryContent) {
                    for (const step of act.actions) {
                        for (const id of step.dst) allDeviceIds.add(id);
                    }
                }
                const accessible = await sender.filterAccessibleDevices([
                    ...allDeviceIds
                ]);

                const filtered: typeof registryContent = [];
                for (const act of registryContent) {
                    let ok = true;
                    for (const step of act.actions) {
                        for (const shellyID of step.dst) {
                            if (!accessible.has(shellyID)) {
                                ok = false;
                                break;
                            }
                        }
                        if (!ok) break;
                    }
                    if (ok) filtered.push(act);
                }
                return filtered;
            }

            if (registry === 'dashboards' || key === 'dashboards') {
                if (!sender.hasCrudPermission('dashboards', 'read')) {
                    return Array.isArray(registryContent) ? [] : {};
                }

                if (Array.isArray(registryContent)) {
                    return registryContent.filter((d: any) =>
                        isComponentPermissionAllowed(
                            canPerformComponentOperation(
                                sender,
                                'dashboards',
                                'read',
                                d?.id
                            )
                        )
                    );
                }
                const result: Record<string, any> = {};
                for (const [id, val] of Object.entries(registryContent)) {
                    const dashId = (val as any)?.id ?? Number(id);
                    if (
                        isComponentPermissionAllowed(
                            canPerformComponentOperation(
                                sender,
                                'dashboards',
                                'read',
                                dashId
                            )
                        )
                    ) {
                        result[id] = val;
                    }
                }
                return result;
            }

            return registryContent;
        } catch (error) {
            this.logger.error(`Error accessing registry ${registry}:`, error);
            return null;
        }
    }

    @Component.NoAudit
    @Component.Expose('Keys')
    @Component.NoPermissions
    async keys(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<StorageKeysParams>(
            rawParams ?? {},
            STORAGE_KEYS_PARAMS
        );
        const registry = (params.registry ?? 'memory').toLowerCase();
        this.#assertRegistryReadable(sender, registry);

        if (registry === 'memory') return Object.keys(this.config.items);
        if (registry === 'configs') {
            return listReadableConfigurationProfileKeys(sender);
        }
        return Registry.getRegistryKeys(registry);
    }

    @Component.NoAudit
    @Component.Expose('GetAll')
    @Component.NoPermissions
    async getall(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<StorageKeysParams>(
            rawParams ?? {},
            STORAGE_GETALL_PARAMS
        );
        const registry = (params.registry ?? 'memory').toLowerCase();
        const result = await this.#fetchGetAll(registry, sender);
        this.#enforceGetAllSizeCap(registry, result);
        return result;
    }

    async #fetchGetAll(
        registry: string,
        sender: CommandSender
    ): Promise<Record<string, any>> {
        if (registry === 'memory') {
            return this.config.items;
        }
        this.#assertRegistryReadable(sender, registry);

        // Whole-registry global reads only for global provider support. Tenant
        // admins flow through the per-resource filters below so
        // file-backed state stays scoped per-resource where it can be.
        if (canCrossOrganizationBoundary(sender)) {
            return Registry.getAll(registry);
        }

        if (registry === 'dashboards') {
            if (!sender.hasCrudPermission('dashboards', 'read')) {
                return {};
            }
            const all = await Registry.getAll(registry);
            const result: Record<string, any> = {};
            for (const id of Object.keys(all)) {
                const decision = canPerformComponentOperation(
                    sender,
                    'dashboards',
                    'read',
                    Number(id)
                );
                if (isComponentPermissionAllowed(decision)) {
                    result[id] = all[id];
                }
            }
            return result;
        }

        if (registry === 'configs') {
            return readReadableConfigurationProfiles(sender);
        }

        if (registry === 'actions') {
            if (!sender.hasCrudPermission('actions', 'read')) {
                return {};
            }
            return Registry.getAll(registry);
        }

        if (
            registry === 'action-variables' ||
            registry === 'action-variables-meta'
        ) {
            if (!sender.hasCrudPermission('actions', 'read')) {
                return {};
            }
            return Registry.getAll(registry);
        }

        // Unreachable: #assertRegistryReadable above throws for unknown
        // registries when sender is not provider support; provider support
        // short-circuited at the top.
        return {};
    }

    // Guard the wire payload so a runaway registry can't blow up
    // first-load bandwidth. Callers should switch to Storage.Keys +
    // Storage.GetItem when this fires.
    #enforceGetAllSizeCap(registry: string, payload: unknown): void {
        const cap = tuning.storage.getAllMaxBytes;
        if (cap <= 0) return;
        const size = Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8');
        if (size <= cap) return;
        throw RpcError.InvalidRequest(
            `Storage.GetAll('${registry}') payload ${size}B exceeds FM_STORAGE_GETALL_MAX_BYTES=${cap}B; use Storage.Keys + Storage.GetItem instead.`
        );
    }

    // Auth is enforced inside `getall`'s body (scoped filtering per registry).
    @Component.NoAudit
    @Component.Expose('List')
    @Component.NoPermissions
    async list(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<StorageKeysParams>(
            rawParams ?? {},
            STORAGE_GETALL_PARAMS
        );
        const dict = (await this.getall(params, sender)) as Record<
            string,
            unknown
        >;
        const entries =
            dict && typeof dict === 'object' ? Object.entries(dict) : [];
        const items = entries.map(([key, value]) => ({key, value}));
        return buildListResponse(items, items.length, items.length, 0);
    }

    @Component.Expose('RemoveItem')
    @Component.CheckPermissions(canUseAuthenticatedWrite)
    async removeItem(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<StorageRemoveItemParams>(
            rawParams,
            STORAGE_REMOVE_ITEM_PARAMS
        );
        const registry = (params.registry ?? 'memory').toLowerCase();
        this.#checkRegistryWritePermission(
            sender,
            registry,
            params.key,
            'delete',
            params.value?.id
        );

        if (registry === 'memory') {
            this.setConfig({
                items: {[params.key]: undefined}
            });
        } else {
            await Registry.removeFromRegistry(
                registry,
                params.key,
                params.value,
                sender.getOrganizationId()
            );
        }

        return {removed: params.key};
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'items':
                return typeof value === 'object';
            case 'enable':
                return typeof value === 'boolean';
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override applyConfigKey(key: string, value: any): void {
        switch (key) {
            case 'items':
                if (typeof value === 'object')
                    for (const inner_key in value) {
                        const inner_value = value[inner_key];
                        if (inner_value === undefined) {
                            delete this.config.items[inner_key];
                            continue;
                        }
                        this.config.items[inner_key] = inner_value;
                    }
                break;
            case 'enable':
                this.config.enable = Boolean(value);
                break;
        }
    }

    protected override getDefaultConfig() {
        return {
            enable: true,
            items: {}
        };
    }

    override getConfig() {
        return {
            enable: this.config.enable
        };
    }

    override getStatus(): Record<string, any> {
        return {
            length: JSON.stringify(this.config.items).length
        };
    }
}
