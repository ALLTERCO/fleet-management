--------------UP
-- Add 'map' to the allowed dashboard_type set + seed the builtin Map template.
ALTER TABLE ui.dashboard
    DROP CONSTRAINT IF EXISTS dashboard_dashboard_type_check;

ALTER TABLE ui.dashboard
    ADD CONSTRAINT dashboard_dashboard_type_check
    CHECK (dashboard_type IN (
        'classic', 'analytics', 'overview', 'energy',
        'environment', 'control', 'safety', 'map'
    ));

INSERT INTO ui.dashboard_template
    (organization_id, key, label, description, dashboard_type, seed, is_builtin)
VALUES
    (NULL, 'map_default', 'Map',
     'Geospatial view of locations with live device status overlays',
     'map',
     jsonb_build_object(
         'detectsEntityTypes',
         jsonb_build_array(
             'switch', 'em', 'em1', 'pm1', 'temperature', 'humidity',
             'flood', 'smoke', 'presence', 'devicepower'
         )
     ),
     TRUE)
ON CONFLICT DO NOTHING;
--------------DOWN
DELETE FROM ui.dashboard_template
 WHERE organization_id IS NULL AND key = 'map_default';

ALTER TABLE ui.dashboard
    DROP CONSTRAINT IF EXISTS dashboard_dashboard_type_check;

-- WARNING: rollback fails if any rows still have dashboard_type='map'.
ALTER TABLE ui.dashboard
    ADD CONSTRAINT dashboard_dashboard_type_check
    CHECK (dashboard_type IN (
        'classic', 'analytics', 'overview', 'energy',
        'environment', 'control', 'safety'
    ));
