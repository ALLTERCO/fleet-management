// SoT for migration directory layout. Imported by runtime config and CI.

export const MIGRATION_DIRS: readonly string[] = [
    './db/migration/postgresql/logging',
    './db/migration/postgresql/organization',
    './db/migration/postgresql/user',
    './db/migration/postgresql/ui',
    './db/migration/postgresql/device',
    './db/migration/postgresql/device/groups',
    './db/migration/postgresql/device/em',
    './db/migration/postgresql/notifications',
    './db/migration/postgresql/fm'
];

export const LINKED_SCHEMAS: readonly string[] = [
    'device',
    'user',
    'ui',
    'organization',
    'device_em',
    'logging',
    'notifications',
    'fm'
];
