import * as PostgresProvider from '../PostgresProvider';

export interface StoredPresenceRow {
    id: number;
    external_id: string;
    /** device.list.kind: physical | virtual | bluetooth | ... */
    kind: string;
    last_seen: Date | string | null;
    name?: string | null;
}

interface StoredPresenceDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
}

// Id order keeps each device at the same point of every paced sweep tick.
export async function storedDevicePresence(
    organizationId: string,
    deps: StoredPresenceDeps = PostgresProvider,
    externalIds?: readonly string[]
): Promise<StoredPresenceRow[]> {
    return deps.queryRows<StoredPresenceRow>(
        `SELECT
                dl.id,
                dl.external_id,
                dl.kind,
                CASE
                    WHEN vd.device_list_id IS NULL THEN dl.last_seen
                    WHEN source_presence.missing_required_source THEN NULL
                    WHEN source_presence.has_required_source
                    THEN source_presence.required_last_seen
                    ELSE source_presence.any_last_seen
                END AS last_seen,
                COALESCE(
                    vd.name,
                    dl.jdoc->'info'->>'name',
                    dl.jdoc->>'name'
                ) AS name
           FROM device.list dl
      LEFT JOIN device.virtual_device vd
             ON vd.device_list_id = dl.id
            AND vd.organization_id = dl.organization_id
            AND vd.deleted_at IS NULL
      LEFT JOIN LATERAL (
                SELECT
                    COALESCE(
                        BOOL_OR(
                            binding.required IS DISTINCT FROM FALSE AND
                            src.id IS NULL
                        ),
                        FALSE
                    ) AS missing_required_source,
                    COALESCE(
                        BOOL_OR(binding.required IS DISTINCT FROM FALSE),
                        FALSE
                    ) AS has_required_source,
                    MIN(src.last_seen) FILTER (
                        WHERE binding.required IS DISTINCT FROM FALSE
                    ) AS required_last_seen,
                    MAX(src.last_seen) AS any_last_seen
                  FROM device.virtual_device_binding binding
             LEFT JOIN device.list src
                    ON src.id = binding.source_device_list_id
                   AND src.organization_id = binding.organization_id
                   AND src.deleted_at IS NULL
                 WHERE binding.organization_id = dl.organization_id
                   AND binding.virtual_device_list_id = dl.id
                   AND binding.effective_from <= NOW()
                   AND (
                        binding.effective_to IS NULL OR
                        binding.effective_to > NOW()
                   )
           ) source_presence ON vd.device_list_id IS NOT NULL
          WHERE dl.organization_id = $1
            AND dl.external_id IS NOT NULL
            AND dl.deleted_at IS NULL
            AND ($2::varchar[] IS NULL OR dl.external_id = ANY($2::varchar[]))
       ORDER BY dl.id`,
        [organizationId, externalIds ?? null]
    );
}

export function timestampMs(
    value: Date | string | number | null | undefined
): number | null {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}
