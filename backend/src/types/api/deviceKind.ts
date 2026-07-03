// Params for the device-kind classification RPCs. `kind` is a catalog id
// (vendor catalog, later org custom kinds) or null to clear it. The id is
// validated against the catalog at runtime by deviceKindValidator.

import type {JsonSchema} from './_schema';

export interface DeviceKindAssignment {
    shellyID: string;
    kind: string | null;
}

export interface DeviceKindSetParams {
    shellyID: string;
    /** Catalog kind id, or null to clear the classification. */
    kind: string | null;
    /** Billing label for cost allocation; null clears, omit to leave as-is. */
    costCenter?: string | null;
}

export const DEVICE_KIND_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'kind'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string', minLength: 1, maxLength: 64},
        kind: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 64,
            description: 'Catalog kind id, or null to clear the classification'
        },
        costCenter: {
            type: ['string', 'null'],
            maxLength: 120,
            description: 'Billing label; null clears it, omit to leave as-is'
        }
    }
};
