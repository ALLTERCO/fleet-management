// Live sockets for unapproved waiting-room devices (absent from
// connectionRegistry) so a read-only operator probe can reach them.

export interface WaitingRoomProbe {
    sendRpc(method: string): Promise<unknown | null>;
}

export interface WaitingRoomProbeRegistration {
    organizationId: string;
    reportedExternalId: string;
    probe: WaitingRoomProbe;
}

// org -> externalId -> probe. Nested so the two id parts can never collide into
// one key, whatever characters a device reports as its external id.
const probes = new Map<string, Map<string, WaitingRoomProbe>>();

export function registerWaitingRoomProbe(
    registration: WaitingRoomProbeRegistration
): void {
    const byExternalId =
        probes.get(registration.organizationId) ??
        new Map<string, WaitingRoomProbe>();
    byExternalId.set(registration.reportedExternalId, registration.probe);
    probes.set(registration.organizationId, byExternalId);
}

// Identity-checked so a reconnecting device's old socket can't delete the new
// socket's handle (the key is not unique per socket — last register wins).
export function unregisterWaitingRoomProbe(
    registration: WaitingRoomProbeRegistration
): void {
    const byExternalId = probes.get(registration.organizationId);
    if (!byExternalId) return;
    if (
        byExternalId.get(registration.reportedExternalId) !== registration.probe
    )
        return;
    byExternalId.delete(registration.reportedExternalId);
    if (byExternalId.size === 0) probes.delete(registration.organizationId);
}

export function getWaitingRoomProbe(
    organizationId: string,
    reportedExternalId: string
): WaitingRoomProbe | null {
    return probes.get(organizationId)?.get(reportedExternalId) ?? null;
}

export function clearWaitingRoomProbesForTests(): void {
    probes.clear();
}
