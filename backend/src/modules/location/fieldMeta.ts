// Per-field UI metadata — what the frontend needs to render a form
// control without guessing. One map, referenced by kindDescriptors so
// every kind that uses the same field shows the same label / widget /
// group. Add new fields here, then list them in kindSchemas.ts.

/** Form groupings — drives section headers / accordion layout. */
export type FieldGroup =
    | 'identity'
    | 'physical'
    | 'contact'
    | 'hours'
    | 'compliance'
    | 'operational'
    | 'environmental'
    | 'custom';

/** Input widget hint. Frontend picks the control. */
export type FieldWidget =
    | 'text' // plain input
    | 'number' // numeric input
    | 'iso' // strict dropdown from a canonical ISO list
    | 'combobox' // env-extensible dropdown, custom allowed
    | 'multiCombobox' // same, but multi-select
    | 'address' // nested {streetName,streetNumber,city,region,postalCode,countryCode}
    | 'geo' // nested {lat, lng}
    | 'contact' // nested {name, role, email, phone, afterHours}
    | 'operatingHours' // weekday grid
    | 'environmentalSetpoint'; // nested {tempMin/Max, humidityMin/Max}

export interface FieldDescriptor {
    key: string;
    label: string;
    description: string;
    group: FieldGroup;
    widget: FieldWidget;
    /** Name of an OptionSetDescriptor returned in ListKinds.optionSets. */
    optionSet?: string;
    /** Client-side hint (backend already enforces min/max/pattern via JSON schema). */
    min?: number;
    max?: number;
    pattern?: string;
    /** Displayed next to the input — "m²", "°C", "%", etc. */
    unit?: string;
    placeholder?: string;
}

/** Every field the per-kind schemas may list. Keep keys in sync with
 *  kindSchemas.ts property names — the describe-golden test catches drift. */
export const FIELD_META: Readonly<Record<string, FieldDescriptor>> =
    Object.freeze({
        // ---- identity -----------------------------------------------------
        countryCode: {
            key: 'countryCode',
            label: 'Country',
            description: 'ISO 3166-1 alpha-2 code (US, GB, DE…).',
            group: 'identity',
            widget: 'iso',
            optionSet: 'countryCode',
            pattern: '^[A-Z]{2}$',
            placeholder: 'US'
        },
        regionCode: {
            key: 'regionCode',
            label: 'Region / State code',
            description: 'ISO 3166-2 code prefixed by the parent country.',
            group: 'identity',
            widget: 'text',
            pattern: '^[A-Z]{2}-[A-Z0-9]{1,3}$',
            placeholder: 'US-CA'
        },
        currency: {
            key: 'currency',
            label: 'Currency',
            description: 'ISO 4217 currency code.',
            group: 'identity',
            widget: 'iso',
            optionSet: 'currency',
            pattern: '^[A-Z]{3}$',
            placeholder: 'USD'
        },
        timezone: {
            key: 'timezone',
            label: 'Time zone',
            description: 'IANA time zone identifier.',
            group: 'identity',
            widget: 'iso',
            optionSet: 'timezone',
            placeholder: 'Europe/Sofia'
        },
        regulatoryZone: {
            key: 'regulatoryZone',
            label: 'Regulatory zone',
            description:
                'Default data-retention + privacy regime for locations beneath this one.',
            group: 'identity',
            widget: 'combobox',
            optionSet: 'regulatoryZone'
        },
        siteType: {
            key: 'siteType',
            label: 'Site type',
            description: 'What happens at this site (office, data-center, …).',
            group: 'identity',
            widget: 'combobox',
            optionSet: 'siteType'
        },
        buildingType: {
            key: 'buildingType',
            label: 'Building type',
            description: 'Primary use of the building.',
            group: 'identity',
            widget: 'combobox',
            optionSet: 'buildingType'
        },
        roomType: {
            key: 'roomType',
            label: 'Room type',
            description: 'Function (meeting, server, lab, …).',
            group: 'identity',
            widget: 'combobox',
            optionSet: 'roomType'
        },

        // ---- physical -----------------------------------------------------
        address: {
            key: 'address',
            label: 'Address',
            description: 'Street address lines, city, postal code.',
            group: 'physical',
            widget: 'address'
        },
        geo: {
            key: 'geo',
            label: 'Coordinates',
            description: 'Latitude / longitude for the map view.',
            group: 'physical',
            widget: 'geo'
        },
        floorCount: {
            key: 'floorCount',
            label: 'Floor count',
            description: 'Total floors in the building (incl. basements).',
            group: 'physical',
            widget: 'number',
            min: -5,
            max: 300
        },
        grossFloorArea: {
            key: 'grossFloorArea',
            label: 'Gross floor area',
            description: 'Total floor area.',
            group: 'physical',
            widget: 'number',
            min: 0,
            unit: 'm²'
        },
        yearBuilt: {
            key: 'yearBuilt',
            label: 'Year built',
            description: 'Construction year — useful for HVAC age tracking.',
            group: 'physical',
            widget: 'number',
            min: 1500,
            max: 2200
        },
        energyCertification: {
            key: 'energyCertification',
            label: 'Energy certification',
            description: 'LEED / BREEAM / DGNB rating if any.',
            group: 'physical',
            widget: 'combobox',
            optionSet: 'energyCertification'
        },
        floorNumber: {
            key: 'floorNumber',
            label: 'Floor number',
            description: 'Negative for basements (−1 = B1).',
            group: 'physical',
            widget: 'number',
            min: -20,
            max: 300
        },
        roomNumber: {
            key: 'roomNumber',
            label: 'Room number',
            description: 'Internal room identifier.',
            group: 'physical',
            widget: 'text'
        },
        capacity: {
            key: 'capacity',
            label: 'Capacity',
            description: 'Occupancy / seat count.',
            group: 'physical',
            widget: 'number',
            min: 0,
            max: 100000,
            unit: 'people'
        },

        // ---- contact ------------------------------------------------------
        primaryContact: {
            key: 'primaryContact',
            label: 'Primary contact',
            description: 'Day-to-day contact for this location.',
            group: 'contact',
            widget: 'contact'
        },
        emergencyContact: {
            key: 'emergencyContact',
            label: 'Emergency contact',
            description: 'After-hours / escalation contact.',
            group: 'contact',
            widget: 'contact'
        },

        // ---- hours --------------------------------------------------------
        operatingHours: {
            key: 'operatingHours',
            label: 'Operating hours',
            description:
                'Per-weekday open/close windows. Drives quiet hours for alerts.',
            group: 'hours',
            widget: 'operatingHours'
        },

        // ---- compliance + access -----------------------------------------
        complianceTags: {
            key: 'complianceTags',
            label: 'Compliance',
            description:
                'HIPAA / PCI / SOC2 / … tags. Drives retention + audit policy.',
            group: 'compliance',
            widget: 'multiCombobox',
            optionSet: 'complianceTag'
        },
        accessProcedure: {
            key: 'accessProcedure',
            label: 'Access procedure',
            description: 'How field service gets inside.',
            group: 'compliance',
            widget: 'combobox',
            optionSet: 'accessProcedure'
        },

        // ---- operational -------------------------------------------------
        operationalTier: {
            key: 'operationalTier',
            label: 'Operational tier',
            description:
                'Criticality — drives alert routing + quiet-hour behavior.',
            group: 'operational',
            widget: 'combobox',
            optionSet: 'operationalTier'
        },

        // ---- environmental -----------------------------------------------
        environmentalSetpoint: {
            key: 'environmentalSetpoint',
            label: 'Environmental setpoint',
            description:
                'Target temperature + humidity range (server rooms, labs, cold storage).',
            group: 'environmental',
            widget: 'environmentalSetpoint'
        }
    });

/** Sort key for form sections. */
export const FIELD_GROUP_ORDER: readonly FieldGroup[] = Object.freeze([
    'identity',
    'physical',
    'contact',
    'hours',
    'operational',
    'compliance',
    'environmental',
    'custom'
]);

/** Look up a field descriptor. Returns a synthetic fallback for any key
 *  that's in a kind schema but not yet catalogued here — keeps the form
 *  renderable while the describe-golden test surfaces the gap. */
export function fieldMetaFor(key: string): FieldDescriptor {
    return (
        FIELD_META[key] ?? {
            key,
            label: key,
            description: '',
            group: 'custom',
            widget: 'text'
        }
    );
}
