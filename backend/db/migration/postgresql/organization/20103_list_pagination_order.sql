--------------UP
-- Primary identities keep tied rows on the same page across page sizes.

CREATE OR REPLACE FUNCTION organization.fn_authz_audit_query(
    p_tenant_id    VARCHAR,
    p_from         TIMESTAMPTZ DEFAULT NULL,
    p_to           TIMESTAMPTZ DEFAULT NULL,
    p_actor_id     VARCHAR     DEFAULT NULL,
    p_action       VARCHAR     DEFAULT NULL,
    p_target_type  VARCHAR     DEFAULT NULL,
    p_target_id    VARCHAR     DEFAULT NULL,
    p_limit        INT         DEFAULT 200,
    p_offset       INT         DEFAULT 0
)
RETURNS TABLE (
    id          TEXT,
    tenant_id   TEXT,
    actor_id    VARCHAR,
    action      VARCHAR,
    target_type VARCHAR,
    target_id   TEXT,
    payload     JSONB,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, actor_id, action,
           target_type, target_id::text, payload, created_at
      FROM organization.authz_audit
     WHERE tenant_id = p_tenant_id
       AND (p_from        IS NULL OR created_at >= p_from)
       AND (p_to          IS NULL OR created_at <= p_to)
       AND (p_actor_id    IS NULL OR actor_id    = p_actor_id)
       AND (p_action      IS NULL OR action      = p_action)
       AND (p_target_type IS NULL OR target_type = p_target_type)
       AND (p_target_id   IS NULL OR target_id::text = p_target_id)
     ORDER BY created_at DESC, id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_certificate_list(
    p_tenant_id            VARCHAR,
    p_kind                 VARCHAR,
    p_source               VARCHAR,
    p_slot                 VARCHAR,
    p_tag                  VARCHAR,
    p_group_id             INT,
    p_expiring_within_days INT,
    p_limit                INT,
    p_offset               INT
)
RETURNS TABLE (
    id                    TEXT,
    tenant_id             TEXT,
    name                  VARCHAR,
    kind                  VARCHAR,
    fingerprint_sha256    VARCHAR,
    subject_cn            VARCHAR,
    issuer_cn             VARCHAR,
    sans                  TEXT[],
    key_algo              VARCHAR,
    chain_depth           INT,
    basic_constraints_ca  BOOLEAN,
    not_before            TIMESTAMPTZ,
    not_after             TIMESTAMPTZ,
    slot_compat           TEXT[],
    device_compatible     BOOLEAN,
    incompat_reasons      TEXT[],
    source                VARCHAR,
    created_at            TIMESTAMPTZ,
    created_by            TEXT,
    last_used_at          TIMESTAMPTZ,
    metadata              JSONB,
    tags                  TEXT[],
    device_group_ids      INT[],
    total_count           INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, c.name, c.kind, c.fingerprint_sha256,
           c.subject_cn, c.issuer_cn, c.sans, c.key_algo, c.chain_depth,
           c.basic_constraints_ca, c.not_before, c.not_after, c.slot_compat,
           c.device_compatible, c.incompat_reasons, c.source, c.created_at,
           c.created_by::text, c.last_used_at, c.metadata, c.tags,
           COALESCE(
               (SELECT array_agg(cdg.group_id ORDER BY cdg.group_id)
                  FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id),
               ARRAY[]::int[]
           ) AS device_group_ids,
           COUNT(*) OVER()::int AS total_count
      FROM organization.certificates c
     WHERE c.tenant_id = p_tenant_id
       AND (p_kind   IS NULL OR c.kind   = p_kind)
       AND (p_source IS NULL OR c.source = p_source)
       AND (p_slot   IS NULL OR p_slot = ANY(c.slot_compat))
       AND (p_tag    IS NULL OR p_tag  = ANY(c.tags))
       AND (p_group_id IS NULL OR EXISTS (
                SELECT 1 FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id
                   AND cdg.group_id = p_group_id))
       AND (p_expiring_within_days IS NULL
            OR (c.not_after IS NOT NULL
                AND c.not_after <= now() + make_interval(days => p_expiring_within_days)))
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_list(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_status VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error,
           COUNT(*) OVER()::INT
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND (p_device_id IS NULL OR d.external_id = p_device_id)
       AND (p_status IS NULL OR c.last_rotation_status = p_status)
     ORDER BY c.rotated_at DESC, c.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_list_failed(
    p_tenant_id VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error,
           COUNT(*) OVER()::INT
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND c.last_rotation_status <> 'ok'
     ORDER BY c.rotated_at DESC, c.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_list(
    p_organization_id       VARCHAR,
    p_parent_id             INTEGER   DEFAULT NULL,
    p_roots_only            BOOLEAN   DEFAULT FALSE,
    p_query                 VARCHAR   DEFAULT NULL,
    p_group_type            VARCHAR   DEFAULT NULL,
    p_limit                 INTEGER   DEFAULT 200,
    p_offset                INTEGER   DEFAULT 0,
    p_sort_by               VARCHAR   DEFAULT 'name',
    p_sort_dir              VARCHAR   DEFAULT 'asc',
    p_allowed_ids           INTEGER[] DEFAULT NULL,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_default_retention_standard    INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical    INTEGER DEFAULT NULL,
    p_default_retention_custom      INTEGER DEFAULT NULL,
    p_default_audit_retention_standard    INTEGER DEFAULT NULL,
    p_default_audit_retention_operational INTEGER DEFAULT NULL,
    p_default_audit_retention_critical    INTEGER DEFAULT NULL,
    p_default_audit_retention_custom      INTEGER DEFAULT NULL
)
RETURNS TABLE (
    total_count             BIGINT,
    id                      INTEGER,
    organization_id         VARCHAR,
    name                    VARCHAR,
    description             VARCHAR,
    parent_group_id         INTEGER,
    group_type              VARCHAR,
    membership_mode         VARCHAR,
    kind                    TEXT,
    metadata                JSONB,
    visual_json             JSONB,
    image_asset_id          UUID,
    revision                BIGINT,
    is_legacy               BOOLEAN,
    effective_severity_floor        VARCHAR,
    effective_retention_days        INTEGER,
    effective_audit_retention_days  INTEGER,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ,
    c_child_groups          BIGINT,
    c_devices               BIGINT,
    c_entities              BIGINT,
    c_locations             BIGINT,
    c_tags                  BIGINT,
    c_descendant_devices    BIGINT,
    c_descendant_entities   BIGINT
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT g.*
        FROM organization.groups g
        WHERE g.organization_id = p_organization_id
          AND (
              (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_roots_only IS TRUE  AND g.parent_group_id IS NULL)
              OR (p_roots_only IS FALSE AND g.parent_group_id = p_parent_id)
          )
          AND (p_group_type IS NULL OR g.group_type = p_group_type)
          AND (p_query IS NULL OR g.name ILIKE '%' || p_query || '%')
          AND (p_allowed_ids IS NULL OR g.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.description, f.parent_group_id,
        f.group_type, f.membership_mode, f.kind, f.metadata, f.visual_json,
        f.image_asset_id, f.revision, f.is_legacy,
        COALESCE(
            f.metadata->'policy'->>'severityFloor',
            (SELECT p.value FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'severity_floor'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        )::VARCHAR,
        COALESCE(
            (f.metadata->'policy'->>'retentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'retention_days'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
            END
        ),
        COALESCE(
            (f.metadata->'policy'->>'auditRetentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'audit_retention_days'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_audit_retention_standard
                WHEN 'operational' THEN p_default_audit_retention_operational
                WHEN 'critical'    THEN p_default_audit_retention_critical
                WHEN 'custom'      THEN p_default_audit_retention_custom
            END
        ),
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.groups c
             WHERE c.parent_group_id = f.id
               AND c.organization_id = p_organization_id
               AND (p_allowed_ids IS NULL OR c.id = ANY(p_allowed_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'device'
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'entity'
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'location'
               AND (p_allowed_location_ids IS NULL OR gm.subject_id IN (
                   SELECT id::text FROM unnest(p_allowed_location_ids) AS t(id)
               )))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.tag_assignments ta
             WHERE ta.organization_id = p_organization_id
               AND ta.subject_type = 'group'
               AND ta.subject_id = f.id::text
               AND (p_allowed_tag_ids IS NULL OR ta.tag_id = ANY(p_allowed_tag_ids)))
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                f.id, p_organization_id, 'device', p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                f.id, p_organization_id, 'entity', NULL, p_allowed_device_ids
            )
        END
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN name       END ASC,
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN name       END DESC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'asc'  THEN group_type END ASC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'desc' THEN group_type END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC,
            id ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE
    ORDER BY
        CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN f.name       END ASC,
        CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN f.name       END DESC,
        CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'asc'  THEN f.group_type END ASC,
        CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'desc' THEN f.group_type END DESC,
        CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN f.created_at END DESC,
        CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN f.created_at END ASC,
        CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN f.updated_at END DESC,
        CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN f.updated_at END ASC,
        f.id ASC;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id     VARCHAR,
    p_parent_id           INTEGER DEFAULT NULL,
    p_roots_only          BOOLEAN DEFAULT FALSE,
    p_limit               INTEGER DEFAULT 200,
    p_offset              INTEGER DEFAULT 0,
    p_allowed_ids         INTEGER[] DEFAULT NULL,
    p_include_summary     BOOLEAN DEFAULT FALSE,
    p_allowed_device_ids  VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids   INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids     INTEGER[] DEFAULT NULL,
    p_kind                VARCHAR DEFAULT NULL,
    p_query               VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    parent_location_id INTEGER, sort_order INTEGER,
    timezone VARCHAR, address JSONB, geo JSONB,
    country_code VARCHAR, region_code VARCHAR, currency VARCHAR,
    regulatory_zone VARCHAR, site_type VARCHAR, building_type VARCHAR,
    room_type VARCHAR, operational_tier VARCHAR, access_procedure VARCHAR,
    energy_certification VARCHAR, floor_number INTEGER, floor_count INTEGER,
    gross_floor_area NUMERIC, year_built INTEGER, capacity INTEGER,
    room_number VARCHAR, compliance_tags TEXT[], operating_hours JSONB,
    primary_contact JSONB, emergency_contact JSONB,
    environmental_setpoint JSONB, custom_fields JSONB, metadata JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    c_child_locations       BIGINT, c_devices BIGINT, c_entities BIGINT,
    c_tags BIGINT, c_descendant_devices BIGINT,
    c_descendant_entities BIGINT, c_groups_referencing BIGINT,
    total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
          AND (
              (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_parent_id IS NOT NULL AND l.parent_location_id = p_parent_id)
          )
          AND (p_kind IS NULL OR l.kind = p_kind)
          AND (p_query IS NULL OR l.name ILIKE '%' || p_query || '%')
    ),
    counted AS (SELECT COUNT(*)::BIGINT AS c FROM filtered)
    SELECT
        f.id, f.organization_id, f.name, f.kind,
        f.parent_location_id, f.sort_order,
        f.timezone, f.address, f.geo,
        f.country_code, f.region_code, f.currency,
        f.regulatory_zone, f.site_type, f.building_type,
        f.room_type, f.operational_tier, f.access_procedure,
        f.energy_certification, f.floor_number, f.floor_count,
        f.gross_floor_area, f.year_built, f.capacity,
        f.room_number, f.compliance_tags, f.operating_hours,
        f.primary_contact, f.emergency_contact,
        f.environmental_setpoint, f.custom_fields, f.metadata,
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary
             THEN (SELECT COUNT(*) FROM organization.locations c
                   WHERE c.parent_location_id = f.id)::BIGINT
             ELSE NULL END AS c_child_locations,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        c.c AS total_count
    FROM filtered f
    CROSS JOIN counted c
    ORDER BY f.sort_order, f.name, f.id
    LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN

CREATE OR REPLACE FUNCTION organization.fn_authz_audit_query(
    p_tenant_id    VARCHAR,
    p_from         TIMESTAMPTZ DEFAULT NULL,
    p_to           TIMESTAMPTZ DEFAULT NULL,
    p_actor_id     VARCHAR     DEFAULT NULL,
    p_action       VARCHAR     DEFAULT NULL,
    p_target_type  VARCHAR     DEFAULT NULL,
    p_target_id    VARCHAR     DEFAULT NULL,
    p_limit        INT         DEFAULT 200,
    p_offset       INT         DEFAULT 0
)
RETURNS TABLE (
    id          TEXT,
    tenant_id   TEXT,
    actor_id    VARCHAR,
    action      VARCHAR,
    target_type VARCHAR,
    target_id   TEXT,
    payload     JSONB,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT id::text, tenant_id::text, actor_id, action,
           target_type, target_id::text, payload, created_at
      FROM organization.authz_audit
     WHERE tenant_id = p_tenant_id
       AND (p_from        IS NULL OR created_at >= p_from)
       AND (p_to          IS NULL OR created_at <= p_to)
       AND (p_actor_id    IS NULL OR actor_id    = p_actor_id)
       AND (p_action      IS NULL OR action      = p_action)
       AND (p_target_type IS NULL OR target_type = p_target_type)
       AND (p_target_id   IS NULL OR target_id::text = p_target_id)
     ORDER BY created_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_certificate_list(
    p_tenant_id            VARCHAR,
    p_kind                 VARCHAR,
    p_source               VARCHAR,
    p_slot                 VARCHAR,
    p_tag                  VARCHAR,
    p_group_id             INT,
    p_expiring_within_days INT,
    p_limit                INT,
    p_offset               INT
)
RETURNS TABLE (
    id                    TEXT,
    tenant_id             TEXT,
    name                  VARCHAR,
    kind                  VARCHAR,
    fingerprint_sha256    VARCHAR,
    subject_cn            VARCHAR,
    issuer_cn             VARCHAR,
    sans                  TEXT[],
    key_algo              VARCHAR,
    chain_depth           INT,
    basic_constraints_ca  BOOLEAN,
    not_before            TIMESTAMPTZ,
    not_after             TIMESTAMPTZ,
    slot_compat           TEXT[],
    device_compatible     BOOLEAN,
    incompat_reasons      TEXT[],
    source                VARCHAR,
    created_at            TIMESTAMPTZ,
    created_by            TEXT,
    last_used_at          TIMESTAMPTZ,
    metadata              JSONB,
    tags                  TEXT[],
    device_group_ids      INT[],
    total_count           INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, c.name, c.kind, c.fingerprint_sha256,
           c.subject_cn, c.issuer_cn, c.sans, c.key_algo, c.chain_depth,
           c.basic_constraints_ca, c.not_before, c.not_after, c.slot_compat,
           c.device_compatible, c.incompat_reasons, c.source, c.created_at,
           c.created_by::text, c.last_used_at, c.metadata, c.tags,
           COALESCE(
               (SELECT array_agg(cdg.group_id ORDER BY cdg.group_id)
                  FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id),
               ARRAY[]::int[]
           ) AS device_group_ids,
           COUNT(*) OVER()::int AS total_count
      FROM organization.certificates c
     WHERE c.tenant_id = p_tenant_id
       AND (p_kind   IS NULL OR c.kind   = p_kind)
       AND (p_source IS NULL OR c.source = p_source)
       AND (p_slot   IS NULL OR p_slot = ANY(c.slot_compat))
       AND (p_tag    IS NULL OR p_tag  = ANY(c.tags))
       AND (p_group_id IS NULL OR EXISTS (
                SELECT 1 FROM organization.certificate_device_groups cdg
                 WHERE cdg.certificate_id = c.id
                   AND cdg.group_id = p_group_id))
       AND (p_expiring_within_days IS NULL
            OR (c.not_after IS NOT NULL
                AND c.not_after <= now() + make_interval(days => p_expiring_within_days)))
     ORDER BY c.created_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_list(
    p_tenant_id VARCHAR,
    p_device_id VARCHAR,
    p_status VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error,
           COUNT(*) OVER()::INT
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND (p_device_id IS NULL OR d.external_id = p_device_id)
       AND (p_status IS NULL OR c.last_rotation_status = p_status)
     ORDER BY c.rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_credential_list_failed(
    p_tenant_id VARCHAR,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    id TEXT,
    tenant_id TEXT,
    device_id VARCHAR,
    username VARCHAR,
    realm VARCHAR,
    rotated_at TIMESTAMPTZ,
    rotated_by VARCHAR,
    last_rotation_status VARCHAR,
    last_rotation_error TEXT,
    total_count INT
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id::text, c.tenant_id::text, d.external_id, c.username,
           d.external_id, c.rotated_at, c.rotated_by,
           c.last_rotation_status, c.last_rotation_error,
           COUNT(*) OVER()::INT
      FROM organization.device_credentials c
      JOIN device.list d
        ON d.id = c.logical_device_id
       AND d.organization_id = c.tenant_id
     WHERE c.tenant_id = p_tenant_id
       AND c.retired_at IS NULL
       AND c.last_rotation_status <> 'ok'
     ORDER BY c.rotated_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_list(
    p_organization_id       VARCHAR,
    p_parent_id             INTEGER   DEFAULT NULL,
    p_roots_only            BOOLEAN   DEFAULT FALSE,
    p_query                 VARCHAR   DEFAULT NULL,
    p_group_type            VARCHAR   DEFAULT NULL,
    p_limit                 INTEGER   DEFAULT 200,
    p_offset                INTEGER   DEFAULT 0,
    p_sort_by               VARCHAR   DEFAULT 'name',
    p_sort_dir              VARCHAR   DEFAULT 'asc',
    p_allowed_ids           INTEGER[] DEFAULT NULL,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_default_retention_standard    INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical    INTEGER DEFAULT NULL,
    p_default_retention_custom      INTEGER DEFAULT NULL,
    p_default_audit_retention_standard    INTEGER DEFAULT NULL,
    p_default_audit_retention_operational INTEGER DEFAULT NULL,
    p_default_audit_retention_critical    INTEGER DEFAULT NULL,
    p_default_audit_retention_custom      INTEGER DEFAULT NULL
)
RETURNS TABLE (
    total_count             BIGINT,
    id                      INTEGER,
    organization_id         VARCHAR,
    name                    VARCHAR,
    description             VARCHAR,
    parent_group_id         INTEGER,
    group_type              VARCHAR,
    membership_mode         VARCHAR,
    kind                    TEXT,
    metadata                JSONB,
    visual_json             JSONB,
    image_asset_id          UUID,
    revision                BIGINT,
    is_legacy               BOOLEAN,
    effective_severity_floor        VARCHAR,
    effective_retention_days        INTEGER,
    effective_audit_retention_days  INTEGER,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ,
    c_child_groups          BIGINT,
    c_devices               BIGINT,
    c_entities              BIGINT,
    c_locations             BIGINT,
    c_tags                  BIGINT,
    c_descendant_devices    BIGINT,
    c_descendant_entities   BIGINT
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT g.*
        FROM organization.groups g
        WHERE g.organization_id = p_organization_id
          AND (
              (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_roots_only IS TRUE  AND g.parent_group_id IS NULL)
              OR (p_roots_only IS FALSE AND g.parent_group_id = p_parent_id)
          )
          AND (p_group_type IS NULL OR g.group_type = p_group_type)
          AND (p_query IS NULL OR g.name ILIKE '%' || p_query || '%')
          AND (p_allowed_ids IS NULL OR g.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.description, f.parent_group_id,
        f.group_type, f.membership_mode, f.kind, f.metadata, f.visual_json,
        f.image_asset_id, f.revision, f.is_legacy,
        COALESCE(
            f.metadata->'policy'->>'severityFloor',
            (SELECT p.value FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'severity_floor'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        )::VARCHAR,
        COALESCE(
            (f.metadata->'policy'->>'retentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'retention_days'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
            END
        ),
        COALESCE(
            (f.metadata->'policy'->>'auditRetentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'audit_retention_days'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_audit_retention_standard
                WHEN 'operational' THEN p_default_audit_retention_operational
                WHEN 'critical'    THEN p_default_audit_retention_critical
                WHEN 'custom'      THEN p_default_audit_retention_custom
            END
        ),
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.groups c
             WHERE c.parent_group_id = f.id
               AND c.organization_id = p_organization_id
               AND (p_allowed_ids IS NULL OR c.id = ANY(p_allowed_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'device'
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'entity'
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'location'
               AND (p_allowed_location_ids IS NULL OR gm.subject_id IN (
                   SELECT id::text FROM unnest(p_allowed_location_ids) AS t(id)
               )))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.tag_assignments ta
             WHERE ta.organization_id = p_organization_id
               AND ta.subject_type = 'group'
               AND ta.subject_id = f.id::text
               AND (p_allowed_tag_ids IS NULL OR ta.tag_id = ANY(p_allowed_tag_ids)))
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                f.id, p_organization_id, 'device', p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                f.id, p_organization_id, 'entity', NULL, p_allowed_device_ids
            )
        END
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN name       END ASC,
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN name       END DESC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'asc'  THEN group_type END ASC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'desc' THEN group_type END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id     VARCHAR,
    p_parent_id           INTEGER DEFAULT NULL,
    p_roots_only          BOOLEAN DEFAULT FALSE,
    p_limit               INTEGER DEFAULT 200,
    p_offset              INTEGER DEFAULT 0,
    p_allowed_ids         INTEGER[] DEFAULT NULL,
    p_include_summary     BOOLEAN DEFAULT FALSE,
    p_allowed_device_ids  VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids   INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids     INTEGER[] DEFAULT NULL,
    p_kind                VARCHAR DEFAULT NULL,
    p_query               VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    parent_location_id INTEGER, sort_order INTEGER,
    timezone VARCHAR, address JSONB, geo JSONB,
    country_code VARCHAR, region_code VARCHAR, currency VARCHAR,
    regulatory_zone VARCHAR, site_type VARCHAR, building_type VARCHAR,
    room_type VARCHAR, operational_tier VARCHAR, access_procedure VARCHAR,
    energy_certification VARCHAR, floor_number INTEGER, floor_count INTEGER,
    gross_floor_area NUMERIC, year_built INTEGER, capacity INTEGER,
    room_number VARCHAR, compliance_tags TEXT[], operating_hours JSONB,
    primary_contact JSONB, emergency_contact JSONB,
    environmental_setpoint JSONB, custom_fields JSONB, metadata JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    c_child_locations       BIGINT, c_devices BIGINT, c_entities BIGINT,
    c_tags BIGINT, c_descendant_devices BIGINT,
    c_descendant_entities BIGINT, c_groups_referencing BIGINT,
    total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
          AND (
              (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_parent_id IS NOT NULL AND l.parent_location_id = p_parent_id)
          )
          AND (p_kind IS NULL OR l.kind = p_kind)
          AND (p_query IS NULL OR l.name ILIKE '%' || p_query || '%')
    ),
    counted AS (SELECT COUNT(*)::BIGINT AS c FROM filtered)
    SELECT
        f.id, f.organization_id, f.name, f.kind,
        f.parent_location_id, f.sort_order,
        f.timezone, f.address, f.geo,
        f.country_code, f.region_code, f.currency,
        f.regulatory_zone, f.site_type, f.building_type,
        f.room_type, f.operational_tier, f.access_procedure,
        f.energy_certification, f.floor_number, f.floor_count,
        f.gross_floor_area, f.year_built, f.capacity,
        f.room_number, f.compliance_tags, f.operating_hours,
        f.primary_contact, f.emergency_contact,
        f.environmental_setpoint, f.custom_fields, f.metadata,
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary
             THEN (SELECT COUNT(*) FROM organization.locations c
                   WHERE c.parent_location_id = f.id)::BIGINT
             ELSE NULL END AS c_child_locations,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        c.c AS total_count
    FROM filtered f
    CROSS JOIN counted c
    ORDER BY f.sort_order, f.name
    LIMIT p_limit OFFSET p_offset;
$$;
