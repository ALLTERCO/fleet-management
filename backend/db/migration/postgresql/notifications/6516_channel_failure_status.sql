--------------UP
ALTER TABLE notifications.channels
    ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_failure_message TEXT;

DROP FUNCTION IF EXISTS notifications.fn_channel_list(VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION notifications.fn_channel_list(
    p_organization_id VARCHAR,
    p_type            VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id INTEGER,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    last_failure_at         TIMESTAMPTZ,
    last_failure_message    TEXT,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        id,
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        secret_version,
        verification_status,
        disabled_reason,
        last_delivery_status,
        last_delivery_at,
        last_failure_at,
        last_failure_message,
        created_at,
        updated_at
    FROM notifications.channels
    WHERE organization_id = p_organization_id
      AND (p_type IS NULL OR type = p_type)
    ORDER BY LOWER(name), id;
$$;

DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(
    VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB, INTEGER
);
CREATE OR REPLACE FUNCTION notifications.fn_channel_upsert(
    p_organization_id         VARCHAR,
    p_channel_id              BIGINT DEFAULT NULL,
    p_name                    VARCHAR DEFAULT NULL,
    p_type                    VARCHAR DEFAULT NULL,
    p_config                  JSONB DEFAULT '{}'::jsonb,
    p_integration_endpoint_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id INTEGER,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    last_failure_at         TIMESTAMPTZ,
    last_failure_message    TEXT,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_integration_endpoint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM notifications.integration_endpoints e
        WHERE e.id = p_integration_endpoint_id
          AND e.organization_id = p_organization_id
          AND e.provider = p_type
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'integration endpoint not found for channel';
    END IF;

    IF p_channel_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.channels
        SET
            integration_endpoint_id = p_integration_endpoint_id,
            name                    = COALESCE(p_name, channels.name),
            type                    = COALESCE(p_type, channels.type),
            config                  = COALESCE(p_config, channels.config),
            updated_at              = NOW()
        WHERE organization_id = p_organization_id
          AND id = p_channel_id
        RETURNING
            channels.id,
            channels.organization_id,
            channels.integration_endpoint_id,
            channels.name,
            channels.type,
            channels.config,
            channels.secret_version,
            channels.verification_status,
            channels.disabled_reason,
            channels.last_delivery_status,
            channels.last_delivery_at,
            channels.last_failure_at,
            channels.last_failure_message,
            channels.created_at,
            channels.updated_at;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO notifications.channels (
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_integration_endpoint_id,
        p_name,
        p_type,
        COALESCE(p_config, '{}'::jsonb),
        NOW()
    )
    RETURNING
        channels.id,
        channels.organization_id,
        channels.integration_endpoint_id,
        channels.name,
        channels.type,
        channels.config,
        channels.secret_version,
        channels.verification_status,
        channels.disabled_reason,
        channels.last_delivery_status,
        channels.last_delivery_at,
        channels.last_failure_at,
        channels.last_failure_message,
        channels.created_at,
        channels.updated_at;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_channel_record_test_result(
    VARCHAR, BIGINT, VARCHAR, BOOLEAN
);
CREATE OR REPLACE FUNCTION notifications.fn_channel_record_test_result(
    p_organization_id      VARCHAR,
    p_channel_id           BIGINT,
    p_status               VARCHAR,
    p_sent                 BOOLEAN,
    p_last_failure_message TEXT DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id BIGINT,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    last_failure_at         TIMESTAMPTZ,
    last_failure_message    TEXT,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_status NOT IN ('success', 'failed') THEN
        RAISE EXCEPTION 'invalid channel test status'
            USING ERRCODE = '22023', DETAIL = 'ValidationFailed';
    END IF;

    RETURN QUERY
    UPDATE notifications.channels c
    SET verification_status = CASE
            WHEN p_status = 'success' THEN 'verified'
            ELSE 'failed'
        END,
        last_delivery_status = CASE
            WHEN p_sent THEN p_status
            ELSE c.last_delivery_status
        END,
        last_delivery_at = CASE
            WHEN p_sent THEN NOW()
            ELSE c.last_delivery_at
        END,
        last_failure_at = CASE
            WHEN p_status = 'failed' THEN NOW()
            ELSE NULL
        END,
        last_failure_message = CASE
            WHEN p_status = 'failed' THEN p_last_failure_message
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE c.organization_id = p_organization_id
      AND c.id = p_channel_id
    RETURNING
        c.id,
        c.organization_id,
        c.integration_endpoint_id,
        c.name,
        c.type,
        c.config,
        c.secret_version,
        c.verification_status,
        c.disabled_reason,
        c.last_delivery_status,
        c.last_delivery_at,
        c.last_failure_at,
        c.last_failure_message,
        c.created_at,
        c.updated_at;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_channel_record_test_result(
    VARCHAR, BIGINT, VARCHAR, BOOLEAN, TEXT
);
DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(
    VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_channel_list(VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION notifications.fn_channel_list(
    p_organization_id VARCHAR,
    p_type            VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id INTEGER,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        id,
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        secret_version,
        verification_status,
        disabled_reason,
        last_delivery_status,
        last_delivery_at,
        created_at,
        updated_at
    FROM notifications.channels
    WHERE organization_id = p_organization_id
      AND (p_type IS NULL OR type = p_type)
    ORDER BY LOWER(name), id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_upsert(
    p_organization_id         VARCHAR,
    p_channel_id              BIGINT DEFAULT NULL,
    p_name                    VARCHAR DEFAULT NULL,
    p_type                    VARCHAR DEFAULT NULL,
    p_config                  JSONB DEFAULT '{}'::jsonb,
    p_integration_endpoint_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id INTEGER,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_integration_endpoint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM notifications.integration_endpoints e
        WHERE e.id = p_integration_endpoint_id
          AND e.organization_id = p_organization_id
          AND e.provider = p_type
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'integration endpoint not found for channel';
    END IF;

    IF p_channel_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.channels
        SET
            integration_endpoint_id = p_integration_endpoint_id,
            name                    = COALESCE(p_name, channels.name),
            type                    = COALESCE(p_type, channels.type),
            config                  = COALESCE(p_config, channels.config),
            updated_at              = NOW()
        WHERE organization_id = p_organization_id
          AND id = p_channel_id
        RETURNING
            channels.id,
            channels.organization_id,
            channels.integration_endpoint_id,
            channels.name,
            channels.type,
            channels.config,
            channels.secret_version,
            channels.verification_status,
            channels.disabled_reason,
            channels.last_delivery_status,
            channels.last_delivery_at,
            channels.created_at,
            channels.updated_at;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO notifications.channels (
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_integration_endpoint_id,
        p_name,
        p_type,
        COALESCE(p_config, '{}'::jsonb),
        NOW()
    )
    RETURNING
        channels.id,
        channels.organization_id,
        channels.integration_endpoint_id,
        channels.name,
        channels.type,
        channels.config,
        channels.secret_version,
        channels.verification_status,
        channels.disabled_reason,
        channels.last_delivery_status,
        channels.last_delivery_at,
        channels.created_at,
        channels.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_record_test_result(
    p_organization_id VARCHAR,
    p_channel_id      BIGINT,
    p_status          VARCHAR,
    p_sent            BOOLEAN
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id BIGINT,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_status NOT IN ('success', 'failed') THEN
        RAISE EXCEPTION 'invalid channel test status'
            USING ERRCODE = '22023', DETAIL = 'ValidationFailed';
    END IF;

    RETURN QUERY
    UPDATE notifications.channels c
    SET verification_status = CASE
            WHEN p_status = 'success' THEN 'verified'
            ELSE 'failed'
        END,
        last_delivery_status = CASE
            WHEN p_sent THEN p_status
            ELSE c.last_delivery_status
        END,
        last_delivery_at = CASE
            WHEN p_sent THEN NOW()
            ELSE c.last_delivery_at
        END,
        updated_at = NOW()
    WHERE c.organization_id = p_organization_id
      AND c.id = p_channel_id
    RETURNING
        c.id,
        c.organization_id,
        c.integration_endpoint_id,
        c.name,
        c.type,
        c.config,
        c.secret_version,
        c.verification_status,
        c.disabled_reason,
        c.last_delivery_status,
        c.last_delivery_at,
        c.created_at,
        c.updated_at;
END;
$$;

ALTER TABLE notifications.channels
    DROP COLUMN IF EXISTS last_failure_message,
    DROP COLUMN IF EXISTS last_failure_at;
