import {
    authzAuditActor,
    authzAuditWriter
} from '../../modules/authz/audit/AuthzAuditWriter';
import * as EventDistributor from '../../modules/EventDistributor';
import * as Registry from '../../modules/Registry';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {ACTION_VARIABLES_REGISTRY} from '../../types/api/registryNames';
import {
    VARIABLES_DELETE_PARAMS,
    VARIABLES_DESCRIBE,
    VARIABLES_GET_PARAMS,
    VARIABLES_LIST_PARAMS,
    VARIABLES_SET_PARAMS
} from '../../types/api/variables';
import type CommandSender from '../CommandSender';
import Component from './Component';

// OWASP A09:2025 — variable mutations must surface in the audit trail.
// Variables can carry tokens / passwords; previews are truncated and only
// logged at debug-friendly length to avoid leaking secrets in audit rows.
const VALUE_PREVIEW_MAX = 64;

function variableValuePreview(value: string): string {
    return value.length > VALUE_PREVIEW_MAX
        ? `${value.slice(0, VALUE_PREVIEW_MAX)}…`
        : value;
}

interface VariableEntry {
    key: string;
    value: string;
}

export default class VariablesComponent extends Component {
    constructor() {
        super('variables', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return VARIABLES_DESCRIBE;
    }

    // Variables can hold secrets/operational data — actions:read.
    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('actions', 'read')
    async list(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            VARIABLES_LIST_PARAMS
        );
        const raw = (await Registry.getAll(ACTION_VARIABLES_REGISTRY)) as
            | Record<string, string>
            | undefined;
        const items: VariableEntry[] = raw
            ? Object.entries(raw).map(([key, value]) => ({
                  key,
                  value: String(value)
              }))
            : [];
        return buildListResponse(items, items.length, items.length, 0);
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('actions', 'read')
    async get(params: unknown) {
        const v = validateOrThrow<{key: string}>(params, VARIABLES_GET_PARAMS);
        const value = await Registry.getFromRegistry(
            ACTION_VARIABLES_REGISTRY,
            v.key
        );
        return {key: v.key, value: value ?? null};
    }

    @Component.Expose('Set')
    @Component.CrudPermission('actions', 'update')
    async set(params: unknown, sender: CommandSender): Promise<VariableEntry> {
        const v = validateOrThrow<{key: string; value: string}>(
            params,
            VARIABLES_SET_PARAMS
        );
        await Registry.addToRegistry(ACTION_VARIABLES_REGISTRY, v.key, v.value);
        await authzAuditWriter.writeVariableEvent({
            tenantId: null,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'set',
            key: v.key,
            valuePreview: variableValuePreview(v.value)
        });
        EventDistributor.emitVariablesChanged(v.key, 'set');
        return {key: v.key, value: v.value};
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('actions', 'delete')
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean}> {
        const v = validateOrThrow<{key: string}>(
            params,
            VARIABLES_DELETE_PARAMS
        );
        await Registry.removeFromRegistry(ACTION_VARIABLES_REGISTRY, v.key);
        await authzAuditWriter.writeVariableEvent({
            tenantId: null,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'delete',
            key: v.key
        });
        EventDistributor.emitVariablesChanged(v.key, 'delete');
        return {deleted: true};
    }
}
