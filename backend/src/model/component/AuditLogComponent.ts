import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import path from 'node:path';
import * as AuditLogger from '../../modules/AuditLogger';
import type CommandSender from '../CommandSender';
import Component from './Component';

const AUDIT_EXPORTS_PATH = path.join(__dirname, '../../../uploads/audit-logs');

// Ensure directory exists
if (!fs.existsSync(AUDIT_EXPORTS_PATH)) {
    fs.mkdirSync(AUDIT_EXPORTS_PATH, {recursive: true});
}

// Track generated files for cleanup
const generatedFiles = new Map<string, number>(); // filename -> timestamp

// Cleanup job: delete files older than 1 hour
setInterval(
    async () => {
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;

        for (const [filename, timestamp] of generatedFiles.entries()) {
            if (now - timestamp > ONE_HOUR) {
                try {
                    await fsAsync.unlink(
                        path.join(AUDIT_EXPORTS_PATH, filename)
                    );
                    generatedFiles.delete(filename);
                } catch {
                    // File may already be deleted
                    generatedFiles.delete(filename);
                }
            }
        }
    },
    5 * 60 * 1000
); // Check every 5 minutes

interface AuditLogConfig {
    enabled: boolean;
}

export default class AuditLogComponent extends Component<AuditLogConfig> {
    constructor() {
        super('auditlog');
    }

    @Component.Expose('Query')
    @Component.WriteOperation
    async query(
        params: {
            from?: string;
            to?: string;
            eventTypes?: string[];
            username?: string;
            shellyId?: string;
            limit?: number;
            offset?: number;
        },
        sender: CommandSender
    ) {
        return await AuditLogger.query({
            from: params.from ? new Date(params.from) : undefined,
            to: params.to ? new Date(params.to) : undefined,
            eventTypes: params.eventTypes as AuditLogger.AuditEventType[],
            username: params.username,
            shellyId: params.shellyId,
            limit: params.limit,
            offset: params.offset
        });
    }

    @Component.Expose('Export')
    @Component.WriteOperation
    async export(
        params: {
            from: string;
            to: string;
            eventTypes?: string[];
        },
        sender: CommandSender
    ) {
        const rows = await AuditLogger.query({
            from: new Date(params.from),
            to: new Date(params.to),
            eventTypes: params.eventTypes as AuditLogger.AuditEventType[],
            limit: 100000
        });

        const timestamp = Date.now();
        const filename = `audit-log-${timestamp}.csv`;
        const filePath = path.join(AUDIT_EXPORTS_PATH, filename);

        // Build CSV content
        const headers = [
            'timestamp',
            'event_type',
            'username',
            'device_id',
            'method',
            'success',
            'error',
            'ip_address',
            'params'
        ];

        const csvLines = [headers.join(',')];

        for (const row of rows) {
            const line = [
                this.escapeCsvField(row.ts?.toISOString() || ''),
                this.escapeCsvField(row.event_type || ''),
                this.escapeCsvField(row.username || ''),
                this.escapeCsvField(row.shelly_id || ''),
                this.escapeCsvField(row.method || ''),
                row.success ? 'true' : 'false',
                this.escapeCsvField(row.error_message || ''),
                this.escapeCsvField(row.ip_address || ''),
                this.escapeCsvField(JSON.stringify(row.params || {}))
            ];
            csvLines.push(line.join(','));
        }

        await fsAsync.writeFile(filePath, csvLines.join('\n'), 'utf-8');

        // Track for cleanup
        generatedFiles.set(filename, timestamp);

        return {
            filename,
            downloadUrl: `/api/audit-log/download/${filename}`,
            rows: rows.length,
            generated: new Date().toISOString()
        };
    }

    private escapeCsvField(field: string): string {
        if (
            field.includes(',') ||
            field.includes('"') ||
            field.includes('\n')
        ) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    protected override getDefaultConfig(): AuditLogConfig {
        return {
            enabled: true
        };
    }
}

export {AUDIT_EXPORTS_PATH};
