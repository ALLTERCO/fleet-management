--------------UP
-- Reject assignments whose persona belongs to a different tenant.
-- System personas (tenant_id IS NULL) are assignable from any tenant.
SET search_path TO organization;

CREATE OR REPLACE FUNCTION organization.fn_assignment_persona_tenant_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    persona_tenant VARCHAR(120);
BEGIN
    SELECT tenant_id INTO persona_tenant
      FROM organization.personas
     WHERE id = NEW.persona_id;

    IF persona_tenant IS NULL THEN
        RETURN NEW;
    END IF;

    IF persona_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION
            'assignment tenant_id (%) does not match persona tenant_id (%)',
            NEW.tenant_id, persona_tenant
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assignments_persona_tenant_match ON assignments;
CREATE TRIGGER assignments_persona_tenant_match
    BEFORE INSERT OR UPDATE OF persona_id, tenant_id ON assignments
    FOR EACH ROW
    EXECUTE FUNCTION organization.fn_assignment_persona_tenant_match();

--------------DOWN
SET search_path TO organization;

DROP TRIGGER IF EXISTS assignments_persona_tenant_match ON assignments;
DROP FUNCTION IF EXISTS organization.fn_assignment_persona_tenant_match();
