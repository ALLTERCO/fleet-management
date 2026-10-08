--------------UP
-- Delete one entry; returns the deleted id, or no row when it was not
-- in the org (component turns the empty result into deleted=false).

CREATE OR REPLACE FUNCTION fm.fn_ir_library_delete(
    p_organization_id VARCHAR(120),
    p_id BIGINT
)
RETURNS TABLE (id BIGINT)
AS $$
    DELETE FROM fm.ir_library AS l
    WHERE l.organization_id = p_organization_id AND l.id = p_id
    RETURNING l.id;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_ir_library_delete(VARCHAR(120), BIGINT);
