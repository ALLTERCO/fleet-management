--------------UP
CREATE TABLE IF NOT EXISTS fm.scoped_automation_invocation (
    automation_id UUID NOT NULL REFERENCES fm.scoped_automation(id)
        ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    invocation_id VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    result_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (automation_id, token_hash, invocation_id),
    CONSTRAINT scoped_automation_invocation_id_chk
        CHECK (length(invocation_id) > 0),
    CONSTRAINT scoped_automation_invocation_status_chk
        CHECK (status IN ('pending', 'completed', 'denied')),
    CONSTRAINT scoped_automation_invocation_result_chk CHECK (
        (status = 'pending' AND result_json IS NULL AND completed_at IS NULL)
        OR
        (status IN ('completed', 'denied') AND result_json IS NOT NULL
            AND completed_at IS NOT NULL)
    )
);

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_invocation_claim(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_token_hash CHAR(64),
    p_invocation_id VARCHAR(128)
)
RETURNS TABLE (status TEXT, automation_json JSONB, result_json JSONB)
LANGUAGE plpgsql
AS $$
DECLARE
    v_automation fm.scoped_automation%ROWTYPE;
    v_receipt fm.scoped_automation_invocation%ROWTYPE;
    v_automation_json JSONB;
BEGIN
    SELECT * INTO v_automation
      FROM fm.scoped_automation a
     WHERE a.id = p_id
     FOR UPDATE;

    IF NOT FOUND
       OR v_automation.tenant_id IS DISTINCT FROM p_tenant_id
       OR v_automation.token_hash IS DISTINCT FROM p_token_hash
       OR v_automation.deployment_state <> 'active' THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::JSONB, NULL::JSONB;
        RETURN;
    END IF;

    v_automation_json := jsonb_build_object(
        'id', v_automation.id,
        'name', v_automation.name,
        'device_ids', v_automation.device_ids,
        'schedule_json', v_automation.schedule_json,
        'method', v_automation.method,
        'params_json', v_automation.params_json,
        'deployment_state', v_automation.deployment_state,
        'execution_state', v_automation.execution_state,
        'revision', v_automation.revision,
        'flow_id', v_automation.flow_id,
        'authority_json', v_automation.authority_json,
        'created_at', v_automation.created_at,
        'updated_at', v_automation.updated_at
    );

    SELECT * INTO v_receipt
      FROM fm.scoped_automation_invocation i
     WHERE i.automation_id = p_id
       AND i.token_hash = p_token_hash
       AND i.invocation_id = p_invocation_id;

    IF FOUND THEN
        IF v_receipt.status = 'completed' THEN
            RETURN QUERY SELECT 'completed'::TEXT, v_automation_json,
                                v_receipt.result_json;
        ELSIF v_receipt.status = 'denied' THEN
            RETURN QUERY SELECT 'denied'::TEXT, v_automation_json, NULL::JSONB;
        ELSE
            RETURN QUERY SELECT 'busy'::TEXT, NULL::JSONB, NULL::JSONB;
        END IF;
        RETURN;
    END IF;

    IF v_automation.execution_state <> 'idle' THEN
        RETURN QUERY SELECT 'busy'::TEXT, NULL::JSONB, NULL::JSONB;
        RETURN;
    END IF;

    INSERT INTO fm.scoped_automation_invocation (
        automation_id, token_hash, invocation_id
    ) VALUES (p_id, p_token_hash, p_invocation_id);

    UPDATE fm.scoped_automation a
       SET execution_state = 'unknown', updated_at = now()
     WHERE a.id = p_id;

    v_automation_json := jsonb_set(
        jsonb_set(v_automation_json, '{execution_state}', '"unknown"'),
        '{updated_at}', to_jsonb(now())
    );
    RETURN QUERY SELECT 'claimed'::TEXT, v_automation_json, NULL::JSONB;
END;
$$;

CREATE OR REPLACE FUNCTION fm.fn_scoped_automation_invocation_finish(
    p_id UUID,
    p_tenant_id VARCHAR(120),
    p_token_hash CHAR(64),
    p_invocation_id VARCHAR(128),
    p_result JSONB,
    p_denied BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_changed BIGINT;
BEGIN
    PERFORM 1
      FROM fm.scoped_automation a
     WHERE a.id = p_id
       AND a.tenant_id = p_tenant_id
       AND a.token_hash = p_token_hash
       AND a.execution_state = 'unknown'
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE fm.scoped_automation_invocation i
       SET status = CASE WHEN p_denied THEN 'denied' ELSE 'completed' END,
           result_json = p_result,
           completed_at = now()
     WHERE i.automation_id = p_id
       AND i.token_hash = p_token_hash
       AND i.invocation_id = p_invocation_id
       AND i.status = 'pending';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed = 0 THEN
        RETURN FALSE;
    END IF;

    UPDATE fm.scoped_automation a
       SET execution_state = 'idle', updated_at = now()
     WHERE a.id = p_id;
    RETURN TRUE;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_invocation_finish(
    UUID, VARCHAR(120), CHAR(64), VARCHAR(128), JSONB, BOOLEAN
);
DROP FUNCTION IF EXISTS fm.fn_scoped_automation_invocation_claim(
    UUID, VARCHAR(120), CHAR(64), VARCHAR(128)
);
DROP TABLE IF EXISTS fm.scoped_automation_invocation;
