--------------UP
-- Drop persona_templates: dead since V1 FleetRole removal. The 6111 table
-- + 5 SQL fns had no remaining callers (RPC + types deleted in this commit).
-- LINT-IGNORE: additive-only

DROP FUNCTION IF EXISTS organization.fn_persona_template_delete(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS organization.fn_persona_template_update(VARCHAR, INTEGER, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS organization.fn_persona_template_create(VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB, VARCHAR);
DROP FUNCTION IF EXISTS organization.fn_persona_template_get(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS organization.fn_persona_template_list(VARCHAR);
DROP TABLE IF EXISTS organization.persona_templates;

--------------DOWN
-- Re-apply 6111 by hand (operator path; templates are not coming back).
