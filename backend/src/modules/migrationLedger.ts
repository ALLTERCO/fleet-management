export const MIGRATION_PATH_MARKER = 'db/migration/postgresql/';

export function normalizeMigrationLedgerName(name: string): string {
    const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
    const markerIndex = normalized.indexOf(MIGRATION_PATH_MARKER);
    if (markerIndex < 0) return normalized;
    return normalized.slice(markerIndex);
}

export function pgIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

export function migrationLedgerTable(database: string, schema: string): string {
    return `${pgIdentifier(database)}.${pgIdentifier(schema)}."migration.list"`;
}
