// Resolves how to render a device's identifying glyph.

import type {shelly_device_t} from '@/types';
import {GENERIC_LOGO, getLogo, getLogoFromModel} from './device';

const SYNTHETIC_BLU_LOGO = '/images/devices/generic-blu-device.png';
const SYNTHETIC_VIRTUAL_ICON = 'fas fa-cube';

// Asset id → resolver URL. Holder columns store UUIDs only.
export function resolveAssetSrc(assetId: string): string {
    return `/api/assets/${assetId}`;
}

export type DeviceLogo =
    | {kind: 'icon'; faClass: string; accent?: string}
    | {kind: 'image'; src: string}
    | {kind: 'cdn'; src: string};

// Explicit backend/user decoration — same precedence for every device type.
function decorationLogo(device: shelly_device_t): DeviceLogo | null {
    const visual =
        device.meta?.virtualDevice?.visual ??
        device.meta?.bluetoothDevice?.visual;
    if (typeof visual?.icon === 'string' && visual.icon.length > 0) {
        return {kind: 'icon', faClass: visual.icon, accent: visual.accent};
    }
    const imageAssetId = device.info?.imageAssetId;
    if (typeof imageAssetId === 'string' && imageAssetId.length > 0) {
        return {kind: 'image', src: resolveAssetSrc(imageAssetId)};
    }
    if (typeof visual?.imageModel === 'string' && visual.imageModel.length > 0) {
        return {kind: 'image', src: getLogoFromModel(visual.imageModel)};
    }
    const overrideIcon = device.info?.icon;
    if (typeof overrideIcon === 'string' && overrideIcon.length > 0) {
        return {
            kind: 'icon',
            faClass: overrideIcon,
            accent: device.info?.accent
        };
    }
    return null;
}

// Placeholder when no product model is known — by device nature.
function fallbackLogo(source: string | undefined): DeviceLogo {
    if (source === 'virtual') {
        return {kind: 'icon', faClass: SYNTHETIC_VIRTUAL_ICON};
    }
    if (source === 'bluetooth') {
        return {kind: 'image', src: SYNTHETIC_BLU_LOGO};
    }
    return {kind: 'image', src: GENERIC_LOGO};
}

// The product photo, via getLogo — the single source for model→image
// (jwt-aware for modular Shelly X, bad-url safe).
function productPhoto(device: shelly_device_t): DeviceLogo {
    const src = getLogo(device);
    return src === GENERIC_LOGO ? {kind: 'image', src} : {kind: 'cdn', src};
}

// A BLU device's info.model is `modelId ?? capability`, so the model is only
// real when it differs from the capability. Its true model isn't in meta.
function bluetoothHasRealModel(device: shelly_device_t): boolean {
    const model = device.info?.model;
    const capability = device.meta?.bluetoothDevice?.capability;
    return (
        typeof model === 'string' && model.length > 0 && model !== capability
    );
}

export function resolveDeviceLogo(device: shelly_device_t): DeviceLogo {
    const decoration = decorationLogo(device);
    if (decoration) return decoration;
    const source = (device as {source?: string}).source;
    // Each family reads its model from a different place, so resolve per family;
    // the product photo itself always goes through getLogo (one source).
    if (source === 'virtual') return fallbackLogo(source);
    if (source === 'bluetooth') {
        return bluetoothHasRealModel(device)
            ? productPhoto(device)
            : fallbackLogo(source);
    }
    // Regular Shelly (info.model) + modular Shelly X (jwt code, via getLogo).
    return device.info?.model ? productPhoto(device) : fallbackLogo(source);
}
