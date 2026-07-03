// Shared visual decoration shape used by virtual devices and groups.
// Resources that need extra fields (e.g. virtual-device role layout)
// extend this with additionalProperties + their own props.

import type {JsonSchema} from './_schema';

export const VISUAL_DECORATION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        // MDI ('mdi mdi-fridge') or FA ('fas fa-thermometer-half'); applied verbatim to `<i class>`.
        icon: {type: 'string', minLength: 1, maxLength: 80},
        // Accent token KEY, not raw CSS — maps to `--accent-<key>` in the
        // design system. Locked at the schema boundary so user data can't
        // smuggle arbitrary CSS.
        accent: {type: 'string', minLength: 1, maxLength: 80},
        // Bundled device image model, resolved through the same model→image
        // helper used by physical Shelly devices.
        imageModel: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            pattern: '^[A-Za-z0-9_.-]+$'
        }
    }
};

export interface VisualDecoration {
    icon?: string;
    accent?: string;
    imageModel?: string;
}
