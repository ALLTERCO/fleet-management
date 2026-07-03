// Curated FA Free icon set for the virtual-component icon picker.
// Categorised + tagged for search. Class names are valid FA Free 6.x.
// Stored as `fas fa-<name>` strings in `meta.ui.glyph` (FM-side).

export interface IconLibraryEntry {
    cls: string;
    label: string;
    category: IconCategory;
    tags: string[];
}

export type IconCategory =
    | 'lighting'
    | 'climate'
    | 'energy'
    | 'sensors'
    | 'industrial'
    | 'security'
    | 'water'
    | 'network'
    | 'modes'
    | 'vehicles'
    | 'building'
    | 'tools'
    | 'media'
    | 'controls'
    | 'misc';

export const ICON_CATEGORIES: Array<{key: IconCategory; label: string}> = [
    {key: 'lighting', label: 'Lighting'},
    {key: 'climate', label: 'Climate / HVAC'},
    {key: 'energy', label: 'Energy / Power'},
    {key: 'sensors', label: 'Sensors'},
    {key: 'industrial', label: 'Industrial / Machines'},
    {key: 'security', label: 'Security'},
    {key: 'water', label: 'Water'},
    {key: 'network', label: 'Network'},
    {key: 'modes', label: 'Modes / Scenes'},
    {key: 'vehicles', label: 'Vehicles'},
    {key: 'building', label: 'Building'},
    {key: 'tools', label: 'Tools'},
    {key: 'media', label: 'Media'},
    {key: 'controls', label: 'Controls'},
    {key: 'misc', label: 'Misc'}
];

export const ICON_LIBRARY: IconLibraryEntry[] = [
    // ─── Lighting ──────────────────────────────────────────
    {
        cls: 'fas fa-lightbulb',
        label: 'Light bulb',
        category: 'lighting',
        tags: ['bulb', 'lamp', 'light']
    },
    {
        cls: 'fas fa-bolt-lightning',
        label: 'Bolt',
        category: 'lighting',
        tags: ['lightning', 'flash']
    },
    {
        cls: 'fas fa-bolt',
        label: 'Lightning',
        category: 'lighting',
        tags: ['bolt', 'flash']
    },
    {
        cls: 'fas fa-sun',
        label: 'Sun',
        category: 'lighting',
        tags: ['daylight', 'bright']
    },
    {
        cls: 'fas fa-moon',
        label: 'Moon',
        category: 'lighting',
        tags: ['night', 'dim']
    },
    {
        cls: 'fas fa-fire',
        label: 'Fire',
        category: 'lighting',
        tags: ['flame', 'candle']
    },
    {
        cls: 'fas fa-fire-flame-simple',
        label: 'Flame',
        category: 'lighting',
        tags: ['fire', 'candle']
    },
    {
        cls: 'fas fa-fire-flame-curved',
        label: 'Candle flame',
        category: 'lighting',
        tags: ['fire']
    },
    {
        cls: 'fas fa-eye',
        label: 'Visibility',
        category: 'lighting',
        tags: ['see', 'view']
    },
    {
        cls: 'fas fa-eye-slash',
        label: 'Hidden',
        category: 'lighting',
        tags: ['hide']
    },
    {
        cls: 'fas fa-circle-half-stroke',
        label: 'Dimmer',
        category: 'lighting',
        tags: ['half', 'brightness']
    },
    {
        cls: 'fas fa-droplet',
        label: 'Droplet (RGB)',
        category: 'lighting',
        tags: ['color', 'paint']
    },
    {
        cls: 'fas fa-palette',
        label: 'Palette',
        category: 'lighting',
        tags: ['color', 'rgb']
    },
    {
        cls: 'fas fa-rainbow',
        label: 'Rainbow',
        category: 'lighting',
        tags: ['color', 'spectrum']
    },
    {
        cls: 'fas fa-circle-nodes',
        label: 'LED strip',
        category: 'lighting',
        tags: ['nodes', 'addressable']
    },
    {
        cls: 'fas fa-glasses',
        label: 'Reading light',
        category: 'lighting',
        tags: ['vision']
    },
    {
        cls: 'fas fa-tv',
        label: 'Display',
        category: 'lighting',
        tags: ['screen', 'monitor']
    },
    {
        cls: 'fas fa-spinner',
        label: 'Spinning effect',
        category: 'lighting',
        tags: ['rotate']
    },
    {
        cls: 'fas fa-stars',
        label: 'Stars',
        category: 'lighting',
        tags: ['twinkle']
    },
    {
        cls: 'fas fa-star',
        label: 'Star',
        category: 'lighting',
        tags: ['favorite', 'shine']
    },

    // ─── Climate / HVAC ────────────────────────────────────
    {
        cls: 'fas fa-temperature-high',
        label: 'High temperature',
        category: 'climate',
        tags: ['hot', 'heat']
    },
    {
        cls: 'fas fa-temperature-low',
        label: 'Low temperature',
        category: 'climate',
        tags: ['cold']
    },
    {
        cls: 'fas fa-temperature-quarter',
        label: 'Temp 1/4',
        category: 'climate',
        tags: ['low']
    },
    {
        cls: 'fas fa-temperature-half',
        label: 'Temp 1/2',
        category: 'climate',
        tags: ['medium']
    },
    {
        cls: 'fas fa-temperature-three-quarters',
        label: 'Temp 3/4',
        category: 'climate',
        tags: ['high']
    },
    {
        cls: 'fas fa-temperature-full',
        label: 'Temp full',
        category: 'climate',
        tags: ['max', 'hot']
    },
    {
        cls: 'fas fa-temperature-empty',
        label: 'Temp empty',
        category: 'climate',
        tags: ['cold', 'min']
    },
    {
        cls: 'fas fa-thermometer',
        label: 'Thermometer',
        category: 'climate',
        tags: ['temperature', 'measure']
    },
    {
        cls: 'fas fa-snowflake',
        label: 'Snowflake',
        category: 'climate',
        tags: ['cold', 'cooling', 'frost']
    },
    {
        cls: 'fas fa-icicles',
        label: 'Icicles',
        category: 'climate',
        tags: ['cold', 'freeze']
    },
    {
        cls: 'fas fa-fan',
        label: 'Fan',
        category: 'climate',
        tags: ['cooling', 'ventilation']
    },
    {
        cls: 'fas fa-wind',
        label: 'Wind',
        category: 'climate',
        tags: ['airflow', 'breeze']
    },
    {
        cls: 'fas fa-cloud',
        label: 'Cloud',
        category: 'climate',
        tags: ['weather']
    },
    {
        cls: 'fas fa-cloud-sun',
        label: 'Partly cloudy',
        category: 'climate',
        tags: ['weather']
    },
    {
        cls: 'fas fa-cloud-moon',
        label: 'Cloudy night',
        category: 'climate',
        tags: ['weather']
    },
    {
        cls: 'fas fa-cloud-rain',
        label: 'Rain',
        category: 'climate',
        tags: ['weather', 'wet']
    },
    {
        cls: 'fas fa-cloud-showers-heavy',
        label: 'Heavy rain',
        category: 'climate',
        tags: ['weather', 'storm']
    },
    {
        cls: 'fas fa-cloud-bolt',
        label: 'Thunderstorm',
        category: 'climate',
        tags: ['weather', 'lightning']
    },
    {
        cls: 'fas fa-cloud-sun-rain',
        label: 'Sun shower',
        category: 'climate',
        tags: ['weather']
    },
    {
        cls: 'fas fa-cloud-meatball',
        label: 'Hail',
        category: 'climate',
        tags: ['weather']
    },
    {
        cls: 'fas fa-tornado',
        label: 'Tornado',
        category: 'climate',
        tags: ['storm']
    },
    {
        cls: 'fas fa-hurricane',
        label: 'Hurricane',
        category: 'climate',
        tags: ['storm']
    },
    {
        cls: 'fas fa-smog',
        label: 'Smog',
        category: 'climate',
        tags: ['fog', 'air quality']
    },
    {
        cls: 'fas fa-house-fire',
        label: 'House fire',
        category: 'climate',
        tags: ['heating']
    },
    {
        cls: 'fas fa-fire-burner',
        label: 'Burner',
        category: 'climate',
        tags: ['stove']
    },
    {
        cls: 'fas fa-radiation',
        label: 'Radiation',
        category: 'climate',
        tags: ['heat', 'radiator']
    },
    {
        cls: 'fas fa-mound',
        label: 'Heat pump',
        category: 'climate',
        tags: ['hvac']
    },
    {
        cls: 'fas fa-mug-hot',
        label: 'Hot drink',
        category: 'climate',
        tags: ['warm']
    },
    {
        cls: 'fas fa-toilet-paper',
        label: 'Roll',
        category: 'climate',
        tags: ['placeholder']
    },
    {
        cls: 'fas fa-droplet-slash',
        label: 'Dry mode',
        category: 'climate',
        tags: ['dehumidify']
    },
    {
        cls: 'fas fa-droplet',
        label: 'Humidity',
        category: 'climate',
        tags: ['water', 'humid']
    },
    {
        cls: 'fas fa-leaf',
        label: 'Eco mode',
        category: 'climate',
        tags: ['eco', 'green']
    },
    {
        cls: 'fas fa-seedling',
        label: 'Sprout',
        category: 'climate',
        tags: ['eco', 'grow']
    },
    {
        cls: 'fas fa-bed',
        label: 'Sleep mode',
        category: 'climate',
        tags: ['night', 'quiet']
    },

    // ─── Energy / Power ─────────────────────────────────────
    {
        cls: 'fas fa-plug',
        label: 'Plug',
        category: 'energy',
        tags: ['power', 'outlet']
    },
    {
        cls: 'fas fa-plug-circle-bolt',
        label: 'Plug + bolt',
        category: 'energy',
        tags: ['power']
    },
    {
        cls: 'fas fa-plug-circle-check',
        label: 'Plug check',
        category: 'energy',
        tags: ['power']
    },
    {
        cls: 'fas fa-plug-circle-xmark',
        label: 'Plug off',
        category: 'energy',
        tags: ['power']
    },
    {
        cls: 'fas fa-plug-circle-plus',
        label: 'Plug add',
        category: 'energy',
        tags: ['power']
    },
    {
        cls: 'fas fa-plug-circle-exclamation',
        label: 'Plug fault',
        category: 'energy',
        tags: ['warning']
    },
    {
        cls: 'fas fa-plug-circle-minus',
        label: 'Plug minus',
        category: 'energy',
        tags: ['power']
    },
    {
        cls: 'fas fa-battery-full',
        label: 'Battery full',
        category: 'energy',
        tags: ['full']
    },
    {
        cls: 'fas fa-battery-three-quarters',
        label: 'Battery 3/4',
        category: 'energy',
        tags: ['high']
    },
    {
        cls: 'fas fa-battery-half',
        label: 'Battery half',
        category: 'energy',
        tags: ['medium']
    },
    {
        cls: 'fas fa-battery-quarter',
        label: 'Battery low',
        category: 'energy',
        tags: ['low']
    },
    {
        cls: 'fas fa-battery-empty',
        label: 'Battery empty',
        category: 'energy',
        tags: ['critical']
    },
    {
        cls: 'fas fa-car-battery',
        label: 'Car battery',
        category: 'energy',
        tags: ['vehicle', 'lead acid']
    },
    {
        cls: 'fas fa-charging-station',
        label: 'Charging station',
        category: 'energy',
        tags: ['ev', 'charger']
    },
    {
        cls: 'fas fa-bolt-auto',
        label: 'Auto power',
        category: 'energy',
        tags: ['auto']
    },
    {
        cls: 'fas fa-power-off',
        label: 'Power off',
        category: 'energy',
        tags: ['on', 'off']
    },
    {
        cls: 'fas fa-solar-panel',
        label: 'Solar panel',
        category: 'energy',
        tags: ['pv', 'solar', 'renewable']
    },
    {
        cls: 'fas fa-wind',
        label: 'Wind turbine',
        category: 'energy',
        tags: ['renewable']
    },
    {
        cls: 'fas fa-gauge-high',
        label: 'Gauge high',
        category: 'energy',
        tags: ['meter']
    },
    {cls: 'fas fa-gauge', label: 'Gauge', category: 'energy', tags: ['meter']},
    {
        cls: 'fas fa-gauge-simple',
        label: 'Gauge simple',
        category: 'energy',
        tags: ['meter']
    },
    {
        cls: 'fas fa-gauge-simple-high',
        label: 'High pressure',
        category: 'energy',
        tags: ['meter']
    },
    {
        cls: 'fas fa-tachograph-digital',
        label: 'Energy meter',
        category: 'energy',
        tags: ['metering']
    },
    {
        cls: 'fas fa-microchip',
        label: 'Microchip',
        category: 'energy',
        tags: ['ic', 'electronics']
    },
    {
        cls: 'fas fa-circuit-board',
        label: 'Circuit board',
        category: 'energy',
        tags: ['pcb']
    },
    {
        cls: 'fas fa-bezier-curve',
        label: 'Inverter curve',
        category: 'energy',
        tags: ['inverter']
    },
    {
        cls: 'fas fa-wave-square',
        label: 'AC waveform',
        category: 'energy',
        tags: ['ac', 'signal']
    },
    {
        cls: 'fas fa-circle-half-stroke',
        label: 'Voltage',
        category: 'energy',
        tags: ['voltage']
    },
    {
        cls: 'fas fa-square-poll-vertical',
        label: 'Consumption chart',
        category: 'energy',
        tags: ['chart', 'meter']
    },
    {
        cls: 'fas fa-chart-line',
        label: 'Trend',
        category: 'energy',
        tags: ['chart']
    },
    {
        cls: 'fas fa-chart-column',
        label: 'Bar chart',
        category: 'energy',
        tags: ['chart']
    },
    {
        cls: 'fas fa-chart-pie',
        label: 'Pie chart',
        category: 'energy',
        tags: ['chart']
    },
    {
        cls: 'fas fa-piggy-bank',
        label: 'Savings',
        category: 'energy',
        tags: ['cost', 'savings']
    },
    {cls: 'fas fa-coins', label: 'Cost', category: 'energy', tags: ['money']},
    {
        cls: 'fas fa-money-bill',
        label: 'Bill',
        category: 'energy',
        tags: ['cost']
    },
    {cls: 'fas fa-leaf', label: 'Renewable', category: 'energy', tags: ['eco']},

    // ─── Sensors ───────────────────────────────────────────
    {
        cls: 'fas fa-person-walking',
        label: 'Motion',
        category: 'sensors',
        tags: ['walking', 'detect']
    },
    {
        cls: 'fas fa-person-running',
        label: 'Running motion',
        category: 'sensors',
        tags: ['detect']
    },
    {
        cls: 'fas fa-eye',
        label: 'Presence',
        category: 'sensors',
        tags: ['detect']
    },
    {
        cls: 'fas fa-shield-cat',
        label: 'Pet detect',
        category: 'sensors',
        tags: ['pet', 'animal']
    },
    {cls: 'fas fa-paw', label: 'Pet', category: 'sensors', tags: ['animal']},
    {
        cls: 'fas fa-temperature-half',
        label: 'Temp sensor',
        category: 'sensors',
        tags: ['temperature']
    },
    {
        cls: 'fas fa-droplet',
        label: 'Humidity sensor',
        category: 'sensors',
        tags: ['water']
    },
    {
        cls: 'fas fa-smog',
        label: 'Air quality',
        category: 'sensors',
        tags: ['voc', 'pm2.5']
    },
    {
        cls: 'fas fa-wind',
        label: 'Wind speed',
        category: 'sensors',
        tags: ['anemometer']
    },
    {
        cls: 'fas fa-compass',
        label: 'Wind direction',
        category: 'sensors',
        tags: ['heading']
    },
    {
        cls: 'fas fa-compass-drafting',
        label: 'Compass',
        category: 'sensors',
        tags: ['direction']
    },
    {
        cls: 'fas fa-water',
        label: 'Water leak',
        category: 'sensors',
        tags: ['flood', 'leak']
    },
    {
        cls: 'fas fa-house-flood-water',
        label: 'Flood',
        category: 'sensors',
        tags: ['water']
    },
    {
        cls: 'fas fa-fire-smoke',
        label: 'Smoke',
        category: 'sensors',
        tags: ['fire']
    },
    {
        cls: 'fas fa-fire',
        label: 'Fire alarm',
        category: 'sensors',
        tags: ['flame']
    },
    {
        cls: 'fas fa-radiation',
        label: 'Radon',
        category: 'sensors',
        tags: ['radiation']
    },
    {
        cls: 'fas fa-skull-crossbones',
        label: 'CO2 / hazard',
        category: 'sensors',
        tags: ['gas']
    },
    {
        cls: 'fas fa-mask-face',
        label: 'Air filter',
        category: 'sensors',
        tags: ['filter']
    },
    {
        cls: 'fas fa-cube',
        label: 'Generic sensor',
        category: 'sensors',
        tags: ['box']
    },
    {
        cls: 'fas fa-square-poll-horizontal',
        label: 'Light level',
        category: 'sensors',
        tags: ['illuminance']
    },
    {
        cls: 'fas fa-sun',
        label: 'Lux sensor',
        category: 'sensors',
        tags: ['illuminance', 'light']
    },
    {
        cls: 'fas fa-volume-high',
        label: 'Sound sensor',
        category: 'sensors',
        tags: ['noise']
    },
    {
        cls: 'fas fa-microphone',
        label: 'Microphone',
        category: 'sensors',
        tags: ['sound']
    },
    {cls: 'fas fa-bell', label: 'Alarm', category: 'sensors', tags: ['notify']},
    {
        cls: 'fas fa-bell-slash',
        label: 'Silenced',
        category: 'sensors',
        tags: ['mute']
    },
    {
        cls: 'fas fa-door-open',
        label: 'Door open',
        category: 'sensors',
        tags: ['contact']
    },
    {
        cls: 'fas fa-door-closed',
        label: 'Door closed',
        category: 'sensors',
        tags: ['contact']
    },
    {
        cls: 'fas fa-window-maximize',
        label: 'Window',
        category: 'sensors',
        tags: ['contact']
    },
    {
        cls: 'fas fa-window-minimize',
        label: 'Window closed',
        category: 'sensors',
        tags: ['contact']
    },
    {
        cls: 'fas fa-magnet',
        label: 'Magnet contact',
        category: 'sensors',
        tags: ['reed']
    },
    {
        cls: 'fas fa-vibrate',
        label: 'Vibration',
        category: 'sensors',
        tags: ['shock']
    },
    {
        cls: 'fas fa-tilt',
        label: 'Tilt',
        category: 'sensors',
        tags: ['orientation']
    },
    {
        cls: 'fas fa-gauge',
        label: 'Pressure',
        category: 'sensors',
        tags: ['barometer']
    },
    {
        cls: 'fas fa-arrows-up-down',
        label: 'Altitude',
        category: 'sensors',
        tags: ['height']
    },
    {
        cls: 'fas fa-ruler',
        label: 'Distance',
        category: 'sensors',
        tags: ['range']
    },
    {
        cls: 'fas fa-ruler-combined',
        label: 'Dimensions',
        category: 'sensors',
        tags: ['measure']
    },
    {
        cls: 'fas fa-weight-scale',
        label: 'Weight',
        category: 'sensors',
        tags: ['scale']
    },

    // ─── Industrial / Machines ─────────────────────────────
    {
        cls: 'fas fa-industry',
        label: 'Factory',
        category: 'industrial',
        tags: ['plant', 'factory']
    },
    {
        cls: 'fas fa-warehouse',
        label: 'Warehouse',
        category: 'industrial',
        tags: ['storage']
    },
    {
        cls: 'fas fa-gears',
        label: 'Gears',
        category: 'industrial',
        tags: ['mechanical', 'cogs']
    },
    {
        cls: 'fas fa-gear',
        label: 'Gear',
        category: 'industrial',
        tags: ['cog', 'settings']
    },
    {cls: 'fas fa-cog', label: 'Cog', category: 'industrial', tags: ['gear']},
    {
        cls: 'fas fa-cogs',
        label: 'Cogs',
        category: 'industrial',
        tags: ['mechanical']
    },
    {
        cls: 'fas fa-screwdriver-wrench',
        label: 'Mechanic tools',
        category: 'industrial',
        tags: ['repair']
    },
    {
        cls: 'fas fa-wrench',
        label: 'Wrench',
        category: 'industrial',
        tags: ['maintenance']
    },
    {
        cls: 'fas fa-hammer',
        label: 'Hammer',
        category: 'industrial',
        tags: ['repair']
    },
    {
        cls: 'fas fa-screwdriver',
        label: 'Screwdriver',
        category: 'industrial',
        tags: ['tool']
    },
    {
        cls: 'fas fa-toolbox',
        label: 'Toolbox',
        category: 'industrial',
        tags: ['kit']
    },
    {
        cls: 'fas fa-robot',
        label: 'Robot',
        category: 'industrial',
        tags: ['automation']
    },
    {
        cls: 'fas fa-conveyor-belt',
        label: 'Conveyor',
        category: 'industrial',
        tags: ['belt']
    },
    {
        cls: 'fas fa-conveyor-belt-boxes',
        label: 'Conveyor + boxes',
        category: 'industrial',
        tags: ['assembly']
    },
    {
        cls: 'fas fa-truck-ramp-box',
        label: 'Loading dock',
        category: 'industrial',
        tags: ['shipping']
    },
    {
        cls: 'fas fa-pallet',
        label: 'Pallet',
        category: 'industrial',
        tags: ['stock']
    },
    {
        cls: 'fas fa-pallet-boxes',
        label: 'Pallet stack',
        category: 'industrial',
        tags: ['inventory']
    },
    {
        cls: 'fas fa-boxes-stacked',
        label: 'Stock',
        category: 'industrial',
        tags: ['inventory']
    },
    {
        cls: 'fas fa-dolly',
        label: 'Dolly',
        category: 'industrial',
        tags: ['cart']
    },
    {
        cls: 'fas fa-helmet-safety',
        label: 'Hard hat',
        category: 'industrial',
        tags: ['safety']
    },
    {
        cls: 'fas fa-mask-ventilator',
        label: 'Ventilator',
        category: 'industrial',
        tags: ['safety']
    },
    {
        cls: 'fas fa-person-digging',
        label: 'Worker',
        category: 'industrial',
        tags: ['labor']
    },
    {
        cls: 'fas fa-truck',
        label: 'Truck',
        category: 'industrial',
        tags: ['transport']
    },
    {
        cls: 'fas fa-truck-fast',
        label: 'Express truck',
        category: 'industrial',
        tags: ['delivery']
    },
    {
        cls: 'fas fa-truck-pickup',
        label: 'Pickup',
        category: 'industrial',
        tags: ['vehicle']
    },
    {
        cls: 'fas fa-tractor',
        label: 'Tractor',
        category: 'industrial',
        tags: ['agriculture']
    },
    {
        cls: 'fas fa-snowplow',
        label: 'Snowplow',
        category: 'industrial',
        tags: ['plow']
    },
    {
        cls: 'fas fa-oil-can',
        label: 'Oil can',
        category: 'industrial',
        tags: ['lubricant']
    },
    {
        cls: 'fas fa-oil-well',
        label: 'Oil well',
        category: 'industrial',
        tags: ['petroleum']
    },
    {
        cls: 'fas fa-gas-pump',
        label: 'Fuel pump',
        category: 'industrial',
        tags: ['gas']
    },
    {
        cls: 'fas fa-jug-detergent',
        label: 'Detergent',
        category: 'industrial',
        tags: ['cleaning']
    },
    {
        cls: 'fas fa-cube',
        label: 'Block',
        category: 'industrial',
        tags: ['component']
    },
    {
        cls: 'fas fa-cubes',
        label: 'Blocks',
        category: 'industrial',
        tags: ['components']
    },
    {
        cls: 'fas fa-cubes-stacked',
        label: 'Stack',
        category: 'industrial',
        tags: ['inventory']
    },
    {
        cls: 'fas fa-box-archive',
        label: 'Archive',
        category: 'industrial',
        tags: ['storage']
    },
    {
        cls: 'fas fa-box',
        label: 'Box',
        category: 'industrial',
        tags: ['package']
    },
    {
        cls: 'fas fa-tags',
        label: 'Tags',
        category: 'industrial',
        tags: ['labels']
    },
    {cls: 'fas fa-tag', label: 'Tag', category: 'industrial', tags: ['label']},
    {
        cls: 'fas fa-barcode',
        label: 'Barcode',
        category: 'industrial',
        tags: ['scan']
    },
    {
        cls: 'fas fa-qrcode',
        label: 'QR code',
        category: 'industrial',
        tags: ['scan']
    },
    {
        cls: 'fas fa-microscope',
        label: 'Microscope',
        category: 'industrial',
        tags: ['lab']
    },
    {
        cls: 'fas fa-flask',
        label: 'Flask',
        category: 'industrial',
        tags: ['lab', 'chemistry']
    },
    {
        cls: 'fas fa-flask-vial',
        label: 'Flask vial',
        category: 'industrial',
        tags: ['lab']
    },
    {cls: 'fas fa-vial', label: 'Vial', category: 'industrial', tags: ['lab']},
    {
        cls: 'fas fa-vials',
        label: 'Vials',
        category: 'industrial',
        tags: ['lab']
    },
    {
        cls: 'fas fa-vault',
        label: 'Vault',
        category: 'industrial',
        tags: ['storage']
    },

    // ─── Security ──────────────────────────────────────────
    {
        cls: 'fas fa-lock',
        label: 'Lock',
        category: 'security',
        tags: ['secure', 'closed']
    },
    {
        cls: 'fas fa-unlock',
        label: 'Unlock',
        category: 'security',
        tags: ['open']
    },
    {
        cls: 'fas fa-lock-open',
        label: 'Open lock',
        category: 'security',
        tags: ['unlocked']
    },
    {cls: 'fas fa-key', label: 'Key', category: 'security', tags: ['access']},
    {
        cls: 'fas fa-shield',
        label: 'Shield',
        category: 'security',
        tags: ['protected']
    },
    {
        cls: 'fas fa-shield-halved',
        label: 'Shield half',
        category: 'security',
        tags: ['armoured']
    },
    {
        cls: 'fas fa-shield-heart',
        label: 'Shield heart',
        category: 'security',
        tags: ['safe']
    },
    {
        cls: 'fas fa-fingerprint',
        label: 'Fingerprint',
        category: 'security',
        tags: ['biometric']
    },
    {
        cls: 'fas fa-id-badge',
        label: 'ID badge',
        category: 'security',
        tags: ['badge']
    },
    {
        cls: 'fas fa-id-card',
        label: 'ID card',
        category: 'security',
        tags: ['card']
    },
    {
        cls: 'fas fa-user-shield',
        label: 'Guarded user',
        category: 'security',
        tags: ['protected']
    },
    {
        cls: 'fas fa-user-lock',
        label: 'Locked user',
        category: 'security',
        tags: ['secure']
    },
    {
        cls: 'fas fa-user-secret',
        label: 'Stealth',
        category: 'security',
        tags: ['private']
    },
    {
        cls: 'fas fa-camera',
        label: 'Camera',
        category: 'security',
        tags: ['cctv', 'surveillance']
    },
    {
        cls: 'fas fa-video',
        label: 'Video camera',
        category: 'security',
        tags: ['recording']
    },
    {
        cls: 'fas fa-bell-concierge',
        label: 'Doorbell',
        category: 'security',
        tags: ['ring']
    },
    {
        cls: 'fas fa-house-lock',
        label: 'House lock',
        category: 'security',
        tags: ['armed']
    },
    {
        cls: 'fas fa-house-shield',
        label: 'House shield',
        category: 'security',
        tags: ['armed']
    },
    {
        cls: 'fas fa-shield-virus',
        label: 'Antivirus',
        category: 'security',
        tags: ['protected']
    },
    {cls: 'fas fa-vault', label: 'Vault', category: 'security', tags: ['safe']},
    {
        cls: 'fas fa-eye',
        label: 'Watch',
        category: 'security',
        tags: ['monitor']
    },
    {
        cls: 'fas fa-eye-slash',
        label: 'Stop watching',
        category: 'security',
        tags: ['hidden']
    },
    {
        cls: 'fas fa-bug',
        label: 'Threat',
        category: 'security',
        tags: ['intrusion']
    },
    {
        cls: 'fas fa-bug-slash',
        label: 'Cleared',
        category: 'security',
        tags: ['safe']
    },
    {
        cls: 'fas fa-skull-crossbones',
        label: 'Danger',
        category: 'security',
        tags: ['hazard']
    },
    {
        cls: 'fas fa-triangle-exclamation',
        label: 'Warning',
        category: 'security',
        tags: ['alert']
    },
    {
        cls: 'fas fa-circle-exclamation',
        label: 'Alert',
        category: 'security',
        tags: ['warning']
    },
    {
        cls: 'fas fa-circle-radiation',
        label: 'Radiation alert',
        category: 'security',
        tags: ['hazard']
    },
    {
        cls: 'fas fa-handcuffs',
        label: 'Restrained',
        category: 'security',
        tags: ['locked']
    },
    {
        cls: 'fas fa-key-skeleton',
        label: 'Master key',
        category: 'security',
        tags: ['admin']
    },

    // ─── Water ─────────────────────────────────────────────
    {
        cls: 'fas fa-droplet',
        label: 'Droplet',
        category: 'water',
        tags: ['drop']
    },
    {
        cls: 'fas fa-droplet-slash',
        label: 'No water',
        category: 'water',
        tags: ['off']
    },
    {cls: 'fas fa-water', label: 'Water', category: 'water', tags: ['wave']},
    {
        cls: 'fas fa-tint',
        label: 'Drop classic',
        category: 'water',
        tags: ['drop']
    },
    {cls: 'fas fa-faucet', label: 'Faucet', category: 'water', tags: ['tap']},
    {
        cls: 'fas fa-faucet-drip',
        label: 'Dripping tap',
        category: 'water',
        tags: ['leak']
    },
    {cls: 'fas fa-shower', label: 'Shower', category: 'water', tags: ['bath']},
    {cls: 'fas fa-bath', label: 'Bath', category: 'water', tags: ['tub']},
    {
        cls: 'fas fa-hot-tub-person',
        label: 'Hot tub',
        category: 'water',
        tags: ['spa']
    },
    {cls: 'fas fa-toilet', label: 'Toilet', category: 'water', tags: ['wc']},
    {cls: 'fas fa-sink', label: 'Sink', category: 'water', tags: ['basin']},
    {
        cls: 'fas fa-water-ladder',
        label: 'Pool',
        category: 'water',
        tags: ['swimming']
    },
    {
        cls: 'fas fa-person-swimming',
        label: 'Swimming',
        category: 'water',
        tags: ['pool']
    },
    {cls: 'fas fa-fish', label: 'Fish', category: 'water', tags: ['aquarium']},
    {
        cls: 'fas fa-fish-fins',
        label: 'Fish detail',
        category: 'water',
        tags: ['aquarium']
    },
    {
        cls: 'fas fa-bottle-water',
        label: 'Bottle',
        category: 'water',
        tags: ['drink']
    },
    {
        cls: 'fas fa-glass-water',
        label: 'Glass',
        category: 'water',
        tags: ['drink']
    },
    {
        cls: 'fas fa-glass-water-droplet',
        label: 'Glass + drop',
        category: 'water',
        tags: ['hydration']
    },
    {
        cls: 'fas fa-pump-soap',
        label: 'Soap',
        category: 'water',
        tags: ['hygiene']
    },
    {
        cls: 'fas fa-soap',
        label: 'Soap bar',
        category: 'water',
        tags: ['hygiene']
    },
    {
        cls: 'fas fa-jug-detergent',
        label: 'Detergent',
        category: 'water',
        tags: ['cleaning']
    },
    {
        cls: 'fas fa-bucket',
        label: 'Bucket',
        category: 'water',
        tags: ['vessel']
    },
    {
        cls: 'fas fa-house-flood-water',
        label: 'Flood',
        category: 'water',
        tags: ['leak']
    },
    {
        cls: 'fas fa-wave-square',
        label: 'Wave',
        category: 'water',
        tags: ['flow']
    },
    {
        cls: 'fas fa-water-arrow-down',
        label: 'Drain',
        category: 'water',
        tags: ['outflow']
    },
    {
        cls: 'fas fa-water-arrow-up',
        label: 'Pump',
        category: 'water',
        tags: ['inflow']
    },
    {
        cls: 'fas fa-droplet-percent',
        label: 'Humidity %',
        category: 'water',
        tags: ['humidity']
    },
    {
        cls: 'fas fa-umbrella',
        label: 'Umbrella',
        category: 'water',
        tags: ['rain']
    },
    {
        cls: 'fas fa-spray-can-sparkles',
        label: 'Spray',
        category: 'water',
        tags: ['mist']
    },

    // ─── Network ───────────────────────────────────────────
    {
        cls: 'fas fa-wifi',
        label: 'Wi-Fi',
        category: 'network',
        tags: ['wireless']
    },
    {
        cls: 'fas fa-bluetooth',
        label: 'Bluetooth',
        category: 'network',
        tags: ['ble']
    },
    {
        cls: 'fab fa-bluetooth',
        label: 'BLE',
        category: 'network',
        tags: ['wireless']
    },
    {
        cls: 'fab fa-bluetooth-b',
        label: 'BLE compact',
        category: 'network',
        tags: ['ble']
    },
    {
        cls: 'fas fa-signal',
        label: 'Signal',
        category: 'network',
        tags: ['bars']
    },
    {
        cls: 'fas fa-tower-broadcast',
        label: 'Broadcast',
        category: 'network',
        tags: ['antenna']
    },
    {
        cls: 'fas fa-tower-cell',
        label: 'Cell tower',
        category: 'network',
        tags: ['lte']
    },
    {
        cls: 'fas fa-tower-observation',
        label: 'Tower',
        category: 'network',
        tags: ['post']
    },
    {
        cls: 'fas fa-satellite',
        label: 'Satellite',
        category: 'network',
        tags: ['orbit']
    },
    {
        cls: 'fas fa-satellite-dish',
        label: 'Dish',
        category: 'network',
        tags: ['receiver']
    },
    {
        cls: 'fas fa-network-wired',
        label: 'Wired network',
        category: 'network',
        tags: ['ethernet']
    },
    {
        cls: 'fas fa-ethernet',
        label: 'Ethernet port',
        category: 'network',
        tags: ['lan']
    },
    {
        cls: 'fas fa-server',
        label: 'Server',
        category: 'network',
        tags: ['rack']
    },
    {
        cls: 'fas fa-database',
        label: 'Database',
        category: 'network',
        tags: ['storage']
    },
    {cls: 'fas fa-hdd', label: 'Disk', category: 'network', tags: ['storage']},
    {cls: 'fas fa-cloud', label: 'Cloud', category: 'network', tags: ['saas']},
    {
        cls: 'fas fa-cloud-arrow-up',
        label: 'Cloud upload',
        category: 'network',
        tags: ['sync']
    },
    {
        cls: 'fas fa-cloud-arrow-down',
        label: 'Cloud download',
        category: 'network',
        tags: ['sync']
    },
    {
        cls: 'fas fa-globe',
        label: 'Globe',
        category: 'network',
        tags: ['internet']
    },
    {
        cls: 'fas fa-earth-americas',
        label: 'Earth',
        category: 'network',
        tags: ['global']
    },
    {cls: 'fas fa-router', label: 'Router', category: 'network', tags: ['hub']},
    {cls: 'fas fa-link', label: 'Link', category: 'network', tags: ['url']},
    {
        cls: 'fas fa-link-slash',
        label: 'Broken link',
        category: 'network',
        tags: ['disconnected']
    },
    {cls: 'fas fa-rss', label: 'Feed', category: 'network', tags: ['rss']},
    {
        cls: 'fas fa-podcast',
        label: 'Podcast',
        category: 'network',
        tags: ['stream']
    },
    {
        cls: 'fas fa-share-nodes',
        label: 'Share',
        category: 'network',
        tags: ['social']
    },
    {
        cls: 'fas fa-arrows-to-circle',
        label: 'Hub',
        category: 'network',
        tags: ['gateway']
    },
    {
        cls: 'fas fa-circle-nodes',
        label: 'Mesh',
        category: 'network',
        tags: ['nodes']
    },

    // ─── Modes / Scenes ────────────────────────────────────
    {cls: 'fas fa-house', label: 'Home', category: 'modes', tags: ['present']},
    {
        cls: 'fas fa-house-user',
        label: 'Home + user',
        category: 'modes',
        tags: ['present']
    },
    {
        cls: 'fas fa-house-chimney',
        label: 'House w/chimney',
        category: 'modes',
        tags: ['home']
    },
    {
        cls: 'fas fa-person-walking-arrow-right',
        label: 'Away',
        category: 'modes',
        tags: ['leaving']
    },
    {cls: 'fas fa-plane', label: 'Vacation', category: 'modes', tags: ['away']},
    {
        cls: 'fas fa-suitcase',
        label: 'Trip',
        category: 'modes',
        tags: ['travel']
    },
    {
        cls: 'fas fa-suitcase-rolling',
        label: 'Travel',
        category: 'modes',
        tags: ['away']
    },
    {cls: 'fas fa-bed', label: 'Sleep', category: 'modes', tags: ['night']},
    {
        cls: 'fas fa-mug-saucer',
        label: 'Morning',
        category: 'modes',
        tags: ['coffee']
    },
    {
        cls: 'fas fa-mug-hot',
        label: 'Coffee scene',
        category: 'modes',
        tags: ['drink']
    },
    {
        cls: 'fas fa-utensils',
        label: 'Dinner',
        category: 'modes',
        tags: ['meal']
    },
    {
        cls: 'fas fa-champagne-glasses',
        label: 'Party',
        category: 'modes',
        tags: ['celebration']
    },
    {
        cls: 'fas fa-cake-candles',
        label: 'Birthday',
        category: 'modes',
        tags: ['celebration']
    },
    {cls: 'fas fa-film', label: 'Movie', category: 'modes', tags: ['cinema']},
    {
        cls: 'fas fa-clapperboard',
        label: 'Cinema',
        category: 'modes',
        tags: ['film']
    },
    {cls: 'fas fa-music', label: 'Music', category: 'modes', tags: ['audio']},
    {cls: 'fas fa-gamepad', label: 'Gaming', category: 'modes', tags: ['play']},
    {
        cls: 'fas fa-book-open',
        label: 'Reading',
        category: 'modes',
        tags: ['study']
    },
    {cls: 'fas fa-laptop', label: 'Work', category: 'modes', tags: ['office']},
    {cls: 'fas fa-baby', label: 'Baby', category: 'modes', tags: ['child']},
    {
        cls: 'fas fa-children',
        label: 'Kids',
        category: 'modes',
        tags: ['family']
    },
    {
        cls: 'fas fa-people-roof',
        label: 'Family',
        category: 'modes',
        tags: ['household']
    },
    {cls: 'fas fa-cat', label: 'Pet cat', category: 'modes', tags: ['animal']},
    {cls: 'fas fa-dog', label: 'Pet dog', category: 'modes', tags: ['animal']},
    {cls: 'fas fa-fish', label: 'Aquarium', category: 'modes', tags: ['pet']},
    {cls: 'fas fa-clock', label: 'Schedule', category: 'modes', tags: ['time']},
    {
        cls: 'fas fa-calendar',
        label: 'Calendar',
        category: 'modes',
        tags: ['date']
    },
    {
        cls: 'fas fa-calendar-day',
        label: 'Today',
        category: 'modes',
        tags: ['date']
    },
    {
        cls: 'fas fa-calendar-week',
        label: 'Week',
        category: 'modes',
        tags: ['plan']
    },
    {
        cls: 'fas fa-hourglass',
        label: 'Timer',
        category: 'modes',
        tags: ['countdown']
    },
    {
        cls: 'fas fa-stopwatch',
        label: 'Stopwatch',
        category: 'modes',
        tags: ['timer']
    },
    {cls: 'fas fa-bell', label: 'Alarm', category: 'modes', tags: ['wake']},
    {
        cls: 'fas fa-volume-high',
        label: 'Loud',
        category: 'modes',
        tags: ['sound']
    },
    {
        cls: 'fas fa-volume-low',
        label: 'Quiet',
        category: 'modes',
        tags: ['sound']
    },
    {
        cls: 'fas fa-volume-xmark',
        label: 'Silent',
        category: 'modes',
        tags: ['mute']
    },

    // ─── Vehicles ──────────────────────────────────────────
    {cls: 'fas fa-car', label: 'Car', category: 'vehicles', tags: ['auto']},
    {
        cls: 'fas fa-car-side',
        label: 'Car side',
        category: 'vehicles',
        tags: ['auto']
    },
    {
        cls: 'fas fa-car-rear',
        label: 'Car rear',
        category: 'vehicles',
        tags: ['auto']
    },
    {
        cls: 'fas fa-car-burst',
        label: 'Crash',
        category: 'vehicles',
        tags: ['accident']
    },
    {
        cls: 'fas fa-car-on',
        label: 'Car on',
        category: 'vehicles',
        tags: ['running']
    },
    {
        cls: 'fas fa-car-tunnel',
        label: 'Tunnel',
        category: 'vehicles',
        tags: ['road']
    },
    {
        cls: 'fas fa-charging-station',
        label: 'EV charger',
        category: 'vehicles',
        tags: ['ev', 'electric']
    },
    {
        cls: 'fas fa-plug-circle-bolt',
        label: 'EV plug',
        category: 'vehicles',
        tags: ['charge']
    },
    {
        cls: 'fas fa-bicycle',
        label: 'Bicycle',
        category: 'vehicles',
        tags: ['bike']
    },
    {
        cls: 'fas fa-motorcycle',
        label: 'Motorcycle',
        category: 'vehicles',
        tags: ['bike']
    },
    {
        cls: 'fas fa-truck',
        label: 'Truck',
        category: 'vehicles',
        tags: ['transport']
    },
    {
        cls: 'fas fa-truck-pickup',
        label: 'Pickup',
        category: 'vehicles',
        tags: ['transport']
    },
    {
        cls: 'fas fa-bus',
        label: 'Bus',
        category: 'vehicles',
        tags: ['transport']
    },
    {cls: 'fas fa-train', label: 'Train', category: 'vehicles', tags: ['rail']},
    {
        cls: 'fas fa-train-tram',
        label: 'Tram',
        category: 'vehicles',
        tags: ['rail']
    },
    {
        cls: 'fas fa-train-subway',
        label: 'Subway',
        category: 'vehicles',
        tags: ['metro']
    },
    {cls: 'fas fa-plane', label: 'Plane', category: 'vehicles', tags: ['air']},
    {cls: 'fas fa-ship', label: 'Ship', category: 'vehicles', tags: ['boat']},
    {
        cls: 'fas fa-helicopter',
        label: 'Helicopter',
        category: 'vehicles',
        tags: ['air']
    },
    {
        cls: 'fas fa-rocket',
        label: 'Rocket',
        category: 'vehicles',
        tags: ['launch']
    },
    {
        cls: 'fas fa-tractor',
        label: 'Tractor',
        category: 'vehicles',
        tags: ['farm']
    },
    {
        cls: 'fas fa-garage',
        label: 'Garage',
        category: 'vehicles',
        tags: ['parking']
    },
    {
        cls: 'fas fa-warehouse',
        label: 'Garage door',
        category: 'vehicles',
        tags: ['shutter']
    },
    {cls: 'fas fa-road', label: 'Road', category: 'vehicles', tags: ['street']},
    {
        cls: 'fas fa-traffic-light',
        label: 'Traffic light',
        category: 'vehicles',
        tags: ['signal']
    },
    {
        cls: 'fas fa-parking',
        label: 'Parking',
        category: 'vehicles',
        tags: ['park']
    },

    // ─── Building ──────────────────────────────────────────
    {cls: 'fas fa-house', label: 'House', category: 'building', tags: ['home']},
    {
        cls: 'fas fa-house-chimney-window',
        label: 'House detail',
        category: 'building',
        tags: ['home']
    },
    {
        cls: 'fas fa-building',
        label: 'Building',
        category: 'building',
        tags: ['office']
    },
    {
        cls: 'fas fa-buildings',
        label: 'Buildings',
        category: 'building',
        tags: ['city']
    },
    {
        cls: 'fas fa-city',
        label: 'City',
        category: 'building',
        tags: ['skyline']
    },
    {
        cls: 'fas fa-school',
        label: 'School',
        category: 'building',
        tags: ['education']
    },
    {
        cls: 'fas fa-hospital',
        label: 'Hospital',
        category: 'building',
        tags: ['medical']
    },
    {cls: 'fas fa-store', label: 'Store', category: 'building', tags: ['shop']},
    {cls: 'fas fa-shop', label: 'Shop', category: 'building', tags: ['retail']},
    {
        cls: 'fas fa-warehouse',
        label: 'Warehouse',
        category: 'building',
        tags: ['storage']
    },
    {
        cls: 'fas fa-industry',
        label: 'Factory',
        category: 'building',
        tags: ['plant']
    },
    {
        cls: 'fas fa-landmark',
        label: 'Landmark',
        category: 'building',
        tags: ['institution']
    },
    {
        cls: 'fas fa-place-of-worship',
        label: 'Place of worship',
        category: 'building',
        tags: ['religion']
    },
    {
        cls: 'fas fa-monument',
        label: 'Monument',
        category: 'building',
        tags: ['statue']
    },
    {cls: 'fas fa-tent', label: 'Tent', category: 'building', tags: ['camp']},
    {
        cls: 'fas fa-tents',
        label: 'Camp',
        category: 'building',
        tags: ['camping']
    },
    {
        cls: 'fas fa-campground',
        label: 'Campground',
        category: 'building',
        tags: ['camp']
    },
    {cls: 'fas fa-hotel', label: 'Hotel', category: 'building', tags: ['stay']},
    {cls: 'fas fa-igloo', label: 'Igloo', category: 'building', tags: ['cold']},
    {
        cls: 'fas fa-door-open',
        label: 'Open door',
        category: 'building',
        tags: ['entrance']
    },
    {
        cls: 'fas fa-door-closed',
        label: 'Closed door',
        category: 'building',
        tags: ['entrance']
    },
    {
        cls: 'fas fa-window-restore',
        label: 'Window',
        category: 'building',
        tags: ['glass']
    },
    {
        cls: 'fas fa-stairs',
        label: 'Stairs',
        category: 'building',
        tags: ['floor']
    },
    {
        cls: 'fas fa-elevator',
        label: 'Elevator',
        category: 'building',
        tags: ['lift']
    },
    {
        cls: 'fas fa-couch',
        label: 'Couch',
        category: 'building',
        tags: ['furniture', 'living']
    },
    {
        cls: 'fas fa-chair',
        label: 'Chair',
        category: 'building',
        tags: ['furniture']
    },
    {cls: 'fas fa-bed', label: 'Bed', category: 'building', tags: ['bedroom']},
    {
        cls: 'fas fa-bath',
        label: 'Bath',
        category: 'building',
        tags: ['bathroom']
    },
    {
        cls: 'fas fa-toilet',
        label: 'Toilet',
        category: 'building',
        tags: ['bathroom']
    },
    {
        cls: 'fas fa-kitchen-set',
        label: 'Kitchen',
        category: 'building',
        tags: ['cook']
    },
    {
        cls: 'fas fa-utensils',
        label: 'Dining',
        category: 'building',
        tags: ['eat']
    },
    {cls: 'fas fa-tree', label: 'Tree', category: 'building', tags: ['garden']},
    {
        cls: 'fas fa-tree-city',
        label: 'Park',
        category: 'building',
        tags: ['nature']
    },
    {
        cls: 'fas fa-seedling',
        label: 'Plant',
        category: 'building',
        tags: ['garden']
    },
    {
        cls: 'fas fa-fence',
        label: 'Fence',
        category: 'building',
        tags: ['boundary']
    },
    {
        cls: 'fas fa-house-flag',
        label: 'Flag house',
        category: 'building',
        tags: ['embassy']
    },
    {
        cls: 'fas fa-restroom',
        label: 'Restroom',
        category: 'building',
        tags: ['toilet']
    },

    // ─── Tools ─────────────────────────────────────────────
    {
        cls: 'fas fa-screwdriver',
        label: 'Screwdriver',
        category: 'tools',
        tags: ['fix']
    },
    {
        cls: 'fas fa-screwdriver-wrench',
        label: 'Tools',
        category: 'tools',
        tags: ['fix']
    },
    {cls: 'fas fa-wrench', label: 'Wrench', category: 'tools', tags: ['fix']},
    {cls: 'fas fa-hammer', label: 'Hammer', category: 'tools', tags: ['fix']},
    {cls: 'fas fa-toolbox', label: 'Toolbox', category: 'tools', tags: ['kit']},
    {cls: 'fas fa-pen', label: 'Pen', category: 'tools', tags: ['write']},
    {cls: 'fas fa-pencil', label: 'Pencil', category: 'tools', tags: ['write']},
    {
        cls: 'fas fa-pen-fancy',
        label: 'Quill',
        category: 'tools',
        tags: ['write']
    },
    {
        cls: 'fas fa-pen-clip',
        label: 'Pen clip',
        category: 'tools',
        tags: ['edit']
    },
    {cls: 'fas fa-eraser', label: 'Eraser', category: 'tools', tags: ['clear']},
    {
        cls: 'fas fa-paint-brush',
        label: 'Brush',
        category: 'tools',
        tags: ['paint']
    },
    {
        cls: 'fas fa-paintbrush',
        label: 'Paintbrush',
        category: 'tools',
        tags: ['paint']
    },
    {
        cls: 'fas fa-paint-roller',
        label: 'Roller',
        category: 'tools',
        tags: ['paint']
    },
    {
        cls: 'fas fa-spray-can',
        label: 'Spray',
        category: 'tools',
        tags: ['paint']
    },
    {cls: 'fas fa-broom', label: 'Broom', category: 'tools', tags: ['clean']},
    {cls: 'fas fa-bucket', label: 'Bucket', category: 'tools', tags: ['carry']},
    {cls: 'fas fa-trash', label: 'Trash', category: 'tools', tags: ['delete']},
    {
        cls: 'fas fa-trash-can',
        label: 'Bin',
        category: 'tools',
        tags: ['delete']
    },
    {
        cls: 'fas fa-recycle',
        label: 'Recycle',
        category: 'tools',
        tags: ['reuse']
    },
    {
        cls: 'fas fa-dumpster',
        label: 'Dumpster',
        category: 'tools',
        tags: ['waste']
    },
    {cls: 'fas fa-ruler', label: 'Ruler', category: 'tools', tags: ['measure']},
    {
        cls: 'fas fa-ruler-combined',
        label: 'Ruler set',
        category: 'tools',
        tags: ['measure']
    },
    {
        cls: 'fas fa-ruler-horizontal',
        label: 'Horizontal ruler',
        category: 'tools',
        tags: ['measure']
    },
    {
        cls: 'fas fa-ruler-vertical',
        label: 'Vertical ruler',
        category: 'tools',
        tags: ['measure']
    },
    {
        cls: 'fas fa-magnifying-glass',
        label: 'Search',
        category: 'tools',
        tags: ['find']
    },
    {
        cls: 'fas fa-magnifying-glass-plus',
        label: 'Zoom in',
        category: 'tools',
        tags: ['zoom']
    },
    {
        cls: 'fas fa-magnifying-glass-minus',
        label: 'Zoom out',
        category: 'tools',
        tags: ['zoom']
    },
    {cls: 'fas fa-bullseye', label: 'Target', category: 'tools', tags: ['aim']},
    {
        cls: 'fas fa-crosshairs',
        label: 'Crosshairs',
        category: 'tools',
        tags: ['aim']
    },
    {
        cls: 'fas fa-scissors',
        label: 'Cut',
        category: 'tools',
        tags: ['scissors']
    },
    {
        cls: 'fas fa-clipboard',
        label: 'Clipboard',
        category: 'tools',
        tags: ['copy']
    },

    // ─── Media ─────────────────────────────────────────────
    {cls: 'fas fa-music', label: 'Music', category: 'media', tags: ['audio']},
    {
        cls: 'fas fa-headphones',
        label: 'Headphones',
        category: 'media',
        tags: ['audio']
    },
    {
        cls: 'fas fa-headphones-simple',
        label: 'Slim headphones',
        category: 'media',
        tags: ['audio']
    },
    {
        cls: 'fas fa-volume-high',
        label: 'Volume high',
        category: 'media',
        tags: ['loud']
    },
    {
        cls: 'fas fa-volume-low',
        label: 'Volume low',
        category: 'media',
        tags: ['quiet']
    },
    {
        cls: 'fas fa-volume-off',
        label: 'Volume off',
        category: 'media',
        tags: ['mute']
    },
    {
        cls: 'fas fa-volume-xmark',
        label: 'Mute',
        category: 'media',
        tags: ['silent']
    },
    {
        cls: 'fas fa-microphone',
        label: 'Microphone',
        category: 'media',
        tags: ['record']
    },
    {
        cls: 'fas fa-microphone-slash',
        label: 'Mic muted',
        category: 'media',
        tags: ['silent']
    },
    {
        cls: 'fas fa-record-vinyl',
        label: 'Vinyl',
        category: 'media',
        tags: ['record']
    },
    {
        cls: 'fas fa-compact-disc',
        label: 'CD',
        category: 'media',
        tags: ['disk']
    },
    {cls: 'fas fa-tv', label: 'TV', category: 'media', tags: ['screen']},
    {
        cls: 'fas fa-laptop',
        label: 'Laptop',
        category: 'media',
        tags: ['computer']
    },
    {
        cls: 'fas fa-desktop',
        label: 'Desktop',
        category: 'media',
        tags: ['computer']
    },
    {
        cls: 'fas fa-mobile-screen',
        label: 'Phone',
        category: 'media',
        tags: ['mobile']
    },
    {
        cls: 'fas fa-tablet-screen-button',
        label: 'Tablet',
        category: 'media',
        tags: ['ipad']
    },
    {cls: 'fas fa-print', label: 'Print', category: 'media', tags: ['printer']},
    {
        cls: 'fas fa-keyboard',
        label: 'Keyboard',
        category: 'media',
        tags: ['input']
    },
    {
        cls: 'fas fa-computer-mouse',
        label: 'Mouse',
        category: 'media',
        tags: ['input']
    },
    {cls: 'fas fa-camera', label: 'Camera', category: 'media', tags: ['photo']},
    {
        cls: 'fas fa-camera-retro',
        label: 'Retro camera',
        category: 'media',
        tags: ['photo']
    },
    {cls: 'fas fa-image', label: 'Image', category: 'media', tags: ['picture']},
    {
        cls: 'fas fa-images',
        label: 'Gallery',
        category: 'media',
        tags: ['photos']
    },
    {cls: 'fas fa-film', label: 'Film', category: 'media', tags: ['movie']},
    {cls: 'fas fa-video', label: 'Video', category: 'media', tags: ['record']},
    {
        cls: 'fas fa-podcast',
        label: 'Podcast',
        category: 'media',
        tags: ['stream']
    },
    {
        cls: 'fas fa-radio',
        label: 'Radio',
        category: 'media',
        tags: ['broadcast']
    },
    {
        cls: 'fas fa-gamepad',
        label: 'Gamepad',
        category: 'media',
        tags: ['gaming']
    },
    {
        cls: 'fas fa-dice',
        label: 'Dice',
        category: 'media',
        tags: ['game', 'random']
    },
    {
        cls: 'fas fa-puzzle-piece',
        label: 'Puzzle',
        category: 'media',
        tags: ['game']
    },

    // ─── Controls ──────────────────────────────────────────
    {
        cls: 'fas fa-toggle-on',
        label: 'Toggle on',
        category: 'controls',
        tags: ['switch']
    },
    {
        cls: 'fas fa-toggle-off',
        label: 'Toggle off',
        category: 'controls',
        tags: ['switch']
    },
    {
        cls: 'fas fa-power-off',
        label: 'Power button',
        category: 'controls',
        tags: ['on', 'off']
    },
    {
        cls: 'fas fa-circle-play',
        label: 'Play',
        category: 'controls',
        tags: ['start']
    },
    {
        cls: 'fas fa-circle-pause',
        label: 'Pause',
        category: 'controls',
        tags: ['hold']
    },
    {
        cls: 'fas fa-circle-stop',
        label: 'Stop',
        category: 'controls',
        tags: ['halt']
    },
    {
        cls: 'fas fa-play',
        label: 'Play simple',
        category: 'controls',
        tags: ['start']
    },
    {
        cls: 'fas fa-pause',
        label: 'Pause simple',
        category: 'controls',
        tags: ['hold']
    },
    {
        cls: 'fas fa-stop',
        label: 'Stop simple',
        category: 'controls',
        tags: ['halt']
    },
    {
        cls: 'fas fa-forward',
        label: 'Forward',
        category: 'controls',
        tags: ['next']
    },
    {
        cls: 'fas fa-backward',
        label: 'Backward',
        category: 'controls',
        tags: ['previous']
    },
    {
        cls: 'fas fa-forward-fast',
        label: 'Fast forward',
        category: 'controls',
        tags: ['skip']
    },
    {
        cls: 'fas fa-backward-fast',
        label: 'Rewind',
        category: 'controls',
        tags: ['skip']
    },
    {
        cls: 'fas fa-forward-step',
        label: 'Next',
        category: 'controls',
        tags: ['step']
    },
    {
        cls: 'fas fa-backward-step',
        label: 'Previous',
        category: 'controls',
        tags: ['step']
    },
    {
        cls: 'fas fa-shuffle',
        label: 'Shuffle',
        category: 'controls',
        tags: ['random']
    },
    {
        cls: 'fas fa-repeat',
        label: 'Repeat',
        category: 'controls',
        tags: ['loop']
    },
    {
        cls: 'fas fa-arrows-rotate',
        label: 'Refresh',
        category: 'controls',
        tags: ['reload']
    },
    {
        cls: 'fas fa-rotate',
        label: 'Rotate',
        category: 'controls',
        tags: ['turn']
    },
    {
        cls: 'fas fa-rotate-left',
        label: 'Undo rotate',
        category: 'controls',
        tags: ['back']
    },
    {
        cls: 'fas fa-rotate-right',
        label: 'Redo rotate',
        category: 'controls',
        tags: ['forward']
    },
    {
        cls: 'fas fa-circle-arrow-up',
        label: 'Up',
        category: 'controls',
        tags: ['raise']
    },
    {
        cls: 'fas fa-circle-arrow-down',
        label: 'Down',
        category: 'controls',
        tags: ['lower']
    },
    {
        cls: 'fas fa-circle-arrow-left',
        label: 'Left',
        category: 'controls',
        tags: ['back']
    },
    {
        cls: 'fas fa-circle-arrow-right',
        label: 'Right',
        category: 'controls',
        tags: ['forward']
    },
    {
        cls: 'fas fa-circle-chevron-up',
        label: 'Chevron up',
        category: 'controls',
        tags: ['expand']
    },
    {
        cls: 'fas fa-circle-chevron-down',
        label: 'Chevron down',
        category: 'controls',
        tags: ['collapse']
    },
    {
        cls: 'fas fa-circle-plus',
        label: 'Plus',
        category: 'controls',
        tags: ['add']
    },
    {
        cls: 'fas fa-circle-minus',
        label: 'Minus',
        category: 'controls',
        tags: ['remove']
    },
    {
        cls: 'fas fa-circle-check',
        label: 'Check',
        category: 'controls',
        tags: ['ok']
    },
    {
        cls: 'fas fa-circle-xmark',
        label: 'Close',
        category: 'controls',
        tags: ['cancel']
    },
    {
        cls: 'fas fa-circle-info',
        label: 'Info',
        category: 'controls',
        tags: ['details']
    },
    {
        cls: 'fas fa-circle-question',
        label: 'Help',
        category: 'controls',
        tags: ['question']
    },
    {
        cls: 'fas fa-circle-exclamation',
        label: 'Alert',
        category: 'controls',
        tags: ['warning']
    },
    {
        cls: 'fas fa-up-down-left-right',
        label: 'Move',
        category: 'controls',
        tags: ['drag']
    },
    {
        cls: 'fas fa-arrows-up-down',
        label: 'Vertical',
        category: 'controls',
        tags: ['drag']
    },
    {
        cls: 'fas fa-arrows-left-right',
        label: 'Horizontal',
        category: 'controls',
        tags: ['drag']
    },
    {
        cls: 'fas fa-arrows-spin',
        label: 'Spin',
        category: 'controls',
        tags: ['rotate']
    },
    {
        cls: 'fas fa-sliders',
        label: 'Sliders',
        category: 'controls',
        tags: ['adjust']
    },
    {
        cls: 'fas fa-bars-progress',
        label: 'Progress',
        category: 'controls',
        tags: ['levels']
    },
    {cls: 'fas fa-list', label: 'List', category: 'controls', tags: ['items']},
    {
        cls: 'fas fa-list-ol',
        label: 'Ordered list',
        category: 'controls',
        tags: ['items']
    },
    {
        cls: 'fas fa-list-ul',
        label: 'Bullet list',
        category: 'controls',
        tags: ['items']
    },
    {cls: 'fas fa-table', label: 'Table', category: 'controls', tags: ['grid']},
    {
        cls: 'fas fa-layer-group',
        label: 'Layers',
        category: 'controls',
        tags: ['stack']
    },
    {cls: 'fas fa-grip', label: 'Drag', category: 'controls', tags: ['handle']},
    {
        cls: 'fas fa-grip-vertical',
        label: 'Vertical drag',
        category: 'controls',
        tags: ['handle']
    },
    {
        cls: 'fas fa-grip-horizontal',
        label: 'Horizontal drag',
        category: 'controls',
        tags: ['handle']
    },
    {
        cls: 'fas fa-bars',
        label: 'Menu',
        category: 'controls',
        tags: ['hamburger']
    },
    {
        cls: 'fas fa-ellipsis',
        label: 'More',
        category: 'controls',
        tags: ['options']
    },
    {
        cls: 'fas fa-ellipsis-vertical',
        label: 'Vertical more',
        category: 'controls',
        tags: ['options']
    },
    {
        cls: 'fas fa-filter',
        label: 'Filter',
        category: 'controls',
        tags: ['narrow']
    },
    {cls: 'fas fa-sort', label: 'Sort', category: 'controls', tags: ['order']},
    {
        cls: 'fas fa-sort-up',
        label: 'Sort up',
        category: 'controls',
        tags: ['asc']
    },
    {
        cls: 'fas fa-sort-down',
        label: 'Sort down',
        category: 'controls',
        tags: ['desc']
    },

    // ─── Misc ──────────────────────────────────────────────
    {
        cls: 'fas fa-heart',
        label: 'Heart',
        category: 'misc',
        tags: ['favourite']
    },
    {
        cls: 'fas fa-heart-pulse',
        label: 'Pulse',
        category: 'misc',
        tags: ['health']
    },
    {cls: 'fas fa-thumbs-up', label: 'Like', category: 'misc', tags: ['ok']},
    {
        cls: 'fas fa-thumbs-down',
        label: 'Dislike',
        category: 'misc',
        tags: ['bad']
    },
    {cls: 'fas fa-star', label: 'Star', category: 'misc', tags: ['favourite']},
    {cls: 'fas fa-trophy', label: 'Trophy', category: 'misc', tags: ['award']},
    {cls: 'fas fa-medal', label: 'Medal', category: 'misc', tags: ['award']},
    {cls: 'fas fa-award', label: 'Award', category: 'misc', tags: ['prize']},
    {cls: 'fas fa-crown', label: 'Crown', category: 'misc', tags: ['royal']},
    {cls: 'fas fa-gem', label: 'Gem', category: 'misc', tags: ['premium']},
    {cls: 'fas fa-ring', label: 'Ring', category: 'misc', tags: ['jewel']},
    {
        cls: 'fas fa-bell',
        label: 'Notification',
        category: 'misc',
        tags: ['alert']
    },
    {cls: 'fas fa-flag', label: 'Flag', category: 'misc', tags: ['mark']},
    {
        cls: 'fas fa-bookmark',
        label: 'Bookmark',
        category: 'misc',
        tags: ['save']
    },
    {
        cls: 'fas fa-paperclip',
        label: 'Attach',
        category: 'misc',
        tags: ['file']
    },
    {cls: 'fas fa-anchor', label: 'Anchor', category: 'misc', tags: ['marine']},
    {
        cls: 'fas fa-bullhorn',
        label: 'Announce',
        category: 'misc',
        tags: ['speaker']
    },
    {
        cls: 'fas fa-flag-checkered',
        label: 'Race finish',
        category: 'misc',
        tags: ['flag']
    },
    {
        cls: 'fas fa-binoculars',
        label: 'Binoculars',
        category: 'misc',
        tags: ['view']
    },
    {
        cls: 'fas fa-eye-low-vision',
        label: 'Low vision',
        category: 'misc',
        tags: ['accessibility']
    },
    {
        cls: 'fas fa-stethoscope',
        label: 'Stethoscope',
        category: 'misc',
        tags: ['health']
    },
    {
        cls: 'fas fa-syringe',
        label: 'Syringe',
        category: 'misc',
        tags: ['medical']
    },
    {cls: 'fas fa-pills', label: 'Pills', category: 'misc', tags: ['medicine']},
    {
        cls: 'fas fa-prescription-bottle',
        label: 'Prescription',
        category: 'misc',
        tags: ['medicine']
    },
    {cls: 'fas fa-virus', label: 'Virus', category: 'misc', tags: ['health']},
    {
        cls: 'fas fa-disease',
        label: 'Disease',
        category: 'misc',
        tags: ['health']
    },
    {cls: 'fas fa-bone', label: 'Bone', category: 'misc', tags: ['skeleton']},
    {cls: 'fas fa-brain', label: 'Brain', category: 'misc', tags: ['mind']},
    {cls: 'fas fa-tooth', label: 'Tooth', category: 'misc', tags: ['dental']},
    {
        cls: 'fas fa-ear-listen',
        label: 'Hearing',
        category: 'misc',
        tags: ['ear']
    },
    {cls: 'fas fa-hand', label: 'Hand', category: 'misc', tags: ['stop']},
    {
        cls: 'fas fa-hand-fist',
        label: 'Fist',
        category: 'misc',
        tags: ['strong']
    },
    {
        cls: 'fas fa-hand-spock',
        label: 'Spock',
        category: 'misc',
        tags: ['hand']
    },
    {
        cls: 'fas fa-handshake',
        label: 'Handshake',
        category: 'misc',
        tags: ['deal']
    },
    {
        cls: 'fas fa-people-group',
        label: 'Group',
        category: 'misc',
        tags: ['team']
    },
    {cls: 'fas fa-user', label: 'User', category: 'misc', tags: ['person']},
    {cls: 'fas fa-users', label: 'Users', category: 'misc', tags: ['people']},
    {
        cls: 'fas fa-user-tie',
        label: 'Manager',
        category: 'misc',
        tags: ['office']
    },
    {
        cls: 'fas fa-user-doctor',
        label: 'Doctor',
        category: 'misc',
        tags: ['medical']
    },
    {
        cls: 'fas fa-user-nurse',
        label: 'Nurse',
        category: 'misc',
        tags: ['medical']
    },
    {
        cls: 'fas fa-user-graduate',
        label: 'Graduate',
        category: 'misc',
        tags: ['school']
    },
    {
        cls: 'fas fa-user-astronaut',
        label: 'Astronaut',
        category: 'misc',
        tags: ['space']
    },
    {
        cls: 'fas fa-user-ninja',
        label: 'Ninja',
        category: 'misc',
        tags: ['stealth']
    },
    {cls: 'fas fa-baby', label: 'Baby', category: 'misc', tags: ['child']},
    {
        cls: 'fas fa-pizza-slice',
        label: 'Pizza',
        category: 'misc',
        tags: ['food']
    },
    {cls: 'fas fa-burger', label: 'Burger', category: 'misc', tags: ['food']},
    {
        cls: 'fas fa-ice-cream',
        label: 'Ice cream',
        category: 'misc',
        tags: ['food']
    },
    {
        cls: 'fas fa-bread-slice',
        label: 'Bread',
        category: 'misc',
        tags: ['food']
    },
    {cls: 'fas fa-egg', label: 'Egg', category: 'misc', tags: ['food']},
    {cls: 'fas fa-bacon', label: 'Bacon', category: 'misc', tags: ['food']},
    {cls: 'fas fa-cheese', label: 'Cheese', category: 'misc', tags: ['food']},
    {
        cls: 'fas fa-apple-whole',
        label: 'Apple',
        category: 'misc',
        tags: ['fruit']
    },
    {
        cls: 'fas fa-carrot',
        label: 'Carrot',
        category: 'misc',
        tags: ['vegetable']
    },
    {
        cls: 'fas fa-pepper-hot',
        label: 'Pepper',
        category: 'misc',
        tags: ['spicy']
    },
    {cls: 'fas fa-mug-saucer', label: 'Cup', category: 'misc', tags: ['drink']},
    {
        cls: 'fas fa-wine-glass',
        label: 'Wine',
        category: 'misc',
        tags: ['drink']
    },
    {
        cls: 'fas fa-martini-glass',
        label: 'Cocktail',
        category: 'misc',
        tags: ['drink']
    },
    {
        cls: 'fas fa-beer-mug-empty',
        label: 'Beer',
        category: 'misc',
        tags: ['drink']
    },
    {
        cls: 'fas fa-bottle-water',
        label: 'Water bottle',
        category: 'misc',
        tags: ['drink']
    },
    {cls: 'fas fa-bowl-rice', label: 'Bowl', category: 'misc', tags: ['food']},
    {cls: 'fas fa-cookie', label: 'Cookie', category: 'misc', tags: ['snack']},
    {
        cls: 'fas fa-cake-candles',
        label: 'Cake',
        category: 'misc',
        tags: ['birthday']
    },
    {cls: 'fas fa-gift', label: 'Gift', category: 'misc', tags: ['present']},
    {cls: 'fas fa-gifts', label: 'Gifts', category: 'misc', tags: ['presents']},
    {
        cls: 'fas fa-snowman',
        label: 'Snowman',
        category: 'misc',
        tags: ['winter']
    },
    {
        cls: 'fas fa-tree-christmas',
        label: 'Christmas',
        category: 'misc',
        tags: ['holiday']
    },
    {cls: 'fas fa-tree', label: 'Tree', category: 'misc', tags: ['plant']},
    {cls: 'fas fa-leaf', label: 'Leaf', category: 'misc', tags: ['eco']},
    {cls: 'fas fa-fan', label: 'Fan', category: 'misc', tags: ['blade']},
    {cls: 'fas fa-globe', label: 'World', category: 'misc', tags: ['planet']},
    {
        cls: 'fas fa-earth-europe',
        label: 'Earth (EU)',
        category: 'misc',
        tags: ['planet']
    },
    {
        cls: 'fas fa-earth-asia',
        label: 'Earth (Asia)',
        category: 'misc',
        tags: ['planet']
    },
    {cls: 'fas fa-map', label: 'Map', category: 'misc', tags: ['location']},
    {
        cls: 'fas fa-map-location',
        label: 'Map pin',
        category: 'misc',
        tags: ['location']
    },
    {
        cls: 'fas fa-location-dot',
        label: 'Pin',
        category: 'misc',
        tags: ['location']
    },
    {
        cls: 'fas fa-route',
        label: 'Route',
        category: 'misc',
        tags: ['navigation']
    },
    {cls: 'fas fa-road', label: 'Road', category: 'misc', tags: ['route']},
    {cls: 'fas fa-compass', label: 'Compass', category: 'misc', tags: ['nav']},
    {
        cls: 'fas fa-mountain',
        label: 'Mountain',
        category: 'misc',
        tags: ['outdoor']
    },
    {
        cls: 'fas fa-tree-palm',
        label: 'Palm',
        category: 'misc',
        tags: ['tropical']
    },
    {
        cls: 'fas fa-umbrella-beach',
        label: 'Beach',
        category: 'misc',
        tags: ['vacation']
    },
    {
        cls: 'fas fa-sailboat',
        label: 'Sailboat',
        category: 'misc',
        tags: ['water']
    },
    {cls: 'fas fa-anchor', label: 'Anchor', category: 'misc', tags: ['marine']},
    {
        cls: 'fas fa-fire-extinguisher',
        label: 'Extinguisher',
        category: 'misc',
        tags: ['safety']
    },
    {
        cls: 'fas fa-first-aid',
        label: 'First aid',
        category: 'misc',
        tags: ['medical']
    },
    {
        cls: 'fas fa-helicopter-symbol',
        label: 'Helipad',
        category: 'misc',
        tags: ['landing']
    },
    {
        cls: 'fas fa-passport',
        label: 'Passport',
        category: 'misc',
        tags: ['travel']
    },
    {
        cls: 'fas fa-globe-americas',
        label: 'Globe Americas',
        category: 'misc',
        tags: ['world']
    },
    {cls: 'fas fa-flag-usa', label: 'USA', category: 'misc', tags: ['country']},
    {
        cls: 'fas fa-tachograph-digital',
        label: 'Tachograph',
        category: 'misc',
        tags: ['meter']
    },
    {
        cls: 'fas fa-clipboard-check',
        label: 'Checklist',
        category: 'misc',
        tags: ['done']
    },
    {
        cls: 'fas fa-clipboard-list',
        label: 'List',
        category: 'misc',
        tags: ['todo']
    },
    {cls: 'fas fa-receipt', label: 'Receipt', category: 'misc', tags: ['bill']},
    {cls: 'fas fa-file', label: 'File', category: 'misc', tags: ['document']},
    {
        cls: 'fas fa-file-pdf',
        label: 'PDF',
        category: 'misc',
        tags: ['document']
    },
    {
        cls: 'fas fa-file-image',
        label: 'Image file',
        category: 'misc',
        tags: ['picture']
    },
    {
        cls: 'fas fa-file-audio',
        label: 'Audio file',
        category: 'misc',
        tags: ['sound']
    },
    {
        cls: 'fas fa-file-video',
        label: 'Video file',
        category: 'misc',
        tags: ['movie']
    },
    {
        cls: 'fas fa-folder',
        label: 'Folder',
        category: 'misc',
        tags: ['directory']
    },
    {
        cls: 'fas fa-folder-open',
        label: 'Open folder',
        category: 'misc',
        tags: ['directory']
    },
    {
        cls: 'fas fa-folder-plus',
        label: 'New folder',
        category: 'misc',
        tags: ['add']
    },
    {
        cls: 'fas fa-folder-minus',
        label: 'Remove folder',
        category: 'misc',
        tags: ['delete']
    },
    {
        cls: 'fas fa-paste',
        label: 'Paste',
        category: 'misc',
        tags: ['clipboard']
    },
    {cls: 'fas fa-copy', label: 'Copy', category: 'misc', tags: ['duplicate']},
    {cls: 'fas fa-save', label: 'Save', category: 'misc', tags: ['disk']},
    {
        cls: 'fas fa-cloud-arrow-up',
        label: 'Upload',
        category: 'misc',
        tags: ['cloud']
    },
    {
        cls: 'fas fa-cloud-arrow-down',
        label: 'Download',
        category: 'misc',
        tags: ['cloud']
    },
    {cls: 'fas fa-print', label: 'Print', category: 'misc', tags: ['printer']},
    {cls: 'fas fa-fax', label: 'Fax', category: 'misc', tags: ['document']},
    {cls: 'fas fa-envelope', label: 'Email', category: 'misc', tags: ['mail']},
    {
        cls: 'fas fa-envelope-open',
        label: 'Open email',
        category: 'misc',
        tags: ['mail']
    },
    {
        cls: 'fas fa-paper-plane',
        label: 'Send',
        category: 'misc',
        tags: ['mail']
    },
    {cls: 'fas fa-comment', label: 'Comment', category: 'misc', tags: ['chat']},
    {
        cls: 'fas fa-comments',
        label: 'Comments',
        category: 'misc',
        tags: ['chat']
    },
    {cls: 'fas fa-message', label: 'Message', category: 'misc', tags: ['chat']},
    {cls: 'fas fa-phone', label: 'Phone', category: 'misc', tags: ['call']},
    {
        cls: 'fas fa-phone-volume',
        label: 'Phone volume',
        category: 'misc',
        tags: ['call']
    },
    {
        cls: 'fas fa-mobile-button',
        label: 'Mobile',
        category: 'misc',
        tags: ['phone']
    },
    {
        cls: 'fas fa-walkie-talkie',
        label: 'Walkie talkie',
        category: 'misc',
        tags: ['radio']
    }
];

export function iconsByCategory(cat: IconCategory): IconLibraryEntry[] {
    return ICON_LIBRARY.filter((entry) => entry.category === cat);
}

export function searchIcons(query: string): IconLibraryEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return ICON_LIBRARY;
    return ICON_LIBRARY.filter((entry) => {
        if (entry.label.toLowerCase().includes(q)) return true;
        if (entry.cls.toLowerCase().includes(q)) return true;
        return entry.tags.some((t) => t.toLowerCase().includes(q));
    });
}
