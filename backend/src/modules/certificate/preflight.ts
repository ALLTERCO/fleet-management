// Pre-flight: classify resolved devices into compatible / skipped / warnings.

import type {
    CertificatePreflightResult,
    CertificatePreflightSkip,
    CertificatePreflightWarning,
    CertificateSlot
} from '../../types/api/certificate';
import * as DeviceCollector from '../DeviceCollector';
import {fwAtLeast, parseFwId, SLOT_REGISTRY} from './slotMap';

interface CertMeta {
    slot_compat: string[] | null;
    key_algo: string | null;
}

export interface PreflightDeviceProbe {
    online: boolean;
    fwId: string | null | undefined;
}

export type PreflightDeviceLookup = (
    shellyId: string
) => PreflightDeviceProbe | null;

const realLookup: PreflightDeviceLookup = (id) => {
    const d = DeviceCollector.getDevice(id);
    if (!d) return null;
    return {online: d.online, fwId: d.info?.fw_id};
};

export function preflight(
    deviceIds: string[],
    slot: CertificateSlot,
    cert: CertMeta,
    lookup: PreflightDeviceLookup = realLookup
): CertificatePreflightResult {
    const compatible: string[] = [];
    const skipped: CertificatePreflightSkip[] = [];
    const warnings: CertificatePreflightWarning[] = [];

    if (cert.slot_compat && !cert.slot_compat.includes(slot)) {
        for (const id of deviceIds) {
            skipped.push({shellyId: id, reason: 'slot-not-in-cert-compat'});
        }
        return {compatible, skipped, warnings};
    }
    if (cert.key_algo === 'ecdsa-p521') {
        for (const id of deviceIds) {
            skipped.push({shellyId: id, reason: 'unsupported-key-algo'});
        }
        return {compatible, skipped, warnings};
    }

    const cfg = SLOT_REGISTRY[slot];
    for (const id of deviceIds) {
        const probe = lookup(id);
        if (!probe?.online) {
            skipped.push({shellyId: id, reason: 'offline'});
            continue;
        }
        if (cfg.minFirmware) {
            const fw = parseFwId(probe.fwId);
            if (!fwAtLeast(fw, cfg.minFirmware)) {
                skipped.push({shellyId: id, reason: 'firmware-too-old'});
                continue;
            }
        }
        compatible.push(id);
    }

    return {compatible, skipped, warnings};
}
