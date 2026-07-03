/**
 * policy.* — runtime-editable per-type policy defaults. DB overlays env,
 * admin edits survive redeploys. See docs/specs/2026-04-21-policy-defaults-runtime-spec.md
 */
import {groupPolicy} from '../../config/groupPolicy';
import * as AuditLogger from '../../modules/AuditLogger';
import {canUsePlatformAdmin} from '../../modules/authz/evaluator';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {DescribeOutput} from '../../rpc/describe';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {AlertSeverity} from '../../types/api/alert';
import {GROUP_TYPES, type GroupType} from '../../types/api/group';
import {
    type GroupTypePolicy,
    POLICY_DESCRIBE,
    POLICY_FIELD_KEYS,
    POLICY_GETDEFAULTS_PARAMS,
    POLICY_RESETDEFAULT_PARAMS,
    POLICY_UPDATE_DEFAULTS_PARAMS,
    type PolicyDefaults,
    type PolicyField,
    type PolicyFieldKey,
    type PolicySource
} from '../../types/api/policy';
import type CommandSender from '../CommandSender';
import Component from './Component';

type DbFieldKey = 'severity_floor' | 'retention_days' | 'audit_retention_days';

const DB_KEY_BY_API: Record<PolicyFieldKey, DbFieldKey> = {
    severityFloor: 'severity_floor',
    retentionDays: 'retention_days',
    auditRetentionDays: 'audit_retention_days'
};

interface PolicyRow {
    group_type: GroupType;
    field_key: DbFieldKey;
    value: string | null;
    source: PolicySource;
    updated_at: Date | string;
    updated_by: string | null;
}

interface UpsertRow extends PolicyRow {
    stale: boolean;
}

function senderUsername(sender: CommandSender): string | null {
    return sender.getUser()?.username ?? null;
}

/** Parse a stored DB value back to its typed API shape. */
function parseValue(
    key: DbFieldKey,
    raw: string | null
): AlertSeverity | number | null {
    if (raw == null) return null;
    if (key === 'severity_floor') return raw as AlertSeverity;
    return Number.parseInt(raw, 10);
}

/** Env value for a (groupType, fieldKey) cell. */
function envValueFor(
    key: DbFieldKey,
    gt: GroupType
): AlertSeverity | number | null {
    const p = groupPolicy();
    if (key === 'severity_floor') return p.severityFloorByType[gt];
    if (key === 'retention_days') return p.retentionDaysByType[gt];
    return p.auditRetentionDaysByType[gt];
}

function rowToField<T>(row: PolicyRow): PolicyField<T> {
    return {
        current: parseValue(row.field_key, row.value) as T | null,
        envDefault: envValueFor(row.field_key, row.group_type) as T | null,
        source: row.source,
        lastUpdatedAt: toIso(row.updated_at) ?? '',
        lastUpdatedBy: row.updated_by
    };
}

function buildItem(rows: PolicyRow[]): GroupTypePolicy {
    const by: Partial<Record<DbFieldKey, PolicyRow>> = {};
    for (const r of rows) by[r.field_key] = r;
    const item = {groupType: rows[0].group_type} as GroupTypePolicy;
    for (const apiKey of POLICY_FIELD_KEYS) {
        (item as any)[apiKey] = rowToField(
            by[DB_KEY_BY_API[apiKey]] as PolicyRow
        );
    }
    return item;
}

async function readAll(): Promise<GroupTypePolicy[]> {
    const res = await PostgresProvider.callMethod(
        'organization.fn_policy_get_all',
        {}
    );
    const rows = (res?.rows ?? []) as PolicyRow[];
    const byType = new Map<GroupType, PolicyRow[]>();
    for (const r of rows) {
        const list = byType.get(r.group_type) ?? [];
        list.push(r);
        byType.set(r.group_type, list);
    }
    return GROUP_TYPES.map((gt) =>
        buildItem(byType.get(gt) ?? emptyRowsFor(gt))
    );
}

/** DB keys derive from the API→DB map — single source of truth. */
const ALL_DB_KEYS = Object.values(DB_KEY_BY_API);

function emptyRowsFor(gt: GroupType): PolicyRow[] {
    const ts = new Date(0).toISOString();
    return ALL_DB_KEYS.map((k) => ({
        group_type: gt,
        field_key: k,
        value: null,
        source: 'unset',
        updated_at: ts,
        updated_by: null
    }));
}

async function readOne(gt: GroupType): Promise<GroupTypePolicy> {
    const all = await readAll();
    const found = all.find((x) => x.groupType === gt);
    if (!found) throw RpcError.Domain('PolicyGroupTypeUnknown');
    return found;
}

/** Convert the typed API value to the DB VARCHAR shape. null stays null. */
function serializeValue(
    key: PolicyFieldKey,
    value: AlertSeverity | number | null
): string | null {
    if (value == null) return null;
    if (key === 'severityFloor') return String(value);
    return String(value);
}

interface WriteResult {
    row: PolicyRow;
    changed: boolean;
}

async function writeField(
    gt: GroupType,
    apiKey: PolicyFieldKey,
    value: AlertSeverity | number | null,
    source: 'admin' | 'env-reset',
    updatedBy: string | null,
    ifUnchangedSince?: string
): Promise<WriteResult> {
    const dbKey = DB_KEY_BY_API[apiKey];
    const res = await PostgresProvider.callMethod(
        'organization.fn_policy_upsert_field',
        {
            p_group_type: gt,
            p_field_key: dbKey,
            p_value: serializeValue(apiKey, value),
            p_source: source,
            p_updated_by: updatedBy,
            p_if_unchanged_since: ifUnchangedSince ?? null
        }
    );
    const row = (res?.rows ?? [])[0] as UpsertRow | undefined;
    if (!row) throw RpcError.OperationFailed('policy upsert');
    if (row.stale) {
        throw RpcError.Domain('PolicyDefaultsStaleUpdate', {
            details: {groupType: gt, field: apiKey}
        });
    }
    // Rough no-op detector — upsert still returns a row, but updated_at wasn't bumped.
    // Callers already skip audit for no-ops via `same value` check below.
    return {row, changed: true};
}

function logChange(
    method: 'policy.updatedefaults' | 'policy.resetdefault',
    username: string | null,
    gt: GroupType,
    apiKey: PolicyFieldKey,
    oldValue: unknown,
    newValue: unknown,
    source: 'admin' | 'env-reset'
): void {
    void AuditLogger.log({
        eventType: 'policy_default_change',
        username: username ?? '',
        method,
        params: {
            groupType: gt,
            field: apiKey,
            oldValue,
            newValue,
            source
        },
        success: true
    });
}

export default class PolicyComponent extends Component {
    constructor() {
        super('policy', {
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
        return POLICY_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('GetDefaults')
    @Component.CrudPermission('notifications', 'read')
    async getDefaults(params: unknown): Promise<PolicyDefaults> {
        validateOrThrow<Record<string, never>>(
            params,
            POLICY_GETDEFAULTS_PARAMS
        );
        const policy = groupPolicy();
        return {
            items: await readAll(),
            envFallback: {
                retentionFallbackDays: policy.retentionFallbackDays,
                auditRetentionFallbackDays: policy.auditRetentionFallbackDays,
                sweepIntervalMinutes: Math.round(
                    policy.sweepIntervalMs / 60_000
                )
            }
        };
    }

    // UpdateDefaults / ResetDefault write the global per-group-type
    // policy table (no organization_id partition). Tenant admins must
    // not move defaults that affect every tenant — provider support only.
    // The params.organizationId field is accepted for forward compat
    // (per-org overrides) but is currently ignored by the DB layer.
    @Component.Expose('UpdateDefaults')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async updateDefaults(
        params: unknown,
        sender: CommandSender
    ): Promise<GroupTypePolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            groupType: GroupType;
            severityFloor?: AlertSeverity | null;
            retentionDays?: number | null;
            auditRetentionDays?: number | null;
            ifUnchangedSince?: string;
        }>(params, POLICY_UPDATE_DEFAULTS_PARAMS);

        const username = senderUsername(sender);
        const existing = await readOne(p.groupType);
        const pairs: {
            key: PolicyFieldKey;
            value: AlertSeverity | number | null;
        }[] = [];
        // Only touch fields the caller passed — presence check distinguishes
        // `null` (clear) from omitted (no change).
        for (const key of POLICY_FIELD_KEYS) {
            if (!(key in (p as object))) continue;
            pairs.push({
                key,
                value: (p as Record<string, unknown>)[key] as
                    | AlertSeverity
                    | number
                    | null
            });
        }

        for (const {key, value} of pairs) {
            const prior = existing[key];
            // Skip no-op write — same value AND already 'admin' source.
            if (
                prior.current === value &&
                (prior.source === 'admin' || prior.source === 'env-reset')
            ) {
                continue;
            }
            await writeField(
                p.groupType,
                key,
                value,
                'admin',
                username,
                p.ifUnchangedSince
            );
            logChange(
                'policy.updatedefaults',
                username,
                p.groupType,
                key,
                prior.current,
                value,
                'admin'
            );
        }
        return readOne(p.groupType);
    }

    @Component.Expose('ResetDefault')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async resetDefault(
        params: unknown,
        sender: CommandSender
    ): Promise<GroupTypePolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            groupType: GroupType;
            fields: PolicyFieldKey[];
        }>(params, POLICY_RESETDEFAULT_PARAMS);

        const username = senderUsername(sender);
        const existing = await readOne(p.groupType);
        for (const apiKey of p.fields) {
            if (!POLICY_FIELD_KEYS.includes(apiKey)) {
                throw RpcError.Domain('PolicyFieldUnknown', {
                    details: {field: apiKey}
                });
            }
            const envValue = existing[apiKey].envDefault;
            const prior = existing[apiKey].current;
            await writeField(
                p.groupType,
                apiKey,
                envValue,
                'env-reset',
                username
            );
            logChange(
                'policy.resetdefault',
                username,
                p.groupType,
                apiKey,
                prior,
                envValue,
                'env-reset'
            );
        }
        return readOne(p.groupType);
    }
}
