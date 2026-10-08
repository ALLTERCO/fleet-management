-- Re-states the 20053 definition for databases built from a checkout that also
-- carried an untracked rollup draft, which replaced this wrapper after 20053 ran.
-- On every other database this is the definition already in place.
--------------UP

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT LANGUAGE sql AS $$
    SELECT completed FROM device_em.fn_rollup_dirty_batch(p_limit);
$$;

--------------DOWN

-- Nothing to undo: 20053 owns this definition and it is unchanged here.
