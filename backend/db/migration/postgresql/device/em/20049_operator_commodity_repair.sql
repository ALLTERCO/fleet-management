--------------UP
SET search_path TO device_em, public;

-- Rollback retains immutable audit payloads here. This table deliberately
-- survives DOWN so an operator never loses evidence of a financial-data repair.
CREATE TABLE IF NOT EXISTS device_em.commodity_repair_archive_20049 (
    repair_id BIGINT PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One immutable selector plus its preview/application outcome is the audit
-- record. Apply updates this row under lock and has no delete API.
CREATE TABLE IF NOT EXISTS device_em.commodity_repair (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL
        REFERENCES organization.profile(id) ON DELETE RESTRICT,
    device INTEGER NOT NULL,
    channel SMALLINT NOT NULL,
    tag VARCHAR(30) NOT NULL,
    from_ts TIMESTAMPTZ NOT NULL,
    to_ts TIMESTAMPTZ NOT NULL,
    expected_commodity VARCHAR(12) NOT NULL,
    expected_electrical_source VARCHAR(16),
    target_commodity VARCHAR(12) NOT NULL,
    target_electrical_source VARCHAR(16),
    target_domain VARCHAR(16) NOT NULL,
    source_reference VARCHAR(500) NOT NULL,
    requested_by VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    preview_row_count BIGINT NOT NULL,
    preview_raw_row_count BIGINT NOT NULL,
    preview_quantity DOUBLE PRECISION NOT NULL,
    preview_rollup_conflict_count BIGINT NOT NULL,
    preview_raw_conflict_count BIGINT NOT NULL,
    preview_dirty_count BIGINT NOT NULL,
    preview_first_bucket TIMESTAMPTZ,
    preview_last_bucket TIMESTAMPTZ,
    preview_fingerprint TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'previewed',
    applied_rows BIGINT,
    raw_rows_reclassified BIGINT,
    coverage_start TIMESTAMPTZ,
    applied_by VARCHAR(200),
    applied_at TIMESTAMPTZ,
    CONSTRAINT commodity_repair_device_org_fk FOREIGN KEY (
        organization_id, device
    ) REFERENCES device.list (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT commodity_repair_range_chk CHECK (
        to_ts > from_ts AND to_ts <= from_ts + INTERVAL '366 days'
    ),
    CONSTRAINT commodity_repair_channel_chk CHECK (
        channel >= 0
    ),
    CONSTRAINT commodity_repair_tag_chk CHECK (tag IN (
        'total_act_energy', 'total_act_ret_energy',
        'volume_l', 'volume_m3'
    )),
    CONSTRAINT commodity_repair_commodity_chk CHECK (
        expected_commodity IN ('electricity', 'water', 'gas', 'heat')
        AND target_commodity IN ('electricity', 'water', 'gas', 'heat')
    ),
    CONSTRAINT commodity_repair_expected_axes_chk CHECK (
        (expected_commodity = 'electricity'
            AND expected_electrical_source IN (
                'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus'
            ))
        OR (expected_commodity <> 'electricity'
            AND expected_electrical_source IS NULL)
    ),
    CONSTRAINT commodity_repair_target_axes_chk CHECK (
        (target_commodity = 'electricity'
            AND target_electrical_source IN (
                'ac_mains', 'dc_pv', 'dc_battery', 'dc_bus'
            ))
        OR (target_commodity <> 'electricity'
            AND target_electrical_source IS NULL)
    ),
    CONSTRAINT commodity_repair_changed_chk CHECK (
        expected_commodity <> target_commodity
        OR expected_electrical_source IS DISTINCT FROM target_electrical_source
    ),
    CONSTRAINT commodity_repair_source_chk CHECK (
        source_reference = btrim(source_reference)
        AND source_reference <> ''
    ),
    CONSTRAINT commodity_repair_status_chk CHECK (
        status IN ('previewed', 'applied')
    )
);

-- A rollback leaves the archive and its old ids behind. Re-applying the
-- migration must never reuse one of those immutable audit identities.
DO $$
DECLARE
    v_max_id BIGINT;
    v_sequence TEXT;
BEGIN
    SELECT GREATEST(
        COALESCE((SELECT max(id) FROM device_em.commodity_repair), 0),
        COALESCE((
            SELECT max(repair_id)
              FROM device_em.commodity_repair_archive_20049
        ), 0)
    ) INTO v_max_id;
    v_sequence := pg_get_serial_sequence(
        'device_em.commodity_repair',
        'id'
    );
    IF v_max_id > 0 THEN
        PERFORM setval(v_sequence, v_max_id, TRUE);
    ELSE
        PERFORM setval(v_sequence, 1, FALSE);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS commodity_repair_org_created_idx
    ON device_em.commodity_repair (organization_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS commodity_repair_meter_period_idx
    ON device_em.commodity_repair (
        organization_id, device, channel, tag, from_ts, to_ts
    );

CREATE OR REPLACE FUNCTION device_em.fn_commodity_repair_domain(
    p_commodity TEXT,
    p_electrical_source TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_commodity
        WHEN 'electricity' THEN p_electrical_source
        WHEN 'gas' THEN 'gas'
        WHEN 'heat' THEN 'thermal'
        WHEN 'water' THEN 'unspecified'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_commodity_repair_snapshot(
    p_device INTEGER,
    p_channel SMALLINT,
    p_tag VARCHAR,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_expected_commodity VARCHAR,
    p_expected_electrical_source VARCHAR,
    p_target_commodity VARCHAR,
    p_target_electrical_source VARCHAR,
    p_target_domain VARCHAR
)
RETURNS TABLE (
    row_count BIGINT,
    raw_row_count BIGINT,
    quantity DOUBLE PRECISION,
    rollup_conflict_count BIGINT,
    raw_conflict_count BIGINT,
    dirty_count BIGINT,
    first_bucket TIMESTAMPTZ,
    last_bucket TIMESTAMPTZ,
    fingerprint TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH candidates AS MATERIALIZED (
        SELECT e.bucket, e.device, e.phase, e.channel, e.tag, e.domain,
               e.commodity, e.electrical_source, e.sum_val,
               e.sample_count, e.min_val, e.max_val
          FROM device_em.energy_15min e
         WHERE e.device = p_device
           AND e.channel = p_channel
           AND e.tag = p_tag
           AND e.bucket >= p_from
           AND e.bucket < p_to
           AND e.commodity = p_expected_commodity
           AND e.electrical_source IS NOT DISTINCT FROM
               p_expected_electrical_source
    ), raw_candidates AS MATERIALIZED (
        SELECT s.ts, s.device, s.phase, s.channel, s.tag, s.domain,
               s.commodity, s.electrical_source, s.val
          FROM device_em.stats s
         WHERE s.device = p_device
           AND s.channel = p_channel
           AND s.tag = p_tag
           AND s.ts >= p_from
           AND s.ts < p_to
           AND s.commodity = p_expected_commodity
           AND s.electrical_source IS NOT DISTINCT FROM
               p_expected_electrical_source
    ), rollup_conflicts AS (
        SELECT count(*)::BIGINT AS n
          FROM candidates c
         WHERE c.domain <> p_target_domain
           AND EXISTS (
               SELECT 1
                 FROM device_em.energy_15min target
                WHERE target.bucket = c.bucket
                  AND target.device = c.device
                  AND target.tag = c.tag
                  AND target.domain = p_target_domain
                  AND target.phase IS NOT DISTINCT FROM c.phase
                  AND target.channel IS NOT DISTINCT FROM c.channel
           )
    ), raw_conflicts AS (
        SELECT count(*)::BIGINT AS n
          FROM raw_candidates c
         WHERE c.domain <> p_target_domain
           AND EXISTS (
               SELECT 1
                 FROM device_em.stats target
                WHERE target.ts = c.ts
                  AND target.device = c.device
                  AND target.tag = c.tag
                  AND target.domain = p_target_domain
                  AND target.phase IS NOT DISTINCT FROM c.phase
                  AND target.channel IS NOT DISTINCT FROM c.channel
           )
    ), dirty AS (
        SELECT count(*)::BIGINT AS n
          FROM device_em.rollup_dirty d
         WHERE d.device = p_device
           AND d.channel = p_channel
           AND d.tag = p_tag
           AND d.bucket >= p_from
           AND d.bucket < p_to
    ), rollup_summary AS (
        SELECT count(*)::BIGINT AS row_count,
               COALESCE(sum(c.sum_val), 0)::DOUBLE PRECISION AS quantity,
               min(c.bucket) AS first_bucket,
               max(c.bucket) AS last_bucket,
               md5(COALESCE(string_agg(
                   jsonb_build_array(
                       c.bucket, c.phase, c.channel, c.domain, c.commodity,
                       c.electrical_source, c.sum_val, c.sample_count,
                       c.min_val, c.max_val
                   )::TEXT,
                   E'\n' ORDER BY c.bucket, c.phase, c.channel, c.domain
               ), '')) AS fingerprint
          FROM candidates c
    ), raw_summary AS (
        SELECT count(*)::BIGINT AS row_count,
               md5(COALESCE(string_agg(
                   jsonb_build_array(
                       c.ts, c.phase, c.channel, c.domain, c.commodity,
                       c.electrical_source, c.val
                   )::TEXT,
                   E'\n' ORDER BY c.ts, c.phase, c.channel, c.domain, c.val
               ), '')) AS fingerprint
          FROM raw_candidates c
    )
    SELECT rollup.row_count,
           raw.row_count,
           rollup.quantity,
           rollup_conflicts.n,
           raw_conflicts.n,
           dirty.n,
           rollup.first_bucket,
           rollup.last_bucket,
           md5(rollup.fingerprint || ':' || raw.fingerprint)
      FROM rollup_summary rollup
      CROSS JOIN raw_summary raw
      CROSS JOIN rollup_conflicts
      CROSS JOIN raw_conflicts
      CROSS JOIN dirty;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_preview_commodity_repair(
    p_organization_id VARCHAR,
    p_device INTEGER,
    p_channel SMALLINT,
    p_tag VARCHAR,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_expected_commodity VARCHAR,
    p_expected_electrical_source VARCHAR,
    p_target_commodity VARCHAR,
    p_target_electrical_source VARCHAR,
    p_source_reference VARCHAR,
    p_requested_by VARCHAR
)
RETURNS TABLE (
    preview_id BIGINT,
    eligible BOOLEAN,
    row_count BIGINT,
    quantity DOUBLE PRECISION,
    rollup_conflict_count BIGINT,
    raw_conflict_count BIGINT,
    dirty_count BIGINT,
    raw_row_count BIGINT,
    first_bucket TIMESTAMPTZ,
    last_bucket TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_snapshot RECORD;
    v_target_domain VARCHAR;
    v_preview_id BIGINT;
BEGIN
    IF p_to <= p_from OR p_to > p_from + INTERVAL '366 days'
       OR p_to > now() THEN
        RAISE EXCEPTION 'commodity repair requires a completed range of at most 366 days';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM device.list d
         WHERE d.id = p_device
           AND d.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'device is not owned by organization';
    END IF;
    IF p_tag IN ('volume_l', 'volume_m3') THEN
        IF p_expected_commodity NOT IN ('water', 'gas')
           OR p_target_commodity NOT IN ('water', 'gas') THEN
            RAISE EXCEPTION 'volume repair commodity must be water or gas';
        END IF;
    ELSIF p_expected_commodity <> 'electricity'
       OR p_target_commodity <> 'electricity' THEN
        RAISE EXCEPTION 'electrical energy tags require electricity';
    END IF;

    v_target_domain := device_em.fn_commodity_repair_domain(
        p_target_commodity,
        p_target_electrical_source
    );
    IF v_target_domain IS NULL THEN
        RAISE EXCEPTION 'target commodity/electrical source is invalid';
    END IF;

    SELECT * INTO v_snapshot
      FROM device_em.fn_commodity_repair_snapshot(
          p_device, p_channel, p_tag, p_from, p_to,
          p_expected_commodity, p_expected_electrical_source,
          p_target_commodity, p_target_electrical_source, v_target_domain
      );

    INSERT INTO device_em.commodity_repair (
        organization_id, device, channel, tag, from_ts, to_ts,
        expected_commodity, expected_electrical_source,
        target_commodity, target_electrical_source, target_domain,
        source_reference, requested_by,
        preview_row_count, preview_raw_row_count, preview_quantity,
        preview_rollup_conflict_count, preview_raw_conflict_count,
        preview_dirty_count, preview_first_bucket, preview_last_bucket,
        preview_fingerprint
    ) VALUES (
        p_organization_id, p_device, p_channel, p_tag, p_from, p_to,
        p_expected_commodity, p_expected_electrical_source,
        p_target_commodity, p_target_electrical_source, v_target_domain,
        p_source_reference, p_requested_by,
        v_snapshot.row_count, v_snapshot.raw_row_count, v_snapshot.quantity,
        v_snapshot.rollup_conflict_count,
        v_snapshot.raw_conflict_count,
        v_snapshot.dirty_count,
        v_snapshot.first_bucket, v_snapshot.last_bucket,
        v_snapshot.fingerprint
    ) RETURNING id INTO v_preview_id;

    RETURN QUERY SELECT
        v_preview_id,
        v_snapshot.row_count > 0
            AND v_snapshot.rollup_conflict_count = 0
            AND v_snapshot.raw_conflict_count = 0
            AND v_snapshot.dirty_count = 0,
        v_snapshot.row_count,
        v_snapshot.quantity,
        v_snapshot.rollup_conflict_count,
        v_snapshot.raw_conflict_count,
        v_snapshot.dirty_count,
        v_snapshot.raw_row_count,
        v_snapshot.first_bucket,
        v_snapshot.last_bucket;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_apply_commodity_repair(
    p_organization_id VARCHAR,
    p_preview_id BIGINT,
    p_device INTEGER,
    p_applied_by VARCHAR
)
RETURNS TABLE (
    preview_id BIGINT,
    applied_rows BIGINT,
    raw_rows_reclassified BIGINT,
    coverage_start TIMESTAMPTZ,
    applied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
SET lock_timeout TO '30s'
AS $$
DECLARE
    v_repair device_em.commodity_repair%ROWTYPE;
    v_snapshot RECORD;
    v_applied_rows BIGINT;
    v_raw_rows BIGINT;
    v_coverage_start TIMESTAMPTZ;
    v_applied_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_repair
      FROM device_em.commodity_repair r
     WHERE r.id = p_preview_id
       AND r.organization_id = p_organization_id
       AND r.device = p_device
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'commodity repair preview not found';
    END IF;
    IF v_repair.status = 'applied' THEN
        RETURN QUERY SELECT
            v_repair.id, v_repair.applied_rows,
            v_repair.raw_rows_reclassified, v_repair.coverage_start,
            v_repair.applied_at;
        RETURN;
    END IF;
    IF v_repair.preview_row_count = 0
       OR v_repair.preview_rollup_conflict_count <> 0
       OR v_repair.preview_raw_conflict_count <> 0
       OR v_repair.preview_dirty_count <> 0 THEN
        RAISE EXCEPTION 'commodity repair preview is not eligible';
    END IF;

    -- Rare operator maintenance window. This fixed-order lock has no normal
    -- ingest overhead, permits concurrent reads, and pauses writers only for
    -- the bounded recheck + two updates below. The recheck under the lock
    -- closes the preview/apply phantom window.
    LOCK TABLE device_em.stats, device_em.energy_15min
        IN SHARE ROW EXCLUSIVE MODE;

    SELECT * INTO v_snapshot
      FROM device_em.fn_commodity_repair_snapshot(
          v_repair.device, v_repair.channel, v_repair.tag,
          v_repair.from_ts, v_repair.to_ts,
          v_repair.expected_commodity,
          v_repair.expected_electrical_source,
          v_repair.target_commodity,
          v_repair.target_electrical_source,
          v_repair.target_domain
      );
    IF v_snapshot.row_count <> v_repair.preview_row_count
       OR v_snapshot.raw_row_count <> v_repair.preview_raw_row_count
       OR v_snapshot.quantity IS DISTINCT FROM v_repair.preview_quantity
       OR v_snapshot.rollup_conflict_count <> 0
       OR v_snapshot.raw_conflict_count <> 0
       OR v_snapshot.dirty_count <> 0
       OR v_snapshot.fingerprint <> v_repair.preview_fingerprint THEN
        RAISE EXCEPTION
            'commodity repair source rows changed after preview; preview again';
    END IF;

    UPDATE device_em.stats s
       SET domain = v_repair.target_domain,
           commodity = v_repair.target_commodity,
           electrical_source = v_repair.target_electrical_source
     WHERE s.device = v_repair.device
       AND s.channel = v_repair.channel
       AND s.tag = v_repair.tag
       AND s.ts >= v_repair.from_ts
       AND s.ts < v_repair.to_ts
       AND s.commodity = v_repair.expected_commodity
       AND s.electrical_source IS NOT DISTINCT FROM
           v_repair.expected_electrical_source;
    GET DIAGNOSTICS v_raw_rows = ROW_COUNT;
    IF v_raw_rows <> v_repair.preview_raw_row_count THEN
        RAISE EXCEPTION 'commodity repair raw row count changed';
    END IF;

    UPDATE device_em.energy_15min e
       SET domain = v_repair.target_domain,
           commodity = v_repair.target_commodity,
           electrical_source = v_repair.target_electrical_source
     WHERE e.device = v_repair.device
       AND e.channel = v_repair.channel
       AND e.tag = v_repair.tag
       AND e.bucket >= v_repair.from_ts
       AND e.bucket < v_repair.to_ts
       AND e.commodity = v_repair.expected_commodity
       AND e.electrical_source IS NOT DISTINCT FROM
           v_repair.expected_electrical_source;
    GET DIAGNOSTICS v_applied_rows = ROW_COUNT;
    IF v_applied_rows <> v_repair.preview_row_count THEN
        RAISE EXCEPTION 'commodity repair applied row count changed';
    END IF;

    SELECT min(e.bucket) INTO v_coverage_start
      FROM device_em.energy_15min e
     WHERE e.device = v_repair.device
       AND e.channel = v_repair.channel
       AND e.tag = v_repair.tag
       AND e.commodity = v_repair.target_commodity
       AND e.electrical_source IS NOT DISTINCT FROM
           v_repair.target_electrical_source;
    IF v_coverage_start IS NULL THEN
        RAISE EXCEPTION 'commodity repair produced no target coverage';
    END IF;

    v_applied_at := clock_timestamp();
    UPDATE device_em.commodity_repair
       SET status = 'applied',
           applied_rows = v_applied_rows,
           raw_rows_reclassified = v_raw_rows,
           coverage_start = v_coverage_start,
           applied_by = p_applied_by,
           applied_at = v_applied_at
     WHERE id = v_repair.id;

    RETURN QUERY SELECT
        v_repair.id, v_applied_rows, v_raw_rows,
        v_coverage_start, v_applied_at;
END;
$$;

--------------DOWN
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM device_em.commodity_repair repair
          JOIN device_em.commodity_repair_archive_20049 archive
            ON archive.repair_id = repair.id
         WHERE archive.payload IS DISTINCT FROM to_jsonb(repair)
    ) THEN
        RAISE EXCEPTION
            'commodity repair archive identity collision; refusing to overwrite immutable audit payload';
    END IF;
END;
$$;

INSERT INTO device_em.commodity_repair_archive_20049 (
    repair_id, organization_id, payload, archived_at
)
SELECT repair.id, repair.organization_id, to_jsonb(repair), now()
  FROM device_em.commodity_repair repair
ON CONFLICT (repair_id) DO NOTHING;

DROP FUNCTION IF EXISTS device_em.fn_apply_commodity_repair(
    VARCHAR, BIGINT, INTEGER, VARCHAR
);
DROP FUNCTION IF EXISTS device_em.fn_preview_commodity_repair(
    VARCHAR, INTEGER, SMALLINT, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS device_em.fn_commodity_repair_snapshot(
    INTEGER, SMALLINT, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS device_em.fn_commodity_repair_domain(TEXT, TEXT);
-- LINT-IGNORE: additive-only -- every audit row is archived above first.
DROP TABLE IF EXISTS device_em.commodity_repair;
