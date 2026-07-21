import {deviceGuiConfig} from '../../config/deviceGui';
import {fetchDeviceInfoOrUnavailable} from '../discovery/probeHost';
import {
    type DeviceGuiOutcome,
    deviceGuiNetworkOutcome,
    recordDeviceGuiEvent
} from './deviceGuiDiagnostics';

export interface DeviceGuiAttestationResult {
    targetIp: string | null;
    outcome: DeviceGuiOutcome;
}

export async function attestDeviceGuiIp(
    externalId: string,
    ips: string[],
    port = 80,
    sessionId?: string
): Promise<DeviceGuiAttestationResult> {
    const matches = await Promise.all(
        ips.map(async (ip) => {
            const startedAt = performance.now();
            try {
                const info = await fetchDeviceInfoOrUnavailable(
                    {host: ip, ip, normalized: ip},
                    deviceGuiConfig.connectTimeoutMs,
                    port
                );
                const matched =
                    info.id.toLowerCase() === externalId.toLowerCase();
                recordDeviceGuiEvent({
                    stage: 'attestation',
                    outcome: matched ? 'identity_matched' : 'identity_mismatch',
                    level: matched ? 'info' : 'warn',
                    sessionId,
                    externalId,
                    targetIp: ip,
                    durationMs: performance.now() - startedAt
                });
                return {
                    matched,
                    outcome: matched
                        ? ('identity_matched' as const)
                        : ('identity_mismatch' as const)
                };
            } catch (error) {
                const outcome = deviceGuiNetworkOutcome(error);
                recordDeviceGuiEvent({
                    stage: 'attestation',
                    outcome,
                    level: 'warn',
                    sessionId,
                    externalId,
                    targetIp: ip,
                    durationMs: performance.now() - startedAt,
                    error
                });
                return {matched: false, outcome};
            }
        })
    );
    for (let index = 0; index < ips.length; index++) {
        if (matches[index]?.matched) {
            return {
                targetIp: ips[index] ?? null,
                outcome: 'identity_matched'
            };
        }
    }
    return {
        targetIp: null,
        outcome:
            matches.find((result) => result.outcome === 'identity_mismatch')
                ?.outcome ??
            matches.at(-1)?.outcome ??
            'unreachable'
    };
}
