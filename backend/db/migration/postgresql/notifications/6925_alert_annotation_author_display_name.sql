--------------UP
-- Snapshot the author's name at write time; frozen against a later rename.
ALTER TABLE notifications.alert_annotations
    ADD COLUMN IF NOT EXISTS author_display_name VARCHAR(255);

-- DROP first: CREATE OR REPLACE can't change a signature.
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_append(
    VARCHAR, INTEGER, VARCHAR, VARCHAR
);
CREATE FUNCTION notifications.fn_alert_annotation_append(
    p_organization_id     VARCHAR,
    p_alert_instance_id   INTEGER,
    p_author_user_id      VARCHAR,
    p_author_display_name VARCHAR,
    p_body                VARCHAR
)
RETURNS TABLE (
    id                   BIGINT,
    alert_instance_id    INTEGER,
    organization_id      VARCHAR,
    author_user_id       VARCHAR,
    author_display_name  VARCHAR,
    body                 VARCHAR,
    created_at           TIMESTAMPTZ,
    edited_at            TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.alert_annotations
        (alert_instance_id, organization_id, author_user_id,
         author_display_name, body)
    SELECT p_alert_instance_id, p_organization_id, p_author_user_id,
           p_author_display_name, p_body
    WHERE EXISTS (
        SELECT 1 FROM notifications.alert_instances ai
        WHERE ai.id = p_alert_instance_id
          AND ai.organization_id = p_organization_id
    )
    RETURNING
        id, alert_instance_id, organization_id, author_user_id,
        author_display_name, body, created_at, edited_at;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_list(
    VARCHAR, INTEGER
);
CREATE FUNCTION notifications.fn_alert_annotation_list(
    p_organization_id    VARCHAR,
    p_alert_instance_id  INTEGER
)
RETURNS TABLE (
    id                   BIGINT,
    alert_instance_id    INTEGER,
    organization_id      VARCHAR,
    author_user_id       VARCHAR,
    author_display_name  VARCHAR,
    body                 VARCHAR,
    created_at           TIMESTAMPTZ,
    edited_at            TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        a.id, a.alert_instance_id, a.organization_id, a.author_user_id,
        a.author_display_name, a.body, a.created_at, a.edited_at
    FROM notifications.alert_annotations a
    WHERE a.organization_id = p_organization_id
      AND a.alert_instance_id = p_alert_instance_id
    ORDER BY a.created_at ASC;
$$;

-- Edit keeps the original snapshot; only body/edited_at change.
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_edit(
    VARCHAR, BIGINT, VARCHAR, VARCHAR
);
CREATE FUNCTION notifications.fn_alert_annotation_edit(
    p_organization_id VARCHAR,
    p_id              BIGINT,
    p_author_user_id  VARCHAR,
    p_body            VARCHAR
)
RETURNS TABLE (
    id                   BIGINT,
    alert_instance_id    INTEGER,
    organization_id      VARCHAR,
    author_user_id       VARCHAR,
    author_display_name  VARCHAR,
    body                 VARCHAR,
    created_at           TIMESTAMPTZ,
    edited_at            TIMESTAMPTZ
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
        a.author_display_name, a.body, a.created_at, a.edited_at;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_edit(
    VARCHAR, BIGINT, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_list(
    VARCHAR, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_alert_annotation_append(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR
);

CREATE FUNCTION notifications.fn_alert_annotation_append(
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

CREATE FUNCTION notifications.fn_alert_annotation_list(
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

CREATE FUNCTION notifications.fn_alert_annotation_edit(
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

ALTER TABLE notifications.alert_annotations
    DROP COLUMN IF EXISTS author_display_name;
