import * as AlertEvents from '../../modules/AlertEvents';
import {resolveEmailTemplateConfig} from '../../modules/delivery/emailTemplateResolver';
import {invalidateOutboxSecretsCache} from '../../modules/delivery/OutboxWorker';
import {performProviderTest} from '../../modules/delivery/ProviderTestRunner';
import {redactSecretHeadersForResponse} from '../../modules/integrationConfig';
import {
    listChannelProviderDescriptors,
    mergeChannelConfig,
    mergeChannelConfigPatch,
    validateChannelConfig
} from '../../modules/notification/ChannelRegistry';
import * as NotificationAuditWriter from '../../modules/notification/NotificationAuditWriter';
import * as postgres from '../../modules/PostgresProvider';
import {withPostgresTransaction} from '../../modules/postgresTx';
import {decryptJsonSecret, encryptJsonSecret} from '../../modules/secretCrypto';
import {redactSecretsFromErrorMessage} from '../../modules/util/sanitizeErrorMessage';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CHANNEL_CREATE_PARAMS_SCHEMA,
    CHANNEL_DELETE_PARAMS_SCHEMA,
    CHANNEL_DESCRIBE,
    CHANNEL_GET_PARAMS_SCHEMA,
    CHANNEL_LIST_PARAMS_SCHEMA,
    CHANNEL_LIST_PROVIDERS_PARAMS_SCHEMA,
    CHANNEL_RESET_HEALTH_PARAMS_SCHEMA,
    CHANNEL_TEST_PARAMS_SCHEMA,
    CHANNEL_UPDATE_PARAMS_SCHEMA,
    type Channel,
    type ChannelProvider,
    type ChannelTestResult
} from '../../types/api/channel';
import type CommandSender from '../CommandSender';
import Component from './Component';

type JsonRecord = Record<string, unknown>;
type EndpointOperation = 'create' | 'update' | 'delete';

interface EndpointRow {
    id: number;
    organization_id: string;
    provider: ChannelProvider;
    name: string;
    enabled: boolean;
    config: JsonRecord | null;
    has_secret_fields: boolean;
    last_test_at: Date | string | null;
    last_test_status: 'success' | 'failed' | null;
    last_delivery_at: Date | string | null;
    last_delivery_status: 'success' | 'failed' | null;
    consecutive_failures: number;
    last_success_at: Date | string | null;
    last_failure_at: Date | string | null;
    auto_disabled_at: Date | string | null;
    disable_reason: string | null;
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    quiet_hours_tz: string;
    created_at: Date | string;
    updated_at: Date | string | null;
}

type EndpointListRow = Partial<EndpointRow> & {
    total_count?: number | string;
};

interface EndpointSecretRow {
    endpoint_id: number;
    encrypted_payload: string;
    updated_at: Date | string | null;
}

interface SecretReadResult {
    config: JsonRecord;
    // ISO timestamp from channel_secrets.updated_at. Null when
    // no row existed at read time — caller passes null to take the insert
    // path on the CAS write.
    updatedAt: string | null;
}

interface SecretWriteArgs {
    endpointId: number;
    secretConfig: JsonRecord;
    // Read timestamp captured by #getEndpointSecretConfig. Null = "no row at
    // read time" → insert-if-absent. Non-null = "row at X" → update-if-X.
    expectedUpdatedAt: string | null;
    txId?: number;
}

// Keep AAD stable across the table rename so existing encrypted secrets decrypt.
function endpointSecretAad(endpointId: number): string {
    return `integration_endpoint_secrets:endpoint:${endpointId}`;
}

function isPlainObject(value: unknown): value is JsonRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneRecord(value: unknown): JsonRecord {
    if (!isPlainObject(value)) return {};
    return structuredClone(value);
}

function normalizeName(name: string, label: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw RpcError.InvalidParams(`${label} cannot be empty`);
    return trimmed;
}

function rowToEndpoint(row: EndpointRow): Channel {
    return {
        id: row.id,
        organizationId: row.organization_id,
        provider: row.provider,
        name: row.name,
        enabled: row.enabled,
        config: redactSecretHeadersForResponse(row.provider, row.config),
        secretState: {
            hasSecretFields: !!row.has_secret_fields
        },
        lastTestAt: toIso(row.last_test_at),
        lastTestStatus: row.last_test_status ?? null,
        lastDeliveryAt: toIso(row.last_delivery_at),
        lastDeliveryStatus: row.last_delivery_status ?? null,
        health: {
            consecutiveFailures: row.consecutive_failures ?? 0,
            lastSuccessAt: toIso(row.last_success_at),
            lastFailureAt: toIso(row.last_failure_at),
            autoDisabledAt: toIso(row.auto_disabled_at),
            disableReason: row.disable_reason ?? null
        },
        quietHours:
            row.quiet_hours_start != null && row.quiet_hours_end != null
                ? {
                      startHour: row.quiet_hours_start,
                      endHour: row.quiet_hours_end,
                      timezone: row.quiet_hours_tz ?? 'UTC'
                  }
                : null,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}

function extractErrorMessage(err: unknown): string {
    const raw =
        typeof err === 'string'
            ? err
            : err instanceof Error
              ? err.message
              : err && typeof err === 'object' && 'message' in err
                ? String((err as {message: unknown}).message)
                : String(err);
    return redactSecretsFromErrorMessage(raw);
}

function translateIntegrationError(
    err: unknown,
    operation: EndpointOperation
): RpcError {
    if (err instanceof RpcError) return err;

    const pg = err as {code?: string};
    if (pg?.code === '23505') {
        return RpcError.Domain('ResourceConflict', {
            message: 'channel name already exists',
            details: {resourceType: 'channel'}
        });
    }

    if (pg?.code === '23503' && operation === 'delete') {
        return RpcError.Domain('ResourceConflict', {
            message: 'channel is still referenced by destination groups',
            details: {resourceType: 'channel'}
        });
    }

    return RpcError.OperationFailed(`Channel.${operation}`, err);
}

function auditActor(sender: CommandSender): string | null {
    return sender.getUser()?.username ?? null;
}

/**
 * Run a synthetic test delivery through the same adapter the outbox
 * uses at runtime. Keeps provider behavior in exactly one place —
 * whatever the user sees on `Channel.Test` matches what
 * real alerts will do.
 */
export async function __performProviderTestForTests(
    provider: ChannelProvider,
    organizationId: string,
    endpointId: number,
    fullConfig: JsonRecord,
    payload?: {title?: string; message?: string}
): Promise<void> {
    return performProviderTest({
        provider,
        organizationId,
        endpointId,
        config: fullConfig,
        payload
    });
}

export default class ChannelComponent extends Component {
    constructor() {
        super('channel', {
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
        return CHANNEL_DESCRIBE;
    }

    async #getEndpointRow(
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<EndpointRow | undefined> {
        const result = await postgres.callMethod(
            'notifications.fn_channel_get',
            {
                p_organization_id: organizationId,
                p_id: id
            },
            txId
        );

        return result?.rows?.[0] as EndpointRow | undefined;
    }

    async #requireEndpointRow(
        organizationId: string,
        id: number,
        txId?: number
    ): Promise<EndpointRow> {
        const row = await this.#getEndpointRow(organizationId, id, txId);
        if (!row) throw RpcError.NotFound('channel', id);
        return row;
    }

    async #readEndpointSecret(
        endpointId: number,
        txId?: number
    ): Promise<SecretReadResult> {
        const result = await postgres.callMethod(
            'notifications.fn_channel_secret_get',
            {p_endpoint_id: endpointId},
            txId
        );
        const row = result?.rows?.[0] as EndpointSecretRow | undefined;
        if (!row?.encrypted_payload) {
            return {config: {}, updatedAt: null};
        }
        return {
            config: decryptJsonSecret<JsonRecord>(row.encrypted_payload, {
                additionalData: endpointSecretAad(endpointId)
            }),
            updatedAt: toIso(row.updated_at)
        };
    }

    // Back-compat shim — callers that don't need updatedAt still read just
    // the config. Update path reads via #readEndpointSecret + threads the
    // timestamp into the CAS write.
    async #getEndpointSecretConfig(
        endpointId: number,
        txId?: number
    ): Promise<JsonRecord> {
        const {config} = await this.#readEndpointSecret(endpointId, txId);
        return config;
    }

    async #writeEndpointSecret(args: SecretWriteArgs): Promise<void> {
        const {endpointId, secretConfig, expectedUpdatedAt, txId} = args;
        const hasSecrets = Object.keys(secretConfig).length > 0;

        const result = await postgres.callMethod(
            'notifications.fn_channel_secret_set',
            {
                p_endpoint_id: endpointId,
                p_encrypted_payload: hasSecrets
                    ? encryptJsonSecret(secretConfig, {
                          additionalData: endpointSecretAad(endpointId)
                      })
                    : null,
                p_expected_updated_at: expectedUpdatedAt
            },
            txId
        );
        // CAS guard: SQL fn returns FALSE when the row was rotated
        // concurrently (V-1 — Compare-And-Swap on optimistic concurrency).
        // Treat as conflict, NOT silent overwrite.
        const ok = result?.rows?.[0]?.fn_channel_secret_set;
        if (ok === false) {
            throw RpcError.Domain('ResourceConflict', {
                message:
                    'channel secret was rotated by another writer; re-read and retry',
                details: {
                    resourceType: 'channel_secret',
                    endpointId
                }
            });
        }
    }

    // Insert-if-absent path used by createEndpoint — no existing row to CAS
    // against, so expectedUpdatedAt is always null.
    async #setEndpointSecretConfig(
        endpointId: number,
        secretConfig: JsonRecord,
        txId?: number
    ): Promise<void> {
        await this.#writeEndpointSecret({
            endpointId,
            secretConfig,
            expectedUpdatedAt: null,
            txId
        });
    }

    @Component.NoAudit
    @Component.Expose('ListProviders')
    @Component.CrudPermission('notifications', 'read')
    listProviders(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params,
            CHANNEL_LIST_PROVIDERS_PARAMS_SCHEMA
        );
        return listChannelProviderDescriptors();
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('notifications', 'read')
    async listEndpoints(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            provider?: ChannelProvider;
            enabled?: boolean;
            query?: string;
            limit?: number;
            offset?: number;
        }>(params, CHANNEL_LIST_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        try {
            const result = await postgres.callMethod(
                'notifications.fn_channel_list',
                {
                    p_organization_id: organizationId,
                    p_provider: p.provider ?? null,
                    p_enabled: p.enabled ?? null,
                    p_query: p.query?.trim() || null,
                    p_limit: limit,
                    p_offset: offset
                }
            );
            const rows = (result?.rows ?? []) as EndpointListRow[];
            const total =
                rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
            const items: Channel[] = [];

            for (const row of rows) {
                if (row.id == null) continue;
                items.push(rowToEndpoint(row as EndpointRow));
            }

            return buildListResponse(items, total, limit, offset);
        } catch (err: unknown) {
            throw RpcError.OperationFailed('Channel.List', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('notifications', 'read', (p) => p?.id)
    async getEndpoint(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            CHANNEL_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);

        try {
            return rowToEndpoint(
                await this.#requireEndpointRow(organizationId, p.id)
            );
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            throw RpcError.OperationFailed('Channel.Get', err);
        }
    }

    @Component.Expose('Create')
    @Component.CrudPermission('notifications', 'create')
    async createEndpoint(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            provider: ChannelProvider;
            name: string;
            enabled?: boolean;
            config: JsonRecord;
            quietHours?: {
                startHour: number;
                endHour: number;
                timezone: string;
            } | null;
        }>(params, CHANNEL_CREATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);

        try {
            const validated = validateChannelConfig(p.provider, p.config);

            const created = await withPostgresTransaction(async (txId, ctx) => {
                const result = await postgres.callMethod(
                    'notifications.fn_channel_create',
                    {
                        p_organization_id: organizationId,
                        p_provider: p.provider,
                        p_name: normalizeName(p.name, 'Channel name'),
                        p_enabled: p.enabled ?? true,
                        p_config: validated.publicConfig,
                        p_quiet_hours_start: p.quietHours?.startHour ?? null,
                        p_quiet_hours_end: p.quietHours?.endHour ?? null,
                        p_quiet_hours_tz: p.quietHours?.timezone ?? 'UTC'
                    },
                    txId
                );
                const row = result?.rows?.[0] as EndpointRow | undefined;
                if (!row) {
                    throw RpcError.OperationFailed('Channel.Create');
                }

                await this.#setEndpointSecretConfig(
                    row.id,
                    validated.secretConfig,
                    txId
                );

                const result2 = {
                    id: row.id,
                    full: await this.#requireEndpointRow(
                        organizationId,
                        row.id,
                        txId
                    )
                };
                ctx.onCommit(() => invalidateOutboxSecretsCache(row.id));
                return result2;
            });
            await NotificationAuditWriter.writeEndpointConfigChange({
                organizationId,
                actorId: auditActor(sender),
                action: 'create',
                endpointId: created.id,
                provider: created.full.provider
            });
            AlertEvents.emitChannelCreated({
                organizationId,
                id: created.id,
                name: created.full.name
            });
            return rowToEndpoint(created.full);
        } catch (err: unknown) {
            throw translateIntegrationError(err, 'create');
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission('notifications', 'update', (p) => p?.id)
    async updateEndpoint(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                enabled?: boolean;
                config?: JsonRecord;
                quietHours?: {
                    startHour: number;
                    endHour: number;
                    timezone: string;
                } | null;
            };
        }>(params, CHANNEL_UPDATE_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const patch = p.patch ?? {};

        try {
            const current = await this.#requireEndpointRow(
                organizationId,
                p.id
            );

            if (Object.keys(patch).length === 0) {
                return rowToEndpoint(current);
            }

            let publicConfig = cloneRecord(current.config);
            // CAS: capture the read timestamp so the write rejects if the
            // row was rotated between read and write (V-1).
            const secretRead = await this.#readEndpointSecret(current.id);
            let secretConfig = secretRead.config;
            const expectedUpdatedAt = secretRead.updatedAt;
            let shouldWriteSecret = false;

            if (patch.config !== undefined) {
                const merged = mergeChannelConfigPatch(
                    current.provider,
                    current.config,
                    secretConfig,
                    patch.config
                );
                publicConfig = merged.publicConfig;
                secretConfig = merged.secretConfig;
                shouldWriteSecret = true;
            }

            const updated = await withPostgresTransaction(async (txId, ctx) => {
                const result = await postgres.callMethod(
                    'notifications.fn_channel_update',
                    {
                        p_organization_id: organizationId,
                        p_id: p.id,
                        p_name:
                            patch.name !== undefined
                                ? normalizeName(patch.name, 'Channel name')
                                : null,
                        p_enabled: patch.enabled ?? null,
                        p_config:
                            patch.config !== undefined ? publicConfig : null,
                        p_quiet_hours_start:
                            patch.quietHours?.startHour ?? null,
                        p_quiet_hours_end: patch.quietHours?.endHour ?? null,
                        p_quiet_hours_tz: patch.quietHours?.timezone ?? null,
                        p_clear_quiet_hours: patch.quietHours === null
                    },
                    txId
                );
                const row = result?.rows?.[0] as EndpointRow | undefined;
                if (!row) {
                    throw RpcError.NotFound('channel', p.id);
                }

                if (shouldWriteSecret) {
                    await this.#writeEndpointSecret({
                        endpointId: row.id,
                        secretConfig,
                        expectedUpdatedAt,
                        txId
                    });
                }

                const result2 = {
                    id: row.id,
                    secretChanged: shouldWriteSecret,
                    full: await this.#requireEndpointRow(
                        organizationId,
                        row.id,
                        txId
                    )
                };
                if (shouldWriteSecret) {
                    ctx.onCommit(() => invalidateOutboxSecretsCache(row.id));
                }
                return result2;
            });
            await NotificationAuditWriter.writeEndpointConfigChange({
                organizationId,
                actorId: auditActor(sender),
                action: 'update',
                endpointId: updated.id,
                provider: updated.full.provider
            });
            AlertEvents.emitChannelUpdated({
                organizationId,
                id: updated.id,
                name: updated.full.name
            });
            return rowToEndpoint(updated.full);
        } catch (err: unknown) {
            throw translateIntegrationError(err, 'update');
        }
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('notifications', 'delete', (p) => p?.id)
    async deleteEndpoint(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean; id: number}> {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            CHANNEL_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);

        try {
            const current = await this.#requireEndpointRow(
                organizationId,
                p.id
            );
            const result = await postgres.callMethod(
                'notifications.fn_channel_delete',
                {
                    p_organization_id: organizationId,
                    p_id: p.id
                }
            );
            const row = result?.rows?.[0] as {id?: number} | undefined;
            // Drop any cached secrets for this endpoint — otherwise an
            // OutboxWorker tick before TTL would still see the rotated /
            // deleted secret payload in memory.
            invalidateOutboxSecretsCache(p.id);
            if (row?.id != null) {
                await NotificationAuditWriter.writeEndpointConfigChange({
                    organizationId,
                    actorId: auditActor(sender),
                    action: 'delete',
                    endpointId: p.id,
                    provider: current.provider
                });
                AlertEvents.emitChannelDeleted({organizationId, id: p.id});
            }
            return {deleted: row?.id != null, id: p.id};
        } catch (err: unknown) {
            throw translateIntegrationError(err, 'delete');
        }
    }

    @Component.Expose('Test')
    @Component.CrudPermission('notifications', 'update', (p) => p?.id)
    async testEndpoint(
        params: unknown,
        sender: CommandSender
    ): Promise<ChannelTestResult> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            dryRun?: boolean;
            payload?: {title?: string; message?: string};
        }>(params, CHANNEL_TEST_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);
        const endpoint = await this.#requireEndpointRow(organizationId, p.id);

        let state: 'success' | 'failed' = 'success';
        let errorMessage: string | null = null;

        try {
            const secretConfig = await this.#getEndpointSecretConfig(
                endpoint.id
            );
            const fullConfig = mergeChannelConfig(
                endpoint.provider,
                endpoint.config,
                secretConfig
            );
            validateChannelConfig(endpoint.provider, fullConfig);

            if (!p.dryRun) {
                // Resolve + merge through the same path the outbox uses
                // so Channel.Test behaves exactly like a real send.
                let publicConfig = endpoint.config as JsonRecord;
                if (endpoint.provider === 'email_smtp') {
                    publicConfig = (await resolveEmailTemplateConfig(
                        publicConfig,
                        organizationId
                    )) as JsonRecord;
                }
                const merged = mergeChannelConfig(
                    endpoint.provider,
                    publicConfig,
                    secretConfig
                );
                await performProviderTest({
                    provider: endpoint.provider,
                    organizationId,
                    endpointId: endpoint.id,
                    endpointName: endpoint.name,
                    config: merged,
                    payload: p.payload
                });
            }
        } catch (err: unknown) {
            state = 'failed';
            errorMessage = extractErrorMessage(err);
        }

        try {
            await postgres.callMethod(
                'notifications.fn_channel_set_test_result',
                {
                    p_organization_id: organizationId,
                    p_id: endpoint.id,
                    p_status: state
                }
            );
            const refreshed = await this.#requireEndpointRow(
                organizationId,
                endpoint.id
            );
            await NotificationAuditWriter.writeChannelTestSend({
                organizationId,
                actorId: auditActor(sender),
                channelId: endpoint.id,
                provider: endpoint.provider,
                dryRun: p.dryRun ?? false,
                state,
                success: state === 'success',
                errorMessage
            });

            return {
                channelId: endpoint.id,
                state,
                testedAt:
                    toIso(refreshed.last_test_at) ?? new Date().toISOString(),
                errorMessage
            };
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            throw RpcError.OperationFailed('Channel.Test', err);
        }
    }

    @Component.Expose('ResetHealth')
    @Component.CrudPermission('notifications', 'update', (p) => p?.id)
    async resetEndpointHealth(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            reEnable?: boolean;
        }>(params, CHANNEL_RESET_HEALTH_PARAMS_SCHEMA);
        const organizationId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod(
                'notifications.fn_channel_reset_health',
                {
                    p_id: p.id,
                    p_organization_id: organizationId,
                    p_re_enable: p.reEnable ?? true
                }
            );
            const ok = result?.rows?.[0]?.fn_channel_reset_health === true;
            if (!ok) {
                throw RpcError.NotFound('channel', p.id);
            }
            AlertEvents.emitEndpointHealthReset({
                organizationId,
                endpointId: p.id
            });
            await NotificationAuditWriter.writeEndpointReenable({
                organizationId,
                actorId: auditActor(sender),
                endpointId: p.id,
                reEnable: p.reEnable ?? true
            });
            return rowToEndpoint(
                await this.#requireEndpointRow(organizationId, p.id)
            );
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            throw RpcError.OperationFailed('Channel.ResetHealth', err);
        }
    }
}
