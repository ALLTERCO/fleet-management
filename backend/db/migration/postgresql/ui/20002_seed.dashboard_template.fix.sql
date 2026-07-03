--------------UP
-- Correct builtin templates: drop nonexistent 'em3', add BLU sensors
-- (door/window/motion/contact via bthomesensor + bthomedevice +
-- bthomecontrol), fill in missing lighting types on control.
UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array(
        'em','em1','pm1','switch','temperature','humidity','illuminance',
        'flood','smoke','presence','bthomesensor','bthomedevice','devicepower'
    )
)
 WHERE organization_id IS NULL AND key = 'overview_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array('em','em1','pm1','switch')
)
 WHERE organization_id IS NULL AND key = 'energy_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array(
        'temperature','humidity','illuminance','flood','smoke','bthomesensor'
    )
)
 WHERE organization_id IS NULL AND key = 'environment_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array(
        'switch','light','cover','input','rgb','rgbw','cct','rgbcct',
        'thermostat','blutrv','bthomecontrol'
    )
)
 WHERE organization_id IS NULL AND key = 'control_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array(
        'flood','smoke','presence','bthomesensor','bthomedevice',
        'bthomecontrol'
    )
)
 WHERE organization_id IS NULL AND key = 'safety_default';
--------------DOWN
-- Restore the original (incorrect) seed.
UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array(
        'em','em1','pm1','switch','temperature','humidity','flood',
        'smoke','presence'
    )
)
 WHERE organization_id IS NULL AND key = 'overview_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array('em','em1','pm1','em3','switch')
)
 WHERE organization_id IS NULL AND key = 'energy_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array('temperature','humidity','flood','smoke')
)
 WHERE organization_id IS NULL AND key = 'environment_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array('switch','light','dimmer','cover','rgb','rgbw')
)
 WHERE organization_id IS NULL AND key = 'control_default';

UPDATE ui.dashboard_template SET seed = jsonb_build_object(
    'detectsEntityTypes',
    jsonb_build_array('flood','smoke','presence')
)
 WHERE organization_id IS NULL AND key = 'safety_default';
