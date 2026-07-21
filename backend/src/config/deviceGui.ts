import {envBool, envInt} from './envReader';

export const deviceGuiConfig = Object.freeze({
    enabled: envBool('FM_DEVICE_GUI_ENABLED', false),
    sessionTtlSec: envInt('FM_DEVICE_GUI_SESSION_TTL_SEC', 600, 60),
    attestationTtlSec: 30,
    connectTimeoutMs: envInt('FM_DEVICE_GUI_CONNECT_TIMEOUT_MS', 5000, 500),
    requestTimeoutMs: envInt('FM_DEVICE_GUI_REQUEST_TIMEOUT_MS', 60_000, 1000)
});
