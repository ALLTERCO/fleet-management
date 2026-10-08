import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import type {
    BluetoothTelemetryArbiterPort,
    BluetoothTelemetrySourceClaim
} from '../redis/ports';
import {bluetoothTelemetryArbiter} from '../redis/services';

const logger = log4js.getLogger('bluetooth-telemetry-arbiter');
let lastErrorLogAt = 0;

// Source selection is shared state: one process may hold the primary gateway
// while another receives a backup. Redis arbitrates the short lease; Postgres
// remains the source of truth for which transport is configured primary.
export async function acceptBluetoothTelemetryClaims(
    claims: readonly BluetoothTelemetrySourceClaim[],
    port: BluetoothTelemetryArbiterPort = bluetoothTelemetryArbiter
): Promise<readonly boolean[]> {
    try {
        const accepted = await port.acceptMany(
            claims,
            tuning.virtualDevice.bluTelemetryFailoverMs
        );
        for (let index = 0; index < claims.length; index++) {
            const claim = claims[index];
            const allowed = accepted[index] === true;
            Observability.incrementCounter(
                allowed
                    ? claim.primary
                        ? 'blu_telemetry_primary_accepted_total'
                        : 'blu_telemetry_secondary_accepted_total'
                    : 'blu_telemetry_secondary_suppressed_total'
            );
        }
        return accepted;
    } catch (error) {
        Observability.incrementCounter('blu_telemetry_arbiter_errors_total');
        logArbiterFailure(error);
        // Redis loss must not drop primary telemetry. Secondary telemetry fails
        // closed because accepting every backup would multiply history rows.
        return claims.map((claim) => claim.primary);
    }
}

function logArbiterFailure(error: unknown): void {
    const now = Date.now();
    if (now - lastErrorLogAt < tuning.observability.getterWarnMinIntervalMs) {
        return;
    }
    lastErrorLogAt = now;
    logger.error(
        'BLU telemetry source arbitration failed; accepting primaries only: %s',
        error instanceof Error ? error.message : String(error)
    );
}
