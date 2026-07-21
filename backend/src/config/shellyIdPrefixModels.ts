// Single backend home for the shellyID-prefix → representative model catalog.
// A device announces itself as "<prefix>-<mac>" (e.g. "shelly2pmg4-98a31671fa04")
// before any RPC probe has run, so pending/waiting-room records may carry no
// sys.device.model. This catalog resolves the prefix to a representative model
// code so payloads leave the backend already carrying a model (the frontend
// keeps no device-knowledge table of its own).

const SHELLY_ID_PREFIX_TO_MODEL: Readonly<Record<string, string>> = {
    // Gen 2 Plus
    shellyplus1: 'SPSW-101PE16EU',
    shellyplus1pm: 'SPSW-001PE16EU',
    shellyplus2pm: 'SPSW-202PE16EU',
    shellyplusht: 'SBHT-003C',
    shellyplusplugs: 'SNPL-00110EU',
    shellyplusplugus: 'SNPL-00116US',
    shellyplusplugit: 'SNPL-00116IT',
    shellypluspluguk: 'SNPL-00112UK',
    shellyplusuni: 'SNSW-001X16EU',
    shellyplusdimmer010v: 'SNDM-00100WW',
    shellyplusi4: 'SNSN-0024X',
    shellyplussmoke: 'SNSN-0031Z',
    shellyplusrgbwpm: 'SNDC-0D4P10WW',
    // Gen 2 Pro
    shellypro1: 'SPSW-101PE16EU',
    shellypro1pm: 'SPSW-001PE16EU',
    shellypro2: 'SPSW-102PE16EU',
    shellypro2pm: 'SPSW-202PE16EU',
    shellypro3: 'SPSW-102PE16EU',
    shellypro4pm: 'SPSW-004PE16EU',
    shellypro3em: 'SPEM-003CEBEU',
    shellyproem50: 'SPEM-002CEBEU50',
    shellyprodm1pm: 'SPDM-001PE01EU',
    shellyprodm2pm: 'SPDM-002PE01EU',
    // Gen 3
    shelly1g3: 'S3SW-001X8EU',
    shelly1pmg3: 'S3SW-001P8EU',
    shelly2pmg3: 'S3SW-002P16EU',
    shellypmminig3: 'S3PM-001PCEU16',
    shellyplugsg3: 'S3PL-00112EU',
    shellyhtg3: 'S3SN-0024X',
    shellyi4g3: 'S3SN-0D24X',
    shelly0110dimg3: 'S3DM-0010WW',
    shellyemg3: 'S3EM-002CXCEU',
    shellyblug3: 'S3BL-C010007AEU',
    shellyxtrg3: 'S3XT-0S',
    // Gen 4
    shelly1g4: 'S4SW-001X8EU',
    shelly1pmg4: 'S4SW-001P8EU',
    shelly2pmg4: 'S4SW-002P16EU',
    shellyplugsg4: 'S4PL-00416EU',
    // BLU
    sbbt: 'SBBT-002C',
    sbdw: 'SBDW-002C',
    sbmo: 'SBMO-003Z',
    // Wall Display
    shellywalldisplay: 'SAWD-0A1XX10EU1',
    // Cury
    cury: 'cury'
};

/** Representative model for a shellyID's prefix, or undefined when unknown. */
export function modelFromShellyIdPrefix(shellyID: string): string | undefined {
    const prefix = shellyID.split('-')[0]?.toLowerCase() ?? '';
    return SHELLY_ID_PREFIX_TO_MODEL[prefix];
}
