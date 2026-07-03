// Alert fingerprint. Must match notifications.fn_compute_fingerprint_v2 so the
// engine and the SQL backfill produce identical strings. Granularity mirrors
// the subject/field the rule targets — the same fire-path string is rebuilt on
// the clear path so an alert auto-resolves against the row it created.

export interface FingerprintInput {
    ruleId: number;
    subjectType: 'device' | 'entity' | 'group' | 'location' | 'tag';
    subjectId: string;
    /** Discriminator string already formatted by a builder below, or omitted
     *  for subject-level kinds. */
    discriminator?: string;
}

export function fingerprintV2(input: FingerprintInput): string {
    const base = `rule:${input.ruleId}:${input.subjectType}:${input.subjectId}`;
    return input.discriminator ? `${base}${input.discriminator}` : base;
}

// Field-scoped kinds (component_threshold, anomaly_band, change_event,
// device_event) — keyed by the component.field they watch.
export function fieldDiscriminator(component: string, field: string): string {
    return `:${component}.${field}`;
}

// One builder for every field-scoped kind, called by BOTH the fire and the
// clear path so the two can never diverge.
export function fieldFingerprintV2(input: {
    ruleId: number;
    subjectType: FingerprintInput['subjectType'];
    subjectId: string;
    component: string;
    field: string;
}): string {
    return fingerprintV2({
        ruleId: input.ruleId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        discriminator: fieldDiscriminator(input.component, input.field)
    });
}

// Per-fire incident kinds (operation failed, back-online, automation failed) —
// ms precision so two incidents in the same second don't collide under the v2
// unique index. Pass the same ts used elsewhere on the fire.
export function timestampedDiscriminator(tsMs: number): string {
    return `:t:${tsMs}`;
}
