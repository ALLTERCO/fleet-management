// Allowlist of Shelly model-code families FM accepts for a backup import.
// A genuine Shelly Gen2+ backup names the device model it came from; import
// rejects any model outside this list so a forged or foreign archive can't be
// stored and later restored onto a device.
//
// Community-extensible: a new device family is a one-line prefix addition,
// no schema change. Shelly model codes are structured <family><variant>,
// e.g. SNSW-001X16EU / SPSW-004PE16EU / S3PL-00112EU — matching is a
// case-insensitive prefix test against the four-character family segment.
//
// Only families whose firmware exposes Sys.CreateBackup can produce a backup,
// so Gen1 (SH*) and BLU (SB*) families are intentionally absent.

export const KNOWN_SHELLY_MODEL_PREFIXES: readonly string[] = [
    // Gen2 Plus
    'SNSW',
    'SNPL',
    'SNSN',
    'SNGW',
    'SNDM',
    'SNDC',
    'SNPM',
    'SNCB',
    // Gen2 Pro
    'SPSW',
    'SPEM',
    'SPDM',
    'SPSH',
    'SPCB',
    // Gen3
    'S3SW',
    'S3PL',
    'S3SN',
    'S3EM',
    'S3DM',
    'S3GW',
    'S3MX',
    'S3MG',
    'S3CB',
    'S3PM',
    // Gen4
    'S4SW',
    'S4PL',
    'S4EM',
    'S4DM',
    // Wall Display
    'SAWD'
];

// A model is known when its family segment matches a supported prefix. Loud
// false on any non-string / too-short input so a malformed archive is rejected
// rather than silently treated as unknown-but-plausible.
export function isKnownShellyModel(model: string | null | undefined): boolean {
    if (typeof model !== 'string') return false;
    const code = model.trim().toUpperCase();
    if (code.length < 4) return false;
    return KNOWN_SHELLY_MODEL_PREFIXES.some((prefix) =>
        code.startsWith(prefix)
    );
}
