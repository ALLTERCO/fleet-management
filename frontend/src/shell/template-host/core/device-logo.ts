// Who decides what a device looks like.
//
// The picture rules are Fleet's: they read models, decorations and product
// photos out of the Fleet application. Core cannot import that — the SDK is
// meant to run against Fleet OR Business Manager, and a core that reaches into
// one of them is no longer neutral. There is a test that enforces it.
//
// So the rule is installed from outside, once, at startup. Core calls it and
// knows nothing about how it works. Until a runtime installs one, a device
// simply has no picture, which is the honest answer for a host that has not
// said what its devices look like.

import type {HostDeviceLogo} from './types';

export type DeviceLogoResolver = (
    rawDevice: unknown
) => HostDeviceLogo | undefined;

let resolver: DeviceLogoResolver | null = null;

/** Installed by the runtime that owns the image rules. */
export function setDeviceLogoResolver(next: DeviceLogoResolver | null): void {
    resolver = next;
}

export function resolveHostDeviceLogo(
    rawDevice: unknown
): HostDeviceLogo | undefined {
    return resolver ? resolver(rawDevice) : undefined;
}
