--------------UP
-- 7358 cannot represent non-electric tariffs after DOWN and therefore deletes
-- them. This archive is intentionally independent of tariff foreign keys and
-- survives this migration's DOWN so an operator can recover the exact graph
-- after 7358 is applied again. Nothing in this migration relabels commodity.
CREATE TABLE IF NOT EXISTS organization.tariff_commodity_rollback_archive_7363 (
    organization_id VARCHAR(120) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    row_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, kind, row_key),
    CONSTRAINT tariff_commodity_archive_kind_chk CHECK (kind IN (
        'tariff', 'season', 'window', 'live_source', 'import_assignment',
        'export_assignment', 'price_component'
    ))
);

COMMENT ON TABLE organization.tariff_commodity_rollback_archive_7363 IS
    'Persistent exact-row recovery archive for non-electric tariffs deleted by 7358 DOWN. Inspect status and explicitly restore per organization; never relabel archived rows.';

CREATE OR REPLACE FUNCTION organization.fn_tariff_commodity_rollback_status(
    p_org VARCHAR DEFAULT NULL
)
RETURNS TABLE (kind VARCHAR, archived_rows BIGINT)
LANGUAGE sql STABLE
AS $$
    SELECT archive.kind, count(*)::BIGINT
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     WHERE p_org IS NULL OR archive.organization_id = p_org
     GROUP BY archive.kind
     ORDER BY archive.kind;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_commodity_rollback_archive_row(
    p_org VARCHAR,
    p_kind VARCHAR,
    p_row_key TEXT,
    p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO organization.tariff_commodity_rollback_archive_7363 (
        organization_id, kind, row_key, payload
    ) VALUES (p_org, p_kind, p_row_key, p_payload)
    ON CONFLICT (organization_id, kind, row_key) DO UPDATE SET
        archived_at = now()
    WHERE organization.tariff_commodity_rollback_archive_7363.payload =
          EXCLUDED.payload;

    -- A retained conflict is recovery evidence from an earlier rollback. ID
    -- reuse must stop this rollback, never replace that evidence silently.
    IF NOT FOUND THEN
        RAISE EXCEPTION
            'tariff rollback archive conflict for organization %, kind %, row %; resolve the pending archive before retrying',
            p_org, p_kind, p_row_key;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_commodity_rollback_prepare(
    p_org VARCHAR DEFAULT NULL
)
RETURNS TABLE (kind VARCHAR, archived_rows BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        tariff.organization_id, 'window', tariff_window_row.id::TEXT,
        to_jsonb(tariff_window_row)
    )
      FROM organization.tariff_window tariff_window_row
      JOIN organization.tariff_season season
        ON season.id = tariff_window_row.season_id
      JOIN organization.tariff tariff ON tariff.id = season.tariff_id
     WHERE tariff.commodity <> 'electricity'
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        tariff.organization_id, 'season', season.id::TEXT, to_jsonb(season)
    )
      FROM organization.tariff_season season
      JOIN organization.tariff tariff ON tariff.id = season.tariff_id
     WHERE tariff.commodity <> 'electricity'
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        tariff.organization_id, 'live_source', source.tariff_id::TEXT,
        to_jsonb(source)
    )
      FROM organization.tariff_live_source source
      JOIN organization.tariff tariff ON tariff.id = source.tariff_id
     WHERE tariff.commodity <> 'electricity'
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        assignment.organization_id, 'import_assignment', assignment.id::TEXT,
        to_jsonb(assignment)
    )
      FROM organization.tariff_assignment assignment
      JOIN organization.tariff tariff ON tariff.id = assignment.tariff_id
     WHERE tariff.commodity <> 'electricity'
       AND tariff.organization_id = assignment.organization_id
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        assignment.organization_id, 'export_assignment', assignment.id::TEXT,
        to_jsonb(assignment)
    )
      FROM organization.tariff_export_assignment assignment
      JOIN organization.tariff tariff ON tariff.id = assignment.tariff_id
     WHERE tariff.commodity <> 'electricity'
       AND tariff.organization_id = assignment.organization_id
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        component.organization_id, 'price_component', component.id::TEXT,
        to_jsonb(component)
    )
      FROM organization.tariff_price_component component
      JOIN organization.tariff tariff ON tariff.id = component.tariff_id
     WHERE tariff.commodity <> 'electricity'
       AND tariff.organization_id = component.organization_id
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    PERFORM organization.fn_tariff_commodity_rollback_archive_row(
        tariff.organization_id, 'tariff', tariff.id::TEXT, to_jsonb(tariff)
    )
      FROM organization.tariff tariff
     WHERE tariff.commodity <> 'electricity'
       AND (p_org IS NULL OR tariff.organization_id = p_org);

    RETURN QUERY
        SELECT status.kind, status.archived_rows
          FROM organization.fn_tariff_commodity_rollback_status(p_org) status;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_tariff_commodity_rollback_restore(
    p_org VARCHAR
)
RETURNS TABLE (kind VARCHAR, pending_rows BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_org IS NULL OR btrim(p_org) = '' THEN
        RAISE EXCEPTION 'an explicit organization id is required for tariff recovery';
    END IF;

    INSERT INTO organization.tariff OVERRIDING SYSTEM VALUE
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
      JOIN organization.profile profile ON profile.id = archive.organization_id
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff, archive.payload
     ) restored
     WHERE archive.organization_id = p_org AND archive.kind = 'tariff'
    ON CONFLICT DO NOTHING;

    INSERT INTO organization.tariff_season OVERRIDING SYSTEM VALUE
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff_season, archive.payload
     ) restored
      JOIN organization.tariff tariff ON tariff.id = restored.tariff_id
       AND tariff.organization_id = archive.organization_id
     WHERE archive.organization_id = p_org AND archive.kind = 'season'
    ON CONFLICT DO NOTHING;

    INSERT INTO organization.tariff_window OVERRIDING SYSTEM VALUE
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff_window, archive.payload
     ) restored
      JOIN organization.tariff_season season ON season.id = restored.season_id
      JOIN organization.tariff tariff ON tariff.id = season.tariff_id
       AND tariff.organization_id = archive.organization_id
     WHERE archive.organization_id = p_org AND archive.kind = 'window'
    ON CONFLICT DO NOTHING;

    INSERT INTO organization.tariff_live_source
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff_live_source, archive.payload
     ) restored
      JOIN organization.tariff tariff ON tariff.id = restored.tariff_id
       AND tariff.organization_id = archive.organization_id
     WHERE archive.organization_id = p_org AND archive.kind = 'live_source'
    ON CONFLICT DO NOTHING;

    INSERT INTO organization.tariff_assignment OVERRIDING SYSTEM VALUE
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff_assignment, archive.payload
     ) restored
      JOIN organization.tariff tariff
        ON tariff.id = restored.tariff_id
       AND tariff.organization_id = archive.organization_id
     WHERE archive.organization_id = p_org
       AND archive.kind = 'import_assignment'
    ON CONFLICT DO NOTHING;

    INSERT INTO organization.tariff_export_assignment OVERRIDING SYSTEM VALUE
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff_export_assignment, archive.payload
     ) restored
      JOIN organization.tariff tariff
        ON tariff.id = restored.tariff_id
       AND tariff.organization_id = archive.organization_id
     WHERE archive.organization_id = p_org
       AND archive.kind = 'export_assignment'
    ON CONFLICT DO NOTHING;

    INSERT INTO organization.tariff_price_component OVERRIDING SYSTEM VALUE
    SELECT (restored).*
      FROM organization.tariff_commodity_rollback_archive_7363 archive
     CROSS JOIN LATERAL jsonb_populate_record(
        NULL::organization.tariff_price_component, archive.payload
     ) restored
      JOIN organization.tariff tariff
        ON tariff.id = restored.tariff_id
       AND tariff.organization_id = archive.organization_id
     WHERE archive.organization_id = p_org
       AND archive.kind = 'price_component'
    ON CONFLICT DO NOTHING;

    PERFORM setval(
        pg_get_serial_sequence('organization.tariff', 'id'),
        COALESCE((SELECT max(id) FROM organization.tariff), 1),
        EXISTS (SELECT 1 FROM organization.tariff)
    );
    PERFORM setval(
        pg_get_serial_sequence('organization.tariff_season', 'id'),
        COALESCE((SELECT max(id) FROM organization.tariff_season), 1),
        EXISTS (SELECT 1 FROM organization.tariff_season)
    );
    PERFORM setval(
        pg_get_serial_sequence('organization.tariff_window', 'id'),
        COALESCE((SELECT max(id) FROM organization.tariff_window), 1),
        EXISTS (SELECT 1 FROM organization.tariff_window)
    );
    PERFORM setval(
        pg_get_serial_sequence('organization.tariff_assignment', 'id'),
        COALESCE((SELECT max(id) FROM organization.tariff_assignment), 1),
        EXISTS (SELECT 1 FROM organization.tariff_assignment)
    );
    PERFORM setval(
        pg_get_serial_sequence('organization.tariff_export_assignment', 'id'),
        COALESCE((SELECT max(id) FROM organization.tariff_export_assignment), 1),
        EXISTS (SELECT 1 FROM organization.tariff_export_assignment)
    );
    PERFORM setval(
        pg_get_serial_sequence('organization.tariff_price_component', 'id'),
        COALESCE((SELECT max(id) FROM organization.tariff_price_component), 1),
        EXISTS (SELECT 1 FROM organization.tariff_price_component)
    );

    -- Remove only byte-for-byte compatible records. A conflicting ID or
    -- altered row remains visible as pending operator work.
    DELETE FROM organization.tariff_commodity_rollback_archive_7363 archive
     WHERE archive.organization_id = p_org
       AND (
        (archive.kind = 'tariff' AND EXISTS (
            SELECT 1 FROM organization.tariff row
             WHERE row.id = (archive.payload->>'id')::INTEGER
               AND row.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        )) OR (archive.kind = 'season' AND EXISTS (
            SELECT 1 FROM organization.tariff_season row
              JOIN organization.tariff tariff ON tariff.id = row.tariff_id
             WHERE row.id = (archive.payload->>'id')::INTEGER
               AND tariff.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        )) OR (archive.kind = 'window' AND EXISTS (
            SELECT 1 FROM organization.tariff_window row
              JOIN organization.tariff_season season ON season.id = row.season_id
              JOIN organization.tariff tariff ON tariff.id = season.tariff_id
             WHERE row.id = (archive.payload->>'id')::INTEGER
               AND tariff.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        )) OR (archive.kind = 'live_source' AND EXISTS (
            SELECT 1 FROM organization.tariff_live_source row
              JOIN organization.tariff tariff ON tariff.id = row.tariff_id
             WHERE row.tariff_id = (archive.payload->>'tariff_id')::INTEGER
               AND tariff.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        )) OR (archive.kind = 'import_assignment' AND EXISTS (
            SELECT 1 FROM organization.tariff_assignment row
             WHERE row.id = (archive.payload->>'id')::INTEGER
               AND row.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        )) OR (archive.kind = 'export_assignment' AND EXISTS (
            SELECT 1 FROM organization.tariff_export_assignment row
             WHERE row.id = (archive.payload->>'id')::INTEGER
               AND row.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        )) OR (archive.kind = 'price_component' AND EXISTS (
            SELECT 1 FROM organization.tariff_price_component row
             WHERE row.id = (archive.payload->>'id')::BIGINT
               AND row.organization_id = archive.organization_id
               AND to_jsonb(row) @> archive.payload
        ))
       );

    RETURN QUERY
        SELECT archive.kind, count(*)::BIGINT
          FROM organization.tariff_commodity_rollback_archive_7363 archive
         WHERE archive.organization_id = p_org
         GROUP BY archive.kind
         ORDER BY archive.kind;
END;
$$;

--------------DOWN
-- Archive before 7358 DOWN deletes non-electric tariffs. The archive table is
-- deliberately retained across DOWN; dropping it here would defeat recovery.
SELECT organization.fn_tariff_commodity_rollback_prepare(NULL);

-- LINT-IGNORE: additive-only -- exact rows remain in the persistent archive.
DROP FUNCTION IF EXISTS organization.fn_tariff_commodity_rollback_restore(VARCHAR);
-- LINT-IGNORE: additive-only -- exact rows remain in the persistent archive.
DROP FUNCTION IF EXISTS organization.fn_tariff_commodity_rollback_prepare(VARCHAR);
-- LINT-IGNORE: additive-only -- exact rows remain in the persistent archive.
DROP FUNCTION IF EXISTS organization.fn_tariff_commodity_rollback_archive_row(VARCHAR, VARCHAR, TEXT, JSONB);
-- LINT-IGNORE: additive-only -- exact rows remain in the persistent archive.
DROP FUNCTION IF EXISTS organization.fn_tariff_commodity_rollback_status(VARCHAR);
