--------------UP
-- Backfill: every statement gets an explicit effect=Allow when missing.
-- After this migration the resolver can fail-fast on malformed data instead
-- of coercing on read; toPersonaRow() trusts the schema validator.

UPDATE organization.personas
   SET statements = (
       SELECT jsonb_agg(
           CASE
               WHEN s ? 'effect' THEN s
               ELSE s || '{"effect": "Allow"}'::jsonb
           END
       )
       FROM jsonb_array_elements(statements) AS s
   )
 WHERE EXISTS (
     SELECT 1
       FROM jsonb_array_elements(statements) AS s
      WHERE NOT (s ? 'effect')
 );

--------------DOWN
-- No-op: data backfill cannot be reverted — original missing-effect rows are
-- gone. This migration is forward-only by intent.
