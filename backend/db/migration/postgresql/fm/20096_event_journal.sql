--------------UP
SET search_path TO public;

CREATE SEQUENCE IF NOT EXISTS fm.event_journal_id_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS fm.event_journal_watermark (
    organization_id VARCHAR(160) PRIMARY KEY,
    highwater_id BIGINT NOT NULL DEFAULT 0 CHECK (highwater_id >= 0),
    pruned_through_id BIGINT NOT NULL DEFAULT 0
        CHECK (pruned_through_id >= 0),
    retained_count INTEGER NOT NULL DEFAULT 0
        CHECK (retained_count >= 0 AND retained_count <= 100000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS fm.event_journal (
    id BIGINT PRIMARY KEY,
    organization_id VARCHAR(160) NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    resource_kind VARCHAR(16) NOT NULL
        CHECK (resource_kind IN ('device', 'job', 'job-unit')),
    resource_id VARCHAR(160) NOT NULL,
    job_id VARCHAR(160),
    device_ids VARCHAR(160)[] NOT NULL DEFAULT ARRAY[]::VARCHAR[],
    job_kind VARCHAR(16)
        CHECK (job_kind IS NULL OR job_kind IN ('backup', 'firmware', 'certificate', 'credential')),
    user_id VARCHAR(160),
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    deduplication_key VARCHAR(240),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (jsonb_typeof(payload) = 'object'),
    CHECK (octet_length(payload::TEXT) <= 4096),
    CHECK (cardinality(device_ids) <= 200),
    CHECK (
        (resource_kind = 'device' AND job_id IS NULL AND job_kind IS NULL)
        OR (resource_kind = 'job' AND job_id = resource_id AND job_kind IS NOT NULL)
        OR (resource_kind = 'job-unit' AND job_id IS NOT NULL AND job_kind IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS event_journal_org_id_idx
    ON fm.event_journal (organization_id, id);
CREATE INDEX IF NOT EXISTS event_journal_org_job_idx
    ON fm.event_journal (organization_id, job_id, id)
    WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_journal_org_device_idx
    ON fm.event_journal USING GIN (device_ids);
CREATE INDEX IF NOT EXISTS event_journal_occurred_at_idx
    ON fm.event_journal (occurred_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS event_journal_dedup_idx
    ON fm.event_journal (organization_id, deduplication_key)
    WHERE deduplication_key IS NOT NULL;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_insert(
    p_organization_id VARCHAR,
    p_event_type VARCHAR,
    p_resource_kind VARCHAR,
    p_resource_id VARCHAR,
    p_job_id VARCHAR,
    p_device_ids VARCHAR[],
    p_job_kind VARCHAR,
    p_user_id VARCHAR,
    p_payload JSONB,
    p_deduplication_key VARCHAR
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
    v_pruned_id BIGINT;
    v_retained_count INTEGER;
BEGIN
    IF p_organization_id IS NULL OR length(p_organization_id) > 160
        OR p_resource_id IS NULL OR length(p_resource_id) > 160
        OR p_event_type IS NULL OR length(p_event_type) > 120
        OR p_deduplication_key IS NOT NULL AND length(p_deduplication_key) > 240
        OR coalesce(cardinality(p_device_ids), 0) > 200
        OR jsonb_typeof(coalesce(p_payload, '{}'::JSONB)) IS DISTINCT FROM 'object'
        OR octet_length(coalesce(p_payload, '{}'::JSONB)::TEXT) > 4096 THEN
        RAISE EXCEPTION 'event journal input exceeds limits';
    END IF;

    INSERT INTO fm.event_journal_watermark (organization_id)
    VALUES (p_organization_id)
    ON CONFLICT (organization_id) DO NOTHING;

    -- This tenant row serializes ID allocation through commit. A later ID for
    -- the same tenant therefore cannot commit before an earlier ID.
    PERFORM 1
      FROM fm.event_journal_watermark
     WHERE organization_id = p_organization_id
     FOR UPDATE;

    IF p_deduplication_key IS NOT NULL THEN
        SELECT id INTO v_id
          FROM fm.event_journal
         WHERE organization_id = p_organization_id
           AND deduplication_key = p_deduplication_key;
        IF v_id IS NOT NULL THEN
            RETURN v_id;
        END IF;
    END IF;

    SELECT retained_count
      INTO STRICT v_retained_count
      FROM fm.event_journal_watermark
     WHERE organization_id = p_organization_id;
    IF v_retained_count >= 100000 THEN
        DELETE FROM fm.event_journal
         WHERE id = (
             SELECT id
               FROM fm.event_journal
              WHERE organization_id = p_organization_id
              ORDER BY id ASC
              LIMIT 1
         )
        RETURNING id INTO v_pruned_id;
        UPDATE fm.event_journal_watermark
           SET pruned_through_id = greatest(pruned_through_id, v_pruned_id),
               retained_count = retained_count - 1
         WHERE organization_id = p_organization_id;
    END IF;

    v_id := nextval('fm.event_journal_id_seq');
    INSERT INTO fm.event_journal (
        id,
        organization_id, event_type, resource_kind, resource_id, job_id,
        device_ids, job_kind, user_id, payload, deduplication_key
    ) VALUES (
        v_id,
        p_organization_id, p_event_type, p_resource_kind, p_resource_id,
        p_job_id, coalesce(p_device_ids, ARRAY[]::VARCHAR[]), p_job_kind,
        p_user_id, coalesce(p_payload, '{}'::JSONB), p_deduplication_key
    )
    ;
    UPDATE fm.event_journal_watermark
       SET highwater_id = v_id,
           retained_count = retained_count + 1,
           updated_at = clock_timestamp()
     WHERE organization_id = p_organization_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_append_device(
    p_organization_id VARCHAR,
    p_device_id VARCHAR,
    p_event_type VARCHAR,
    p_user_id VARCHAR,
    p_payload JSONB,
    p_deduplication_key VARCHAR
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_disallowed_key TEXT;
BEGIN
    SELECT key INTO v_disallowed_key
      FROM jsonb_object_keys(coalesce(p_payload, '{}'::JSONB)) AS key
     WHERE key NOT IN (
        'component', 'event', 'reason', 'source', 'status', 'phase',
        'progressPercent', 'changes'
     )
     LIMIT 1;
    IF v_disallowed_key IS NOT NULL THEN
        RAISE EXCEPTION 'device event payload key is not allowed';
    END IF;
    RETURN fm.fn_event_journal_insert(
        p_organization_id, p_event_type, 'device', p_device_id, NULL,
        ARRAY[p_device_id], NULL, p_user_id, p_payload,
        p_deduplication_key
    );
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_read(
    p_organization_id VARCHAR,
    p_after_id BIGINT,
    p_device_ids VARCHAR[],
    p_job_ids VARCHAR[],
    p_limit INTEGER
)
RETURNS TABLE (
    rows JSONB,
    next_after_id BIGINT,
    highwater_id BIGINT,
    pruned_through_id BIGINT,
    first_available_id BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH state AS (
        SELECT coalesce(w.highwater_id, 0) AS highwater_id,
               coalesce(w.pruned_through_id, 0) AS pruned_through_id,
               coalesce(
                   (SELECT min(e.id)
                      FROM fm.event_journal AS e
                     WHERE e.organization_id = p_organization_id),
                   coalesce(w.highwater_id, 0) + 1
               ) AS first_available_id
          FROM (SELECT 1) AS anchor
          LEFT JOIN fm.event_journal_watermark AS w
            ON w.organization_id = p_organization_id
    ), page AS (
        SELECT e.*
          FROM fm.event_journal AS e
          CROSS JOIN state AS s
         WHERE e.organization_id = p_organization_id
           AND e.id > coalesce(p_after_id, 0)
           AND e.id <= s.highwater_id
           AND (p_device_ids IS NULL OR e.device_ids && p_device_ids)
           AND (p_job_ids IS NULL OR e.job_id = ANY(p_job_ids))
         ORDER BY e.id ASC
         LIMIT least(greatest(coalesce(p_limit, 100), 1), 200)
    ), aggregate_page AS (
        SELECT coalesce(
                   jsonb_agg(
                       to_jsonb(page) || jsonb_build_object('id', page.id::TEXT)
                       ORDER BY id
                   ),
                   '[]'::JSONB
               ) AS rows,
               count(*) AS row_count,
               max(id) AS last_id
          FROM page
    )
    SELECT a.rows,
           CASE
               WHEN a.row_count = least(greatest(coalesce(p_limit, 100), 1), 200)
               THEN a.last_id
               ELSE s.highwater_id
           END AS next_after_id,
           s.highwater_id,
           s.pruned_through_id,
           s.first_available_id
      FROM aggregate_page AS a
      CROSS JOIN state AS s;
$$;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_prune()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    WITH candidates AS (
        SELECT id, organization_id
          FROM fm.event_journal
         WHERE occurred_at < clock_timestamp() - INTERVAL '7 days'
         ORDER BY occurred_at ASC, id ASC
         LIMIT 1000
    ), tenant_ids AS (
        SELECT DISTINCT organization_id FROM candidates
    ), locked_tenants AS MATERIALIZED (
        SELECT w.organization_id
          FROM fm.event_journal_watermark AS w
          JOIN tenant_ids AS t USING (organization_id)
         ORDER BY w.organization_id
         FOR UPDATE OF w
    ), deleted AS (
        DELETE FROM fm.event_journal AS e
         USING candidates AS c
         JOIN locked_tenants AS l USING (organization_id)
         WHERE e.id = c.id
        RETURNING e.organization_id, e.id
    ), per_tenant AS (
        SELECT organization_id, max(id) AS max_id, count(*)::INTEGER AS count
          FROM deleted
         GROUP BY organization_id
    ), updated AS (
        UPDATE fm.event_journal_watermark AS w
           SET pruned_through_id = greatest(w.pruned_through_id, p.max_id),
               retained_count = greatest(0, w.retained_count - p.count),
               updated_at = clock_timestamp()
          FROM per_tenant AS p
         WHERE w.organization_id = p.organization_id
        RETURNING p.count
    )
    SELECT coalesce(sum(count), 0)::INTEGER INTO v_deleted FROM updated;
    RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_event_journal_job_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_row JSONB := to_jsonb(NEW);
    v_kind VARCHAR := TG_ARGV[0];
    v_unit BOOLEAN := TG_ARGV[1] = 'unit';
    v_org VARCHAR;
    v_job_id VARCHAR;
    v_resource_id VARCHAR;
    v_device_ids VARCHAR[] := ARRAY[]::VARCHAR[];
    v_payload JSONB;
    v_event_type VARCHAR;
BEGIN
    v_job_id := coalesce(v_row ->> 'job_id', v_row ->> 'id');
    v_resource_id := v_row ->> 'id';
    v_org := v_row ->> 'tenant_id';
    IF v_org IS NULL THEN
        EXECUTE format(
            'SELECT tenant_id FROM organization.%I WHERE id = $1::uuid',
            v_kind || '_jobs'
        ) INTO v_org USING v_job_id;
    END IF;
    IF v_unit AND v_row ->> 'device_id' IS NOT NULL THEN
        v_device_ids := ARRAY[v_row ->> 'device_id'];
    ELSIF NOT v_unit THEN
        SELECT coalesce(array_agg(value), ARRAY[]::VARCHAR[])
          INTO v_device_ids
          FROM jsonb_array_elements_text(
              CASE
                  WHEN jsonb_typeof(v_row -> 'target_summary' -> 'deviceIds') = 'array'
                  THEN v_row -> 'target_summary' -> 'deviceIds'
                  ELSE '[]'::JSONB
              END
          ) AS value;
        -- A job-level event must carry its complete authorization scope. Unit
        -- events remain available when a target set exceeds the row bound.
        IF cardinality(v_device_ids) = 0 OR cardinality(v_device_ids) > 200 THEN
            RETURN NEW;
        END IF;
    END IF;
    v_event_type := CASE WHEN v_unit THEN 'Job.UnitUpdated' ELSE 'Job.Updated' END;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
        'status', v_row ->> 'status',
        'phase', v_row ->> 'phase',
        'progressPercent', v_row -> 'progress_percent',
        'controlState', v_row ->> 'control_state',
        'dispatchState', v_row ->> 'dispatch_state',
        'outcomeState', v_row ->> 'outcome_state'
    ));
    PERFORM fm.fn_event_journal_insert(
        v_org, v_event_type, CASE WHEN v_unit THEN 'job-unit' ELSE 'job' END,
        v_resource_id, v_job_id, v_device_ids, v_kind,
        NULL,
        v_payload, NULL
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER event_journal_backup_jobs
AFTER INSERT OR UPDATE ON organization.backup_jobs
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('backup', 'job');
CREATE OR REPLACE TRIGGER event_journal_backup_units
AFTER INSERT OR UPDATE ON organization.backup_units
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('backup', 'unit');
CREATE OR REPLACE TRIGGER event_journal_firmware_jobs
AFTER INSERT OR UPDATE ON organization.firmware_jobs
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('firmware', 'job');
CREATE OR REPLACE TRIGGER event_journal_firmware_units
AFTER INSERT OR UPDATE ON organization.firmware_units
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('firmware', 'unit');
CREATE OR REPLACE TRIGGER event_journal_certificate_jobs
AFTER INSERT OR UPDATE ON organization.certificate_jobs
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('certificate', 'job');
CREATE OR REPLACE TRIGGER event_journal_certificate_pushes
AFTER INSERT OR UPDATE ON organization.certificate_pushes
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('certificate', 'unit');
CREATE OR REPLACE TRIGGER event_journal_credential_jobs
AFTER INSERT OR UPDATE ON organization.credential_jobs
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('credential', 'job');
CREATE OR REPLACE TRIGGER event_journal_credential_pushes
AFTER INSERT OR UPDATE ON organization.credential_pushes
FOR EACH ROW EXECUTE FUNCTION fm.fn_event_journal_job_trigger('credential', 'unit');

--------------DOWN
DROP TRIGGER IF EXISTS event_journal_credential_pushes ON organization.credential_pushes;
DROP TRIGGER IF EXISTS event_journal_credential_jobs ON organization.credential_jobs;
DROP TRIGGER IF EXISTS event_journal_certificate_pushes ON organization.certificate_pushes;
DROP TRIGGER IF EXISTS event_journal_certificate_jobs ON organization.certificate_jobs;
DROP TRIGGER IF EXISTS event_journal_firmware_units ON organization.firmware_units;
DROP TRIGGER IF EXISTS event_journal_firmware_jobs ON organization.firmware_jobs;
DROP TRIGGER IF EXISTS event_journal_backup_units ON organization.backup_units;
DROP TRIGGER IF EXISTS event_journal_backup_jobs ON organization.backup_jobs;
DROP FUNCTION IF EXISTS fm.fn_event_journal_job_trigger();
DROP FUNCTION IF EXISTS fm.fn_event_journal_prune();
DROP FUNCTION IF EXISTS fm.fn_event_journal_read(VARCHAR, BIGINT, VARCHAR[], VARCHAR[], INTEGER);
DROP FUNCTION IF EXISTS fm.fn_event_journal_append_device(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR);
DROP FUNCTION IF EXISTS fm.fn_event_journal_insert(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR[], VARCHAR, VARCHAR, JSONB, VARCHAR);
DROP TABLE IF EXISTS fm.event_journal;
DROP TABLE IF EXISTS fm.event_journal_watermark;
DROP SEQUENCE IF EXISTS fm.event_journal_id_seq;
