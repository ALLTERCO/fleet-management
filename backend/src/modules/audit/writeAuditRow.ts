// Audit-row inserts. The logging.fn_audit_log_add(_batch) param mapping lives
// here so AuditLogger and AuditDrainer persist rows identically.

import type {AuditBatchRow} from '../auditBatchRow';
import * as PostgresProvider from '../PostgresProvider';

export async function writeAuditRow(row: AuditBatchRow): Promise<void> {
    await PostgresProvider.callMethod('logging.fn_audit_log_add', {
        p_event_type: row.event_type,
        p_username: row.username,
        p_actor_user_id: row.actor_user_id,
        p_shelly_id: row.shelly_id,
        p_method: row.method,
        p_params: row.params ? JSON.stringify(row.params) : null,
        p_success: row.success,
        p_error_message: row.error_message,
        p_ip_address: row.ip_address,
        p_shelly_ids: row.shelly_ids,
        p_device_id: row.device_id,
        p_device_ids: row.device_ids,
        p_ts: row.ts,
        p_organization_id: row.organization_id
    });
}

export async function writeAuditRowBatch(rows: AuditBatchRow[]): Promise<void> {
    // JSONB params must be pre-stringified (callMethod convention).
    await PostgresProvider.callMethod('logging.fn_audit_log_add_batch', {
        p_entries: JSON.stringify(rows)
    });
}
