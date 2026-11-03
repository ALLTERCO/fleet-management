// Shelly firmware can rename the model prefix embedded in its external id while
// the physical device (MAC suffix) stays the same. Keep alias handling narrow:
// only resolve an alias when Fleet already knows the target id. That preserves
// normal waiting-room onboarding for genuinely new devices using the new name.

const MINI_1PM_G4_ALIAS = /^shellymini1pmg4-([0-9a-f]{12})$/i;

export function shellyExternalIdAliasTarget(
    reportedExternalId: string
): string | null {
    const match = MINI_1PM_G4_ALIAS.exec(reportedExternalId.trim());
    return match ? `shelly1pmminig4-${match[1].toLowerCase()}` : null;
}

export function resolveKnownShellyExternalId(
    reportedExternalId: string,
    isKnown: (externalId: string) => boolean
): string {
    const reported = reportedExternalId.trim();
    // An explicitly stored id always wins. This prevents an admitted future
    // device using the new prefix from being folded into an older alias target.
    if (isKnown(reported)) return reported;

    const alias = shellyExternalIdAliasTarget(reported);
    return alias && isKnown(alias) ? alias : reported;
}

// Device construction happens after admission. Only substitute the stable id
// when the already-approved admission id is exactly the known alias target;
// otherwise keep the device's reported id unchanged.
export function resolveAdmittedShellyExternalId(
    reportedExternalId: string,
    admittedExternalId?: string
): string {
    const reported = reportedExternalId.trim();
    if (!admittedExternalId || admittedExternalId === reported) return reported;
    return shellyExternalIdAliasTarget(reported) === admittedExternalId
        ? admittedExternalId
        : reported;
}
