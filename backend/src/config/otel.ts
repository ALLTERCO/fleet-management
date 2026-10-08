// OpenTelemetry reads its standard OTEL_* variables itself; Fleet only decides
// whether to start tracing at all, so an install without a collector pays nothing.

import {envStr} from './envReader';

export function otelTracesEnabled(): boolean {
    if (envStr('OTEL_SDK_DISABLED', '').toLowerCase() === 'true') return false;
    return (
        envStr('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', '') !== '' ||
        envStr('OTEL_EXPORTER_OTLP_ENDPOINT', '') !== ''
    );
}

export function otelServiceName(): string {
    return envStr('OTEL_SERVICE_NAME', 'fleet-manager');
}
