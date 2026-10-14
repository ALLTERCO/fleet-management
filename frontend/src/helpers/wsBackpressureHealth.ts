export type WsBackpressureStatus = 'healthy' | 'warning' | 'critical';

export interface WsBackpressureHealth {
    pausedClients: number;
    droppedClients: number;
}

export function wsBackpressureStatus(
    health: WsBackpressureHealth
): WsBackpressureStatus {
    if (health.droppedClients > 0) return 'critical';
    if (health.pausedClients > 0) return 'warning';
    return 'healthy';
}
