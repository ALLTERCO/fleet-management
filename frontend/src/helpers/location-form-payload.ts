import type {LocationKindFields} from '@api/location';
import type {GeoPrecision, GeoState} from './location-drawer-steps';

interface LocationFormFields {
    mode: 'create' | 'edit';
    kindFields: Record<string, unknown>;
    geo: GeoState;
    hasPin: boolean;
    precision: GeoPrecision;
    tags: readonly string[];
    notes: string;
}

export function buildLocationKindFields(
    form: LocationFormFields
): LocationKindFields {
    const result: LocationKindFields = {...form.kindFields};
    if (form.hasPin) {
        result.geo = {...form.geo, precision: form.precision};
    }
    // Updates merge fields, so omission cannot clear a previously saved value.
    if (form.tags.length) result.tags = [...form.tags];
    else if (form.mode === 'edit') result.tags = null;
    else delete result.tags;
    const notes = form.notes.trim();
    if (notes) result.notes = notes;
    else if (form.mode === 'edit') result.notes = null;
    else delete result.notes;
    return result;
}
