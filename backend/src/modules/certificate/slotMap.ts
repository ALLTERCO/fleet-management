// Cert slot → Shelly.Put* method registry.

import type {CertificateSlot} from '../../types/api/certificate';

export interface SlotConfig {
    rpcMethod: string;
    // null = all Gen2+
    minFirmware: [number, number, number] | null;
    requiresReboot: boolean;
}

export const SLOT_REGISTRY: Record<CertificateSlot, SlotConfig> = {
    root_ca: {
        rpcMethod: 'Shelly.PutUserCA',
        minFirmware: null,
        requiresReboot: false
    },
    client_cert: {
        rpcMethod: 'Shelly.PutTLSClientCert',
        minFirmware: null,
        requiresReboot: false
    },
    client_key: {
        rpcMethod: 'Shelly.PutTLSClientKey',
        minFirmware: null,
        requiresReboot: false
    },
    server_ca: {
        rpcMethod: 'Shelly.PutHTTPServerCABundle',
        minFirmware: [2, 0, 0],
        requiresReboot: true
    },
    server_cert: {
        rpcMethod: 'Shelly.PutHTTPServerCert',
        minFirmware: [2, 0, 0],
        requiresReboot: true
    },
    server_key: {
        rpcMethod: 'Shelly.PutHTTPServerKey',
        minFirmware: [2, 0, 0],
        requiresReboot: true
    }
};

// 6 KiB chunk leaves room under the 8192-byte HTTP RPC envelope cap.
export const PEM_CHUNK_BYTES = 6 * 1024;

export function chunkPemForUpload(pem: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < pem.length; i += PEM_CHUNK_BYTES) {
        out.push(pem.slice(i, i + PEM_CHUNK_BYTES));
    }
    return out.length > 0 ? out : [''];
}

export function parseFwId(
    fwId: string | null | undefined
): [number, number, number] | null {
    if (!fwId) return null;
    // fw_id format: "20240101-080000/2.0.0-beta1@abcdef" — semver after the slash.
    const m = fwId.match(/\/(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function fwAtLeast(
    fw: [number, number, number] | null,
    min: [number, number, number]
): boolean {
    if (!fw) return false;
    if (fw[0] !== min[0]) return fw[0] > min[0];
    if (fw[1] !== min[1]) return fw[1] > min[1];
    return fw[2] >= min[2];
}
