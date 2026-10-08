--------------UP
-- Keep the persistence allowlist aligned with the typed Operations contract.
CREATE OR REPLACE FUNCTION organization.fn_operational_policy_upsert(
    p_organization_id VARCHAR,
    p_family          VARCHAR,
    p_id_field        VARCHAR,
    p_policy_id       VARCHAR,
    p_policy          JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_path TEXT[] := ARRAY['operationalVerdictPolicies', p_family];
    v_metadata JSONB;
    v_policies JSONB;
    v_family_policies JSONB;
BEGIN
    IF p_family NOT IN (
        'refrigeration',
        'parking',
        'irrigation',
        'pv',
        'italiaHotWater',
        'italiaNightFlow',
        'italiaPitch',
        'coldChain'
    ) THEN
        RAISE EXCEPTION 'invalid operational policy family'
            USING ERRCODE = '22023';
    END IF;
    IF p_id_field NOT IN ('id', 'locationId', 'siteId', 'pitchId') THEN
        RAISE EXCEPTION 'invalid operational policy id field'
            USING ERRCODE = '22023';
    END IF;
    IF p_policy_id IS NULL OR p_policy_id = '' OR p_policy IS NULL THEN
        RAISE EXCEPTION 'operational policy id and policy are required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM organization.fn_profile_ensure(p_organization_id);
    SELECT COALESCE(profile.metadata, '{}'::jsonb)
      INTO v_metadata
      FROM organization.profile
     WHERE profile.id = p_organization_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'organization profile not found'
            USING ERRCODE = 'P0002';
    END IF;

    v_policies := CASE
        WHEN jsonb_typeof(v_metadata -> 'operationalVerdictPolicies') = 'object'
        THEN v_metadata -> 'operationalVerdictPolicies'
        ELSE '{}'::jsonb
    END;
    v_family_policies := (
        SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
          FROM jsonb_array_elements(
              CASE
                  WHEN jsonb_typeof(v_policies -> p_family) = 'array'
                  THEN v_policies -> p_family
                  ELSE '[]'::jsonb
              END
          ) AS existing(item)
         WHERE item ->> p_id_field <> p_policy_id
           AND (
               p_id_field = 'id'
               OR NOT (p_policy ? 'id')
               OR item ->> 'id' <> p_policy ->> 'id'
           )
    ) || jsonb_build_array(p_policy);

    IF jsonb_array_length(v_family_policies) > 500 THEN
        RAISE EXCEPTION 'operational policy family exceeds 500 policies'
            USING ERRCODE = '22023';
    END IF;

    v_metadata := jsonb_set(
        jsonb_set(
            v_metadata,
            '{operationalVerdictPolicies}',
            v_policies,
            TRUE
        ),
        v_path,
        v_family_policies,
        TRUE
    );
    IF octet_length(v_metadata::TEXT) > 65536 THEN
        RAISE EXCEPTION 'organization metadata exceeds 65536 bytes'
            USING ERRCODE = '22023';
    END IF;

    UPDATE organization.profile
       SET metadata = v_metadata,
           updated_at = NOW()
     WHERE profile.id = p_organization_id;
    RETURN p_policy;
END;
$$;
CREATE OR REPLACE FUNCTION organization.fn_operational_policy_delete(
    p_organization_id VARCHAR,
    p_family          VARCHAR,
    p_id_field        VARCHAR,
    p_policy_id       VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_path TEXT[] := ARRAY['operationalVerdictPolicies', p_family];
    v_deleted BOOLEAN := FALSE;
BEGIN
    IF p_family NOT IN (
        'refrigeration',
        'parking',
        'irrigation',
        'pv',
        'italiaHotWater',
        'italiaNightFlow',
        'italiaPitch',
        'coldChain'
    ) THEN
        RAISE EXCEPTION 'invalid operational policy family'
            USING ERRCODE = '22023';
    END IF;
    IF p_id_field NOT IN ('id', 'locationId', 'siteId', 'pitchId') THEN
        RAISE EXCEPTION 'invalid operational policy id field'
            USING ERRCODE = '22023';
    END IF;

    UPDATE organization.profile
       SET metadata = jsonb_set(
               jsonb_set(
                   COALESCE(profile.metadata, '{}'::jsonb),
                   '{operationalVerdictPolicies}',
                   CASE
                       WHEN jsonb_typeof(
                           profile.metadata -> 'operationalVerdictPolicies'
                       ) = 'object'
                       THEN profile.metadata -> 'operationalVerdictPolicies'
                       ELSE '{}'::jsonb
                   END,
                   TRUE
               ),
               v_path,
               (
                   SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
                     FROM jsonb_array_elements(
                         CASE
                             WHEN jsonb_typeof(profile.metadata #> v_path) = 'array'
                             THEN profile.metadata #> v_path
                             ELSE '[]'::jsonb
                         END
                     ) AS existing(item)
                    WHERE item ->> p_id_field <> p_policy_id
               ),
               TRUE
           ),
           updated_at = NOW()
     WHERE profile.id = p_organization_id
       AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(
                 CASE
                     WHEN jsonb_typeof(profile.metadata #> v_path) = 'array'
                     THEN profile.metadata #> v_path
                     ELSE '[]'::jsonb
                 END
             ) AS existing(item)
            WHERE item ->> p_id_field = p_policy_id
       )
     RETURNING TRUE INTO v_deleted;

    RETURN COALESCE(v_deleted, FALSE);
END;
$$;

--------------DOWN
-- Restore the previous seven-family persistence contract.
CREATE OR REPLACE FUNCTION organization.fn_operational_policy_upsert(
    p_organization_id VARCHAR,
    p_family          VARCHAR,
    p_id_field        VARCHAR,
    p_policy_id       VARCHAR,
    p_policy          JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_path TEXT[] := ARRAY['operationalVerdictPolicies', p_family];
    v_metadata JSONB;
    v_policies JSONB;
    v_family_policies JSONB;
BEGIN
    IF p_family NOT IN (
        'refrigeration',
        'parking',
        'irrigation',
        'pv',
        'italiaHotWater',
        'italiaNightFlow',
        'italiaPitch'
    ) THEN
        RAISE EXCEPTION 'invalid operational policy family'
            USING ERRCODE = '22023';
    END IF;
    IF p_id_field NOT IN ('id', 'locationId', 'siteId', 'pitchId') THEN
        RAISE EXCEPTION 'invalid operational policy id field'
            USING ERRCODE = '22023';
    END IF;
    IF p_policy_id IS NULL OR p_policy_id = '' OR p_policy IS NULL THEN
        RAISE EXCEPTION 'operational policy id and policy are required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM organization.fn_profile_ensure(p_organization_id);
    SELECT COALESCE(profile.metadata, '{}'::jsonb)
      INTO v_metadata
      FROM organization.profile
     WHERE profile.id = p_organization_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'organization profile not found'
            USING ERRCODE = 'P0002';
    END IF;

    v_policies := CASE
        WHEN jsonb_typeof(v_metadata -> 'operationalVerdictPolicies') = 'object'
        THEN v_metadata -> 'operationalVerdictPolicies'
        ELSE '{}'::jsonb
    END;
    v_family_policies := (
        SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
          FROM jsonb_array_elements(
              CASE
                  WHEN jsonb_typeof(v_policies -> p_family) = 'array'
                  THEN v_policies -> p_family
                  ELSE '[]'::jsonb
              END
          ) AS existing(item)
         WHERE item ->> p_id_field <> p_policy_id
           AND (
               p_id_field = 'id'
               OR NOT (p_policy ? 'id')
               OR item ->> 'id' <> p_policy ->> 'id'
           )
    ) || jsonb_build_array(p_policy);

    IF jsonb_array_length(v_family_policies) > 500 THEN
        RAISE EXCEPTION 'operational policy family exceeds 500 policies'
            USING ERRCODE = '22023';
    END IF;

    v_metadata := jsonb_set(
        jsonb_set(
            v_metadata,
            '{operationalVerdictPolicies}',
            v_policies,
            TRUE
        ),
        v_path,
        v_family_policies,
        TRUE
    );
    IF octet_length(v_metadata::TEXT) > 65536 THEN
        RAISE EXCEPTION 'organization metadata exceeds 65536 bytes'
            USING ERRCODE = '22023';
    END IF;

    UPDATE organization.profile
       SET metadata = v_metadata,
           updated_at = NOW()
     WHERE profile.id = p_organization_id;
    RETURN p_policy;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_operational_policy_delete(
    p_organization_id VARCHAR,
    p_family          VARCHAR,
    p_id_field        VARCHAR,
    p_policy_id       VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_path TEXT[] := ARRAY['operationalVerdictPolicies', p_family];
    v_deleted BOOLEAN := FALSE;
BEGIN
    IF p_family NOT IN (
        'refrigeration',
        'parking',
        'irrigation',
        'pv',
        'italiaHotWater',
        'italiaNightFlow',
        'italiaPitch'
    ) THEN
        RAISE EXCEPTION 'invalid operational policy family'
            USING ERRCODE = '22023';
    END IF;
    IF p_id_field NOT IN ('id', 'locationId', 'siteId', 'pitchId') THEN
        RAISE EXCEPTION 'invalid operational policy id field'
            USING ERRCODE = '22023';
    END IF;

    UPDATE organization.profile
       SET metadata = jsonb_set(
               jsonb_set(
                   COALESCE(profile.metadata, '{}'::jsonb),
                   '{operationalVerdictPolicies}',
                   CASE
                       WHEN jsonb_typeof(
                           profile.metadata -> 'operationalVerdictPolicies'
                       ) = 'object'
                       THEN profile.metadata -> 'operationalVerdictPolicies'
                       ELSE '{}'::jsonb
                   END,
                   TRUE
               ),
               v_path,
               (
                   SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
                     FROM jsonb_array_elements(
                         CASE
                             WHEN jsonb_typeof(profile.metadata #> v_path) = 'array'
                             THEN profile.metadata #> v_path
                             ELSE '[]'::jsonb
                         END
                     ) AS existing(item)
                    WHERE item ->> p_id_field <> p_policy_id
               ),
               TRUE
           ),
           updated_at = NOW()
     WHERE profile.id = p_organization_id
       AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(
                 CASE
                     WHEN jsonb_typeof(profile.metadata #> v_path) = 'array'
                     THEN profile.metadata #> v_path
                     ELSE '[]'::jsonb
                 END
             ) AS existing(item)
            WHERE item ->> p_id_field = p_policy_id
       )
     RETURNING TRUE INTO v_deleted;

    RETURN COALESCE(v_deleted, FALSE);
END;
$$;
