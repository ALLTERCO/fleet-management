--------------UP
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
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_channel_record_test_result(VARCHAR, BIGINT, VARCHAR, BOOLEAN);
