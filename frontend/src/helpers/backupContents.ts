export const BACKUP_CONTENT_KEYS = [
    'ble_bondings',
    'dynamic_components',
    'persistent_counters',
    'schedules',
    'scripts',
    'webhooks',
    'matter_storage'
] as const;

export type BackupContentKey = (typeof BACKUP_CONTENT_KEYS)[number];

export type BackupContents = Record<BackupContentKey, boolean>;

export const BACKUP_CONTENT_LABELS: Record<BackupContentKey, string> = {
    ble_bondings: 'BLE pairings',
    dynamic_components: 'Virtual & BTHome components',
    persistent_counters: 'Persistent counters',
    schedules: 'Schedules',
    scripts: 'Scripts',
    webhooks: 'Actions',
    matter_storage: 'Matter configuration'
};

export function createEmptyBackupContents(): BackupContents {
    return {
        ble_bondings: false,
        dynamic_components: false,
        persistent_counters: false,
        schedules: false,
        scripts: false,
        webhooks: false,
        matter_storage: false
    };
}

export function normalizeBackupContents(
    contents?: Partial<Record<BackupContentKey, boolean>>
): BackupContents {
    return Object.fromEntries(
        BACKUP_CONTENT_KEYS.map((key) => [key, Boolean(contents?.[key])])
    ) as BackupContents;
}

export function summarizeBackupContents(
    contents?: Partial<Record<BackupContentKey, boolean>>
): string {
    const enabled = BACKUP_CONTENT_KEYS.filter((key) => contents?.[key]);
    return enabled.length > 0 ? enabled.join(', ') : 'base config only';
}

export function filterEnabledBackupContents(
    contents?: Partial<Record<BackupContentKey, boolean>>
): Partial<BackupContents> | undefined {
    if (!contents) return undefined;
    const enabledEntries = BACKUP_CONTENT_KEYS.filter(
        (key) => contents[key]
    ).map((key) => [key, true] as const);
    if (enabledEntries.length === 0) {
        return undefined;
    }
    return Object.fromEntries(enabledEntries) as Partial<BackupContents>;
}

export function getEnabledBackupContentLabels(
    contents?: Partial<Record<BackupContentKey, boolean>>
): string[] {
    return BACKUP_CONTENT_KEYS.filter((key) => contents?.[key]).map(
        (key) => BACKUP_CONTENT_LABELS[key]
    );
}
