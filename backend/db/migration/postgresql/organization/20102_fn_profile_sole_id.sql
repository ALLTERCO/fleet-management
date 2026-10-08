-- The one tenant of a single-tenant install, when the database is certain:
-- exactly one organization profile exists. Boot uses it to give unowned
-- files an owner without guessing.
--------------UP

CREATE OR REPLACE FUNCTION organization.fn_profile_sole_id()
RETURNS VARCHAR(120)
LANGUAGE sql
STABLE
AS
$$
    SELECT CASE WHEN count(*) = 1 THEN min(p.id) END
    FROM organization.profile p;
$$;

--------------DOWN

DROP FUNCTION IF EXISTS organization.fn_profile_sole_id();
