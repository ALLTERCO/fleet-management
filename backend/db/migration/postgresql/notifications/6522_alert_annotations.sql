--------------UP
-- Annotation thread per alert instance. Operators add free-form notes
-- during incident response.

CREATE TABLE IF NOT EXISTS notifications.alert_annotations (
    id                BIGSERIAL    PRIMARY KEY,
    alert_instance_id INTEGER      NOT NULL REFERENCES notifications.alert_instances(id) ON DELETE CASCADE,
    organization_id   VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    author_user_id    VARCHAR(255) NOT NULL,
    body              VARCHAR(2000) NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    edited_at         TIMESTAMPTZ,
    CONSTRAINT alert_annotations_body_nonempty CHECK (LENGTH(TRIM(body)) > 0)
);

CREATE INDEX IF NOT EXISTS alert_annotations_alert_idx
    ON notifications.alert_annotations (alert_instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_annotations_author_idx
    ON notifications.alert_annotations (organization_id, author_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION notifications.fn_alert_annotation_append(
    p_organization_id    VARCHAR,
    p_alert_instance_id  INTEGER,
    p_author_user_id     VARCHAR,
    p_body               VARCHAR
)
RETURNS TABLE (
    id                BIGINT,
    alert_instance_id INTEGER,
    organization_id   VARCHAR,
    author_user_id    VARCHAR,
    body              VARCHAR,
    created_at        TIMESTAMPTZ,
    edited_at         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.alert_annotations
        (alert_instance_id, organization_id, author_user_id, body)
    SELECT p_alert_instance_id, p_organization_id, p_author_user_id, p_body
    WHERE EXISTS (
        SELECT 1 FROM notifications.alert_instances ai
        WHERE ai.id = p_alert_instance_id
          AND ai.organization_id = p_organization_id
    )
    RETURNING
        id, alert_instance_id, organization_id, author_user_id, body,
        created_at, edited_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_annotation_list(
    p_organization_id    VARCHAR,
    p_alert_instance_id  INTEGER
)
RETURNS TABLE (
    id                BIGINT,
    alert_instance_id INTEGER,
    organization_id   VARCHAR,
    author_user_id    VARCHAR,
    body              VARCHAR,
    created_at        TIMESTAMPTZ,
    edited_at         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        a.id, a.alert_instance_id, a.organization_id, a.author_user_id,
        a.body, a.created_at, a.edited_at
    FROM notifications.alert_annotations a
    WHERE a.organization_id = p_organization_id
      AND a.alert_instance_id = p_alert_instance_id
    ORDER BY a.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_annotation_edit(
    p_organization_id VARCHAR,
    p_id              BIGINT,
    p_author_user_id  VARCHAR,
    p_body            VARCHAR
)
RETURNS TABLE (
    id                BIGINT,
    alert_instance_id INTEGER,
    organization_id   VARCHAR,
    author_user_id    VARCHAR,
    body              VARCHAR,
    created_at        TIMESTAMPTZ,
    edited_at         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE notifications.alert_annotations a
       SET body      = p_body,
           edited_at = NOW()
     WHERE a.id = p_id
       AND a.organization_id = p_organization_id
       AND a.author_user_id  = p_author_user_id
    RETURNING
        a.id, a.alert_instance_id, a.organization_id, a.author_user_id,
        a.body, a.created_at, a.edited_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_annotation_delete(
    p_organization_id VARCHAR,
    p_id              BIGINT,
    p_author_user_id  VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM notifications.alert_annotations a
         WHERE a.id = p_id
           AND a.organization_id = p_organization_id
           AND a.author_user_id  = p_author_user_id
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_delete(VARCHAR, BIGINT, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_edit(VARCHAR, BIGINT, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_list(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_append(VARCHAR, INTEGER, VARCHAR, VARCHAR);
DROP TABLE IF EXISTS notifications.alert_annotations;
