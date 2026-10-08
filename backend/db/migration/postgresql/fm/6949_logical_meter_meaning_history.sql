--------------UP
-- Role and end-use are interpretations, not meter facts. Keep every applied
-- interpretation on a half-open UTC interval so rerunning an older report
-- resolves the meaning that was effective for its buckets.

-- Rollback retains immutable audit payloads. This table deliberately survives
-- DOWN, and sequence guards below prevent a later deployment reusing ids.
CREATE TABLE IF NOT EXISTS fm.logical_meter_meaning_archive_6949 (
    entity_type VARCHAR(16) NOT NULL,
    entity_id BIGINT NOT NULL,
    payload JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS fm.logical_meter_meaning_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    meter_id BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    role VARCHAR(24) NOT NULL,
    kind_id TEXT,
    change_source VARCHAR(24) NOT NULL,
    source_reference VARCHAR(500),
    changed_by VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT logical_meter_meaning_meter_fk
        FOREIGN KEY (meter_id, organization_id)
        REFERENCES fm.logical_meter (id, organization_id) ON DELETE CASCADE,
    CONSTRAINT logical_meter_meaning_kind_fk
        FOREIGN KEY (kind_id) REFERENCES organization.kind(id)
        ON DELETE RESTRICT,
    CONSTRAINT logical_meter_meaning_revision_uq
        UNIQUE (organization_id, meter_id, revision),
    CONSTRAINT logical_meter_meaning_start_uq
        UNIQUE (organization_id, meter_id, effective_from),
    CONSTRAINT logical_meter_meaning_interval_chk
        CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT logical_meter_meaning_source_chk
        CHECK (change_source IN ('migration', 'logical_meter_save', 'operator_review')),
    CONSTRAINT logical_meter_meaning_role_chk CHECK (
        role IN (
            'grid', 'pv', 'battery', 'generator', 'ev_charge', 'load', 'aux',
            'supply', 'production', 'storage', 'usage'
        )
    )
);

CREATE INDEX IF NOT EXISTS logical_meter_meaning_lookup_idx
    ON fm.logical_meter_meaning_history (
        organization_id, meter_id, effective_from DESC
    );
CREATE INDEX IF NOT EXISTS logical_meter_meaning_interval_idx
    ON fm.logical_meter_meaning_history (
        organization_id, effective_from, effective_to
    );

CREATE OR REPLACE FUNCTION fm.fn_reject_logical_meter_meaning_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM fm.logical_meter_meaning_history existing
         WHERE existing.organization_id = NEW.organization_id
           AND existing.meter_id = NEW.meter_id
           AND existing.id <> NEW.id
           AND tstzrange(
               existing.effective_from, existing.effective_to, '[)'
           ) && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
    ) THEN
        RAISE EXCEPTION 'logical-meter meaning interval overlaps existing history';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS logical_meter_meaning_no_overlap
    ON fm.logical_meter_meaning_history;
CREATE TRIGGER logical_meter_meaning_no_overlap
BEFORE INSERT OR UPDATE OF effective_from, effective_to
ON fm.logical_meter_meaning_history
FOR EACH ROW EXECUTE FUNCTION fm.fn_reject_logical_meter_meaning_overlap();

DO $$
DECLARE
    v_max_id BIGINT;
    v_sequence TEXT;
BEGIN
    SELECT COALESCE(max(entity_id), 0) INTO v_max_id
      FROM fm.logical_meter_meaning_archive_6949
     WHERE entity_type = 'history';
    v_sequence := pg_get_serial_sequence(
        'fm.logical_meter_meaning_history', 'id'
    );
    IF v_max_id > 0 THEN
        PERFORM setval(v_sequence, v_max_id, TRUE);
    END IF;
END;
$$;

INSERT INTO fm.logical_meter_meaning_history (
    organization_id, meter_id, revision, effective_from, effective_to,
    role, kind_id, change_source, source_reference
)
SELECT m.organization_id, m.id, 1, '-infinity'::TIMESTAMPTZ, NULL,
       m.role, m.kind_id, 'migration', '6949 initial logical-meter meaning'
  FROM fm.logical_meter m
 WHERE NOT EXISTS (
    SELECT 1 FROM fm.logical_meter_meaning_history history
     WHERE history.organization_id = m.organization_id
       AND history.meter_id = m.id
 );

-- Preview rows are durable audit evidence. Apply mutates only status/result;
-- the proposed meaning and impact snapshot remain immutable.
CREATE TABLE IF NOT EXISTS fm.logical_meter_meaning_review (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id VARCHAR(120) NOT NULL,
    meter_id BIGINT NOT NULL,
    expected_revision BIGINT NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    proposed_role VARCHAR(24) NOT NULL,
    proposed_kind_id TEXT,
    source_reference VARCHAR(500) NOT NULL,
    current_meaning JSONB NOT NULL,
    impact_snapshot JSONB NOT NULL,
    impact_fingerprint TEXT NOT NULL,
    eligible BOOLEAN NOT NULL,
    ineligibility_reasons JSONB NOT NULL DEFAULT '[]'::JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'previewed',
    requested_by VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_revision BIGINT,
    applied_by VARCHAR(200),
    applied_at TIMESTAMPTZ,
    CONSTRAINT logical_meter_meaning_review_meter_fk
        FOREIGN KEY (meter_id, organization_id)
        REFERENCES fm.logical_meter (id, organization_id) ON DELETE CASCADE,
    CONSTRAINT logical_meter_meaning_review_kind_fk
        FOREIGN KEY (proposed_kind_id) REFERENCES organization.kind(id)
        ON DELETE RESTRICT,
    CONSTRAINT logical_meter_meaning_review_status_chk
        CHECK (status IN ('previewed', 'applied')),
    CONSTRAINT logical_meter_meaning_review_role_chk CHECK (
        proposed_role IN (
            'grid', 'pv', 'battery', 'generator', 'ev_charge', 'load', 'aux',
            'supply', 'production', 'storage', 'usage'
        )
    ),
    CONSTRAINT logical_meter_meaning_review_reference_chk
        CHECK (source_reference = btrim(source_reference) AND source_reference <> '')
);

CREATE INDEX IF NOT EXISTS logical_meter_meaning_review_org_idx
    ON fm.logical_meter_meaning_review (
        organization_id, requested_at DESC, id DESC
    );

DO $$
DECLARE
    v_max_id BIGINT;
    v_sequence TEXT;
BEGIN
    SELECT COALESCE(max(entity_id), 0) INTO v_max_id
      FROM fm.logical_meter_meaning_archive_6949
     WHERE entity_type = 'review';
    v_sequence := pg_get_serial_sequence(
        'fm.logical_meter_meaning_review', 'id'
    );
    IF v_max_id > 0 THEN
        PERFORM setval(v_sequence, v_max_id, TRUE);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_archive_logical_meter_meaning_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fm.logical_meter_meaning_archive_6949 (
        entity_type, entity_id, payload
    )
    SELECT 'review', review.id, to_jsonb(review)
      FROM fm.logical_meter_meaning_review review
     WHERE review.organization_id = OLD.organization_id
       AND review.meter_id = OLD.id
    ON CONFLICT (entity_type, entity_id) DO UPDATE
    SET payload = EXCLUDED.payload, archived_at = now();

    INSERT INTO fm.logical_meter_meaning_archive_6949 (
        entity_type, entity_id, payload
    )
    SELECT 'history', history.id, to_jsonb(history)
      FROM fm.logical_meter_meaning_history history
     WHERE history.organization_id = OLD.organization_id
       AND history.meter_id = OLD.id
    ON CONFLICT (entity_type, entity_id) DO UPDATE
    SET payload = EXCLUDED.payload, archived_at = now();
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS logical_meter_meaning_archive_on_delete
    ON fm.logical_meter;
CREATE TRIGGER logical_meter_meaning_archive_on_delete
BEFORE DELETE ON fm.logical_meter
FOR EACH ROW EXECUTE FUNCTION fm.fn_archive_logical_meter_meaning_before_delete();

CREATE OR REPLACE FUNCTION fm.fn_list_logical_meter_meanings(
    p_org VARCHAR(120),
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS TABLE (
    meter_id BIGINT,
    revision BIGINT,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    role VARCHAR(24),
    kind_id TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT history.meter_id, history.revision, history.effective_from,
           history.effective_to, history.role, history.kind_id
      FROM fm.logical_meter_meaning_history history
     WHERE history.organization_id = p_org
       AND history.effective_from < p_to
       AND (history.effective_to IS NULL OR history.effective_to > p_from)
     ORDER BY history.meter_id, history.effective_from, history.revision
     LIMIT 10001;
$$;

CREATE OR REPLACE FUNCTION fm.fn_list_logical_meters_at(
    p_org VARCHAR(120),
    p_group_id INT DEFAULT NULL,
    p_location_id INT DEFAULT NULL,
    p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
    id BIGINT,
    name VARCHAR(128),
    utility_type VARCHAR(16),
    role VARCHAR(24),
    kind_id TEXT,
    meaning_revision BIGINT,
    meaning_effective_from TIMESTAMPTZ,
    phase_mode VARCHAR(24),
    aggregation_mode VARCHAR(16),
    parent_meter_id BIGINT,
    group_id INT,
    location_id INT,
    cost_center VARCHAR(120),
    virtual_formula JSONB,
    points JSONB
)
LANGUAGE sql STABLE
AS $$
    SELECT m.id, m.name, m.utility_type,
           COALESCE(meaning.role, m.role),
           CASE WHEN meaning.meter_id IS NULL THEN m.kind_id ELSE meaning.kind_id END,
           COALESCE(meaning.revision, 1), meaning.effective_from,
           m.phase_mode, m.aggregation_mode, m.parent_meter_id,
           m.group_id, m.location_id, m.cost_center, m.virtual_formula,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                   'deviceId', point.device,
                   'componentKey', point.component_key,
                   'channel', point.channel,
                   'phase', point.phase,
                   'tag', point.tag,
                   'electricalDomain', point.electrical_domain,
                   'directionHint', point.direction_hint
               ) ORDER BY point.component_key, point.channel, point.phase)
                 FROM fm.logical_meter_point point
                WHERE point.logical_meter_id = m.id
           ), '[]'::JSONB)
      FROM fm.logical_meter m
      LEFT JOIN LATERAL (
          SELECT history.meter_id, history.role, history.kind_id,
                 history.revision, history.effective_from
            FROM fm.logical_meter_meaning_history history
           WHERE history.organization_id = p_org
             AND history.meter_id = m.id
             AND history.effective_from <= p_at
             AND (history.effective_to IS NULL OR history.effective_to > p_at)
           ORDER BY history.effective_from DESC, history.revision DESC
           LIMIT 1
      ) meaning ON TRUE
     WHERE m.organization_id = p_org
       AND (p_group_id IS NULL OR m.group_id = p_group_id)
       AND (p_location_id IS NULL OR m.location_id = p_location_id)
     ORDER BY m.name, m.id;
$$;

-- Keep the rolling-deploy signature while forcing existing role/end-use
-- changes through the persisted preview/apply workflow below.
DO $$
BEGIN
    IF to_regprocedure(
        'fm.fn_save_logical_meter_axes_v6948(bigint,character varying,character varying,character varying,character varying,text,text,character varying,character varying,bigint,integer,integer,character varying,jsonb,jsonb)'
    ) IS NULL THEN
        ALTER FUNCTION fm.fn_save_logical_meter_axes(
            BIGINT, VARCHAR(120), VARCHAR(128), VARCHAR(16), VARCHAR(24),
            TEXT, TEXT, VARCHAR(24), VARCHAR(16), BIGINT, INT, INT,
            VARCHAR(120), JSONB, JSONB
        )
            -- LINT-IGNORE: additive-only
            RENAME TO fn_save_logical_meter_axes_v6948;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_save_logical_meter_axes(
    p_id BIGINT,
    p_org VARCHAR(120),
    p_name VARCHAR(128),
    p_utility_type VARCHAR(16),
    p_role VARCHAR(24),
    p_kind_id TEXT,
    p_energy_source TEXT,
    p_phase_mode VARCHAR(24),
    p_aggregation_mode VARCHAR(16),
    p_parent_meter_id BIGINT,
    p_group_id INT,
    p_location_id INT,
    p_cost_center VARCHAR(120),
    p_virtual_formula JSONB,
    p_points JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
    v_previous_role VARCHAR(24);
    v_previous_kind TEXT;
BEGIN
    IF p_id IS NOT NULL THEN
        SELECT meter.role, meter.kind_id
          INTO v_previous_role, v_previous_kind
          FROM fm.logical_meter meter
         WHERE meter.id = p_id AND meter.organization_id = p_org
         FOR UPDATE;
    END IF;

    v_id := fm.fn_save_logical_meter_axes_v6948(
        p_id, p_org, p_name, p_utility_type, p_role, p_kind_id,
        p_energy_source, p_phase_mode, p_aggregation_mode,
        p_parent_meter_id, p_group_id, p_location_id, p_cost_center,
        p_virtual_formula, p_points
    );

    IF p_id IS NULL THEN
        INSERT INTO fm.logical_meter_meaning_history (
            organization_id, meter_id, revision, effective_from,
            role, kind_id, change_source
        ) VALUES (
            p_org, v_id, 1, '-infinity'::TIMESTAMPTZ,
            p_role, p_kind_id, 'logical_meter_save'
        );
    ELSIF v_previous_role IS DISTINCT FROM p_role
       OR v_previous_kind IS DISTINCT FROM p_kind_id THEN
        RAISE EXCEPTION
            'existing logical-meter meaning requires preview/apply review';
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_apply_logical_meter_meaning_review(
    p_org VARCHAR(120),
    p_review_id BIGINT,
    p_meter_id BIGINT,
    p_expected_revision BIGINT,
    p_impact_fingerprint TEXT,
    p_applied_by VARCHAR(200)
)
RETURNS TABLE (
    preview_id BIGINT,
    meter_id BIGINT,
    revision BIGINT,
    effective_from TIMESTAMPTZ,
    applied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_review fm.logical_meter_meaning_review%ROWTYPE;
    v_cover fm.logical_meter_meaning_history%ROWTYPE;
    v_current_revision BIGINT;
    v_revision BIGINT;
    v_applied_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    SELECT * INTO v_review
      FROM fm.logical_meter_meaning_review review
     WHERE review.id = p_review_id
       AND review.organization_id = p_org
       AND review.meter_id = p_meter_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'logical-meter meaning preview not found';
    END IF;
    IF v_review.status = 'applied' THEN
        RETURN QUERY SELECT v_review.id, v_review.meter_id,
            v_review.applied_revision, v_review.effective_from,
            v_review.applied_at;
        RETURN;
    END IF;
    IF NOT v_review.eligible THEN
        RAISE EXCEPTION 'logical-meter meaning preview is not eligible';
    END IF;
    IF v_review.effective_from > v_applied_at
       OR mod(extract(epoch FROM v_review.effective_from)::BIGINT, 900) <> 0 THEN
        RAISE EXCEPTION 'effectiveFrom must be a completed 15-minute UTC boundary';
    END IF;
    IF v_review.expected_revision <> p_expected_revision
       OR v_review.impact_fingerprint <> p_impact_fingerprint THEN
        RAISE EXCEPTION 'logical-meter meaning preview changed; preview again';
    END IF;

    PERFORM 1 FROM fm.logical_meter meter
     WHERE meter.id = p_meter_id AND meter.organization_id = p_org
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'logical meter not found for organization';
    END IF;

    SELECT max(history.revision) INTO v_current_revision
      FROM fm.logical_meter_meaning_history history
     WHERE history.organization_id = p_org AND history.meter_id = p_meter_id;
    IF v_current_revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'logical-meter meaning revision changed; preview again';
    END IF;

    SELECT * INTO v_cover
      FROM fm.logical_meter_meaning_history history
     WHERE history.organization_id = p_org
       AND history.meter_id = p_meter_id
       AND history.effective_from < v_review.effective_from
       AND (history.effective_to IS NULL
            OR history.effective_to > v_review.effective_from)
     ORDER BY history.effective_from DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'effectiveFrom must fall inside an existing interval';
    END IF;

    v_revision := v_current_revision + 1;
    UPDATE fm.logical_meter_meaning_history
       SET effective_to = v_review.effective_from
     WHERE id = v_cover.id;
    INSERT INTO fm.logical_meter_meaning_history (
        organization_id, meter_id, revision, effective_from, effective_to,
        role, kind_id, change_source, source_reference, changed_by
    ) VALUES (
        p_org, p_meter_id, v_revision, v_review.effective_from,
        v_cover.effective_to, v_review.proposed_role,
        v_review.proposed_kind_id, 'operator_review',
        v_review.source_reference, p_applied_by
    );

    -- A backdated correction may end before now. Keep compatibility columns
    -- on the meaning effective now, not blindly on the inserted old interval.
    UPDATE fm.logical_meter meter
       SET role = active.role,
           kind_id = active.kind_id,
           updated_at = v_applied_at
      FROM (
          SELECT history.role, history.kind_id
            FROM fm.logical_meter_meaning_history history
           WHERE history.organization_id = p_org
             AND history.meter_id = p_meter_id
             AND history.effective_from <= v_applied_at
             AND (history.effective_to IS NULL
                  OR history.effective_to > v_applied_at)
           ORDER BY history.effective_from DESC
           LIMIT 1
      ) active
     WHERE meter.id = p_meter_id AND meter.organization_id = p_org;
    UPDATE fm.logical_meter_meaning_review
       SET status = 'applied', applied_revision = v_revision,
           applied_by = p_applied_by, applied_at = v_applied_at
     WHERE id = p_review_id;

    RETURN QUERY SELECT p_review_id, p_meter_id, v_revision,
        v_review.effective_from, v_applied_at;
END;
$$;

--------------DOWN
INSERT INTO fm.logical_meter_meaning_archive_6949 (
    entity_type, entity_id, payload
)
SELECT 'review', review.id, to_jsonb(review)
  FROM fm.logical_meter_meaning_review review
ON CONFLICT (entity_type, entity_id) DO UPDATE
SET payload = EXCLUDED.payload, archived_at = now();

INSERT INTO fm.logical_meter_meaning_archive_6949 (
    entity_type, entity_id, payload
)
SELECT 'history', history.id, to_jsonb(history)
  FROM fm.logical_meter_meaning_history history
ON CONFLICT (entity_type, entity_id) DO UPDATE
SET payload = EXCLUDED.payload, archived_at = now();

DROP FUNCTION IF EXISTS fm.fn_apply_logical_meter_meaning_review(
    VARCHAR(120), BIGINT, BIGINT, BIGINT, TEXT, VARCHAR(200)
);
DROP FUNCTION IF EXISTS fm.fn_list_logical_meter_meanings(
    VARCHAR(120), TIMESTAMPTZ, TIMESTAMPTZ
);
DROP FUNCTION IF EXISTS fm.fn_list_logical_meters_at(
    VARCHAR(120), INT, INT, TIMESTAMPTZ
);
DROP FUNCTION IF EXISTS fm.fn_save_logical_meter_axes(
    BIGINT, VARCHAR(120), VARCHAR(128), VARCHAR(16), VARCHAR(24), TEXT, TEXT,
    VARCHAR(24), VARCHAR(16), BIGINT, INT, INT, VARCHAR(120), JSONB, JSONB
);
ALTER FUNCTION fm.fn_save_logical_meter_axes_v6948(
    BIGINT, VARCHAR(120), VARCHAR(128), VARCHAR(16), VARCHAR(24), TEXT, TEXT,
    VARCHAR(24), VARCHAR(16), BIGINT, INT, INT, VARCHAR(120), JSONB, JSONB
)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_save_logical_meter_axes;

DROP TRIGGER IF EXISTS logical_meter_meaning_archive_on_delete
    ON fm.logical_meter;
DROP FUNCTION IF EXISTS fm.fn_archive_logical_meter_meaning_before_delete();
DROP TABLE IF EXISTS fm.logical_meter_meaning_review;
DROP TABLE IF EXISTS fm.logical_meter_meaning_history;
DROP FUNCTION IF EXISTS fm.fn_reject_logical_meter_meaning_overlap();
