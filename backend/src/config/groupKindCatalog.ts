// Single source of truth for the group_kind catalog.
//
// The DB table `organization.group_kind` is a hot-loaded cache of this
// constant — the boot seeder UPSERTs every entry on every start.
// To add or edit a kind: edit this file, restart the backend.
// Never UPDATE the table directly; the next boot will overwrite it.

import type {JsonSchema} from '../types/api/_schema';
import {CONSUMER_KINDS} from './groupKindConsumers';
import type {GroupKindDefinition} from './groupKindTypes';

export type {GroupKindCategory, GroupKindDefinition} from './groupKindTypes';

// Schemas reused across kinds — declared once, referenced everywhere.

// Catch-all kind: accepts any shape so freeform / legacy metadata survives
// (every pre-existing group defaulted to kind='manual' via the column
// default). Typed kinds keep their strict schemas; only `manual` opts in.
const SCHEMA_PERMISSIVE: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {}
};

const TIME_HHMM: JsonSchema = {
    type: 'string',
    pattern: '^[0-2][0-9]:[0-5][0-9]$'
};

const POSITIVE_NUMBER: JsonSchema = {type: 'number', minimum: 0};
const POSITIVE_INT: JsonSchema = {type: 'integer', minimum: 1};
const ISO_DATE: JsonSchema = {type: 'string', format: 'date'};
const ISO_DATETIME: JsonSchema = {type: 'string', format: 'date-time'};
const SHORT_TEXT: JsonSchema = {type: 'string', maxLength: 120};
const CODE: JsonSchema = {type: 'string', maxLength: 64};

export const GROUP_KIND_CATALOG: readonly GroupKindDefinition[] = [
    // ─── general ──────────────────────────────────────────────────────
    {
        id: 'manual',
        appliesTo: 'both',
        displayName: 'Custom Group',
        description: 'A generic folder — pick this when no other kind fits.',
        category: 'general',
        icon: 'fa-folder',
        metadataSchema: SCHEMA_PERMISSIVE,
        sortOrder: 0
    },

    // ─── electrical ───────────────────────────────────────────────────
    {
        id: 'main_meter',
        appliesTo: 'both',
        displayName: 'Main Meter',
        description:
            "A site's main electrical meter at the service entrance — total incoming energy.",
        category: 'electrical',
        icon: 'fa-gauge-high',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_amps: POSITIVE_NUMBER,
                voltage: POSITIVE_NUMBER,
                phase_count: {type: 'integer', minimum: 1, maximum: 3}
            }
        },
        sortOrder: 8,
        metrics: [
            {
                name: 'energy_kwh',
                semantic: 'energy',
                rollup: {kind: 'sum', over: 'self.components.em:*.energy_kwh'}
            },
            {
                name: 'peak_w',
                semantic: 'power',
                rollup: {kind: 'max', over: 'self.components.em:*.power_w'}
            }
        ]
    },
    {
        id: 'submeter',
        appliesTo: 'both',
        displayName: 'Submeter',
        description:
            'A meter measuring one tenant, circuit, or load downstream of the main meter.',
        category: 'electrical',
        icon: 'fa-gauge',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_amps: POSITIVE_NUMBER,
                voltage: POSITIVE_NUMBER,
                serves: {type: 'string', maxLength: 80}
            }
        },
        sortOrder: 9,
        metrics: [
            {
                name: 'energy_kwh',
                semantic: 'energy',
                rollup: {kind: 'sum', over: 'self.components.em:*.energy_kwh'}
            }
        ]
    },
    {
        id: 'circuit',
        appliesTo: 'both',
        displayName: 'Circuit',
        description:
            'One electrical wire from a breaker to a group of outlets or equipment.',
        category: 'electrical',
        icon: 'fa-bolt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_amps: POSITIVE_NUMBER,
                voltage: POSITIVE_NUMBER,
                phase_count: {type: 'integer', minimum: 1, maximum: 3},
                panel_id: {type: 'integer'},
                breaker_position: {type: 'string', maxLength: 40},
                upstream_circuit_id: {type: 'integer'}
            }
        },
        sortOrder: 10,
        metrics: [
            {
                name: 'energy_kwh',
                semantic: 'energy',
                rollup: {kind: 'sum', over: 'self.components.em:*.energy_kwh'}
            },
            {
                name: 'peak_w',
                semantic: 'power',
                rollup: {kind: 'max', over: 'self.components.em:*.power_w'}
            }
        ]
    },
    {
        id: 'panel',
        appliesTo: 'both',
        displayName: 'Panel',
        description:
            'An electrical distribution panel (breaker box). Houses circuits.',
        category: 'electrical',
        icon: 'fa-th-large',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                breaker_count: POSITIVE_INT,
                voltage: POSITIVE_NUMBER,
                main_amps: POSITIVE_NUMBER,
                location_id: {type: 'integer'}
            }
        },
        sortOrder: 11
    },
    {
        id: 'feeder',
        appliesTo: 'both',
        displayName: 'Feeder',
        description:
            'A higher-capacity conductor feeding downstream panels or circuits.',
        category: 'electrical',
        icon: 'fa-plug',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_amps: POSITIVE_NUMBER,
                voltage: POSITIVE_NUMBER,
                length_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 12
    },
    {
        id: 'switchgear',
        appliesTo: 'both',
        displayName: 'Switchgear',
        description:
            'Industrial-scale equipment combining switches, fuses, and breakers.',
        category: 'electrical',
        icon: 'fa-server',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kv: POSITIVE_NUMBER,
                rated_amps: POSITIVE_NUMBER
            }
        },
        sortOrder: 13
    },
    {
        id: 'bus',
        appliesTo: 'both',
        displayName: 'Bus',
        description: 'A common conductor connecting multiple sources or loads.',
        category: 'electrical',
        icon: 'fa-grip-lines',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_amps: POSITIVE_NUMBER,
                voltage: POSITIVE_NUMBER
            }
        },
        sortOrder: 14
    },
    {
        id: 'substation',
        displayName: 'Substation',
        description:
            'High-voltage step-up or step-down installation for transmission or distribution.',
        category: 'electrical',
        icon: 'fa-tower-broadcast',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                primary_kv: POSITIVE_NUMBER,
                secondary_kv: POSITIVE_NUMBER,
                capacity_mva: POSITIVE_NUMBER
            }
        },
        sortOrder: 15
    },
    {
        id: 'distribution_transformer',
        appliesTo: 'both',
        displayName: 'Distribution Transformer',
        description:
            'Pole-mount or pad-mount transformer feeding a service area.',
        category: 'electrical',
        icon: 'fa-bolt-lightning',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                kva_rating: POSITIVE_NUMBER,
                primary_voltage: POSITIVE_NUMBER,
                secondary_voltage: POSITIVE_NUMBER
            }
        },
        sortOrder: 16
    },
    {
        id: 'capacitor_bank',
        appliesTo: 'both',
        displayName: 'Capacitor Bank',
        description:
            'Power-factor correction equipment installed on a feeder or panel.',
        category: 'electrical',
        icon: 'fa-microchip',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                kvar_rating: POSITIVE_NUMBER,
                stages: POSITIVE_INT
            }
        },
        sortOrder: 17
    },

    // ─── building ─────────────────────────────────────────────────────
    {
        id: 'hvac_zone',
        appliesTo: 'both',
        displayName: 'HVAC Zone',
        description: 'A controlled climate area served by HVAC equipment.',
        category: 'building',
        icon: 'fa-fan',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                setpoint_heat_c: {type: 'number'},
                setpoint_cool_c: {type: 'number'}
            }
        },
        sortOrder: 20
    },
    {
        id: 'lighting_zone',
        appliesTo: 'both',
        displayName: 'Lighting Zone',
        description: 'A space served by a controllable lighting circuit.',
        category: 'building',
        icon: 'fa-lightbulb',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                daylight_harvest: {type: 'boolean'}
            }
        },
        sortOrder: 21
    },
    {
        id: 'occupancy_group',
        displayName: 'Occupancy Group',
        description: 'Spaces grouped by typical occupancy schedule.',
        category: 'building',
        icon: 'fa-users',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                schedule_id: CODE,
                max_occupancy: {type: 'integer', minimum: 0}
            }
        },
        sortOrder: 22
    },
    {
        id: 'demand_response_group',
        displayName: 'Demand Response Group',
        description:
            'Equipment available for utility demand-response curtailment.',
        category: 'building',
        icon: 'fa-power-off',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                max_shed_kw: POSITIVE_NUMBER,
                program_id: CODE
            }
        },
        sortOrder: 23
    },
    {
        id: 'exterior_lighting',
        displayName: 'Exterior Lighting',
        description: 'Outdoor lighting — facade, parking, signage, perimeter.',
        category: 'building',
        icon: 'fa-tree-city',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                photocell_controlled: {type: 'boolean'},
                schedule_id: CODE
            }
        },
        sortOrder: 24
    },
    {
        id: 'parking_structure',
        displayName: 'Parking Structure',
        description:
            'A parking facility with its own lighting, ventilation, and EV loads.',
        category: 'building',
        icon: 'fa-square-parking',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                space_count: POSITIVE_INT,
                level_count: POSITIVE_INT
            }
        },
        sortOrder: 25
    },

    // ─── industrial ───────────────────────────────────────────────────
    {
        id: 'production_line',
        displayName: 'Production Line',
        description:
            'A sequence of equipment producing a manufacturing output.',
        category: 'industrial',
        icon: 'fa-industry',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                throughput_unit: CODE,
                throughput_target: POSITIVE_NUMBER,
                shift_pattern: CODE,
                product_code: CODE
            }
        },
        sortOrder: 30
    },
    {
        id: 'work_center',
        displayName: 'Work Center',
        description:
            'A defined area where work is performed on materials or products.',
        category: 'industrial',
        icon: 'fa-cogs',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity_units_per_hr: POSITIVE_NUMBER}
        },
        sortOrder: 31
    },
    {
        id: 'machine_cell',
        appliesTo: 'both',
        displayName: 'Machine Cell',
        description: 'A cluster of machines that operate as a unit.',
        category: 'industrial',
        icon: 'fa-robot',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {machine_count: POSITIVE_INT}
        },
        sortOrder: 32
    },
    {
        id: 'shift',
        displayName: 'Shift',
        description: 'A defined work period (e.g. day shift, night shift).',
        category: 'industrial',
        icon: 'fa-clock',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                start_time: TIME_HHMM,
                end_time: TIME_HHMM,
                days_of_week: {
                    type: 'array',
                    items: {type: 'integer', minimum: 0, maximum: 6},
                    uniqueItems: true,
                    maxItems: 7
                }
            }
        },
        sortOrder: 33
    },
    {
        id: 'batch',
        displayName: 'Batch',
        description: 'A production batch — a discrete run of output.',
        category: 'industrial',
        icon: 'fa-boxes',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                batch_number: CODE,
                started_at: ISO_DATETIME,
                completed_at: ISO_DATETIME
            }
        },
        sortOrder: 34
    },
    {
        id: 'compressed_air_system',
        displayName: 'Compressed Air System',
        description:
            'Compressors, receivers, and dryers serving plant air loads.',
        category: 'industrial',
        icon: 'fa-wind',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_cfm: POSITIVE_NUMBER,
                operating_psi: POSITIVE_NUMBER
            }
        },
        sortOrder: 35
    },
    {
        id: 'chilled_water_loop',
        displayName: 'Chilled Water Loop',
        description:
            'Chiller plant + distribution serving process or comfort cooling.',
        category: 'industrial',
        icon: 'fa-snowflake',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_tons: POSITIVE_NUMBER,
                supply_temp_c: {type: 'number'}
            }
        },
        sortOrder: 36
    },
    {
        id: 'hot_water_loop',
        displayName: 'Hot Water Loop',
        description:
            'Boiler plant + distribution serving heating or process loads.',
        category: 'industrial',
        icon: 'fa-fire',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                supply_temp_c: {type: 'number'}
            }
        },
        sortOrder: 37
    },

    // ─── property ─────────────────────────────────────────────────────
    {
        id: 'tenant',
        appliesTo: 'both',
        displayName: 'Tenant',
        description: 'A tenant in a multi-unit property.',
        category: 'property',
        icon: 'fa-user',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                lease_start: ISO_DATE,
                lease_end: ISO_DATE,
                cost_center: CODE,
                contact_email: SHORT_TEXT
            }
        },
        sortOrder: 40
    },
    {
        id: 'suite',
        displayName: 'Unit / Suite',
        description: 'A leasable physical unit in a multi-unit property.',
        category: 'property',
        icon: 'fa-building',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                floor: {type: 'integer'},
                area_m2: POSITIVE_NUMBER,
                bedrooms: {type: 'integer', minimum: 0}
            }
        },
        sortOrder: 41
    },
    {
        id: 'lease_period',
        displayName: 'Lease Period',
        description: 'A specific lease term for billing reconciliation.',
        category: 'property',
        icon: 'fa-calendar',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                start_date: ISO_DATE,
                end_date: ISO_DATE,
                tenant_group_id: {type: 'integer'}
            }
        },
        sortOrder: 42
    },
    {
        id: 'billing_unit',
        displayName: 'Billing Unit',
        description:
            'A virtual billing aggregation independent of physical units.',
        category: 'property',
        icon: 'fa-receipt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                cost_center: CODE,
                billing_address: {type: 'string', maxLength: 500}
            }
        },
        sortOrder: 43
    },

    // ─── retail ───────────────────────────────────────────────────────
    {
        id: 'store',
        displayName: 'Store',
        description: 'A retail store location.',
        category: 'retail',
        icon: 'fa-store',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                store_number: CODE,
                open_date: ISO_DATE,
                area_m2: POSITIVE_NUMBER
            }
        },
        sortOrder: 50
    },
    {
        id: 'region',
        displayName: 'Region',
        description: 'A geographic region of stores.',
        category: 'retail',
        icon: 'fa-globe',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {region_code: CODE}
        },
        sortOrder: 51
    },
    {
        id: 'brand',
        displayName: 'Brand',
        description: 'A brand within a multi-brand portfolio.',
        category: 'retail',
        icon: 'fa-trademark',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {brand_code: CODE}
        },
        sortOrder: 52
    },
    {
        id: 'franchise',
        displayName: 'Franchise',
        description:
            'A franchised group of stores under independent ownership.',
        category: 'retail',
        icon: 'fa-handshake',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {franchisee: SHORT_TEXT}
        },
        sortOrder: 53
    },
    {
        id: 'hospitality_venue',
        displayName: 'Hospitality Venue',
        description:
            'Hotel, restaurant, or similar venue with rooms or covers.',
        category: 'retail',
        icon: 'fa-hotel',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                venue_type: SHORT_TEXT,
                room_count: {type: 'integer', minimum: 0}
            }
        },
        sortOrder: 54
    },

    // ─── solar ────────────────────────────────────────────────────────
    {
        id: 'solar_array',
        appliesTo: 'both',
        displayName: 'Solar Array',
        description: 'A physical photovoltaic array.',
        category: 'solar',
        icon: 'fa-solar-panel',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                panel_count: POSITIVE_INT,
                rated_kw: POSITIVE_NUMBER,
                tilt_deg: {type: 'number'},
                azimuth_deg: {type: 'number'}
            }
        },
        sortOrder: 60,
        metrics: [
            {
                name: 'total_kwh',
                semantic: 'energy',
                rollup: {kind: 'sum', over: 'children.energy_kwh'}
            },
            {
                name: 'peak_kw',
                semantic: 'power',
                rollup: {kind: 'max', over: 'children.power_w'}
            },
            {
                name: 'inverter_count',
                semantic: 'count',
                rollup: {kind: 'count', over: 'children'}
            }
        ]
    },
    {
        id: 'dc_string',
        displayName: 'DC String',
        description:
            'A series-connected string of PV panels feeding a DC input.',
        category: 'solar',
        icon: 'fa-arrow-right',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                panels_in_series: POSITIVE_INT,
                open_circuit_voltage: POSITIVE_NUMBER
            }
        },
        sortOrder: 61
    },
    {
        id: 'ac_string',
        displayName: 'AC String',
        description: 'An AC-coupled cluster of microinverters.',
        category: 'solar',
        icon: 'fa-arrow-right',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {inverter_count: POSITIVE_INT}
        },
        sortOrder: 62
    },
    {
        id: 'inverter_cluster',
        displayName: 'Inverter Cluster',
        description: 'A group of inverters operating together on a site.',
        category: 'solar',
        icon: 'fa-network-wired',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {inverter_count: POSITIVE_INT}
        },
        sortOrder: 63
    },
    {
        id: 'battery_bank',
        appliesTo: 'both',
        displayName: 'Battery Bank',
        description: 'A group of battery storage units operating together.',
        category: 'energy_storage',
        icon: 'fa-battery-full',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                capacity_kwh: POSITIVE_NUMBER,
                rated_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 64,
        metrics: [
            {
                name: 'total_capacity_kwh',
                semantic: 'energy',
                rollup: {kind: 'sum', over: 'children.metadata.capacity_kwh'}
            },
            {
                name: 'avg_state_of_charge',
                semantic: 'percent_pct',
                rollup: {kind: 'avg', over: 'children.soc_pct'}
            }
        ]
    },

    // ─── ev ───────────────────────────────────────────────────────────
    {
        id: 'ev_charging_station',
        appliesTo: 'both',
        displayName: 'EV Charging Station',
        description: 'A single physical EVSE installation.',
        category: 'ev',
        icon: 'fa-charging-station',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                connector_type: CODE,
                max_kw: POSITIVE_NUMBER,
                port_count: POSITIVE_INT
            }
        },
        sortOrder: 70
    },
    {
        id: 'ev_charging_hub',
        displayName: 'EV Charging Hub',
        description:
            'A site hosting multiple EVSE stations with shared capacity.',
        category: 'ev',
        icon: 'fa-plug-circle-bolt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                station_count: POSITIVE_INT,
                site_max_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 71
    },
    {
        id: 'charge_session',
        displayName: 'Charge Session',
        description:
            'A single vehicle charging event for reconciliation or billing.',
        category: 'ev',
        icon: 'fa-bolt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                session_id: CODE,
                started_at: ISO_DATETIME,
                ended_at: ISO_DATETIME,
                driver_id: CODE
            }
        },
        sortOrder: 72
    },
    {
        id: 'fleet_vehicle',
        appliesTo: 'both',
        displayName: 'Fleet Vehicle',
        description: 'One vehicle in a managed EV fleet.',
        category: 'ev',
        icon: 'fa-car',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                vehicle_id: CODE,
                battery_kwh: POSITIVE_NUMBER
            }
        },
        sortOrder: 73
    },
    {
        id: 'smart_charging_pool',
        displayName: 'Smart Charging Pool',
        description:
            'Group of EVSEs coordinated by a load-management algorithm.',
        category: 'ev',
        icon: 'fa-sliders',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                pool_max_kw: POSITIVE_NUMBER,
                priority_rule: CODE
            }
        },
        sortOrder: 74
    },

    // ─── datacenter ───────────────────────────────────────────────────
    {
        id: 'server_rack',
        appliesTo: 'both',
        displayName: 'Server Rack',
        description: 'A single equipment rack within a data center room.',
        category: 'datacenter',
        icon: 'fa-server',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rack_units: POSITIVE_INT,
                rated_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 80
    },
    {
        id: 'pdu_chain',
        displayName: 'PDU Chain',
        description: 'Power distribution path from UPS through PDUs to a rack.',
        category: 'datacenter',
        icon: 'fa-link',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {redundancy: CODE}
        },
        sortOrder: 81
    },
    {
        id: 'ups_string',
        displayName: 'UPS String',
        description:
            'Battery string within a UPS — monitored for runtime estimation.',
        category: 'datacenter',
        icon: 'fa-battery-half',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kva: POSITIVE_NUMBER,
                runtime_min: POSITIVE_NUMBER
            }
        },
        sortOrder: 82
    },
    {
        id: 'cooling_loop',
        displayName: 'Cooling Loop',
        description:
            'CRAC/CRAH + chilled-water path serving a data-hall hot/cold aisle.',
        category: 'datacenter',
        icon: 'fa-snowflake',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw_cooling: POSITIVE_NUMBER,
                aisle: SHORT_TEXT
            }
        },
        sortOrder: 83
    },

    // ─── residential ──────────────────────────────────────────────────
    {
        id: 'household',
        displayName: 'Household',
        description: 'All devices belonging to one residence or family.',
        category: 'residential',
        icon: 'fa-house',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                occupant_count: {type: 'integer', minimum: 0},
                primary_residence: {type: 'boolean'}
            }
        },
        sortOrder: 90
    },
    {
        id: 'scene',
        displayName: 'Scene',
        description:
            'A coordinated device state for one moment (movie night, away, sleep).',
        category: 'residential',
        icon: 'fa-wand-magic-sparkles',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {scene_type: CODE}
        },
        sortOrder: 91
    },
    {
        id: 'automation_group',
        displayName: 'Automation Group',
        description:
            'Devices controlled together by a routine or smart automation.',
        category: 'residential',
        icon: 'fa-gears',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {automation_id: CODE}
        },
        sortOrder: 92
    },
    {
        id: 'security_zone',
        displayName: 'Security Zone',
        description:
            'Doors, motion sensors, cameras grouped for an alarm partition.',
        category: 'residential',
        icon: 'fa-shield',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {arm_mode: CODE}
        },
        sortOrder: 93
    },

    // ─── asset_mgmt ───────────────────────────────────────────────────
    {
        id: 'maintenance_window',
        displayName: 'Maintenance Window',
        description: 'A scheduled time window for planned maintenance.',
        category: 'asset_mgmt',
        icon: 'fa-wrench',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                start: ISO_DATETIME,
                end: ISO_DATETIME,
                recurring: {type: 'boolean'}
            }
        },
        sortOrder: 100
    },
    {
        id: 'audit_scope',
        displayName: 'Audit Scope',
        description: 'Defined scope for a regulatory or internal audit.',
        category: 'asset_mgmt',
        icon: 'fa-clipboard-check',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                audit_id: CODE,
                start_date: ISO_DATE,
                end_date: ISO_DATE
            }
        },
        sortOrder: 101
    },
    {
        id: 'warranty_class',
        displayName: 'Warranty Class',
        description: 'Equipment under the same warranty terms.',
        category: 'asset_mgmt',
        icon: 'fa-shield-alt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                warranty_start: ISO_DATE,
                warranty_end: ISO_DATE,
                warranty_provider: SHORT_TEXT
            }
        },
        sortOrder: 102
    },
    {
        id: 'service_contract',
        displayName: 'Service Contract',
        description: 'Equipment covered by a maintenance/service contract.',
        category: 'asset_mgmt',
        icon: 'fa-file-contract',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                contract_id: CODE,
                vendor: SHORT_TEXT,
                start_date: ISO_DATE,
                end_date: ISO_DATE
            }
        },
        sortOrder: 103
    },

    // ─── sustainability ───────────────────────────────────────────────
    {
        id: 'carbon_source',
        displayName: 'Carbon Source',
        description:
            'Devices grouped by GHG Protocol emission category for accounting.',
        category: 'sustainability',
        icon: 'fa-smog',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                scope: {type: 'string', enum: ['1', '2', '3']},
                category_code: CODE
            }
        },
        sortOrder: 110
    },
    {
        id: 'ppa_contract',
        displayName: 'PPA Contract',
        description:
            'Power purchase agreement scope for procurement reporting.',
        category: 'sustainability',
        icon: 'fa-file-signature',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                contract_id: CODE,
                start_date: ISO_DATE,
                end_date: ISO_DATE,
                price_per_mwh: POSITIVE_NUMBER
            }
        },
        sortOrder: 111
    },
    {
        id: 'recs_registry',
        displayName: 'REC Registry',
        description:
            'Renewable Energy Certificates tracked for market-based emissions.',
        category: 'sustainability',
        icon: 'fa-leaf',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                registry_name: SHORT_TEXT,
                certificate_count: {type: 'integer', minimum: 0}
            }
        },
        sortOrder: 112
    },
    {
        id: 'regulatory_reporting_unit',
        displayName: 'Regulatory Reporting Unit',
        description:
            'Aggregation boundary for CDP, CSRD, TCFD, SEC climate disclosures.',
        category: 'sustainability',
        icon: 'fa-clipboard-list',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                framework: SHORT_TEXT,
                reporting_year: {type: 'integer', minimum: 2000}
            }
        },
        sortOrder: 113
    },

    // ─── building (extended) ──────────────────────────────────────────
    {
        id: 'elevator_bank',
        appliesTo: 'both',
        displayName: 'Elevator Bank',
        description: 'Group of elevators sharing dispatch logic.',
        category: 'building',
        icon: 'fa-arrows-up-down',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                car_count: POSITIVE_INT,
                floors_served: POSITIVE_INT
            }
        },
        sortOrder: 26
    },
    {
        id: 'common_area',
        displayName: 'Common Area',
        description: 'Lobby, corridor, restroom — shared occupant spaces.',
        category: 'building',
        icon: 'fa-people-roof',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 27
    },
    {
        id: 'conference_room',
        displayName: 'Conference Room',
        description: 'Meeting space with shared occupancy schedule.',
        category: 'building',
        icon: 'fa-table',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                capacity: {type: 'integer', minimum: 0}
            }
        },
        sortOrder: 28
    },

    // ─── industrial (extended) ────────────────────────────────────────
    {
        id: 'reactor',
        appliesTo: 'both',
        displayName: 'Reactor',
        description: 'Chemical or biological reactor vessel.',
        category: 'industrial',
        icon: 'fa-radiation',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                volume_m3: POSITIVE_NUMBER,
                operating_temp_c: {type: 'number'},
                operating_pressure_bar: {type: 'number'}
            }
        },
        sortOrder: 38
    },
    {
        id: 'distillation_column',
        appliesTo: 'both',
        displayName: 'Distillation Column',
        description: 'Separation column for chemical or beverage processes.',
        category: 'industrial',
        icon: 'fa-vial',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                stage_count: POSITIVE_INT,
                reflux_ratio: POSITIVE_NUMBER
            }
        },
        sortOrder: 39
    },
    {
        id: 'heat_exchanger',
        appliesTo: 'both',
        displayName: 'Heat Exchanger',
        description: 'Equipment transferring heat between two fluid streams.',
        category: 'industrial',
        icon: 'fa-temperature-three-quarters',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                duty_kw: POSITIVE_NUMBER,
                fluid_hot: SHORT_TEXT,
                fluid_cold: SHORT_TEXT
            }
        },
        sortOrder: 40
    },
    {
        id: 'food_processing_oven',
        appliesTo: 'both',
        displayName: 'Food Processing Oven',
        description: 'Industrial oven for baking, roasting, or curing food.',
        category: 'industrial',
        icon: 'fa-bread-slice',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                max_temp_c: {type: 'number'}
            }
        },
        sortOrder: 41
    },
    {
        id: 'cleanroom',
        displayName: 'Cleanroom',
        description:
            'Particulate-controlled space classified to ISO 14644 / FED-209.',
        category: 'industrial',
        icon: 'fa-shield-virus',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                iso_class: {type: 'integer', minimum: 1, maximum: 9},
                area_m2: POSITIVE_NUMBER,
                air_changes_per_hour: POSITIVE_NUMBER
            }
        },
        sortOrder: 42
    },
    {
        id: 'atex_zone',
        displayName: 'ATEX / Hazardous Zone',
        description:
            'Area with explosive atmosphere classified per ATEX / IECEx.',
        category: 'industrial',
        icon: 'fa-triangle-exclamation',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                zone_class: SHORT_TEXT,
                gas_group: SHORT_TEXT,
                temperature_class: SHORT_TEXT
            }
        },
        sortOrder: 43
    },
    {
        id: 'dust_collection_system',
        appliesTo: 'both',
        displayName: 'Dust Collection System',
        description: 'Industrial dust extraction with filters and fans.',
        category: 'industrial',
        icon: 'fa-filter',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_cfm: POSITIVE_NUMBER,
                filter_count: POSITIVE_INT
            }
        },
        sortOrder: 44
    },
    {
        id: 'fume_hood',
        appliesTo: 'both',
        displayName: 'Fume Hood',
        description: 'Lab containment ventilation device.',
        category: 'industrial',
        icon: 'fa-mask-ventilator',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                face_velocity_fpm: POSITIVE_NUMBER,
                sash_height_mm: POSITIVE_NUMBER
            }
        },
        sortOrder: 45
    },

    // ─── electrical (extended) ────────────────────────────────────────
    {
        id: 'protection_zone',
        displayName: 'Protection Zone',
        description:
            'Coordinated protection scheme — overcurrent, differential, distance.',
        category: 'electrical',
        icon: 'fa-shield-halved',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                scheme_type: SHORT_TEXT,
                relay_count: POSITIVE_INT
            }
        },
        sortOrder: 18
    },
    {
        id: 'microgrid_segment',
        displayName: 'Microgrid Segment',
        description:
            'Islandable portion of a distribution network with local generation.',
        category: 'electrical',
        icon: 'fa-circle-nodes',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                grid_forming: {type: 'boolean'}
            }
        },
        sortOrder: 19
    },
    {
        id: 'ancillary_service_pool',
        displayName: 'Ancillary Service Pool',
        description:
            'Frequency-response or reserve resources offered to a grid operator.',
        category: 'electrical',
        icon: 'fa-handshake-angle',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                service_type: SHORT_TEXT,
                bid_mw: POSITIVE_NUMBER
            }
        },
        sortOrder: 20
    },

    // ─── residential (extended) ───────────────────────────────────────
    {
        id: 'garage',
        displayName: 'Garage',
        description: 'Residential garage — door openers, lighting, EV plug.',
        category: 'residential',
        icon: 'fa-warehouse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bay_count: POSITIVE_INT}
        },
        sortOrder: 94
    },
    {
        id: 'outdoor_zone',
        displayName: 'Outdoor Zone',
        description: 'Garden, patio, deck — outdoor smart-home loads.',
        category: 'residential',
        icon: 'fa-tree',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 95
    },
    {
        id: 'garden_irrigation',
        appliesTo: 'both',
        displayName: 'Garden Irrigation',
        description: 'Home irrigation valves and pumps grouped together.',
        category: 'residential',
        icon: 'fa-droplet',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {valve_count: POSITIVE_INT}
        },
        sortOrder: 96
    },

    // ─── renewables (non-solar) ───────────────────────────────────────
    {
        id: 'wind_turbine',
        appliesTo: 'both',
        displayName: 'Wind Turbine',
        description: 'A single wind turbine generating unit.',
        category: 'renewables',
        icon: 'fa-wind',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                rotor_diameter_m: POSITIVE_NUMBER,
                hub_height_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 120
    },
    {
        id: 'wind_farm',
        displayName: 'Wind Farm',
        description: 'Collection of wind turbines sharing a substation.',
        category: 'renewables',
        icon: 'fa-wind',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                turbine_count: POSITIVE_INT,
                rated_mw: POSITIVE_NUMBER
            }
        },
        sortOrder: 121
    },
    {
        id: 'hydro_turbine',
        appliesTo: 'both',
        displayName: 'Hydro Turbine',
        description: 'A hydroelectric generating unit.',
        category: 'renewables',
        icon: 'fa-water',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                head_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 122
    },
    {
        id: 'chp_unit',
        appliesTo: 'both',
        displayName: 'CHP Unit',
        description: 'Combined-heat-and-power cogeneration unit.',
        category: 'renewables',
        icon: 'fa-fire-flame-curved',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                electric_kw: POSITIVE_NUMBER,
                thermal_kw: POSITIVE_NUMBER,
                fuel: SHORT_TEXT
            }
        },
        sortOrder: 123
    },
    {
        id: 'biogas_plant',
        appliesTo: 'both',
        displayName: 'Biogas Plant',
        description: 'Anaerobic digester producing biogas for energy use.',
        category: 'renewables',
        icon: 'fa-leaf',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                feedstock: SHORT_TEXT,
                rated_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 124
    },
    {
        id: 'geothermal_loop',
        displayName: 'Geothermal Loop',
        description: 'Ground-source heat-pump loop for heating or cooling.',
        category: 'renewables',
        icon: 'fa-temperature-arrow-up',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                loop_length_m: POSITIVE_NUMBER,
                bore_count: POSITIVE_INT
            }
        },
        sortOrder: 125
    },

    // ─── healthcare ───────────────────────────────────────────────────
    {
        id: 'patient_room',
        displayName: 'Patient Room',
        description: 'Inpatient room with HVAC, lighting, and medical loads.',
        category: 'healthcare',
        icon: 'fa-bed-pulse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                bed_count: POSITIVE_INT,
                acuity_level: SHORT_TEXT
            }
        },
        sortOrder: 130
    },
    {
        id: 'operating_theater',
        displayName: 'Operating Theater',
        description: 'Surgical suite with strict environmental requirements.',
        category: 'healthcare',
        icon: 'fa-user-doctor',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                room_class: SHORT_TEXT,
                air_changes_per_hour: POSITIVE_NUMBER
            }
        },
        sortOrder: 131
    },
    {
        id: 'lab_freezer',
        appliesTo: 'both',
        displayName: 'Lab Freezer',
        description: 'Ultra-low or biomedical freezer for sample storage.',
        category: 'healthcare',
        icon: 'fa-temperature-arrow-down',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                setpoint_c: {type: 'number'},
                capacity_l: POSITIVE_NUMBER
            }
        },
        sortOrder: 132
    },
    {
        id: 'pharmacy',
        displayName: 'Pharmacy',
        description:
            'Drug storage and dispensing area with environmental monitoring.',
        category: 'healthcare',
        icon: 'fa-prescription-bottle-medical',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 133
    },
    {
        id: 'imaging_suite',
        displayName: 'Imaging Suite',
        description: 'MRI / CT / X-ray room with high-power equipment.',
        category: 'healthcare',
        icon: 'fa-magnet',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {modality: SHORT_TEXT}
        },
        sortOrder: 134
    },

    // ─── education ────────────────────────────────────────────────────
    {
        id: 'classroom',
        displayName: 'Classroom',
        description: 'Academic teaching space.',
        category: 'education',
        icon: 'fa-school',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                capacity: POSITIVE_INT,
                grade_level: SHORT_TEXT
            }
        },
        sortOrder: 140
    },
    {
        id: 'lecture_hall',
        displayName: 'Lecture Hall',
        description: 'Large auditorium-style instructional space.',
        category: 'education',
        icon: 'fa-chalkboard-user',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity: POSITIVE_INT}
        },
        sortOrder: 141
    },
    {
        id: 'dorm_room',
        displayName: 'Dorm Room',
        description: 'Student residential room.',
        category: 'education',
        icon: 'fa-bed',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bed_count: POSITIVE_INT}
        },
        sortOrder: 142
    },
    {
        id: 'library_zone',
        displayName: 'Library Zone',
        description: 'Library reading or stack area with quiet HVAC needs.',
        category: 'education',
        icon: 'fa-book',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 143
    },

    // ─── hospitality ──────────────────────────────────────────────────
    {
        id: 'guest_room',
        displayName: 'Guest Room',
        description: 'Hotel or short-stay guest room.',
        category: 'hospitality',
        icon: 'fa-bed',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                room_number: CODE,
                bed_type: SHORT_TEXT
            }
        },
        sortOrder: 150
    },
    {
        id: 'conference_hall',
        displayName: 'Conference Hall',
        description: 'Hospitality conference / event venue room.',
        category: 'hospitality',
        icon: 'fa-people-arrows',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity: POSITIVE_INT}
        },
        sortOrder: 151
    },
    {
        id: 'banquet_hall',
        displayName: 'Banquet Hall',
        description: 'Dining or reception hall with kitchen connection.',
        category: 'hospitality',
        icon: 'fa-utensils',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity: POSITIVE_INT}
        },
        sortOrder: 152
    },
    {
        id: 'kitchen_back_of_house',
        displayName: 'Kitchen (Back of House)',
        description: 'Commercial kitchen with hoods, ovens, refrigeration.',
        category: 'hospitality',
        icon: 'fa-kitchen-set',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 153
    },

    // ─── water utility ────────────────────────────────────────────────
    {
        id: 'water_meter_zone',
        displayName: 'Water Meter Zone',
        description: 'Area downstream of one water meter for billing.',
        category: 'water_utility',
        icon: 'fa-droplet',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                meter_serial: CODE,
                meter_size_mm: POSITIVE_NUMBER
            }
        },
        sortOrder: 160
    },
    {
        id: 'pressure_zone',
        displayName: 'Pressure Zone',
        description:
            'Distribution-network zone served by one pressure-control device.',
        category: 'water_utility',
        icon: 'fa-gauge',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                target_pressure_bar: POSITIVE_NUMBER,
                elevation_m: {type: 'number'}
            }
        },
        sortOrder: 161
    },
    {
        id: 'irrigation_zone',
        displayName: 'Irrigation Zone',
        description: 'Commercial or municipal irrigation area.',
        category: 'water_utility',
        icon: 'fa-faucet',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                schedule_id: CODE
            }
        },
        sortOrder: 162
    },
    {
        id: 'pump_station',
        appliesTo: 'both',
        displayName: 'Pump Station',
        description:
            'Wastewater lift or water booster station with multiple pumps.',
        category: 'water_utility',
        icon: 'fa-arrow-up-from-bracket',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                pump_count: POSITIVE_INT,
                rated_lps: POSITIVE_NUMBER
            }
        },
        sortOrder: 163
    },

    // ─── telecom ──────────────────────────────────────────────────────
    {
        id: 'cell_tower',
        appliesTo: 'both',
        displayName: 'Cell Tower',
        description: 'Mobile-network radio tower site.',
        category: 'telecom',
        icon: 'fa-tower-cell',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                operator: SHORT_TEXT,
                technology: SHORT_TEXT
            }
        },
        sortOrder: 170
    },
    {
        id: 'base_station',
        appliesTo: 'both',
        displayName: 'Base Station',
        description: 'Active radio equipment at a tower or rooftop.',
        category: 'telecom',
        icon: 'fa-tower-broadcast',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                generation: SHORT_TEXT
            }
        },
        sortOrder: 171
    },
    {
        id: 'fiber_node',
        appliesTo: 'both',
        displayName: 'Fiber Node',
        description: 'Fiber-optic concentrator or splitter location.',
        category: 'telecom',
        icon: 'fa-link',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {port_count: POSITIVE_INT}
        },
        sortOrder: 172
    },
    {
        id: 'telecom_shelter',
        displayName: 'Telecom Shelter',
        description: 'Equipment hut with HVAC and backup power.',
        category: 'telecom',
        icon: 'fa-warehouse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                backup_runtime_min: POSITIVE_NUMBER
            }
        },
        sortOrder: 173
    },

    // ─── agriculture ──────────────────────────────────────────────────
    {
        id: 'greenhouse',
        displayName: 'Greenhouse',
        description: 'Controlled-environment growing structure.',
        category: 'agriculture',
        icon: 'fa-leaf',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                heating_type: SHORT_TEXT
            }
        },
        sortOrder: 180
    },
    {
        id: 'livestock_barn',
        displayName: 'Livestock Barn',
        description: 'Animal housing with ventilation and feed systems.',
        category: 'agriculture',
        icon: 'fa-cow',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                animal_type: SHORT_TEXT,
                head_count: POSITIVE_INT
            }
        },
        sortOrder: 181
    },
    {
        id: 'grain_silo',
        appliesTo: 'both',
        displayName: 'Grain Silo',
        description: 'Grain or feed storage with aeration and unloading.',
        category: 'agriculture',
        icon: 'fa-warehouse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity_tonnes: POSITIVE_NUMBER}
        },
        sortOrder: 182
    },
    {
        id: 'dairy_parlor',
        displayName: 'Dairy Parlor',
        description: 'Milking parlor with vacuum pumps and bulk tank.',
        category: 'agriculture',
        icon: 'fa-cow',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {stall_count: POSITIVE_INT}
        },
        sortOrder: 183
    },

    // ─── transportation ───────────────────────────────────────────────
    {
        id: 'airport_gate',
        displayName: 'Airport Gate',
        description: 'Boarding gate with jet bridge and ground-power loads.',
        category: 'transportation',
        icon: 'fa-plane',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                gate_number: CODE,
                jet_bridge: {type: 'boolean'}
            }
        },
        sortOrder: 190
    },
    {
        id: 'rail_station_platform',
        displayName: 'Rail Station Platform',
        description: 'Train platform with lighting, signage, and PA systems.',
        category: 'transportation',
        icon: 'fa-train',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                platform_number: CODE,
                length_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 191
    },
    {
        id: 'port_terminal',
        displayName: 'Port Terminal',
        description: 'Cargo or passenger terminal at a maritime port.',
        category: 'transportation',
        icon: 'fa-ship',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                terminal_type: SHORT_TEXT,
                berth_count: POSITIVE_INT
            }
        },
        sortOrder: 192
    },
    {
        id: 'shipping_dock',
        displayName: 'Shipping Dock',
        description:
            'Loading dock with refrigeration, levelers, and tractor power.',
        category: 'transportation',
        icon: 'fa-truck-ramp-box',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {dock_door_count: POSITIVE_INT}
        },
        sortOrder: 193
    },
    {
        id: 'bus_depot',
        displayName: 'Bus Depot',
        description: 'Bus storage and maintenance yard with charging.',
        category: 'transportation',
        icon: 'fa-bus',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                bay_count: POSITIVE_INT,
                ev_charging: {type: 'boolean'}
            }
        },
        sortOrder: 194
    },
    {
        id: 'highway_segment',
        displayName: 'Highway Segment',
        description: 'Stretch of highway with lighting, sensors, ITS gear.',
        category: 'transportation',
        icon: 'fa-road',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                route: CODE,
                length_km: POSITIVE_NUMBER
            }
        },
        sortOrder: 195
    },

    // ─── smart city ───────────────────────────────────────────────────
    {
        id: 'smart_streetlight',
        appliesTo: 'both',
        displayName: 'Smart Streetlight',
        description: 'Connected streetlight with dimming and telemetry.',
        category: 'smart_city',
        icon: 'fa-lightbulb',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                pole_id: CODE,
                wattage: POSITIVE_NUMBER
            }
        },
        sortOrder: 200
    },
    {
        id: 'traffic_intersection',
        displayName: 'Traffic Intersection',
        description:
            'Signalized intersection with controllers and vehicle detectors.',
        category: 'smart_city',
        icon: 'fa-traffic-light',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {approach_count: POSITIVE_INT}
        },
        sortOrder: 201
    },
    {
        id: 'public_charging_curb',
        appliesTo: 'both',
        displayName: 'Public Curb Charger',
        description: 'On-street EV charging point integrated with the curb.',
        category: 'smart_city',
        icon: 'fa-plug',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                connector_type: CODE,
                max_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 202
    },
    {
        id: 'parking_meter_zone',
        displayName: 'Parking Meter Zone',
        description: 'Cluster of smart parking meters under one schedule.',
        category: 'smart_city',
        icon: 'fa-square-parking',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {space_count: POSITIVE_INT}
        },
        sortOrder: 203
    },
    {
        id: 'public_wifi_zone',
        displayName: 'Public Wi-Fi Zone',
        description:
            'Municipal Wi-Fi coverage area with multiple access points.',
        category: 'smart_city',
        icon: 'fa-wifi',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {ap_count: POSITIVE_INT}
        },
        sortOrder: 204
    },

    // ─── logistics ────────────────────────────────────────────────────
    {
        id: 'warehouse_zone',
        displayName: 'Warehouse Zone',
        description: 'Defined area within a warehouse for pick or storage.',
        category: 'logistics',
        icon: 'fa-warehouse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                rack_count: POSITIVE_INT
            }
        },
        sortOrder: 210
    },
    {
        id: 'cold_storage',
        displayName: 'Cold Storage',
        description: 'Refrigerated or freezer warehouse room.',
        category: 'logistics',
        icon: 'fa-snowflake',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                setpoint_c: {type: 'number'},
                volume_m3: POSITIVE_NUMBER
            }
        },
        sortOrder: 211
    },
    {
        id: 'distribution_center',
        displayName: 'Distribution Center',
        description: 'Large hub for receiving and dispatching shipments.',
        category: 'logistics',
        icon: 'fa-truck-fast',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                throughput_units_per_day: POSITIVE_NUMBER,
                dock_count: POSITIVE_INT
            }
        },
        sortOrder: 212
    },
    {
        id: 'packing_station',
        displayName: 'Packing Station',
        description:
            'Workstation with conveyors, scales, label printers, and lighting.',
        category: 'logistics',
        icon: 'fa-box',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {station_count: POSITIVE_INT}
        },
        sortOrder: 213
    },
    {
        id: 'micro_fulfillment_node',
        displayName: 'Micro-Fulfillment Node',
        description:
            'Small automated fulfillment hub serving last-mile delivery.',
        category: 'logistics',
        icon: 'fa-boxes-stacked',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                automation_type: SHORT_TEXT
            }
        },
        sortOrder: 214
    },

    // ─── public safety ────────────────────────────────────────────────
    {
        id: 'fire_station',
        displayName: 'Fire Station',
        description: 'Firehouse with apparatus bays and crew quarters.',
        category: 'public_safety',
        icon: 'fa-fire-extinguisher',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bay_count: POSITIVE_INT}
        },
        sortOrder: 220
    },
    {
        id: 'police_substation',
        displayName: 'Police Substation',
        description: 'Neighborhood police facility with command and detention.',
        category: 'public_safety',
        icon: 'fa-shield',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                holding_cells: {type: 'integer', minimum: 0}
            }
        },
        sortOrder: 221
    },
    {
        id: 'emergency_shelter',
        displayName: 'Emergency Shelter',
        description: 'Designated facility for disaster sheltering.',
        category: 'public_safety',
        icon: 'fa-house-medical',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity: POSITIVE_INT}
        },
        sortOrder: 222
    },
    {
        id: 'emergency_generator_site',
        appliesTo: 'both',
        displayName: 'Emergency Generator Site',
        description: 'Standby genset installation for critical loads.',
        category: 'public_safety',
        icon: 'fa-bolt-lightning',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                fuel_type: SHORT_TEXT
            }
        },
        sortOrder: 223
    },

    // ─── stadium / sports ────────────────────────────────────────────
    {
        id: 'stadium_section',
        displayName: 'Stadium Section',
        description: 'Seating bowl or concourse zone within a stadium.',
        category: 'stadium_sports',
        icon: 'fa-futbol',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                seat_count: POSITIVE_INT,
                level: SHORT_TEXT
            }
        },
        sortOrder: 230
    },
    {
        id: 'ice_rink',
        displayName: 'Ice Rink',
        description:
            'Indoor or outdoor ice surface with refrigeration and lighting.',
        category: 'stadium_sports',
        icon: 'fa-skating',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 231
    },
    {
        id: 'swimming_pool',
        displayName: 'Swimming Pool',
        description: 'Pool facility with pumps, heating, and filtration.',
        category: 'stadium_sports',
        icon: 'fa-person-swimming',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                volume_m3: POSITIVE_NUMBER,
                heated: {type: 'boolean'}
            }
        },
        sortOrder: 232
    },
    {
        id: 'gym_zone',
        displayName: 'Gym Zone',
        description: 'Fitness area with equipment and HVAC loads.',
        category: 'stadium_sports',
        icon: 'fa-dumbbell',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 233
    },

    // ─── energy storage ──────────────────────────────────────────────
    {
        id: 'hydrogen_electrolyzer',
        appliesTo: 'both',
        displayName: 'Hydrogen Electrolyzer',
        description: 'Electrolysis plant producing green hydrogen.',
        category: 'energy_storage',
        icon: 'fa-flask',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_mw: POSITIVE_NUMBER,
                technology: SHORT_TEXT
            }
        },
        sortOrder: 240
    },
    {
        id: 'hydrogen_storage_tank',
        appliesTo: 'both',
        displayName: 'Hydrogen Storage Tank',
        description: 'Pressurized or liquefied hydrogen storage vessel.',
        category: 'energy_storage',
        icon: 'fa-gas-pump',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                capacity_kg: POSITIVE_NUMBER,
                pressure_bar: POSITIVE_NUMBER
            }
        },
        sortOrder: 241
    },
    {
        id: 'thermal_storage',
        appliesTo: 'both',
        displayName: 'Thermal Storage',
        description: 'Ice, chilled-water, or molten-salt thermal energy store.',
        category: 'energy_storage',
        icon: 'fa-temperature-high',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                capacity_kwh_thermal: POSITIVE_NUMBER,
                medium: SHORT_TEXT
            }
        },
        sortOrder: 242
    },
    {
        id: 'pumped_hydro_storage',
        displayName: 'Pumped Hydro Storage',
        description: 'Reversible-pump hydro facility for grid storage.',
        category: 'energy_storage',
        icon: 'fa-water',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_mw: POSITIVE_NUMBER,
                head_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 243
    },

    // ─── mining ──────────────────────────────────────────────────────
    {
        id: 'mining_shaft',
        displayName: 'Mining Shaft',
        description: 'Vertical or inclined mine access with hoist and vent.',
        category: 'mining',
        icon: 'fa-arrow-down',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {depth_m: POSITIVE_NUMBER}
        },
        sortOrder: 250
    },
    {
        id: 'ore_conveyor_belt',
        appliesTo: 'both',
        displayName: 'Ore Conveyor Belt',
        description: 'Long-haul belt moving ore from extraction to processing.',
        category: 'mining',
        icon: 'fa-grip-lines-vertical',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                length_m: POSITIVE_NUMBER,
                rated_tph: POSITIVE_NUMBER
            }
        },
        sortOrder: 251
    },
    {
        id: 'processing_mill',
        appliesTo: 'both',
        displayName: 'Processing Mill',
        description: 'Crusher / SAG mill processing extracted ore.',
        category: 'mining',
        icon: 'fa-mortar-pestle',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {rated_kw: POSITIVE_NUMBER}
        },
        sortOrder: 252
    },
    {
        id: 'tailings_pond',
        displayName: 'Tailings Pond',
        description: 'Containment for waste slurry with pumps and monitoring.',
        category: 'mining',
        icon: 'fa-water',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {volume_m3: POSITIVE_NUMBER}
        },
        sortOrder: 253
    },

    // ─── marine / offshore ───────────────────────────────────────────
    {
        id: 'offshore_platform',
        displayName: 'Offshore Platform',
        description: 'Fixed or floating offshore production platform.',
        category: 'marine_offshore',
        icon: 'fa-oil-well',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                platform_type: SHORT_TEXT,
                water_depth_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 260
    },
    {
        id: 'vessel',
        appliesTo: 'both',
        displayName: 'Vessel',
        description: 'A ship — commercial, cruise, research, or workboat.',
        category: 'marine_offshore',
        icon: 'fa-ship',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                imo_number: CODE,
                vessel_type: SHORT_TEXT
            }
        },
        sortOrder: 261
    },
    {
        id: 'marine_dock',
        displayName: 'Marine Dock',
        description: 'Dock with shore-power, lighting, and cargo gear.',
        category: 'marine_offshore',
        icon: 'fa-anchor',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                berth_length_m: POSITIVE_NUMBER,
                shore_power_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 262
    },
    {
        id: 'fish_farm',
        displayName: 'Fish Farm',
        description: 'Aquaculture pen system with aeration and feeders.',
        category: 'marine_offshore',
        icon: 'fa-fish',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                pen_count: POSITIVE_INT,
                species: SHORT_TEXT
            }
        },
        sortOrder: 263
    },

    // ─── healthcare (extended) ───────────────────────────────────────
    {
        id: 'icu',
        displayName: 'Intensive Care Unit',
        description: 'Critical-care ward with high reliability requirements.',
        category: 'healthcare',
        icon: 'fa-heart-pulse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bed_count: POSITIVE_INT}
        },
        sortOrder: 135
    },
    {
        id: 'emergency_department',
        displayName: 'Emergency Department',
        description: 'Hospital ER with 24/7 critical loads.',
        category: 'healthcare',
        icon: 'fa-truck-medical',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bay_count: POSITIVE_INT}
        },
        sortOrder: 136
    },
    {
        id: 'dialysis_unit',
        displayName: 'Dialysis Unit',
        description: 'Dialysis treatment area with water-purification loads.',
        category: 'healthcare',
        icon: 'fa-syringe',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {station_count: POSITIVE_INT}
        },
        sortOrder: 137
    },
    {
        id: 'sterilization_room',
        displayName: 'Sterilization Room',
        description: 'Central sterile processing with autoclaves and washers.',
        category: 'healthcare',
        icon: 'fa-soap',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {autoclave_count: POSITIVE_INT}
        },
        sortOrder: 138
    },

    // ─── industrial (extended again) ─────────────────────────────────
    {
        id: 'packaging_line',
        displayName: 'Packaging Line',
        description:
            'Fillers, cappers, labelers, and case packers in sequence.',
        category: 'industrial',
        icon: 'fa-boxes-packing',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                throughput_units_per_min: POSITIVE_NUMBER,
                product_type: SHORT_TEXT
            }
        },
        sortOrder: 46
    },
    {
        id: 'mixing_vessel',
        appliesTo: 'both',
        displayName: 'Mixing Vessel',
        description: 'Agitated tank for blending or reacting materials.',
        category: 'industrial',
        icon: 'fa-blender',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                volume_m3: POSITIVE_NUMBER,
                agitator_kw: POSITIVE_NUMBER
            }
        },
        sortOrder: 47
    },
    {
        id: 'centrifuge_station',
        appliesTo: 'both',
        displayName: 'Centrifuge Station',
        description: 'Centrifugal separator for solids/liquids.',
        category: 'industrial',
        icon: 'fa-rotate',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                bowl_diameter_mm: POSITIVE_NUMBER
            }
        },
        sortOrder: 48
    },
    {
        id: 'industrial_mill',
        appliesTo: 'both',
        displayName: 'Industrial Mill',
        description: 'Grinding mill — cement, paper, pulp, or pigment.',
        category: 'industrial',
        icon: 'fa-mortar-pestle',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                mill_type: SHORT_TEXT
            }
        },
        sortOrder: 49
    },

    // ─── agriculture (extended) ──────────────────────────────────────
    {
        id: 'crop_field',
        displayName: 'Crop Field',
        description: 'Row-crop field with sensors and irrigation.',
        category: 'agriculture',
        icon: 'fa-wheat-awn',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_ha: POSITIVE_NUMBER,
                crop_type: SHORT_TEXT
            }
        },
        sortOrder: 184
    },
    {
        id: 'vineyard',
        displayName: 'Vineyard',
        description:
            'Grape-growing area with drip irrigation and weather stations.',
        category: 'agriculture',
        icon: 'fa-wine-bottle',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_ha: POSITIVE_NUMBER,
                varietal: SHORT_TEXT
            }
        },
        sortOrder: 185
    },
    {
        id: 'aquaculture_pond',
        displayName: 'Aquaculture Pond',
        description: 'Fish or shellfish pond with aeration and monitoring.',
        category: 'agriculture',
        icon: 'fa-fish',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                volume_m3: POSITIVE_NUMBER,
                species: SHORT_TEXT
            }
        },
        sortOrder: 186
    },
    {
        id: 'orchard',
        displayName: 'Orchard',
        description: 'Tree-crop farm with fans, sprinklers, and frost control.',
        category: 'agriculture',
        icon: 'fa-apple-whole',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_ha: POSITIVE_NUMBER,
                tree_type: SHORT_TEXT
            }
        },
        sortOrder: 187
    },

    // ─── hospitality (extended) ──────────────────────────────────────
    {
        id: 'hotel_pool_area',
        displayName: 'Hotel Pool Area',
        description: 'Hospitality pool deck with lighting and heating.',
        category: 'hospitality',
        icon: 'fa-person-swimming',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 154
    },
    {
        id: 'spa_zone',
        displayName: 'Spa Zone',
        description: 'Spa with saunas, steam rooms, and treatment areas.',
        category: 'hospitality',
        icon: 'fa-hot-tub-person',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {treatment_room_count: POSITIVE_INT}
        },
        sortOrder: 155
    },
    {
        id: 'hotel_fitness_zone',
        displayName: 'Hotel Fitness Zone',
        description: 'Guest fitness room with equipment loads.',
        category: 'hospitality',
        icon: 'fa-dumbbell',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 156
    },
    {
        id: 'hotel_lobby',
        displayName: 'Hotel Lobby',
        description: 'Reception, lounge, and circulation common area.',
        category: 'hospitality',
        icon: 'fa-couch',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 157
    },

    // ─── building (extended again) ───────────────────────────────────
    {
        id: 'atrium',
        displayName: 'Atrium',
        description:
            'Multi-story open space — daylight, smoke control, special HVAC.',
        category: 'building',
        icon: 'fa-tower-observation',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {volume_m3: POSITIVE_NUMBER}
        },
        sortOrder: 29
    },
    {
        id: 'it_closet',
        displayName: 'IT Closet',
        description: 'Telecom / network equipment room with dedicated cooling.',
        category: 'building',
        icon: 'fa-network-wired',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                rated_kw: POSITIVE_NUMBER,
                rack_count: POSITIVE_INT
            }
        },
        sortOrder: 30
    },

    // ─── property (extended) ─────────────────────────────────────────
    {
        id: 'short_term_rental',
        displayName: 'Short-Term Rental',
        description: 'Airbnb / VRBO-style short-stay unit.',
        category: 'property',
        icon: 'fa-key',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                listing_id: CODE,
                platform: SHORT_TEXT
            }
        },
        sortOrder: 45
    },
    {
        id: 'timeshare_unit',
        displayName: 'Timeshare Unit',
        description: 'Fractional-ownership unit with rotating occupants.',
        category: 'property',
        icon: 'fa-calendar-days',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {weeks_owned: POSITIVE_INT}
        },
        sortOrder: 46
    },

    // ─── stadium / sports (extended) ─────────────────────────────────
    {
        id: 'golf_course',
        displayName: 'Golf Course',
        description:
            'Golf facility with irrigation, clubhouse, and cart fleet.',
        category: 'stadium_sports',
        icon: 'fa-golf-ball-tee',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                hole_count: POSITIVE_INT,
                area_ha: POSITIVE_NUMBER
            }
        },
        sortOrder: 234
    },
    {
        id: 'tennis_court',
        displayName: 'Tennis Court',
        description: 'Indoor or outdoor tennis playing surface.',
        category: 'stadium_sports',
        icon: 'fa-baseball',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                surface: SHORT_TEXT,
                lighted: {type: 'boolean'}
            }
        },
        sortOrder: 235
    },
    {
        id: 'race_track',
        displayName: 'Race Track',
        description: 'Motor or horse racing circuit with pit and grandstand.',
        category: 'stadium_sports',
        icon: 'fa-flag-checkered',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                length_m: POSITIVE_NUMBER,
                track_type: SHORT_TEXT
            }
        },
        sortOrder: 236
    },
    {
        id: 'equestrian_facility',
        displayName: 'Equestrian Facility',
        description: 'Stables, riding arenas, and training yards for horses.',
        category: 'stadium_sports',
        icon: 'fa-horse',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {stall_count: POSITIVE_INT}
        },
        sortOrder: 237
    },
    {
        id: 'skate_park',
        displayName: 'Skate Park',
        description: 'Skateboarding park with ramps and bowls.',
        category: 'stadium_sports',
        icon: 'fa-person-skating',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 238
    },

    // ─── mass transit ─────────────────────────────────────────────────
    {
        id: 'metro_station',
        displayName: 'Metro Station',
        description: 'Subway / metro station with escalators and signaling.',
        category: 'mass_transit',
        icon: 'fa-train-subway',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                station_code: CODE,
                line_count: POSITIVE_INT
            }
        },
        sortOrder: 270
    },
    {
        id: 'tram_depot',
        displayName: 'Tram Depot',
        description: 'Tram / light-rail storage and maintenance yard.',
        category: 'mass_transit',
        icon: 'fa-train-tram',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bay_count: POSITIVE_INT}
        },
        sortOrder: 271
    },
    {
        id: 'ferry_terminal',
        displayName: 'Ferry Terminal',
        description: 'Passenger or vehicle ferry terminal with shore loads.',
        category: 'mass_transit',
        icon: 'fa-ship',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {berth_count: POSITIVE_INT}
        },
        sortOrder: 272
    },
    {
        id: 'light_rail_segment',
        displayName: 'Light Rail Segment',
        description:
            'Section of light-rail track with signaling and traction power.',
        category: 'mass_transit',
        icon: 'fa-train-tram',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {length_m: POSITIVE_NUMBER}
        },
        sortOrder: 273
    },
    {
        id: 'bike_share_station',
        displayName: 'Bike Share Station',
        description: 'Docking station for bike-sharing fleets.',
        category: 'mass_transit',
        icon: 'fa-bicycle',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {dock_count: POSITIVE_INT}
        },
        sortOrder: 274
    },
    {
        id: 'gondola_lift',
        appliesTo: 'both',
        displayName: 'Gondola Lift',
        description: 'Aerial cable transport — urban or alpine.',
        category: 'mass_transit',
        icon: 'fa-mountain',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                cabin_count: POSITIVE_INT,
                length_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 275
    },

    // ─── religious ────────────────────────────────────────────────────

    // ─── civic / government ──────────────────────────────────────────

    // ─── entertainment ────────────────────────────────────────────────

    // ─── cultural ────────────────────────────────────────────────────

    // ─── specialty agriculture ───────────────────────────────────────

    // ─── film / media ────────────────────────────────────────────────
    {
        id: 'sound_stage',
        displayName: 'Sound Stage',
        description: 'Acoustically isolated film/TV production stage.',
        category: 'film_media',
        icon: 'fa-video',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                clear_height_m: POSITIVE_NUMBER
            }
        },
        sortOrder: 330
    },
    {
        id: 'post_production_suite',
        displayName: 'Post-Production Suite',
        description: 'Color, sound, or VFX finishing room.',
        category: 'film_media',
        icon: 'fa-pen-to-square',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {discipline: SHORT_TEXT}
        },
        sortOrder: 331
    },
    {
        id: 'broadcast_studio',
        displayName: 'Broadcast Studio',
        description: 'Live TV / radio production studio with control room.',
        category: 'film_media',
        icon: 'fa-tower-broadcast',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {studio_type: SHORT_TEXT}
        },
        sortOrder: 332
    },
    {
        id: 'edit_bay',
        displayName: 'Edit Bay',
        description: 'Video editing workstation room with storage and KVM.',
        category: 'film_media',
        icon: 'fa-clapperboard',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {workstation_count: POSITIVE_INT}
        },
        sortOrder: 333
    },
    {
        id: 'virtual_production_volume',
        displayName: 'Virtual Production Volume',
        description:
            'LED-wall stage for in-camera VFX and virtual backgrounds.',
        category: 'film_media',
        icon: 'fa-display',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {wall_area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 334
    },

    // ─── funeral services ────────────────────────────────────────────

    // ─── childcare ───────────────────────────────────────────────────
    {
        id: 'daycare_room',
        displayName: 'Daycare Room',
        description: 'Toddler or preschool classroom in a daycare facility.',
        category: 'childcare',
        icon: 'fa-baby',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {child_capacity: POSITIVE_INT}
        },
        sortOrder: 350
    },
    {
        id: 'infant_room',
        displayName: 'Infant Room',
        description: 'Infant care space with cribs and feeding stations.',
        category: 'childcare',
        icon: 'fa-baby-carriage',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {crib_count: POSITIVE_INT}
        },
        sortOrder: 351
    },
    {
        id: 'playground',
        displayName: 'Playground',
        description: 'Outdoor or indoor play area with lighting and shade.',
        category: 'childcare',
        icon: 'fa-child',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 352
    },
    {
        id: 'after_school_program',
        displayName: 'After-School Program',
        description: 'After-hours childcare and tutoring program space.',
        category: 'childcare',
        icon: 'fa-school-circle-check',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {capacity: POSITIVE_INT}
        },
        sortOrder: 353
    },

    // ─── animal care ─────────────────────────────────────────────────

    // ─── beauty / wellness ───────────────────────────────────────────
    {
        id: 'beauty_salon',
        displayName: 'Beauty Salon',
        description: 'Hair / styling salon with stations and color rooms.',
        category: 'beauty_wellness',
        icon: 'fa-scissors',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {chair_count: POSITIVE_INT}
        },
        sortOrder: 370
    },
    {
        id: 'barber_shop',
        displayName: 'Barber Shop',
        description: 'Traditional barber shop with chairs and sterilizers.',
        category: 'beauty_wellness',
        icon: 'fa-scissors',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {chair_count: POSITIVE_INT}
        },
        sortOrder: 371
    },
    {
        id: 'massage_room',
        displayName: 'Massage Room',
        description: 'Therapeutic massage treatment room.',
        category: 'beauty_wellness',
        icon: 'fa-spa',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {table_count: POSITIVE_INT}
        },
        sortOrder: 372
    },
    {
        id: 'tattoo_parlor',
        displayName: 'Tattoo Parlor',
        description: 'Tattoo studio with sterilization and ventilation.',
        category: 'beauty_wellness',
        icon: 'fa-pen-fancy',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {station_count: POSITIVE_INT}
        },
        sortOrder: 373
    },
    {
        id: 'nail_salon',
        displayName: 'Nail Salon',
        description: 'Manicure and pedicure salon with extraction ventilation.',
        category: 'beauty_wellness',
        icon: 'fa-hand-sparkles',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {station_count: POSITIVE_INT}
        },
        sortOrder: 374
    },

    // ─── automotive ──────────────────────────────────────────────────
    {
        id: 'car_wash',
        appliesTo: 'both',
        displayName: 'Car Wash',
        description:
            'Automated or hand car wash with pumps, dryers, and reclaim.',
        category: 'automotive',
        icon: 'fa-car-side',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                bay_count: POSITIVE_INT,
                automation_type: SHORT_TEXT
            }
        },
        sortOrder: 380
    },
    {
        id: 'auto_repair_bay',
        displayName: 'Auto Repair Bay',
        description: 'Vehicle service bay with lifts and compressed air.',
        category: 'automotive',
        icon: 'fa-wrench',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {bay_count: POSITIVE_INT}
        },
        sortOrder: 381
    },
    {
        id: 'dealership_lot',
        displayName: 'Dealership Lot',
        description: 'Vehicle sales lot with outdoor lighting and signage.',
        category: 'automotive',
        icon: 'fa-car',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                area_m2: POSITIVE_NUMBER,
                inventory_count: POSITIVE_INT
            }
        },
        sortOrder: 382
    },
    {
        id: 'parking_garage_commercial',
        displayName: 'Commercial Parking Garage',
        description: 'Commercial parking garage with ventilation and gates.',
        category: 'automotive',
        icon: 'fa-square-parking',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                space_count: POSITIVE_INT,
                level_count: POSITIVE_INT
            }
        },
        sortOrder: 383
    },
    {
        id: 'fuel_island',
        appliesTo: 'both',
        displayName: 'Fuel Island',
        description: 'Fueling area with dispensers and canopy lighting.',
        category: 'automotive',
        icon: 'fa-gas-pump',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {dispenser_count: POSITIVE_INT}
        },
        sortOrder: 384
    },

    // ─── convenience / service ───────────────────────────────────────
    {
        id: 'gas_station',
        displayName: 'Gas Station',
        description: 'Retail fuel station with C-store and food service.',
        category: 'convenience_service',
        icon: 'fa-gas-pump',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                pump_count: POSITIVE_INT,
                has_convenience_store: {type: 'boolean'}
            }
        },
        sortOrder: 390
    },
    {
        id: 'convenience_store',
        displayName: 'Convenience Store',
        description: 'Small retail store with refrigeration and POS.',
        category: 'convenience_service',
        icon: 'fa-bag-shopping',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {area_m2: POSITIVE_NUMBER}
        },
        sortOrder: 391
    },
    {
        id: 'laundromat',
        displayName: 'Laundromat',
        description: 'Coin / card-operated laundry with washers and dryers.',
        category: 'convenience_service',
        icon: 'fa-shirt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                washer_count: POSITIVE_INT,
                dryer_count: POSITIVE_INT
            }
        },
        sortOrder: 392
    },
    {
        id: 'dry_cleaner',
        displayName: 'Dry Cleaner',
        description: 'Garment cleaning facility with solvent extraction.',
        category: 'convenience_service',
        icon: 'fa-shirt',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {machine_count: POSITIVE_INT}
        },
        sortOrder: 393
    },
    {
        id: 'atm_kiosk',
        appliesTo: 'both',
        displayName: 'ATM Kiosk',
        description: 'Standalone ATM enclosure with HVAC and surveillance.',
        category: 'convenience_service',
        icon: 'fa-credit-card',
        metadataSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {atm_count: POSITIVE_INT}
        },
        sortOrder: 394
    },

    // ─── defense ─────────────────────────────────────────────────────

    // ─── common appliances & sources (logical-meter kindId) ───────────
    // App-friendly everyday loads/sources promoted for the energy
    // logical-meter picker. Mapped onto existing domain categories — the
    // category is a search/filter aid, not a permission. All tag a single
    // device or a group, so appliesTo: 'both'.
    ...CONSUMER_KINDS
];
