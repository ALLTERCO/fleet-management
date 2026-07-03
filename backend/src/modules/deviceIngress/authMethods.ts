// The auth methods a device can use to prove itself over its outbound
// WebSocket, derived from the ingress enforcement mode. This is the single
// source of truth the UI reads, so it stops hardcoding which options to show.
//
// Shelly facts (docs): a stock Shelly's outbound WS has no client-certificate
// key — the only cryptographic login is a URL token; otherwise it is
// recognized by the id it reports (approved once = allow-listed). So there is
// no certificate rung for WS devices.

export type IngressEnforcementMode =
    | 'record_only'
    | 'enforce_new'
    | 'enforce_all';

export interface AvailableAuthMethods {
    token: boolean;
    approvedId: boolean;
    certificate: boolean;
}

export function availableAuthMethods(
    enforcementMode: IngressEnforcementMode
): AvailableAuthMethods {
    return {
        // URL token — accepted in every mode.
        token: true,
        // Approve-by-id (grandfather) is on only under enforce_new; mirrors the
        // gate's grandfatherKnownDevices so both read the one enforcement mode.
        approvedId: enforcementMode === 'enforce_new',
        // Stock Shelly WS exposes no client cert — never a device login here.
        certificate: false
    };
}
