import log4js from 'log4js';
import type {
    VirtualDeviceProfileMetadata,
    VirtualDeviceProfileRole
} from '../types/api/virtualdevice';
import * as postgres from './PostgresProvider';
import {formatError} from './util/formatError';
import {upsertSystemProfile} from './virtualDevice/profileRepository';

const logger = log4js.getLogger('virtualdevice-profile-seeder');

interface SystemProfile {
    key: string;
    name: string;
    version: number;
    roles: VirtualDeviceProfileRole[];
    metadata: VirtualDeviceProfileMetadata;
}

const SYSTEM_PROFILES: readonly SystemProfile[] = [
    {
        key: 'door_window',
        name: 'Door or window',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {icon: 'fas fa-door-open', accent: 'switch'}
        },
        roles: [
            {
                roleKey: 'opening',
                label: 'Open / closed',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-door-open',
                    slot: 'primary',
                    chart: 'state',
                    format: {
                        trueLabel: 'Open',
                        falseLabel: 'Closed'
                    }
                },
                metadata: {
                    entityType: 'window',
                    componentType: 'door',
                    options: {
                        true: 'Open',
                        false: 'Closed',
                        open: 'Open',
                        closed: 'Closed'
                    }
                }
            },
            {
                roleKey: 'battery',
                label: 'Battery',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-battery-half',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'battery',
                    objName: 'battery'
                }
            }
        ]
    },
    {
        key: 'lighting_zone',
        name: 'Lighting zone',
        version: 1,
        metadata: {
            categoryKey: 'lighting',
            defaultVisual: {icon: 'fas fa-lightbulb', accent: 'switch'}
        },
        roles: [
            {
                roleKey: 'light',
                label: 'Light',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                visual: {
                    icon: 'fas fa-lightbulb',
                    slot: 'control',
                    chart: 'state',
                    format: {
                        trueLabel: 'On',
                        falseLabel: 'Off'
                    }
                },
                metadata: {
                    entityType: 'switch',
                    componentType: 'switch',
                    options: {
                        true: 'On',
                        false: 'Off'
                    }
                }
            },
            {
                roleKey: 'power',
                label: 'Power',
                valueType: 'number',
                unit: 'W',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-bolt',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'power',
                    objName: 'power'
                }
            }
        ]
    },
    {
        key: 'room_climate',
        name: 'Room climate',
        version: 1,
        metadata: {
            categoryKey: 'climate',
            defaultVisual: {icon: 'fas fa-temperature-half', accent: 'temp'}
        },
        roles: [
            {
                roleKey: 'temperature',
                label: 'Temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-temperature-half',
                    slot: 'primary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            },
            {
                roleKey: 'humidity',
                label: 'Humidity',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-droplet',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {entityType: 'humidity', componentType: 'humidity'}
            },
            {
                roleKey: 'co2',
                label: 'CO2',
                valueType: 'number',
                unit: 'ppm',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-wind',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'co2',
                    objName: 'co2'
                }
            }
        ]
    },
    {
        key: 'energy_meter',
        name: 'Energy meter',
        version: 1,
        metadata: {
            categoryKey: 'energy',
            defaultVisual: {icon: 'fas fa-gauge-high', accent: 'energy'}
        },
        roles: [
            {
                roleKey: 'power',
                label: 'Live power',
                valueType: 'number',
                unit: 'W',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-bolt',
                    slot: 'primary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'power',
                    objName: 'power'
                }
            },
            {
                roleKey: 'energy',
                label: 'Energy',
                valueType: 'number',
                unit: 'kWh',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-gauge-high',
                    slot: 'secondary',
                    chart: 'area'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'energy',
                    objName: 'energy'
                }
            },
            {
                roleKey: 'voltage',
                label: 'Voltage',
                valueType: 'number',
                unit: 'V',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-plug',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {entityType: 'voltmeter', componentType: 'voltage'}
            }
        ]
    },
    {
        key: 'security_sensor',
        name: 'Security sensor',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {icon: 'fas fa-shield-halved', accent: 'generic'}
        },
        roles: [
            {
                roleKey: 'alarm',
                label: 'Alarm state',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-triangle-exclamation',
                    slot: 'primary',
                    chart: 'state',
                    format: {
                        trueLabel: 'Active',
                        falseLabel: 'Clear'
                    }
                },
                metadata: {
                    entityType: 'smoke',
                    componentType: 'smoke',
                    options: {
                        true: 'Active',
                        false: 'Clear',
                        active: 'Active',
                        clear: 'Clear'
                    }
                }
            },
            {
                roleKey: 'tamper',
                label: 'Tamper',
                valueType: 'boolean',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-hand',
                    slot: 'diagnostic',
                    chart: 'state'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'tamper',
                    objName: 'tamper'
                }
            },
            {
                roleKey: 'battery',
                label: 'Battery',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-battery-half',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'battery',
                    objName: 'battery'
                }
            }
        ]
    },
    {
        key: 'machine_state',
        name: 'Machine state',
        version: 1,
        metadata: {
            categoryKey: 'custom',
            defaultVisual: {icon: 'fas fa-industry', accent: 'generic'}
        },
        roles: [
            {
                roleKey: 'running',
                label: 'Running',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-play',
                    slot: 'primary',
                    chart: 'state',
                    format: {
                        trueLabel: 'Running',
                        falseLabel: 'Stopped'
                    }
                },
                metadata: {
                    entityType: 'switch',
                    componentType: 'switch',
                    options: {
                        true: 'Running',
                        false: 'Stopped'
                    }
                }
            },
            {
                roleKey: 'power',
                label: 'Power',
                valueType: 'number',
                unit: 'W',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-bolt',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'power',
                    objName: 'power'
                }
            }
        ]
    },
    {
        key: 'occupancy_area',
        name: 'Occupancy area',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {icon: 'fas fa-person-walking', accent: 'generic'}
        },
        roles: [
            {
                roleKey: 'occupancy',
                label: 'Occupancy',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-person-walking',
                    slot: 'primary',
                    chart: 'state'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'presence',
                    objName: 'presence'
                }
            },
            {
                roleKey: 'motion',
                label: 'Motion',
                valueType: 'boolean',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-person-running',
                    slot: 'secondary',
                    chart: 'state'
                },
                metadata: {entityType: 'motion', componentType: 'motion'}
            },
            {
                roleKey: 'illuminance',
                label: 'Illuminance',
                valueType: 'number',
                unit: 'lux',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-sun',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'illuminance',
                    componentType: 'illuminance'
                }
            }
        ]
    },
    {
        key: 'air_quality',
        name: 'Air quality',
        version: 1,
        metadata: {
            categoryKey: 'climate',
            defaultVisual: {icon: 'fas fa-wind', accent: 'temp'}
        },
        roles: [
            {
                roleKey: 'co2',
                label: 'CO2',
                valueType: 'number',
                unit: 'ppm',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-wind',
                    slot: 'primary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'co2',
                    objName: 'co2'
                }
            },
            {
                roleKey: 'tvoc',
                label: 'TVOC',
                valueType: 'number',
                unit: 'µg/m³',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-flask',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'tvoc',
                    objName: 'tvoc'
                }
            },
            {
                roleKey: 'temperature',
                label: 'Temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-temperature-half',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            },
            {
                roleKey: 'humidity',
                label: 'Humidity',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-droplet',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {entityType: 'humidity', componentType: 'humidity'}
            }
        ]
    },
    {
        key: 'weather_station',
        name: 'Weather station',
        version: 1,
        metadata: {
            categoryKey: 'climate',
            defaultVisual: {icon: 'fas fa-cloud-sun', accent: 'temp'}
        },
        roles: [
            {
                roleKey: 'temperature',
                label: 'Temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-temperature-half',
                    slot: 'primary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            },
            {
                roleKey: 'humidity',
                label: 'Humidity',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-droplet',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {entityType: 'humidity', componentType: 'humidity'}
            },
            {
                roleKey: 'pressure',
                label: 'Pressure',
                valueType: 'number',
                unit: 'hPa',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-gauge',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'pressure',
                    objName: 'pressure'
                }
            },
            {
                roleKey: 'rain',
                label: 'Rain',
                valueType: 'number',
                unit: 'mm',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-cloud-rain',
                    slot: 'diagnostic',
                    chart: 'bar'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'rain',
                    objName: 'precipitation'
                }
            }
        ]
    },
    {
        key: 'leak_protection',
        name: 'Leak protection',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {icon: 'fas fa-droplet', accent: 'humidity'}
        },
        roles: [
            {
                roleKey: 'leak',
                label: 'Leak',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-droplet',
                    slot: 'primary',
                    chart: 'state'
                },
                metadata: {entityType: 'flood', componentType: 'flood'}
            },
            {
                roleKey: 'valve',
                label: 'Valve',
                valueType: 'boolean',
                writable: true,
                required: false,
                historyMode: 'live_only',
                visual: {
                    icon: 'fas fa-faucet',
                    slot: 'control',
                    chart: 'state'
                },
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'battery',
                label: 'Battery',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-battery-half',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'battery',
                    objName: 'battery'
                }
            }
        ]
    },
    {
        key: 'gas_safety',
        name: 'Gas and CO safety',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {
                icon: 'fas fa-triangle-exclamation',
                accent: 'generic'
            }
        },
        roles: [
            {
                roleKey: 'gas',
                label: 'Gas',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-triangle-exclamation',
                    slot: 'primary',
                    chart: 'state'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'gas',
                    objName: 'gas'
                }
            },
            {
                roleKey: 'carbon_monoxide',
                label: 'Carbon monoxide',
                valueType: 'boolean',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-skull-crossbones',
                    slot: 'secondary',
                    chart: 'state'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'carbon_monoxide',
                    objName: 'carbon_monoxide'
                }
            }
        ]
    },
    {
        key: 'garage_door',
        name: 'Garage door',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {icon: 'fas fa-warehouse', accent: 'switch'}
        },
        roles: [
            {
                roleKey: 'door',
                label: 'Door',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-warehouse',
                    slot: 'primary',
                    chart: 'state'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'garage_door',
                    objName: 'garage_door'
                }
            },
            {
                roleKey: 'opener',
                label: 'Opener',
                valueType: 'boolean',
                writable: true,
                required: false,
                historyMode: 'live_only',
                visual: {
                    icon: 'fas fa-power-off',
                    slot: 'control',
                    chart: 'state'
                },
                metadata: {entityType: 'switch', componentType: 'switch'}
            }
        ]
    },
    {
        key: 'smart_lock',
        name: 'Smart lock',
        version: 1,
        metadata: {
            categoryKey: 'safety',
            defaultVisual: {icon: 'fas fa-lock', accent: 'generic'}
        },
        roles: [
            {
                roleKey: 'lock',
                label: 'Lock',
                valueType: 'boolean',
                writable: false,
                required: true,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-lock',
                    slot: 'primary',
                    chart: 'state'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'lock',
                    objName: 'lock'
                }
            },
            {
                roleKey: 'battery',
                label: 'Battery',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-battery-half',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'battery',
                    objName: 'battery'
                }
            }
        ]
    },
    {
        key: 'button_scene',
        name: 'Button scene',
        version: 1,
        metadata: {
            categoryKey: 'custom',
            defaultVisual: {icon: 'fas fa-hand-pointer', accent: 'generic'}
        },
        roles: [
            {
                roleKey: 'button',
                label: 'Button',
                valueType: 'event',
                writable: false,
                required: true,
                historyMode: 'live_only',
                visual: {
                    icon: 'fas fa-hand-pointer',
                    slot: 'primary',
                    chart: 'none'
                },
                metadata: {
                    entityType: 'input',
                    componentType: 'button',
                    inputType: 'button'
                }
            },
            {
                roleKey: 'battery',
                label: 'Battery',
                valueType: 'number',
                unit: '%',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-battery-half',
                    slot: 'diagnostic',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'battery',
                    objName: 'battery'
                }
            }
        ]
    },
    {
        key: 'pump_or_valve',
        name: 'Pump or valve',
        version: 1,
        metadata: {
            categoryKey: 'energy',
            defaultVisual: {icon: 'fas fa-faucet-drip', accent: 'switch'}
        },
        roles: [
            {
                roleKey: 'actuator',
                label: 'Actuator',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                visual: {
                    icon: 'fas fa-power-off',
                    slot: 'control',
                    chart: 'state'
                },
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'pressure',
                label: 'Pressure',
                valueType: 'number',
                unit: 'hPa',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-gauge',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'pressure',
                    objName: 'pressure'
                }
            },
            {
                roleKey: 'power',
                label: 'Power',
                valueType: 'number',
                unit: 'W',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-bolt',
                    slot: 'secondary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'power',
                    objName: 'power'
                }
            }
        ]
    },
    {
        key: 'ev_charger',
        name: 'EV charger',
        version: 1,
        metadata: {
            categoryKey: 'energy',
            defaultVisual: {icon: 'fas fa-charging-station', accent: 'energy'}
        },
        roles: [
            {
                roleKey: 'charging',
                label: 'Charging',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                visual: {
                    icon: 'fas fa-charging-station',
                    slot: 'control',
                    chart: 'state'
                },
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'power',
                label: 'Power',
                valueType: 'number',
                unit: 'W',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-bolt',
                    slot: 'primary',
                    chart: 'line'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'power',
                    objName: 'power'
                }
            },
            {
                roleKey: 'energy',
                label: 'Energy',
                valueType: 'number',
                unit: 'kWh',
                writable: false,
                required: false,
                historyMode: 'linked',
                visual: {
                    icon: 'fas fa-gauge-high',
                    slot: 'secondary',
                    chart: 'area'
                },
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'energy',
                    objName: 'energy'
                }
            }
        ]
    },
    {
        key: 'fireplace',
        name: 'Fireplace',
        version: 1,
        metadata: {categoryKey: 'climate'},
        roles: [
            {
                roleKey: 'burner',
                label: 'Burner',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'flame_temp',
                label: 'Flame temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: false,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            }
        ]
    },
    {
        key: 'washing_machine',
        name: 'Washing machine',
        version: 1,
        metadata: {categoryKey: 'energy'},
        roles: [
            {
                roleKey: 'power',
                label: 'Power',
                valueType: 'number',
                unit: 'W',
                writable: false,
                required: true,
                historyMode: 'linked',
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'power',
                    objName: 'power'
                }
            },
            {
                roleKey: 'door',
                label: 'Door',
                valueType: 'boolean',
                writable: false,
                required: false,
                historyMode: 'live_only',
                metadata: {entityType: 'window', componentType: 'door'}
            }
        ]
    },
    {
        key: 'oven',
        name: 'Oven',
        version: 1,
        metadata: {categoryKey: 'climate'},
        roles: [
            {
                roleKey: 'element',
                label: 'Element',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'temp',
                label: 'Temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: false,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            }
        ]
    },
    {
        key: 'hvac',
        name: 'HVAC',
        version: 1,
        metadata: {categoryKey: 'climate'},
        roles: [
            {
                roleKey: 'compressor',
                label: 'Compressor',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'fan',
                label: 'Fan',
                valueType: 'boolean',
                writable: true,
                required: false,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'room_temp',
                label: 'Room temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: true,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            },
            {
                roleKey: 'setpoint',
                label: 'Setpoint',
                valueType: 'number',
                unit: '°C',
                writable: true,
                required: false,
                historyMode: 'live_only',
                metadata: {entityType: 'number', componentType: 'number'}
            }
        ]
    },
    {
        key: 'heating_loop',
        name: 'Heating loop',
        version: 1,
        metadata: {categoryKey: 'climate'},
        roles: [
            {
                roleKey: 'boiler',
                label: 'Boiler',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'flow_temp',
                label: 'Flow temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: false,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            },
            {
                roleKey: 'return_temp',
                label: 'Return temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: false,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            }
        ]
    },
    {
        key: 'cooling_system',
        name: 'Cooling system',
        version: 1,
        metadata: {categoryKey: 'climate'},
        roles: [
            {
                roleKey: 'chiller',
                label: 'Chiller',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'supply_temp',
                label: 'Supply temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: false,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            }
        ]
    },
    {
        key: 'hot_water_tank',
        name: 'Hot water tank',
        version: 1,
        metadata: {categoryKey: 'climate'},
        roles: [
            {
                roleKey: 'heater',
                label: 'Heater',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            },
            {
                roleKey: 'tank_temp',
                label: 'Tank temperature',
                valueType: 'number',
                unit: '°C',
                writable: false,
                required: true,
                historyMode: 'linked',
                metadata: {
                    entityType: 'temperature',
                    componentType: 'temperature'
                }
            }
        ]
    },
    {
        key: 'lighting_group',
        name: 'Lighting group',
        version: 1,
        metadata: {categoryKey: 'lighting'},
        roles: [
            {
                roleKey: 'lights',
                label: 'Lights',
                valueType: 'boolean',
                writable: true,
                required: true,
                historyMode: 'live_only',
                metadata: {entityType: 'switch', componentType: 'switch'}
            }
        ]
    },
    {
        key: 'sensor_cluster',
        name: 'Sensor cluster',
        version: 1,
        metadata: {categoryKey: 'safety'},
        roles: [
            {
                roleKey: 'sensors',
                label: 'Sensors',
                valueType: 'number',
                writable: false,
                required: true,
                historyMode: 'linked',
                metadata: {
                    entityType: 'bthomesensor',
                    componentType: 'bthomesensor'
                }
            }
        ]
    },
    {
        key: 'custom_blank',
        name: 'Custom (blank)',
        version: 1,
        metadata: {categoryKey: 'custom'},
        roles: [
            {
                roleKey: 'value',
                label: 'Value',
                valueType: 'number',
                writable: false,
                required: false,
                historyMode: 'linked'
            }
        ]
    }
];

export function systemProfileCatalog(): readonly SystemProfile[] {
    return SYSTEM_PROFILES;
}

interface ExistingRow {
    key: string;
    version: number | string;
}

export async function seedSystemVirtualDeviceProfiles(): Promise<{
    inserted: number;
}> {
    const seen = await loadSeededProfileKeys();
    let inserted = 0;
    for (const profile of SYSTEM_PROFILES) {
        if (seen.has(profileTag(profile.key, profile.version))) continue;
        const ok = await seedOneProfile(profile);
        if (ok) inserted++;
    }
    if (inserted > 0) {
        logger.info('Seeded %d system virtual-device profiles', inserted);
    }
    return {inserted};
}

async function loadSeededProfileKeys(): Promise<Set<string>> {
    const rows = await postgres.queryRows<ExistingRow>(
        `SELECT key, version
           FROM device.virtual_device_profile
          WHERE organization_id IS NULL AND deleted_at IS NULL`
    );
    return new Set(rows.map((r) => profileTag(r.key, Number(r.version))));
}

function profileTag(key: string, version: number): string {
    return `${key}@${version}`;
}

// One bad row must not abort the rest of the catalog.
async function seedOneProfile(profile: SystemProfile): Promise<boolean> {
    try {
        return await upsertOne(profile);
    } catch (err) {
        return recordSeedFailure(profile, err);
    }
}

async function upsertOne(profile: SystemProfile): Promise<boolean> {
    const result = await upsertSystemProfile({
        organizationId: null,
        key: profile.key,
        name: profile.name,
        version: profile.version,
        roles: profile.roles,
        metadata: profile.metadata
    });
    return result.inserted;
}

function recordSeedFailure(profile: SystemProfile, err: unknown): false {
    logger.warn(
        'Failed seeding system profile %s@%d — continuing: %s',
        profile.key,
        profile.version,
        formatError(err)
    );
    return false;
}
