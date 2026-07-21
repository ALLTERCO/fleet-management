import {getLogger} from 'log4js';
import * as Observability from '../Observability';
import {liveGauge} from '../observability/processMetrics';
import {sanitizeErrorMessageForPersistence} from '../util/sanitizeErrorMessage';

const logger = getLogger('device-gui');
let activeWebSockets = 0;

liveGauge(
    'fm_device_gui_active_websockets',
    'Current Device GUI WebSocket connections',
    () => activeWebSockets
);

export type DeviceGuiStage =
    | 'launch'
    | 'attestation'
    | 'session'
    | 'http'
    | 'websocket';

export type DeviceGuiOutcome =
    | 'requested'
    | 'success'
    | 'replaced'
    | 'revoked'
    | 'closed'
    | 'auth_required'
    | 'disabled'
    | 'https_required'
    | 'invalid_device_id'
    | 'device_not_found'
    | 'access_denied'
    | 'no_private_ip'
    | 'identity_matched'
    | 'identity_mismatch'
    | 'unreachable'
    | 'invalid_session'
    | 'session_expired'
    | 'secret_mismatch'
    | 'token_invalid'
    | 'user_mismatch'
    | 'device_changed'
    | 'request_too_large'
    | 'rate_limited'
    | 'upgrade_rejected'
    | 'timeout'
    | 'connection_refused'
    | 'connection_reset'
    | 'client_aborted'
    | 'upstream_error'
    | 'internal_error';

export type DeviceGuiLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface DeviceGuiDiagnosticEvent {
    stage: DeviceGuiStage;
    outcome: DeviceGuiOutcome;
    level?: DeviceGuiLogLevel;
    sessionId?: string;
    traceId?: string;
    deviceId?: number;
    externalId?: string;
    targetIp?: string;
    method?: string;
    path?: string;
    status?: number;
    durationMs?: number;
    browserToDeviceBytes?: number;
    deviceToBrowserBytes?: number;
    error?: unknown;
}

function safeText(value: string, maxChars: number): string {
    return Array.from(value, (character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? ' ' : character;
    })
        .join('')
        .slice(0, maxChars);
}

export function deviceGuiTraceId(
    sessionId: string | undefined
): string | undefined {
    return sessionId?.slice(0, 8);
}

export function deviceGuiNetworkOutcome(error: unknown): DeviceGuiOutcome {
    const code =
        error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (code === 'ECONNRESET' || code === 'EPIPE') return 'connection_reset';
    if (code === 'ETIMEDOUT' || message.includes('timed out')) return 'timeout';
    return 'upstream_error';
}

export function recordDeviceGuiEvent(event: DeviceGuiDiagnosticEvent): void {
    Observability.incrementLabeledCounter('device_gui_events_total', {
        stage: event.stage,
        outcome: event.outcome
    });
    if (event.durationMs !== undefined) {
        Observability.incrementLabeledCounter(
            'device_gui_duration_ms_total',
            {stage: event.stage, outcome: event.outcome},
            Math.max(0, event.durationMs)
        );
        Observability.incrementLabeledCounter(
            'device_gui_duration_samples_total',
            {stage: event.stage, outcome: event.outcome}
        );
    }
    if (event.level === 'silent') return;

    const error =
        event.error instanceof Error
            ? sanitizeErrorMessageForPersistence(event.error.message, 240)
            : undefined;
    const detail = {
        event: 'device_gui',
        stage: event.stage,
        outcome: event.outcome,
        trace: event.traceId ?? deviceGuiTraceId(event.sessionId),
        deviceId: event.deviceId,
        externalId: event.externalId
            ? safeText(event.externalId, 96)
            : undefined,
        targetIp: event.targetIp,
        method: event.method,
        path: event.path
            ? safeText(event.path.split('?')[0] ?? '/', 160)
            : undefined,
        status: event.status,
        durationMs:
            event.durationMs === undefined
                ? undefined
                : Math.round(event.durationMs),
        browserToDeviceBytes: event.browserToDeviceBytes,
        deviceToBrowserBytes: event.deviceToBrowserBytes,
        error
    };
    const line = JSON.stringify(detail);
    const level = event.level ?? 'info';
    if (level === 'error') logger.error(line);
    else if (level === 'warn') logger.warn(line);
    else if (level === 'debug') logger.debug(line);
    else logger.info(line);
}

export function setDeviceGuiActiveWebSockets(count: number): void {
    activeWebSockets = Math.max(0, count);
}

export function recordDeviceGuiBytes(input: {
    transport: 'http' | 'websocket';
    direction: 'browser_to_device' | 'device_to_browser';
    bytes: number;
}): void {
    if (Observability.getLevel() < 2) return;
    if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0) return;
    Observability.incrementLabeledCounter(
        'device_gui_bytes_total',
        {
            transport: input.transport,
            direction: input.direction
        },
        input.bytes
    );
}

export function recordDeviceGuiHttpResponse(status: number): void {
    const statusClass =
        Number.isInteger(status) && status >= 100 && status <= 599
            ? `${Math.floor(status / 100)}xx`
            : 'unknown';
    Observability.incrementLabeledCounter('device_gui_http_responses_total', {
        status: statusClass
    });
}

export function recordDeviceGuiWebSocketCompression(
    offered: boolean,
    negotiated: boolean
): void {
    Observability.incrementLabeledCounter(
        'device_gui_websocket_compression_total',
        {
            offered: offered ? 'yes' : 'no',
            negotiated: negotiated ? 'yes' : 'no'
        }
    );
}
