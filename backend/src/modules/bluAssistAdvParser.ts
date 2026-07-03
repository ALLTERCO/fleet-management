// BLE advertisement parser for GATTC.Scan results.

const ALLTERCO_COMPANY_ID = 0x0ba9;
const BTHOME_SERVICE_UUID = 0xfcd2;
const AD_TYPE_SHORTENED_NAME = 0x08;
const AD_TYPE_COMPLETE_NAME = 0x09;
const AD_TYPE_MFDATA = 0xff;
const AD_TYPE_SERVICE_DATA_16 = 0x16;

export interface AdvParsed {
    isShellyBlu: boolean;
    encrypted: boolean;
    localName?: string;
    /** Numeric model_id from Shelly mfdata when present (byte 0 = 0x01 format). */
    modelId?: number;
}

function hexToBytes(hex: string): number[] {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const out: number[] = [];
    for (let i = 0; i + 1 < clean.length; i += 2) {
        out.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return out;
}

export function parseAdvData(hex: string): AdvParsed {
    const bytes = hexToBytes(hex);
    let isShellyBlu = false;
    let encrypted = false;
    let localName: string | undefined;
    let modelId: number | undefined;
    let i = 0;
    while (i < bytes.length) {
        const len = bytes[i++];
        if (len === 0 || i + len > bytes.length) break;
        const type = bytes[i];
        const value = bytes.slice(i + 1, i + len);
        i += len;

        if (type === AD_TYPE_COMPLETE_NAME || type === AD_TYPE_SHORTENED_NAME) {
            try {
                localName = Buffer.from(value).toString('utf8');
            } catch {
                // malformed bytes — skip
            }
        } else if (type === AD_TYPE_MFDATA && value.length >= 2) {
            const companyId = value[0] | (value[1] << 8);
            if (companyId === ALLTERCO_COMPANY_ID) {
                isShellyBlu = true;
                encrypted = true;
                // BLU peripheral encrypted format (version byte 0x01):
                // [version][model_id LE 2B][...payload]
                if (value.length >= 5 && value[2] === 0x01) {
                    modelId = value[3] | (value[4] << 8);
                }
            }
        } else if (type === AD_TYPE_SERVICE_DATA_16 && value.length >= 3) {
            const uuid = value[0] | (value[1] << 8);
            if (uuid === BTHOME_SERVICE_UUID) {
                const deviceInfo = value[2];
                if ((deviceInfo & 0x01) !== 0) encrypted = true;
            }
        }
    }
    return {isShellyBlu, encrypted, localName, modelId};
}
