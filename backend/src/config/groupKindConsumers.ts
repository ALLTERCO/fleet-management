// All simple consumer / equipment / appliance kinds, across home and every
// business sector. A compact tuple table keeps this DRY; the factory expands
// each row into a full GroupKindDefinition. These spread into the single source
// of truth, GROUP_KIND_CATALOG, so every importer still reads one array.
// Reference rows only: id + name + category + icon, no metadata schema or
// rollup metrics (those live on the structural kinds in groupKindCatalog).

import {
    type GroupKindCategory,
    type GroupKindDefinition,
    SCHEMA_EMPTY
} from './groupKindTypes';

// [id, displayName, description, category, icon]
type ConsumerKindRow = [string, string, string, GroupKindCategory, string];

const CONSUMER_KIND_DATA: readonly ConsumerKindRow[] = [
    [
        'vacancy_pool',
        'Vacancy Pool',
        'Currently-vacant units pending occupancy.',
        'property',
        'fa-door-open'
    ],
    [
        'grid_source',
        'Grid source',
        'Utility grid connection feeding the site.',
        'electrical',
        'fa-bolt'
    ],
    [
        'generated_energy',
        'Generated energy',
        'On-site generation (solar, generator, CHP).',
        'electrical',
        'fa-solar-panel'
    ],
    [
        'socket',
        'Socket',
        'A wall socket / outlet circuit.',
        'electrical',
        'fa-plug'
    ],
    [
        'plug_load',
        'Plug load',
        'A plugged-in appliance metered at the socket.',
        'electrical',
        'fa-plug'
    ],
    [
        'inverter',
        'Inverter',
        'DC-to-AC inverter (solar / hybrid).',
        'solar',
        'fa-bolt'
    ],
    [
        'generator',
        'Generator',
        'Fuel or backup generator set.',
        'renewables',
        'fa-bolt'
    ],
    [
        'lighting',
        'Lighting',
        'General lighting load.',
        'building',
        'fa-lightbulb'
    ],
    [
        'hvac',
        'HVAC',
        'Heating, ventilation and air-conditioning load.',
        'building',
        'fa-temperature-half'
    ],
    [
        'air_conditioner',
        'Air conditioner',
        'Cooling unit.',
        'building',
        'fa-snowflake'
    ],
    [
        'heat_pump',
        'Heat pump',
        'Heat-pump heating/cooling unit.',
        'building',
        'fa-temperature-high'
    ],
    [
        'space_heater',
        'Space heater',
        'Standalone electric heater.',
        'building',
        'fa-fire'
    ],
    [
        'radiator',
        'Radiator',
        'Electric or hydronic radiator.',
        'building',
        'fa-temperature-high'
    ],
    [
        'underfloor_heating',
        'Underfloor heating',
        'Electric or hydronic floor heating circuit.',
        'building',
        'fa-fire'
    ],
    ['fan_coil', 'Fan coil', 'Fan-coil unit.', 'building', 'fa-fan'],
    [
        'thermostat',
        'Thermostat',
        'Heating/cooling controller.',
        'building',
        'fa-gauge'
    ],
    [
        'ventilation',
        'Ventilation',
        'Mechanical ventilation system.',
        'building',
        'fa-fan'
    ],
    ['fan', 'Fan', 'Standalone fan.', 'building', 'fa-fan'],
    [
        'extractor_fan',
        'Extractor fan',
        'Kitchen/bathroom extractor fan.',
        'building',
        'fa-fan'
    ],
    [
        'air_purifier',
        'Air purifier',
        'Air-cleaning unit.',
        'building',
        'fa-wind'
    ],
    [
        'dehumidifier',
        'Dehumidifier',
        'Moisture-removal unit.',
        'building',
        'fa-droplet-slash'
    ],
    [
        'humidifier',
        'Humidifier',
        'Moisture-adding unit.',
        'building',
        'fa-droplet'
    ],
    [
        'water_heater',
        'Water heater',
        'Electric water heater / boiler.',
        'building',
        'fa-shower'
    ],
    ['boiler', 'Boiler', 'Central heating boiler.', 'building', 'fa-fire'],
    [
        'circulation_pump',
        'Circulation pump',
        'Heating/hot-water circulation pump.',
        'building',
        'fa-rotate'
    ],
    ['computer', 'Computer', 'Desktop/workstation.', 'building', 'fa-computer'],
    [
        'network_equipment',
        'Network equipment',
        'Router / switch / access point.',
        'building',
        'fa-network-wired'
    ],
    [
        'printer',
        'Printer',
        'Printer / multifunction device.',
        'building',
        'fa-print'
    ],
    ['monitor', 'Monitor', 'Display / monitor.', 'building', 'fa-desktop'],
    [
        'roller_shutter',
        'Roller shutter',
        'Motorised roller shutter.',
        'building',
        'fa-window-maximize'
    ],
    [
        'garage_door',
        'Garage door',
        'Motorised garage door.',
        'building',
        'fa-warehouse'
    ],
    [
        'gate_motor',
        'Gate motor',
        'Driveway/gate motor.',
        'building',
        'fa-door-closed'
    ],
    ['blind', 'Blind', 'Motorised blind.', 'building', 'fa-window-maximize'],
    ['awning', 'Awning', 'Motorised awning.', 'building', 'fa-umbrella'],
    ['refrigerator', 'Refrigerator', 'Fridge.', 'residential', 'fa-snowflake'],
    [
        'freezer',
        'Freezer',
        'Standalone freezer.',
        'residential',
        'fa-snowflake'
    ],
    [
        'fridge_freezer',
        'Fridge freezer',
        'Combined fridge-freezer.',
        'residential',
        'fa-snowflake'
    ],
    [
        'wine_cooler',
        'Wine cooler',
        'Wine fridge.',
        'residential',
        'fa-wine-bottle'
    ],
    [
        'washing_machine',
        'Washing machine',
        'Clothes washer.',
        'residential',
        'fa-soap'
    ],
    [
        'tumble_dryer',
        'Tumble dryer',
        'Clothes dryer.',
        'residential',
        'fa-wind'
    ],
    [
        'washer_dryer',
        'Washer dryer',
        'Combined washer-dryer.',
        'residential',
        'fa-soap'
    ],
    ['dishwasher', 'Dishwasher', 'Dishwasher.', 'residential', 'fa-utensils'],
    [
        'vacuum_cleaner',
        'Vacuum cleaner',
        'Vacuum cleaner.',
        'residential',
        'fa-broom'
    ],
    [
        'robot_vacuum',
        'Robot vacuum',
        'Robotic vacuum / dock.',
        'residential',
        'fa-robot'
    ],
    ['oven', 'Oven', 'Electric oven.', 'residential', 'fa-fire-burner'],
    [
        'cooktop',
        'Cooktop',
        'Electric/induction cooktop.',
        'residential',
        'fa-fire-burner'
    ],
    ['hob', 'Hob', 'Cooking hob.', 'residential', 'fa-fire-burner'],
    ['stove', 'Stove', 'Range / stove.', 'residential', 'fa-fire-burner'],
    ['microwave', 'Microwave', 'Microwave oven.', 'residential', 'fa-box'],
    ['kettle', 'Kettle', 'Electric kettle.', 'residential', 'fa-mug-hot'],
    [
        'coffee_machine',
        'Coffee machine',
        'Coffee maker / espresso machine.',
        'residential',
        'fa-mug-saucer'
    ],
    ['toaster', 'Toaster', 'Toaster.', 'residential', 'fa-bread-slice'],
    ['air_fryer', 'Air fryer', 'Air fryer.', 'residential', 'fa-fire-burner'],
    ['tv', 'TV', 'Television.', 'residential', 'fa-tv'],
    [
        'game_console',
        'Game console',
        'Gaming console.',
        'residential',
        'fa-gamepad'
    ],
    [
        'speaker_system',
        'Speaker system',
        'Audio / speaker system.',
        'residential',
        'fa-volume-high'
    ],
    ['projector', 'Projector', 'Video projector.', 'residential', 'fa-film'],
    [
        'media_player',
        'Media player',
        'Streaming / media player.',
        'residential',
        'fa-circle-play'
    ],
    ['set_top_box', 'Set-top box', 'TV set-top box.', 'residential', 'fa-box'],
    [
        'pool_pump',
        'Pool pump',
        'Swimming-pool pump.',
        'residential',
        'fa-water'
    ],
    [
        'pool_heater',
        'Pool heater',
        'Swimming-pool heater.',
        'residential',
        'fa-fire'
    ],
    ['pond_pump', 'Pond pump', 'Garden pond pump.', 'residential', 'fa-water'],
    [
        'ev_charger',
        'EV charger',
        'Electric-vehicle charger (single point).',
        'ev',
        'fa-charging-station'
    ],
    ['camera', 'Camera', 'Security / IP camera.', 'public_safety', 'fa-video'],
    ['alarm', 'Alarm', 'Alarm system.', 'public_safety', 'fa-bell'],
    ['door_lock', 'Door lock', 'Smart door lock.', 'public_safety', 'fa-lock'],
    ['intercom', 'Intercom', 'Door intercom.', 'public_safety', 'fa-phone'],
    [
        'access_control',
        'Access control',
        'Access-control reader / panel.',
        'public_safety',
        'fa-id-card'
    ],
    [
        'espresso_machine',
        'Espresso machine',
        'Espresso / bean-to-cup machine.',
        'residential',
        'fa-mug-hot'
    ],
    [
        'range_hood',
        'Range hood',
        'Cooker extractor hood.',
        'residential',
        'fa-fan'
    ],
    ['blender', 'Blender', 'Countertop blender.', 'residential', 'fa-blender'],
    [
        'food_processor',
        'Food processor',
        'Food processor.',
        'residential',
        'fa-blender'
    ],
    [
        'stand_mixer',
        'Stand mixer',
        'Kitchen stand mixer.',
        'residential',
        'fa-blender'
    ],
    ['juicer', 'Juicer', 'Juice extractor.', 'residential', 'fa-blender'],
    [
        'rice_cooker',
        'Rice cooker',
        'Rice cooker.',
        'residential',
        'fa-bowl-rice'
    ],
    [
        'slow_cooker',
        'Slow cooker',
        'Slow cooker / crockpot.',
        'residential',
        'fa-bowl-food'
    ],
    [
        'pressure_cooker',
        'Pressure cooker',
        'Electric pressure cooker.',
        'residential',
        'fa-bowl-food'
    ],
    [
        'deep_fryer',
        'Deep fryer',
        'Deep fat fryer.',
        'residential',
        'fa-fire-burner'
    ],
    [
        'electric_grill',
        'Electric grill',
        'Indoor electric grill.',
        'residential',
        'fa-fire-burner'
    ],
    [
        'bread_maker',
        'Bread maker',
        'Bread machine.',
        'residential',
        'fa-bread-slice'
    ],
    ['ice_maker', 'Ice maker', 'Ice maker.', 'residential', 'fa-snowflake'],
    [
        'water_dispenser',
        'Water dispenser',
        'Hot/cold water dispenser.',
        'residential',
        'fa-faucet'
    ],
    [
        'garbage_disposal',
        'Garbage disposal',
        'Sink waste disposer.',
        'residential',
        'fa-trash'
    ],
    [
        'mini_fridge',
        'Mini fridge',
        'Compact fridge.',
        'residential',
        'fa-snowflake'
    ],
    [
        'warming_drawer',
        'Warming drawer',
        'Food warming drawer.',
        'residential',
        'fa-fire-burner'
    ],
    ['iron', 'Iron', 'Clothes iron.', 'residential', 'fa-shirt'],
    [
        'garment_steamer',
        'Garment steamer',
        'Clothes steamer.',
        'residential',
        'fa-shirt'
    ],
    ['steam_mop', 'Steam mop', 'Steam floor mop.', 'residential', 'fa-broom'],
    [
        'heated_drying_rack',
        'Heated drying rack',
        'Heated airer.',
        'residential',
        'fa-temperature-high'
    ],
    [
        'pressure_washer',
        'Pressure washer',
        'High-pressure washer.',
        'residential',
        'fa-spray-can-sparkles'
    ],
    ['ceiling_fan', 'Ceiling fan', 'Ceiling fan.', 'building', 'fa-fan'],
    ['tower_fan', 'Tower fan', 'Standing tower fan.', 'building', 'fa-fan'],
    [
        'oil_heater',
        'Oil heater',
        'Oil-filled radiator.',
        'building',
        'fa-temperature-high'
    ],
    [
        'infrared_heater',
        'Infrared heater',
        'Infrared panel heater.',
        'building',
        'fa-temperature-high'
    ],
    [
        'electric_fireplace',
        'Electric fireplace',
        'Electric fireplace.',
        'building',
        'fa-fire'
    ],
    [
        'towel_warmer',
        'Towel warmer',
        'Heated towel rail.',
        'building',
        'fa-temperature-high'
    ],
    [
        'electric_blanket',
        'Electric blanket',
        'Heated blanket.',
        'residential',
        'fa-temperature-high'
    ],
    [
        'portable_ac',
        'Portable AC',
        'Portable air conditioner.',
        'building',
        'fa-snowflake'
    ],
    [
        'patio_heater',
        'Patio heater',
        'Outdoor patio heater.',
        'building',
        'fa-fire'
    ],
    [
        'heat_recovery_unit',
        'Heat recovery unit',
        'MVHR / HRV unit.',
        'building',
        'fa-arrows-rotate'
    ],
    [
        'immersion_heater',
        'Immersion heater',
        'Hot-water immersion element.',
        'building',
        'fa-temperature-high'
    ],
    ['well_pump', 'Well pump', 'Water well pump.', 'building', 'fa-faucet'],
    [
        'sump_pump',
        'Sump pump',
        'Sump / drainage pump.',
        'building',
        'fa-faucet'
    ],
    [
        'booster_pump',
        'Booster pump',
        'Pressure booster pump.',
        'building',
        'fa-gauge-high'
    ],
    [
        'water_softener',
        'Water softener',
        'Water softening unit.',
        'building',
        'fa-droplet'
    ],
    [
        'water_filter',
        'Water filter',
        'Water filtration unit.',
        'building',
        'fa-droplet'
    ],
    [
        'hot_tub',
        'Hot tub',
        'Hot tub / spa.',
        'residential',
        'fa-hot-tub-person'
    ],
    [
        'sauna',
        'Sauna',
        'Home sauna heater.',
        'residential',
        'fa-temperature-high'
    ],
    [
        'steam_room',
        'Steam room',
        'Steam generator.',
        'residential',
        'fa-temperature-high'
    ],
    [
        'irrigation_controller',
        'Irrigation controller',
        'Garden irrigation controller.',
        'residential',
        'fa-droplet'
    ],
    [
        'sprinkler_system',
        'Sprinkler system',
        'Lawn sprinkler system.',
        'residential',
        'fa-droplet'
    ],
    ['lamp', 'Lamp', 'Table / floor lamp.', 'building', 'fa-lightbulb'],
    ['led_strip', 'LED strip', 'LED light strip.', 'building', 'fa-lightbulb'],
    [
        'smart_bulb',
        'Smart bulb',
        'Smart light bulb.',
        'building',
        'fa-lightbulb'
    ],
    [
        'grow_light',
        'Grow light',
        'Plant grow light.',
        'building',
        'fa-seedling'
    ],
    [
        'decorative_lighting',
        'Decorative lighting',
        'Decorative / accent lighting.',
        'building',
        'fa-lightbulb'
    ],
    [
        'floodlight',
        'Floodlight',
        'Outdoor floodlight.',
        'building',
        'fa-lightbulb'
    ],
    [
        'uv_lamp',
        'UV lamp',
        'UV sterilization lamp.',
        'building',
        'fa-lightbulb'
    ],
    ['laptop', 'Laptop', 'Laptop computer.', 'residential', 'fa-laptop'],
    ['desktop', 'Desktop', 'Desktop computer.', 'residential', 'fa-computer'],
    ['server', 'Server', 'Compute server.', 'datacenter', 'fa-server'],
    ['nas', 'NAS', 'Network storage.', 'datacenter', 'fa-hard-drive'],
    ['router', 'Router', 'Network router.', 'residential', 'fa-network-wired'],
    ['modem', 'Modem', 'Broadband modem.', 'residential', 'fa-network-wired'],
    [
        'ups',
        'UPS',
        'Uninterruptible power supply.',
        'datacenter',
        'fa-battery-full'
    ],
    ['scanner', 'Scanner', 'Document scanner.', 'residential', 'fa-print'],
    ['printer_3d', '3D printer', '3D printer.', 'residential', 'fa-print'],
    [
        'phone_charger',
        'Phone charger',
        'Phone / USB charger.',
        'residential',
        'fa-plug'
    ],
    [
        'docking_station',
        'Docking station',
        'Laptop docking station.',
        'residential',
        'fa-plug'
    ],
    ['soundbar', 'Soundbar', 'TV soundbar.', 'residential', 'fa-volume-high'],
    [
        'av_receiver',
        'AV receiver',
        'Home AV receiver.',
        'residential',
        'fa-volume-high'
    ],
    [
        'amplifier',
        'Amplifier',
        'Audio amplifier.',
        'residential',
        'fa-volume-high'
    ],
    [
        'turntable',
        'Turntable',
        'Record player.',
        'residential',
        'fa-record-vinyl'
    ],
    [
        'streaming_device',
        'Streaming device',
        'Media streaming stick/box.',
        'residential',
        'fa-tv'
    ],
    [
        'robot_lawn_mower',
        'Robot lawn mower',
        'Robotic mower.',
        'residential',
        'fa-robot'
    ],
    [
        'power_tool',
        'Power tool',
        'Corded power tool.',
        'residential',
        'fa-screwdriver-wrench'
    ],
    [
        'air_compressor',
        'Air compressor',
        'Workshop air compressor.',
        'industrial',
        'fa-gauge-high'
    ],
    ['welder', 'Welder', 'Welding machine.', 'industrial', 'fa-fire'],
    [
        'table_saw',
        'Table saw',
        'Table saw.',
        'residential',
        'fa-screwdriver-wrench'
    ],
    [
        'leaf_blower',
        'Leaf blower',
        'Electric leaf blower.',
        'residential',
        'fa-wind'
    ],
    [
        'snow_melt_mat',
        'Snow melt mat',
        'Heated snow-melt mat.',
        'building',
        'fa-temperature-high'
    ],
    ['hair_dryer', 'Hair dryer', 'Hair dryer.', 'residential', 'fa-wind'],
    [
        'hair_straightener',
        'Hair straightener',
        'Hair straightener.',
        'residential',
        'fa-wind'
    ],
    ['curling_iron', 'Curling iron', 'Curling iron.', 'residential', 'fa-wind'],
    [
        'shaver_charger',
        'Shaver charger',
        'Electric shaver charger.',
        'residential',
        'fa-plug'
    ],
    [
        'toothbrush_charger',
        'Toothbrush charger',
        'Electric toothbrush charger.',
        'residential',
        'fa-plug'
    ],
    [
        'massage_chair',
        'Massage chair',
        'Massage chair.',
        'residential',
        'fa-chair'
    ],
    [
        'treadmill',
        'Treadmill',
        'Treadmill.',
        'stadium_sports',
        'fa-person-running'
    ],
    [
        'exercise_bike',
        'Exercise bike',
        'Stationary bike.',
        'stadium_sports',
        'fa-person-biking'
    ],
    [
        'elliptical',
        'Elliptical',
        'Elliptical trainer.',
        'stadium_sports',
        'fa-person-running'
    ],
    [
        'rowing_machine',
        'Rowing machine',
        'Rowing machine.',
        'stadium_sports',
        'fa-person-running'
    ],
    [
        'aquarium',
        'Aquarium',
        'Aquarium life support.',
        'residential',
        'fa-fish'
    ],
    [
        'terrarium',
        'Terrarium',
        'Terrarium heater/light.',
        'residential',
        'fa-frog'
    ],
    [
        'sewing_machine',
        'Sewing machine',
        'Sewing machine.',
        'residential',
        'fa-scissors'
    ],
    [
        'vending_machine',
        'Vending machine',
        'Vending machine.',
        'retail',
        'fa-store'
    ],
    [
        'water_cooler',
        'Water cooler',
        'Bottled water cooler.',
        'building',
        'fa-faucet'
    ],
    ['kiln', 'Kiln', 'Pottery / ceramics kiln.', 'industrial', 'fa-fire'],
    [
        'incubator',
        'Incubator',
        'Egg / hatchery incubator.',
        'agriculture',
        'fa-egg'
    ],
    ['doorbell', 'Doorbell', 'Wired doorbell.', 'public_safety', 'fa-bell'],
    [
        'smart_doorbell',
        'Smart doorbell',
        'Video doorbell.',
        'public_safety',
        'fa-bell'
    ],
    [
        'smart_plug',
        'Smart plug',
        'Smart plug / socket.',
        'electrical',
        'fa-plug'
    ],
    [
        'power_strip',
        'Power strip',
        'Metered power strip.',
        'electrical',
        'fa-plug'
    ],
    [
        'generic_appliance',
        'Generic appliance',
        'Unspecified appliance load.',
        'electrical',
        'fa-plug'
    ],
    [
        'commercial_oven',
        'Commercial oven',
        'Commercial oven.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'combi_oven',
        'Combi oven',
        'Combination steam oven.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'convection_oven',
        'Convection oven',
        'Convection oven.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'pizza_oven',
        'Pizza oven',
        'Pizza oven.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'deck_oven',
        'Deck oven',
        'Deck baking oven.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'conveyor_oven',
        'Conveyor oven',
        'Conveyor oven.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'commercial_range',
        'Commercial range',
        'Commercial cooking range.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'induction_range',
        'Induction range',
        'Induction cooking range.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'griddle',
        'Griddle',
        'Flat-top griddle.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'char_grill',
        'Char grill',
        'Charbroiler grill.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'salamander',
        'Salamander',
        'Salamander broiler.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'commercial_dishwasher',
        'Commercial dishwasher',
        'Commercial dishwasher.',
        'hospitality',
        'fa-sink'
    ],
    [
        'glasswasher',
        'Glasswasher',
        'Bar glasswasher.',
        'hospitality',
        'fa-wine-glass'
    ],
    [
        'commercial_fridge',
        'Commercial fridge',
        'Commercial refrigerator.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'reach_in_fridge',
        'Reach-in fridge',
        'Reach-in refrigerator.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'walk_in_cooler',
        'Walk-in cooler',
        'Walk-in cold room.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'walk_in_freezer',
        'Walk-in freezer',
        'Walk-in freezer.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'blast_chiller',
        'Blast chiller',
        'Blast chiller.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'display_fridge',
        'Display fridge',
        'Refrigerated display.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'ice_machine',
        'Ice machine',
        'Commercial ice machine.',
        'hospitality',
        'fa-snowflake'
    ],
    [
        'commercial_coffee_machine',
        'Commercial coffee machine',
        'Commercial coffee machine.',
        'hospitality',
        'fa-mug-hot'
    ],
    [
        'bain_marie',
        'Bain-marie',
        'Hot food bain-marie.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'food_warmer',
        'Food warmer',
        'Food holding warmer.',
        'hospitality',
        'fa-fire-burner'
    ],
    [
        'heat_lamp',
        'Heat lamp',
        'Food heat lamp.',
        'hospitality',
        'fa-lightbulb'
    ],
    [
        'proofing_cabinet',
        'Proofing cabinet',
        'Dough proofing cabinet.',
        'hospitality',
        'fa-temperature-high'
    ],
    [
        'dough_mixer',
        'Dough mixer',
        'Commercial dough mixer.',
        'hospitality',
        'fa-blender'
    ],
    [
        'meat_slicer',
        'Meat slicer',
        'Deli meat slicer.',
        'hospitality',
        'fa-blender'
    ],
    [
        'vacuum_sealer',
        'Vacuum sealer',
        'Vacuum packing machine.',
        'hospitality',
        'fa-box'
    ],
    [
        'sous_vide',
        'Sous vide',
        'Sous-vide cooker.',
        'hospitality',
        'fa-temperature-high'
    ],
    [
        'soft_serve_machine',
        'Soft serve machine',
        'Soft-serve machine.',
        'hospitality',
        'fa-ice-cream'
    ],
    [
        'slush_machine',
        'Slush machine',
        'Slush / granita machine.',
        'hospitality',
        'fa-cup-togo'
    ],
    [
        'beverage_dispenser',
        'Beverage dispenser',
        'Drinks dispenser.',
        'hospitality',
        'fa-cup-togo'
    ],
    [
        'kegerator',
        'Kegerator',
        'Draft beer cooler.',
        'hospitality',
        'fa-beer-mug-empty'
    ],
    [
        'exhaust_hood',
        'Exhaust hood',
        'Kitchen exhaust hood.',
        'hospitality',
        'fa-fan'
    ],
    [
        'makeup_air_unit',
        'Make-up air unit',
        'Kitchen make-up air unit.',
        'hospitality',
        'fa-fan'
    ],
    [
        'refrigerated_display_case',
        'Refrigerated display case',
        'Retail chilled display.',
        'retail',
        'fa-snowflake'
    ],
    [
        'open_chiller',
        'Open chiller',
        'Open-front chiller.',
        'retail',
        'fa-snowflake'
    ],
    [
        'freezer_island',
        'Freezer island',
        'Island freezer.',
        'retail',
        'fa-snowflake'
    ],
    [
        'deli_case',
        'Deli case',
        'Refrigerated deli case.',
        'retail',
        'fa-snowflake'
    ],
    [
        'bakery_case',
        'Bakery case',
        'Bakery display case.',
        'retail',
        'fa-snowflake'
    ],
    [
        'backroom_freezer',
        'Backroom freezer',
        'Stockroom freezer.',
        'retail',
        'fa-snowflake'
    ],
    [
        'pos_terminal',
        'POS terminal',
        'Point-of-sale terminal.',
        'retail',
        'fa-cash-register'
    ],
    [
        'self_checkout',
        'Self checkout',
        'Self-checkout kiosk.',
        'retail',
        'fa-cash-register'
    ],
    [
        'barcode_scanner',
        'Barcode scanner',
        'Barcode scanner.',
        'retail',
        'fa-barcode'
    ],
    [
        'electronic_shelf_label',
        'Electronic shelf label',
        'ESL system.',
        'retail',
        'fa-tag'
    ],
    [
        'digital_signage',
        'Digital signage',
        'Digital signage screen.',
        'retail',
        'fa-tv'
    ],
    [
        'eas_security_gate',
        'EAS security gate',
        'Anti-theft gate.',
        'retail',
        'fa-shield'
    ],
    [
        'produce_misting',
        'Produce misting',
        'Produce misting system.',
        'retail',
        'fa-droplet'
    ],
    [
        'cart_charger',
        'Cart charger',
        'Shopping-cart charger.',
        'retail',
        'fa-plug'
    ],
    [
        'desktop_computer',
        'Desktop computer',
        'Office desktop.',
        'building',
        'fa-computer'
    ],
    [
        'workstation',
        'Workstation',
        'Engineering workstation.',
        'building',
        'fa-computer'
    ],
    [
        'multifunction_printer',
        'Multifunction printer',
        'Office MFP.',
        'building',
        'fa-print'
    ],
    ['copier', 'Copier', 'Photocopier.', 'building', 'fa-print'],
    ['plotter', 'Plotter', 'Large-format plotter.', 'building', 'fa-print'],
    ['shredder', 'Shredder', 'Paper shredder.', 'building', 'fa-scissors'],
    ['video_wall', 'Video wall', 'Video wall display.', 'building', 'fa-tv'],
    [
        'conference_system',
        'Conference system',
        'AV conference system.',
        'building',
        'fa-video'
    ],
    ['hand_dryer', 'Hand dryer', 'Washroom hand dryer.', 'building', 'fa-wind'],
    [
        'automatic_door',
        'Automatic door',
        'Automatic door operator.',
        'building',
        'fa-door-open'
    ],
    [
        'revolving_door',
        'Revolving door',
        'Revolving door drive.',
        'building',
        'fa-door-open'
    ],
    [
        'air_curtain',
        'Air curtain',
        'Doorway air curtain.',
        'building',
        'fa-wind'
    ],
    [
        'escalator_drive',
        'Escalator drive',
        'Escalator motor.',
        'building',
        'fa-stairs'
    ],
    [
        'elevator_drive',
        'Elevator drive',
        'Elevator / lift motor.',
        'building',
        'fa-elevator'
    ],
    [
        'blade_server',
        'Blade server',
        'Blade server.',
        'datacenter',
        'fa-server'
    ],
    [
        'storage_array',
        'Storage array',
        'Disk storage array.',
        'datacenter',
        'fa-hard-drive'
    ],
    [
        'network_switch',
        'Network switch',
        'Network switch.',
        'datacenter',
        'fa-network-wired'
    ],
    ['firewall', 'Firewall', 'Network firewall.', 'datacenter', 'fa-shield'],
    ['pdu', 'PDU', 'Rack power distribution unit.', 'datacenter', 'fa-plug'],
    [
        'kvm_switch',
        'KVM switch',
        'KVM switch.',
        'datacenter',
        'fa-network-wired'
    ],
    [
        'crac_unit',
        'CRAC unit',
        'Computer-room AC.',
        'datacenter',
        'fa-snowflake'
    ],
    [
        'crah_unit',
        'CRAH unit',
        'Computer-room air handler.',
        'datacenter',
        'fa-snowflake'
    ],
    [
        'in_row_cooler',
        'In-row cooler',
        'In-row cooling unit.',
        'datacenter',
        'fa-snowflake'
    ],
    [
        'precision_cooling',
        'Precision cooling',
        'Precision cooling unit.',
        'datacenter',
        'fa-snowflake'
    ],
    [
        'render_farm',
        'Render farm',
        'Render farm node.',
        'datacenter',
        'fa-server'
    ],
    [
        'immersion_cooling',
        'Immersion cooling',
        'Immersion cooling tank.',
        'datacenter',
        'fa-droplet'
    ],
    [
        'rear_door_cooler',
        'Rear-door cooler',
        'Rear-door heat exchanger.',
        'datacenter',
        'fa-snowflake'
    ],
    ['busway', 'Busway', 'Overhead busway.', 'datacenter', 'fa-plug'],
    [
        'standby_generator',
        'Standby generator',
        'Backup generator.',
        'datacenter',
        'fa-bolt'
    ],
    [
        'automatic_transfer_switch',
        'Automatic transfer switch',
        'ATS.',
        'datacenter',
        'fa-bolt'
    ],
    [
        'dc_rectifier_plant',
        'DC rectifier plant',
        'Telecom DC plant.',
        'telecom',
        'fa-bolt'
    ],
    [
        'cell_radio',
        'Cell radio',
        'Cellular radio unit.',
        'telecom',
        'fa-tower-cell'
    ],
    [
        'microwave_link',
        'Microwave link',
        'Microwave backhaul.',
        'telecom',
        'fa-tower-broadcast'
    ],
    [
        'satellite_modem',
        'Satellite modem',
        'Satellite modem.',
        'telecom',
        'fa-satellite-dish'
    ],
    [
        'bts_air_conditioner',
        'BTS air conditioner',
        'Base-station AC.',
        'telecom',
        'fa-snowflake'
    ],
    ['mri_scanner', 'MRI scanner', 'MRI scanner.', 'healthcare', 'fa-magnet'],
    ['ct_scanner', 'CT scanner', 'CT scanner.', 'healthcare', 'fa-x-ray'],
    [
        'xray_machine',
        'X-ray machine',
        'X-ray machine.',
        'healthcare',
        'fa-x-ray'
    ],
    [
        'ultrasound',
        'Ultrasound',
        'Ultrasound machine.',
        'healthcare',
        'fa-heart-pulse'
    ],
    [
        'dialysis_machine',
        'Dialysis machine',
        'Dialysis machine.',
        'healthcare',
        'fa-heart-pulse'
    ],
    [
        'ventilator',
        'Ventilator',
        'Medical ventilator.',
        'healthcare',
        'fa-lungs'
    ],
    [
        'anesthesia_machine',
        'Anesthesia machine',
        'Anesthesia machine.',
        'healthcare',
        'fa-lungs'
    ],
    [
        'patient_monitor',
        'Patient monitor',
        'Vital-signs monitor.',
        'healthcare',
        'fa-heart-pulse'
    ],
    [
        'infusion_pump',
        'Infusion pump',
        'IV infusion pump.',
        'healthcare',
        'fa-syringe'
    ],
    [
        'surgical_light',
        'Surgical light',
        'Operating light.',
        'healthcare',
        'fa-lightbulb'
    ],
    [
        'surgical_table',
        'Surgical table',
        'Operating table.',
        'healthcare',
        'fa-bed'
    ],
    [
        'autoclave',
        'Autoclave',
        'Sterilization autoclave.',
        'healthcare',
        'fa-temperature-high'
    ],
    [
        'sterilizer',
        'Sterilizer',
        'Instrument sterilizer.',
        'healthcare',
        'fa-temperature-high'
    ],
    [
        'vaccine_fridge',
        'Vaccine fridge',
        'Vaccine refrigerator.',
        'healthcare',
        'fa-snowflake'
    ],
    [
        'blood_bank_fridge',
        'Blood bank fridge',
        'Blood storage fridge.',
        'healthcare',
        'fa-snowflake'
    ],
    [
        'ultra_low_freezer',
        'Ultra-low freezer',
        '-80C freezer.',
        'healthcare',
        'fa-snowflake'
    ],
    [
        'medical_incubator',
        'Medical incubator',
        'Infant incubator.',
        'healthcare',
        'fa-baby'
    ],
    [
        'dental_chair',
        'Dental chair',
        'Dental treatment chair.',
        'healthcare',
        'fa-tooth'
    ],
    [
        'dental_compressor',
        'Dental compressor',
        'Dental air compressor.',
        'healthcare',
        'fa-gauge-high'
    ],
    [
        'pharmacy_robot',
        'Pharmacy robot',
        'Pharmacy dispensing robot.',
        'healthcare',
        'fa-robot'
    ],
    [
        'electric_motor',
        'Electric motor',
        'Industrial electric motor.',
        'industrial',
        'fa-gears'
    ],
    [
        'vfd_drive',
        'VFD drive',
        'Variable-frequency drive.',
        'industrial',
        'fa-gears'
    ],
    ['servo_drive', 'Servo drive', 'Servo drive.', 'industrial', 'fa-gears'],
    [
        'soft_starter',
        'Soft starter',
        'Motor soft starter.',
        'industrial',
        'fa-gears'
    ],
    ['gearmotor', 'Gearmotor', 'Geared motor.', 'industrial', 'fa-gears'],
    [
        'conveyor',
        'Conveyor',
        'Conveyor drive.',
        'industrial',
        'fa-arrows-left-right'
    ],
    [
        'vacuum_pump',
        'Vacuum pump',
        'Vacuum pump.',
        'industrial',
        'fa-gauge-high'
    ],
    [
        'industrial_chiller',
        'Industrial chiller',
        'Process chiller.',
        'industrial',
        'fa-snowflake'
    ],
    [
        'cooling_tower',
        'Cooling tower',
        'Cooling tower fan/pump.',
        'industrial',
        'fa-fan'
    ],
    [
        'injection_molding_machine',
        'Injection molding machine',
        'Injection molder.',
        'industrial',
        'fa-gears'
    ],
    ['cnc_machine', 'CNC machine', 'CNC machine.', 'industrial', 'fa-gears'],
    ['lathe', 'Lathe', 'Machine lathe.', 'industrial', 'fa-gears'],
    [
        'milling_machine',
        'Milling machine',
        'Milling machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'stamping_press',
        'Stamping press',
        'Stamping press.',
        'industrial',
        'fa-gears'
    ],
    [
        'welding_robot',
        'Welding robot',
        'Robotic welder.',
        'industrial',
        'fa-robot'
    ],
    [
        'plasma_cutter',
        'Plasma cutter',
        'Plasma cutting machine.',
        'industrial',
        'fa-fire'
    ],
    [
        'laser_cutter',
        'Laser cutter',
        'Laser cutting machine.',
        'industrial',
        'fa-bolt'
    ],
    [
        'grinding_machine',
        'Grinding machine',
        'Grinding machine.',
        'industrial',
        'fa-gears'
    ],
    ['extruder', 'Extruder', 'Material extruder.', 'industrial', 'fa-gears'],
    [
        'industrial_mixer',
        'Industrial mixer',
        'Process mixer.',
        'industrial',
        'fa-blender'
    ],
    ['agitator', 'Agitator', 'Tank agitator.', 'industrial', 'fa-gears'],
    [
        'centrifuge',
        'Centrifuge',
        'Industrial centrifuge.',
        'industrial',
        'fa-gears'
    ],
    [
        'induction_furnace',
        'Induction furnace',
        'Induction furnace.',
        'industrial',
        'fa-fire'
    ],
    [
        'industrial_oven',
        'Industrial oven',
        'Process oven.',
        'industrial',
        'fa-fire'
    ],
    [
        'industrial_dryer',
        'Industrial dryer',
        'Process dryer.',
        'industrial',
        'fa-fire'
    ],
    [
        'industrial_boiler',
        'Industrial boiler',
        'Steam boiler.',
        'industrial',
        'fa-fire'
    ],
    [
        'paint_booth',
        'Paint booth',
        'Spray paint booth.',
        'industrial',
        'fa-spray-can'
    ],
    [
        'dust_collector',
        'Dust collector',
        'Dust collection unit.',
        'industrial',
        'fa-wind'
    ],
    [
        'fume_extractor',
        'Fume extractor',
        'Fume extraction unit.',
        'industrial',
        'fa-wind'
    ],
    [
        'overhead_crane',
        'Overhead crane',
        'Overhead crane.',
        'industrial',
        'fa-truck-ramp-box'
    ],
    ['hoist', 'Hoist', 'Electric hoist.', 'industrial', 'fa-truck-ramp-box'],
    [
        'palletizer',
        'Palletizer',
        'Palletizing machine.',
        'industrial',
        'fa-boxes-stacked'
    ],
    [
        'robot_arm',
        'Robot arm',
        'Industrial robot arm.',
        'industrial',
        'fa-robot'
    ],
    [
        'packaging_machine',
        'Packaging machine',
        'Packaging machine.',
        'industrial',
        'fa-box'
    ],
    [
        'labeling_machine',
        'Labeling machine',
        'Labeling machine.',
        'industrial',
        'fa-tag'
    ],
    [
        'filling_machine',
        'Filling machine',
        'Filling machine.',
        'industrial',
        'fa-box'
    ],
    ['baler', 'Baler', 'Material baler.', 'industrial', 'fa-boxes-stacked'],
    [
        'arc_furnace',
        'Arc furnace',
        'Electric arc furnace.',
        'industrial',
        'fa-fire'
    ],
    [
        'ladle_heater',
        'Ladle heater',
        'Ladle preheater.',
        'industrial',
        'fa-fire'
    ],
    [
        'annealing_oven',
        'Annealing oven',
        'Annealing oven.',
        'industrial',
        'fa-fire'
    ],
    [
        'powder_coat_oven',
        'Powder coat oven',
        'Powder-coat curing oven.',
        'industrial',
        'fa-fire'
    ],
    [
        'shot_blaster',
        'Shot blaster',
        'Shot-blasting machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'sandblaster',
        'Sandblaster',
        'Sandblasting machine.',
        'industrial',
        'fa-wind'
    ],
    ['press_brake', 'Press brake', 'Press brake.', 'industrial', 'fa-gears'],
    ['shear', 'Shear', 'Metal shear.', 'industrial', 'fa-scissors'],
    [
        'ironworker',
        'Ironworker',
        'Ironworker machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'anodizing_line',
        'Anodizing line',
        'Anodizing line.',
        'industrial',
        'fa-bolt'
    ],
    [
        'electroplating_line',
        'Electroplating line',
        'Electroplating line.',
        'industrial',
        'fa-bolt'
    ],
    [
        'spot_welder',
        'Spot welder',
        'Spot welding machine.',
        'industrial',
        'fa-fire'
    ],
    [
        'induction_welder',
        'Induction welder',
        'Induction welder.',
        'industrial',
        'fa-fire'
    ],
    [
        'waterjet_cutter',
        'Waterjet cutter',
        'Waterjet cutting machine.',
        'industrial',
        'fa-droplet'
    ],
    ['wire_edm', 'Wire EDM', 'Wire EDM machine.', 'industrial', 'fa-bolt'],
    [
        'blow_molder',
        'Blow molder',
        'Blow molding machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'thermoformer',
        'Thermoformer',
        'Thermoforming machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'granulator',
        'Granulator',
        'Plastic granulator.',
        'industrial',
        'fa-gears'
    ],
    [
        'hopper_dryer',
        'Hopper dryer',
        'Resin hopper dryer.',
        'industrial',
        'fa-fire'
    ],
    [
        'mold_chiller',
        'Mold chiller',
        'Mold cooling chiller.',
        'industrial',
        'fa-snowflake'
    ],
    [
        'glass_furnace',
        'Glass furnace',
        'Glass melting furnace.',
        'industrial',
        'fa-fire'
    ],
    [
        'annealing_lehr',
        'Annealing lehr',
        'Glass annealing lehr.',
        'industrial',
        'fa-fire'
    ],
    [
        'tempering_oven',
        'Tempering oven',
        'Glass tempering oven.',
        'industrial',
        'fa-fire'
    ],
    [
        'ceramic_kiln',
        'Ceramic kiln',
        'Industrial ceramic kiln.',
        'industrial',
        'fa-fire'
    ],
    [
        'glazing_line',
        'Glazing line',
        'Ceramic glazing line.',
        'industrial',
        'fa-gears'
    ],
    ['loom', 'Loom', 'Weaving loom.', 'industrial', 'fa-gears'],
    [
        'knitting_machine',
        'Knitting machine',
        'Knitting machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'spinning_frame',
        'Spinning frame',
        'Spinning frame.',
        'industrial',
        'fa-gears'
    ],
    [
        'dyeing_machine',
        'Dyeing machine',
        'Textile dyeing machine.',
        'industrial',
        'fa-droplet'
    ],
    [
        'tenter_frame',
        'Tenter frame',
        'Textile tenter frame.',
        'industrial',
        'fa-gears'
    ],
    ['calender', 'Calender', 'Calendering machine.', 'industrial', 'fa-gears'],
    [
        'embroidery_machine',
        'Embroidery machine',
        'Embroidery machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'paper_machine_drive',
        'Paper machine drive',
        'Paper machine drive.',
        'industrial',
        'fa-gears'
    ],
    ['pulper', 'Pulper', 'Pulp processor.', 'industrial', 'fa-gears'],
    [
        'flexo_press',
        'Flexo press',
        'Flexographic press.',
        'industrial',
        'fa-print'
    ],
    [
        'gravure_press',
        'Gravure press',
        'Gravure press.',
        'industrial',
        'fa-print'
    ],
    [
        'screen_printer',
        'Screen printer',
        'Screen printing machine.',
        'industrial',
        'fa-print'
    ],
    [
        'uv_curing_lamp',
        'UV curing lamp',
        'UV curing lamp.',
        'industrial',
        'fa-lightbulb'
    ],
    [
        'plate_setter',
        'Plate setter',
        'CTP plate setter.',
        'industrial',
        'fa-print'
    ],
    [
        'table_saw_industrial',
        'Panel saw',
        'Industrial panel saw.',
        'industrial',
        'fa-gears'
    ],
    ['band_saw', 'Band saw', 'Band saw.', 'industrial', 'fa-gears'],
    ['planer', 'Planer', 'Wood planer.', 'industrial', 'fa-gears'],
    ['sander', 'Sander', 'Industrial sander.', 'industrial', 'fa-gears'],
    [
        'edge_bander',
        'Edge bander',
        'Edge banding machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'cnc_router_wood',
        'CNC router',
        'Wood CNC router.',
        'industrial',
        'fa-gears'
    ],
    ['veneer_press', 'Veneer press', 'Veneer press.', 'industrial', 'fa-gears'],
    [
        'wood_dust_extractor',
        'Wood dust extractor',
        'Wood dust extraction.',
        'industrial',
        'fa-wind'
    ],
    [
        'wood_drying_kiln',
        'Wood drying kiln',
        'Lumber drying kiln.',
        'industrial',
        'fa-fire'
    ],
    [
        'mash_tun',
        'Mash tun',
        'Brewery mash tun.',
        'industrial',
        'fa-beer-mug-empty'
    ],
    [
        'brew_kettle',
        'Brew kettle',
        'Brewery kettle.',
        'industrial',
        'fa-beer-mug-empty'
    ],
    ['fermenter', 'Fermenter', 'Fermentation tank.', 'industrial', 'fa-flask'],
    [
        'brewery_glycol_chiller',
        'Brewery glycol chiller',
        'Glycol chiller.',
        'industrial',
        'fa-snowflake'
    ],
    [
        'bottling_line',
        'Bottling line',
        'Bottling line.',
        'industrial',
        'fa-wine-bottle'
    ],
    ['canning_line', 'Canning line', 'Canning line.', 'industrial', 'fa-box'],
    [
        'keg_washer',
        'Keg washer',
        'Keg washing machine.',
        'industrial',
        'fa-beer-mug-empty'
    ],
    ['still', 'Still', 'Distillation still.', 'industrial', 'fa-flask'],
    [
        'pasteurizer',
        'Pasteurizer',
        'Milk pasteurizer.',
        'industrial',
        'fa-temperature-high'
    ],
    ['homogenizer', 'Homogenizer', 'Homogenizer.', 'industrial', 'fa-gears'],
    [
        'milk_separator',
        'Milk separator',
        'Cream separator.',
        'industrial',
        'fa-gears'
    ],
    [
        'cheese_vat',
        'Cheese vat',
        'Cheese-making vat.',
        'industrial',
        'fa-cheese'
    ],
    ['butter_churn', 'Butter churn', 'Butter churn.', 'industrial', 'fa-gears'],
    [
        'milk_silo',
        'Milk silo',
        'Refrigerated milk silo.',
        'industrial',
        'fa-snowflake'
    ],
    [
        'meat_grinder',
        'Meat grinder',
        'Industrial meat grinder.',
        'industrial',
        'fa-gears'
    ],
    [
        'sausage_filler',
        'Sausage filler',
        'Sausage filling machine.',
        'industrial',
        'fa-gears'
    ],
    ['smoker', 'Smoker', 'Food smoker.', 'industrial', 'fa-fire'],
    [
        'brine_injector',
        'Brine injector',
        'Brine injection machine.',
        'industrial',
        'fa-syringe'
    ],
    [
        'fish_grader',
        'Fish grader',
        'Fish grading machine.',
        'agriculture',
        'fa-fish'
    ],
    [
        'aquaculture_aerator',
        'Aquaculture aerator',
        'Pond aerator.',
        'agriculture',
        'fa-water'
    ],
    [
        'oxygen_generator',
        'Oxygen generator',
        'Oxygen generator.',
        'industrial',
        'fa-lungs'
    ],
    [
        'spiral_mixer',
        'Spiral mixer',
        'Bakery spiral mixer.',
        'industrial',
        'fa-blender'
    ],
    [
        'dough_divider',
        'Dough divider',
        'Dough divider.',
        'industrial',
        'fa-gears'
    ],
    ['moulder', 'Moulder', 'Dough moulder.', 'industrial', 'fa-gears'],
    [
        'proofer',
        'Proofer',
        'Industrial proofer.',
        'industrial',
        'fa-temperature-high'
    ],
    ['rack_oven', 'Rack oven', 'Bakery rack oven.', 'industrial', 'fa-fire'],
    [
        'tunnel_oven',
        'Tunnel oven',
        'Bakery tunnel oven.',
        'industrial',
        'fa-fire'
    ],
    [
        'cooling_conveyor',
        'Cooling conveyor',
        'Cooling conveyor.',
        'industrial',
        'fa-arrows-left-right'
    ],
    ['spray_dryer', 'Spray dryer', 'Spray dryer.', 'industrial', 'fa-fire'],
    [
        'freeze_dryer',
        'Freeze dryer',
        'Freeze dryer.',
        'industrial',
        'fa-snowflake'
    ],
    ['tray_dryer', 'Tray dryer', 'Tray dryer.', 'industrial', 'fa-fire'],
    [
        'fluid_bed_dryer',
        'Fluid bed dryer',
        'Fluid-bed dryer.',
        'industrial',
        'fa-fire'
    ],
    [
        'rotary_dryer',
        'Rotary dryer',
        'Rotary drum dryer.',
        'industrial',
        'fa-fire'
    ],
    [
        'lyophilizer',
        'Lyophilizer',
        'Pharma freeze dryer.',
        'industrial',
        'fa-snowflake'
    ],
    ['tablet_press', 'Tablet press', 'Tablet press.', 'industrial', 'fa-gears'],
    [
        'coating_pan',
        'Coating pan',
        'Tablet coating pan.',
        'industrial',
        'fa-gears'
    ],
    [
        'capsule_filler',
        'Capsule filler',
        'Capsule filling machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'blister_line',
        'Blister line',
        'Blister packaging line.',
        'industrial',
        'fa-box'
    ],
    [
        'cip_skid',
        'CIP skid',
        'Clean-in-place skid.',
        'industrial',
        'fa-droplet'
    ],
    [
        'sip_skid',
        'SIP skid',
        'Steam-in-place skid.',
        'industrial',
        'fa-temperature-high'
    ],
    [
        'wfi_still',
        'WFI still',
        'Water-for-injection still.',
        'industrial',
        'fa-flask'
    ],
    [
        'laminar_flow_hood',
        'Laminar flow hood',
        'Laminar flow hood.',
        'industrial',
        'fa-wind'
    ],
    [
        'cleanroom_ahu',
        'Cleanroom AHU',
        'Cleanroom air handler.',
        'industrial',
        'fa-fan'
    ],
    ['ball_mill', 'Ball mill', 'Ball mill.', 'mining', 'fa-gears'],
    ['hammer_mill', 'Hammer mill', 'Hammer mill.', 'mining', 'fa-gears'],
    ['jaw_crusher', 'Jaw crusher', 'Jaw crusher.', 'mining', 'fa-gears'],
    ['cone_crusher', 'Cone crusher', 'Cone crusher.', 'mining', 'fa-gears'],
    [
        'vibrating_feeder',
        'Vibrating feeder',
        'Vibrating feeder.',
        'mining',
        'fa-gears'
    ],
    [
        'screening_deck',
        'Screening deck',
        'Vibrating screen.',
        'mining',
        'fa-gears'
    ],
    [
        'flotation_cell',
        'Flotation cell',
        'Flotation cell.',
        'mining',
        'fa-gears'
    ],
    [
        'magnetic_separator',
        'Magnetic separator',
        'Magnetic separator.',
        'mining',
        'fa-magnet'
    ],
    [
        'mine_hoist',
        'Mine hoist',
        'Mine shaft hoist.',
        'mining',
        'fa-truck-ramp-box'
    ],
    [
        'mine_ventilation_fan',
        'Mine ventilation fan',
        'Mine ventilation fan.',
        'mining',
        'fa-fan'
    ],
    [
        'dewatering_pump',
        'Dewatering pump',
        'Dewatering pump.',
        'mining',
        'fa-faucet'
    ],
    ['pumpjack', 'Pumpjack', 'Oil pumpjack.', 'mining', 'fa-oil-well'],
    [
        'gas_compressor',
        'Gas compressor',
        'Gas compressor.',
        'mining',
        'fa-gauge-high'
    ],
    [
        'wellhead_heater',
        'Wellhead heater',
        'Wellhead heater.',
        'mining',
        'fa-temperature-high'
    ],
    ['car_lift', 'Car lift', 'Vehicle lift.', 'automotive', 'fa-car'],
    [
        'tire_changer',
        'Tire changer',
        'Tire changing machine.',
        'automotive',
        'fa-car'
    ],
    [
        'wheel_balancer',
        'Wheel balancer',
        'Wheel balancing machine.',
        'automotive',
        'fa-car'
    ],
    ['brake_lathe', 'Brake lathe', 'Brake lathe.', 'automotive', 'fa-gears'],
    [
        'diagnostic_machine',
        'Diagnostic machine',
        'Vehicle diagnostic rig.',
        'automotive',
        'fa-car'
    ],
    [
        'spray_booth',
        'Spray booth',
        'Automotive spray booth.',
        'automotive',
        'fa-spray-can'
    ],
    [
        'parts_washer',
        'Parts washer',
        'Parts washing machine.',
        'automotive',
        'fa-soap'
    ],
    [
        'alignment_machine',
        'Alignment machine',
        'Wheel alignment rig.',
        'automotive',
        'fa-car'
    ],
    [
        'dynamometer',
        'Dynamometer',
        'Engine / chassis dyno.',
        'automotive',
        'fa-gauge-high'
    ],
    [
        'ev_service_charger',
        'EV service charger',
        'Workshop EV charger.',
        'automotive',
        'fa-charging-station'
    ],
    [
        'milking_machine',
        'Milking machine',
        'Milking machine.',
        'agriculture',
        'fa-cow'
    ],
    [
        'milk_tank_cooler',
        'Milk tank cooler',
        'Bulk milk cooler.',
        'agriculture',
        'fa-snowflake'
    ],
    [
        'grain_dryer',
        'Grain dryer',
        'Grain dryer.',
        'agriculture',
        'fa-wheat-awn'
    ],
    [
        'grain_auger',
        'Grain auger',
        'Grain auger.',
        'agriculture',
        'fa-wheat-awn'
    ],
    ['feed_mixer', 'Feed mixer', 'Feed mixer.', 'agriculture', 'fa-blender'],
    [
        'barn_ventilation_fan',
        'Barn ventilation fan',
        'Livestock barn fan.',
        'agriculture',
        'fa-fan'
    ],
    [
        'livestock_heat_lamp',
        'Livestock heat lamp',
        'Brooder heat lamp.',
        'agriculture',
        'fa-lightbulb'
    ],
    [
        'egg_incubator',
        'Egg incubator',
        'Egg incubator.',
        'agriculture',
        'fa-egg'
    ],
    [
        'irrigation_pump',
        'Irrigation pump',
        'Field irrigation pump.',
        'agriculture',
        'fa-faucet'
    ],
    [
        'center_pivot',
        'Center pivot',
        'Center-pivot irrigator.',
        'agriculture',
        'fa-droplet'
    ],
    [
        'greenhouse_heater',
        'Greenhouse heater',
        'Greenhouse heater.',
        'agriculture',
        'fa-temperature-high'
    ],
    [
        'greenhouse_fan',
        'Greenhouse fan',
        'Greenhouse fan.',
        'agriculture',
        'fa-fan'
    ],
    [
        'manure_pump',
        'Manure pump',
        'Slurry / manure pump.',
        'agriculture',
        'fa-faucet'
    ],
    [
        'silo_unloader',
        'Silo unloader',
        'Silo unloader.',
        'agriculture',
        'fa-wheat-awn'
    ],
    [
        'cold_room',
        'Cold room',
        'Walk-in cold room.',
        'logistics',
        'fa-snowflake'
    ],
    [
        'blast_freezer',
        'Blast freezer',
        'Blast freezer.',
        'logistics',
        'fa-snowflake'
    ],
    [
        'refrigerated_warehouse',
        'Refrigerated warehouse',
        'Cold warehouse plant.',
        'logistics',
        'fa-snowflake'
    ],
    [
        'reefer_unit',
        'Reefer unit',
        'Refrigerated container unit.',
        'logistics',
        'fa-snowflake'
    ],
    [
        'ice_plant',
        'Ice plant',
        'Industrial ice plant.',
        'logistics',
        'fa-snowflake'
    ],
    [
        'forklift_charger',
        'Forklift charger',
        'Forklift battery charger.',
        'logistics',
        'fa-charging-station'
    ],
    [
        'agv_charger',
        'AGV charger',
        'AGV / AMR charger.',
        'logistics',
        'fa-charging-station'
    ],
    [
        'conveyor_sortation',
        'Sortation conveyor',
        'Parcel sortation conveyor.',
        'logistics',
        'fa-arrows-left-right'
    ],
    [
        'dock_leveler',
        'Dock leveler',
        'Loading dock leveler.',
        'logistics',
        'fa-truck-ramp-box'
    ],
    [
        'dock_door_heater',
        'Dock door heater',
        'Dock door heater.',
        'logistics',
        'fa-temperature-high'
    ],
    [
        'pallet_wrapper',
        'Pallet wrapper',
        'Pallet stretch wrapper.',
        'logistics',
        'fa-box'
    ],
    [
        'commercial_washer',
        'Commercial washer',
        'Commercial washing machine.',
        'convenience_service',
        'fa-soap'
    ],
    [
        'commercial_dryer',
        'Commercial dryer',
        'Commercial tumble dryer.',
        'convenience_service',
        'fa-wind'
    ],
    [
        'flatwork_ironer',
        'Flatwork ironer',
        'Flatwork ironer.',
        'convenience_service',
        'fa-shirt'
    ],
    [
        'dry_cleaning_machine',
        'Dry cleaning machine',
        'Dry-cleaning machine.',
        'convenience_service',
        'fa-shirt'
    ],
    [
        'steam_press',
        'Steam press',
        'Laundry steam press.',
        'convenience_service',
        'fa-shirt'
    ],
    [
        'finishing_tunnel',
        'Finishing tunnel',
        'Garment finishing tunnel.',
        'convenience_service',
        'fa-shirt'
    ],
    [
        'water_extractor',
        'Water extractor',
        'Laundry water extractor.',
        'convenience_service',
        'fa-droplet'
    ],
    [
        'salon_hair_dryer',
        'Salon hair dryer',
        'Salon hood dryer.',
        'beauty_wellness',
        'fa-wind'
    ],
    [
        'uv_nail_lamp',
        'UV nail lamp',
        'Nail curing lamp.',
        'beauty_wellness',
        'fa-lightbulb'
    ],
    [
        'tanning_bed',
        'Tanning bed',
        'Tanning bed.',
        'beauty_wellness',
        'fa-lightbulb'
    ],
    [
        'facial_steamer',
        'Facial steamer',
        'Facial steamer.',
        'beauty_wellness',
        'fa-spa'
    ],
    [
        'commercial_sauna',
        'Commercial sauna',
        'Commercial sauna heater.',
        'beauty_wellness',
        'fa-temperature-high'
    ],
    [
        'spa_pump',
        'Spa pump',
        'Spa circulation pump.',
        'beauty_wellness',
        'fa-faucet'
    ],
    [
        'commercial_hot_tub',
        'Commercial hot tub',
        'Commercial hot tub.',
        'beauty_wellness',
        'fa-hot-tub-person'
    ],
    [
        'steam_generator',
        'Steam generator',
        'Steam-room generator.',
        'beauty_wellness',
        'fa-temperature-high'
    ],
    [
        'biosafety_cabinet',
        'Biosafety cabinet',
        'Biosafety cabinet.',
        'healthcare',
        'fa-shield'
    ],
    ['lab_oven', 'Lab oven', 'Laboratory oven.', 'healthcare', 'fa-fire'],
    [
        'muffle_furnace',
        'Muffle furnace',
        'Muffle furnace.',
        'healthcare',
        'fa-fire'
    ],
    [
        'lab_centrifuge',
        'Lab centrifuge',
        'Laboratory centrifuge.',
        'healthcare',
        'fa-gears'
    ],
    [
        'lab_incubator',
        'Lab incubator',
        'Laboratory incubator.',
        'healthcare',
        'fa-temperature-high'
    ],
    [
        'water_bath',
        'Water bath',
        'Lab water bath.',
        'healthcare',
        'fa-temperature-high'
    ],
    [
        'lab_autoclave',
        'Lab autoclave',
        'Laboratory autoclave.',
        'healthcare',
        'fa-temperature-high'
    ],
    ['pcr_machine', 'PCR machine', 'Thermal cycler.', 'healthcare', 'fa-dna'],
    [
        'lab_chiller',
        'Lab chiller',
        'Laboratory chiller.',
        'healthcare',
        'fa-snowflake'
    ],
    [
        'spectrometer',
        'Spectrometer',
        'Spectrometer.',
        'healthcare',
        'fa-wave-square'
    ],
    [
        'high_lift_pump',
        'High-lift pump',
        'Water high-lift pump.',
        'water_utility',
        'fa-faucet'
    ],
    [
        'raw_water_pump',
        'Raw water pump',
        'Raw water intake pump.',
        'water_utility',
        'fa-faucet'
    ],
    [
        'backwash_pump',
        'Backwash pump',
        'Filter backwash pump.',
        'water_utility',
        'fa-faucet'
    ],
    [
        'ro_membrane_skid',
        'RO membrane skid',
        'Reverse-osmosis skid.',
        'water_utility',
        'fa-droplet'
    ],
    [
        'desalination_pump',
        'Desalination pump',
        'Desalination HP pump.',
        'water_utility',
        'fa-droplet'
    ],
    [
        'chemical_dosing_skid',
        'Chemical dosing skid',
        'Chemical dosing skid.',
        'water_utility',
        'fa-flask'
    ],
    [
        'aeration_blower',
        'Aeration blower',
        'Wastewater aeration blower.',
        'water_utility',
        'fa-wind'
    ],
    [
        'sludge_press',
        'Sludge press',
        'Sludge dewatering press.',
        'water_utility',
        'fa-gears'
    ],
    [
        'uv_disinfection',
        'UV disinfection',
        'UV disinfection unit.',
        'water_utility',
        'fa-lightbulb'
    ],
    [
        'ozone_generator',
        'Ozone generator',
        'Ozone generator.',
        'water_utility',
        'fa-wind'
    ],
    [
        'clarifier_drive',
        'Clarifier drive',
        'Clarifier drive.',
        'water_utility',
        'fa-gears'
    ],
    [
        'waste_shredder',
        'Waste shredder',
        'Waste shredder.',
        'sustainability',
        'fa-gears'
    ],
    [
        'optical_sorter',
        'Optical sorter',
        'Recycling optical sorter.',
        'sustainability',
        'fa-gears'
    ],
    [
        'eddy_current_separator',
        'Eddy current separator',
        'Eddy-current separator.',
        'sustainability',
        'fa-magnet'
    ],
    [
        'compactor',
        'Compactor',
        'Waste compactor.',
        'sustainability',
        'fa-gears'
    ],
    [
        'incinerator_fan',
        'Incinerator fan',
        'Incinerator draft fan.',
        'sustainability',
        'fa-fan'
    ],
    [
        'tower_crane',
        'Tower crane',
        'Construction tower crane.',
        'industrial',
        'fa-truck-ramp-box'
    ],
    [
        'site_hoist',
        'Site hoist',
        'Construction hoist.',
        'industrial',
        'fa-truck-ramp-box'
    ],
    [
        'concrete_mixer',
        'Concrete mixer',
        'Concrete mixer.',
        'industrial',
        'fa-truck-ramp-box'
    ],
    [
        'concrete_pump',
        'Concrete pump',
        'Concrete pump.',
        'industrial',
        'fa-faucet'
    ],
    [
        'site_compressor',
        'Site compressor',
        'Site air compressor.',
        'industrial',
        'fa-gauge-high'
    ],
    [
        'temporary_lighting',
        'Temporary lighting',
        'Construction lighting.',
        'industrial',
        'fa-lightbulb'
    ],
    [
        'rebar_bender',
        'Rebar bender',
        'Rebar bending machine.',
        'industrial',
        'fa-gears'
    ],
    [
        'ev_charger_ac',
        'EV charger (AC)',
        'AC EV charger.',
        'ev',
        'fa-charging-station'
    ],
    [
        'ev_charger_dc_fast',
        'EV fast charger',
        'DC fast charger.',
        'ev',
        'fa-charging-station'
    ],
    [
        'ev_charger_ultrafast',
        'EV ultrafast charger',
        'HPC ultrafast charger.',
        'ev',
        'fa-charging-station'
    ],
    [
        'ebike_charger',
        'E-bike charger',
        'E-bike charger.',
        'ev',
        'fa-charging-station'
    ],
    [
        'escooter_charger',
        'E-scooter charger',
        'E-scooter charger.',
        'ev',
        'fa-charging-station'
    ],
    [
        'bus_charger',
        'Bus charger',
        'Electric bus charger.',
        'ev',
        'fa-charging-station'
    ],
    [
        'battery_swap_station',
        'Battery swap station',
        'Battery swap cabinet.',
        'ev',
        'fa-battery-full'
    ],
    [
        'rooftop_unit',
        'Rooftop unit',
        'Packaged rooftop HVAC.',
        'building',
        'fa-fan'
    ],
    ['air_handling_unit', 'Air handling unit', 'AHU.', 'building', 'fa-fan'],
    ['chiller', 'Chiller', 'Building chiller.', 'building', 'fa-snowflake'],
    [
        'commercial_boiler',
        'Commercial boiler',
        'Commercial boiler.',
        'building',
        'fa-fire'
    ],
    [
        'commercial_heat_pump',
        'Commercial heat pump',
        'Commercial heat pump.',
        'building',
        'fa-temperature-high'
    ],
    [
        'vrf_system',
        'VRF system',
        'VRF / VRV system.',
        'building',
        'fa-snowflake'
    ],
    [
        'exhaust_fan',
        'Exhaust fan',
        'Building exhaust fan.',
        'building',
        'fa-fan'
    ],
    ['supply_fan', 'Supply fan', 'Supply air fan.', 'building', 'fa-fan'],
    [
        'chilled_water_pump',
        'Chilled water pump',
        'Chilled-water pump.',
        'building',
        'fa-faucet'
    ],
    [
        'hot_water_pump',
        'Hot water pump',
        'Hot-water circulation pump.',
        'building',
        'fa-faucet'
    ],
    [
        'commercial_humidifier',
        'Commercial humidifier',
        'Building humidifier.',
        'building',
        'fa-droplet'
    ],
    [
        'electric_reheat',
        'Electric reheat',
        'Duct reheat coil.',
        'building',
        'fa-temperature-high'
    ],
    ['vav_box', 'VAV box', 'Variable-air-volume box.', 'building', 'fa-fan'],
    [
        'snow_melt_system',
        'Snow melt system',
        'Heated walkway/driveway.',
        'building',
        'fa-temperature-high'
    ],
    [
        'high_bay_light',
        'High bay light',
        'Warehouse high-bay light.',
        'building',
        'fa-lightbulb'
    ],
    [
        'flood_light',
        'Flood light',
        'Area floodlight.',
        'building',
        'fa-lightbulb'
    ],
    [
        'street_light',
        'Street light',
        'Street light.',
        'smart_city',
        'fa-lightbulb'
    ],
    [
        'parking_lot_light',
        'Parking lot light',
        'Parking-lot light.',
        'building',
        'fa-lightbulb'
    ],
    [
        'stadium_light',
        'Stadium light',
        'Stadium floodlight.',
        'stadium_sports',
        'fa-lightbulb'
    ],
    [
        'emergency_lighting',
        'Emergency lighting',
        'Emergency luminaire.',
        'building',
        'fa-lightbulb'
    ],
    [
        'exit_sign',
        'Exit sign',
        'Illuminated exit sign.',
        'building',
        'fa-sign-hanging'
    ],
    [
        'signage_lighting',
        'Signage lighting',
        'Signage lighting.',
        'building',
        'fa-lightbulb'
    ],
    [
        'architectural_lighting',
        'Architectural lighting',
        'Facade / architectural lighting.',
        'building',
        'fa-lightbulb'
    ],
    [
        'stage_lighting',
        'Stage lighting',
        'Stage lighting rig.',
        'entertainment',
        'fa-lightbulb'
    ],
    [
        'moving_head_light',
        'Moving head light',
        'Moving-head fixture.',
        'entertainment',
        'fa-lightbulb'
    ],
    ['led_wall', 'LED wall', 'LED video wall.', 'entertainment', 'fa-tv'],
    [
        'pa_system',
        'PA system',
        'Public-address system.',
        'entertainment',
        'fa-volume-high'
    ],
    [
        'amplifier_rack',
        'Amplifier rack',
        'Audio amplifier rack.',
        'entertainment',
        'fa-volume-high'
    ],
    [
        'cinema_projector',
        'Cinema projector',
        'Cinema projector.',
        'entertainment',
        'fa-film'
    ],
    [
        'popcorn_machine',
        'Popcorn machine',
        'Popcorn machine.',
        'entertainment',
        'fa-bowl-food'
    ],
    [
        'arcade_machine',
        'Arcade machine',
        'Arcade cabinet.',
        'entertainment',
        'fa-gamepad'
    ],
    [
        'slot_machine',
        'Slot machine',
        'Casino slot machine.',
        'entertainment',
        'fa-coins'
    ],
    [
        'ride_drive',
        'Ride drive',
        'Amusement ride motor.',
        'entertainment',
        'fa-gears'
    ],
    [
        'ticket_kiosk',
        'Ticket kiosk',
        'Ticketing kiosk.',
        'entertainment',
        'fa-ticket'
    ],
    [
        'photo_booth',
        'Photo booth',
        'Photo booth.',
        'entertainment',
        'fa-camera'
    ],
    [
        'ice_rink_chiller',
        'Ice rink chiller',
        'Ice rink refrigeration.',
        'stadium_sports',
        'fa-snowflake'
    ],
    [
        'chain_hoist',
        'Chain hoist',
        'Rigging chain hoist.',
        'entertainment',
        'fa-truck-ramp-box'
    ],
    [
        'fog_machine',
        'Fog machine',
        'Fog / haze machine.',
        'entertainment',
        'fa-smog'
    ],
    [
        'laser_show',
        'Laser show',
        'Laser projector.',
        'entertainment',
        'fa-bolt'
    ],
    [
        'digital_press',
        'Digital press',
        'Digital printing press.',
        'industrial',
        'fa-print'
    ],
    [
        'offset_press',
        'Offset press',
        'Offset printing press.',
        'industrial',
        'fa-print'
    ],
    [
        'large_format_printer',
        'Large format printer',
        'Wide-format printer.',
        'industrial',
        'fa-print'
    ],
    ['laminator', 'Laminator', 'Laminating machine.', 'industrial', 'fa-print'],
    [
        'cnc_sign_router',
        'CNC sign router',
        'Sign-making router.',
        'industrial',
        'fa-gears'
    ],
    ['led_billboard', 'LED billboard', 'LED billboard.', 'smart_city', 'fa-tv'],
    [
        'broadcast_transmitter',
        'Broadcast transmitter',
        'Broadcast transmitter.',
        'film_media',
        'fa-tower-broadcast'
    ],
    [
        'studio_lighting',
        'Studio lighting',
        'Studio lighting rig.',
        'film_media',
        'fa-lightbulb'
    ],
    [
        'jet_bridge',
        'Jet bridge',
        'Passenger boarding bridge.',
        'transportation',
        'fa-plane'
    ],
    [
        'baggage_carousel',
        'Baggage carousel',
        'Baggage carousel.',
        'transportation',
        'fa-suitcase-rolling'
    ],
    [
        'runway_lighting',
        'Runway lighting',
        'Runway lighting.',
        'transportation',
        'fa-lightbulb'
    ],
    [
        'deicing_rig',
        'Deicing rig',
        'Aircraft deicing rig.',
        'transportation',
        'fa-snowflake'
    ],
    [
        'ground_power_unit',
        'Ground power unit',
        'Aircraft GPU.',
        'transportation',
        'fa-plug'
    ],
    [
        'point_heater',
        'Point heater',
        'Rail switch heater.',
        'mass_transit',
        'fa-temperature-high'
    ],
    [
        'traction_substation',
        'Traction substation',
        'Rail traction substation.',
        'mass_transit',
        'fa-bolt'
    ],
    [
        'platform_hvac',
        'Platform HVAC',
        'Station platform HVAC.',
        'mass_transit',
        'fa-fan'
    ],
    [
        'signaling_system',
        'Signaling system',
        'Rail signaling system.',
        'mass_transit',
        'fa-bolt'
    ],
    [
        'ship_to_shore_crane',
        'Ship-to-shore crane',
        'STS quay crane.',
        'marine_offshore',
        'fa-truck-ramp-box'
    ],
    [
        'rtg_crane',
        'RTG crane',
        'Yard gantry crane.',
        'marine_offshore',
        'fa-truck-ramp-box'
    ],
    [
        'reefer_rack',
        'Reefer rack',
        'Reefer container rack.',
        'marine_offshore',
        'fa-snowflake'
    ],
    [
        'shore_power',
        'Shore power',
        'Cold-ironing shore power.',
        'marine_offshore',
        'fa-plug'
    ],
    [
        'dredge_pump',
        'Dredge pump',
        'Dredging pump.',
        'marine_offshore',
        'fa-faucet'
    ],
    [
        'lock_gate_motor',
        'Lock gate motor',
        'Canal lock gate motor.',
        'marine_offshore',
        'fa-gears'
    ],
    [
        'tunnel_jet_fan',
        'Tunnel jet fan',
        'Tunnel ventilation jet fan.',
        'transportation',
        'fa-fan'
    ],
    [
        'tunnel_lighting',
        'Tunnel lighting',
        'Tunnel lighting.',
        'transportation',
        'fa-lightbulb'
    ],
    [
        'tunnel_drainage_pump',
        'Tunnel drainage pump',
        'Tunnel drainage pump.',
        'transportation',
        'fa-faucet'
    ],
    [
        'toll_gantry',
        'Toll gantry',
        'Tolling gantry.',
        'transportation',
        'fa-road'
    ],
    [
        'highway_sign',
        'Highway sign',
        'Variable message sign.',
        'transportation',
        'fa-sign-hanging'
    ],
    [
        'road_heating',
        'Road heating',
        'Heated road / ramp.',
        'transportation',
        'fa-temperature-high'
    ],
    [
        'pool_filtration_pump',
        'Pool filtration pump',
        'Pool filter pump.',
        'stadium_sports',
        'fa-faucet'
    ],
    [
        'pool_heat_pump',
        'Pool heat pump',
        'Pool heat pump.',
        'stadium_sports',
        'fa-temperature-high'
    ],
    [
        'pool_uv',
        'Pool UV',
        'Pool UV sanitizer.',
        'stadium_sports',
        'fa-lightbulb'
    ],
    [
        'wave_machine',
        'Wave machine',
        'Wave pool machine.',
        'stadium_sports',
        'fa-water'
    ],
    [
        'water_slide_pump',
        'Water slide pump',
        'Water-slide pump.',
        'stadium_sports',
        'fa-faucet'
    ],
    [
        'snow_gun',
        'Snow gun',
        'Snowmaking gun.',
        'stadium_sports',
        'fa-snowflake'
    ],
    [
        'snow_cannon',
        'Snow cannon',
        'Snowmaking cannon.',
        'stadium_sports',
        'fa-snowflake'
    ],
    [
        'ski_lift_motor',
        'Ski lift motor',
        'Ski lift drive.',
        'stadium_sports',
        'fa-gears'
    ],
    [
        'gondola_drive',
        'Gondola drive',
        'Gondola lift drive.',
        'mass_transit',
        'fa-gears'
    ],
    [
        'snowmaking_pump',
        'Snowmaking pump',
        'Snowmaking water pump.',
        'stadium_sports',
        'fa-faucet'
    ],
    [
        'coaster_lift_motor',
        'Coaster lift motor',
        'Roller-coaster lift motor.',
        'entertainment',
        'fa-gears'
    ],
    [
        'animatronics',
        'Animatronics',
        'Animatronic figure.',
        'entertainment',
        'fa-robot'
    ],
    [
        'fountain_show_pump',
        'Fountain show pump',
        'Show fountain pump.',
        'entertainment',
        'fa-faucet'
    ],
    [
        'traffic_signal',
        'Traffic signal',
        'Traffic light.',
        'smart_city',
        'fa-traffic-light'
    ],
    [
        'smart_streetlight_node',
        'Smart streetlight node',
        'Connected streetlight.',
        'smart_city',
        'fa-lightbulb'
    ],
    [
        'ev_curb_charger',
        'Curb EV charger',
        'Curbside EV charger.',
        'smart_city',
        'fa-charging-station'
    ],
    [
        'public_wifi_node',
        'Public WiFi node',
        'Public Wi-Fi node.',
        'smart_city',
        'fa-wifi'
    ],
    [
        'environmental_sensor_station',
        'Environmental sensor station',
        'Air-quality sensor station.',
        'smart_city',
        'fa-gauge'
    ],
    [
        'digital_bus_stop',
        'Digital bus stop',
        'Smart bus shelter.',
        'smart_city',
        'fa-bus'
    ],
    [
        'parking_meter',
        'Parking meter',
        'Smart parking meter.',
        'smart_city',
        'fa-square-parking'
    ],
    [
        'ticket_machine',
        'Ticket machine',
        'Ticket vending machine.',
        'smart_city',
        'fa-ticket'
    ],
    [
        'atm',
        'ATM',
        'Automated teller machine.',
        'convenience_service',
        'fa-money-bill'
    ],
    [
        'coffee_kiosk',
        'Coffee kiosk',
        'Self-serve coffee kiosk.',
        'convenience_service',
        'fa-mug-hot'
    ],
    [
        'water_feature',
        'Water feature',
        'Decorative water feature.',
        'building',
        'fa-faucet'
    ],
    [
        'heated_driveway',
        'Heated driveway',
        'Heated driveway.',
        'building',
        'fa-temperature-high'
    ],
    [
        'heated_gutter',
        'Heated gutter',
        'Gutter heat trace.',
        'building',
        'fa-temperature-high'
    ],
    [
        'fountain_pump',
        'Fountain pump',
        'Fountain pump.',
        'building',
        'fa-faucet'
    ],
    [
        'christmas_lighting',
        'Holiday lighting',
        'Seasonal decorative lighting.',
        'building',
        'fa-lightbulb'
    ],
    [
        'billboard_lighting',
        'Billboard lighting',
        'Billboard floodlighting.',
        'smart_city',
        'fa-lightbulb'
    ],
    [
        'generic_heater',
        'Generic heater',
        'Unspecified heating load.',
        'electrical',
        'fa-temperature-high'
    ],
    [
        'generic_pump',
        'Generic pump',
        'Unspecified pump load.',
        'electrical',
        'fa-faucet'
    ],
    [
        'generic_fan',
        'Generic fan',
        'Unspecified fan load.',
        'electrical',
        'fa-fan'
    ],
    [
        'generic_compressor',
        'Generic compressor',
        'Unspecified compressor load.',
        'electrical',
        'fa-gauge-high'
    ],
    [
        'sub_circuit',
        'Sub-circuit',
        'Monitored sub-circuit.',
        'electrical',
        'fa-plug'
    ],
    [
        'unknown_load',
        'Unknown load',
        'Unidentified load.',
        'electrical',
        'fa-plug'
    ]
];

// Bulk rows sort after the structural kinds; 1000 base keeps them clear of the
// hand-tuned sortOrders on the structural catalog.
export const CONSUMER_KINDS: readonly GroupKindDefinition[] =
    CONSUMER_KIND_DATA.map(
        ([id, displayName, description, category, icon], index) => ({
            id,
            appliesTo: 'both',
            displayName,
            description,
            category,
            icon,
            metadataSchema: SCHEMA_EMPTY,
            sortOrder: 1000 + index
        })
    );
