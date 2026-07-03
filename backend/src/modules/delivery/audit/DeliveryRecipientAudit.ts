// Phase 6f: GDPR-compliant delivery audit log keyed by recipient.
//
// Thin wrapper around the SQL functions in migration 6534. Every
// outbound delivery (queued / sent / delivered / failed / suppressed /
// opted_out) records one row keyed by the recipient hash, with the
// plain-text recipient kept only for `rawTtlMinutes` before a sweep
// nulls it out. Right-to-be-forgotten requests resolve to a single
// `forget(recipient)` call.

import {type BinaryLike, createHash} from 'node:crypto';
import {jsonbParam} from '../../postgresJsonb';

export type DeliveryAuditOutcome =
    | 'queued'
    | 'sent'
    | 'delivered'
    | 'failed'
    | 'suppressed'
    | 'opted_out';

export type DeliveryAuditChannelKind =
    | 'email'
    | 'sms'
    | 'voice'
    | 'push'
    | 'webhook'
    | 'slack'
    | 'telegram'
    | 'teams'
    | 'pagerduty';

export type DeliveryAuditSeverity = 'critical' | 'warning' | 'info';

export interface DeliveryAuditRecord {
    organizationId: string;
    channelKind: DeliveryAuditChannelKind;
    recipient: string;
    outcome: DeliveryAuditOutcome;
    alertId?: number | null;
    ruleId?: number | null;
    channelId?: number | null;
    provider?: string | null;
    providerMessageId?: string | null;
    errorCode?: string | null;
    severity?: DeliveryAuditSeverity | null;
    metadata?: Record<string, unknown>;
    rawTtlMinutes?: number;
}

export interface PgClientLike {
    query<R = unknown>(
        text: string,
        values?: ReadonlyArray<unknown>
    ): Promise<{rows: R[]}>;
}

const DEFAULT_RAW_TTL_MIN = 1440;

export function hashRecipient(recipient: BinaryLike | string): string {
    const normalised =
        typeof recipient === 'string'
            ? recipient.trim().toLowerCase()
            : recipient;
    return createHash('sha256').update(normalised).digest('hex');
}

export class DeliveryRecipientAudit {
    constructor(private readonly db: PgClientLike) {}

    async record(input: DeliveryAuditRecord): Promise<number> {
        const ttl = input.rawTtlMinutes ?? DEFAULT_RAW_TTL_MIN;
        const result = await this.db.query<{id: string | number}>(
            `SELECT notifications.fn_delivery_audit_record(
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $10,
                $11, $12::jsonb, $13
            ) AS id`,
            [
                input.organizationId,
                input.channelKind,
                input.recipient,
                input.outcome,
                input.alertId ?? null,
                input.ruleId ?? null,
                input.channelId ?? null,
                input.provider ?? null,
                input.providerMessageId ?? null,
                input.errorCode ?? null,
                input.severity ?? null,
                jsonbParam(input.metadata ?? {}),
                ttl
            ]
        );
        return Number(result.rows[0]?.id ?? 0);
    }

    async forget(recipient: string): Promise<number> {
        const result = await this.db.query<{count: string | number}>(
            `SELECT notifications.fn_delivery_audit_forget($1) AS count`,
            [recipient]
        );
        return Number(result.rows[0]?.count ?? 0);
    }

    async redactExpired(): Promise<number> {
        const result = await this.db.query<{count: string | number}>(
            `SELECT notifications.fn_delivery_audit_redact_expired() AS count`
        );
        return Number(result.rows[0]?.count ?? 0);
    }
}
