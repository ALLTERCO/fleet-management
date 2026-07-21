export type JsonObject = Record<string, unknown>;

export interface SimulatorComponent {
    key: string;
    config: JsonObject;
    status: JsonObject;
}

export interface DeviceProfile {
    key: string;
    displayName: string;
    idPrefix: string;
    macPrefix: string;
    sourcePaths: readonly string[];
    initialNotificationMethod: 'NotifyFullStatus' | 'NotifyStatus';
    info: JsonObject;
    methods: readonly string[];
    profiles?: JsonObject;
    config: Record<string, JsonObject>;
    status: Record<string, JsonObject>;
}

export interface ExpandedDeviceProfile extends DeviceProfile {
    ordinal: number;
    shellyID: string;
    mac: string;
}

export interface ExpandProfileOptions {
    profiles?: readonly string[];
    count?: number;
}

export interface SimulatorRpcRequest {
    id: number | string;
    method: string;
    params?: JsonObject | null;
    src?: string;
}

export interface SimulatorRpcError {
    code: number;
    message: string;
}

export interface SimulatorRpcResponse {
    id: number | string;
    src: string;
    dst?: string;
    result?: unknown;
    error?: SimulatorRpcError;
}

export interface SimulatorNotification {
    method: 'NotifyEvent' | 'NotifyFullStatus' | 'NotifyStatus';
    src: string;
    params: JsonObject;
}

export interface SimulatorRpcResult {
    response: SimulatorRpcResponse;
    notifications: SimulatorNotification[];
}
