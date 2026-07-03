import {tuning} from '../../config/tuning';

// One home for "which org do gate-less devices belong to". Empty means
// hidden — only shared SaaS (or an explicit override) configures that, and
// callers must say so loudly instead of skipping silently.

export function normalizeIngressOrg(value: string): string | null {
    return value.length > 0 ? value : null;
}

export function gatelessDeviceOrg(): string | null {
    return normalizeIngressOrg(tuning.deviceIngress.defaultOrganizationId);
}

// True when the operator already sees this org directly — surfacing the
// default-org entries again would duplicate them.
export function operatorOwnsGatelessOrg(
    operatorOrganizationId: string
): boolean {
    return gatelessDeviceOrg() === operatorOrganizationId;
}
