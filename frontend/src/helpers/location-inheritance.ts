// Pre-seeding a child location from its parent. When you add a child under an
// existing location, the parent's geo/address/contact/etc. are sensible
// starting values — the backend declares which keys carry over via the child
// kind's `inheritableFields`, so this stays data-driven (no hardcoded list).

// Answer — kindFields a new child should open with, copied from the parent.
// Only keys the child kind marks inheritable and that hold a real value are
// carried; everything stays editable in the form.
export function inheritKindFieldsFromParent(args: {
    parentKindFields: Record<string, unknown> | null | undefined;
    childInheritableFields: ReadonlyArray<string>;
}): Record<string, unknown> {
    const source = args.parentKindFields ?? {};
    const seeded: Record<string, unknown> = {};
    for (const key of args.childInheritableFields) {
        const value = source[key];
        if (isEmptyValue(value)) continue;
        seeded[key] = value;
    }
    return seeded;
}

// Answer — is this a value worth carrying over? Null, empty string, and empty
// arrays are treated as "nothing to inherit".
function isEmptyValue(value: unknown): boolean {
    if (value == null || value === '') return true;
    return Array.isArray(value) && value.length === 0;
}
