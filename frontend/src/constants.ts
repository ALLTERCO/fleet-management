import {debug} from './tools/debug';

export const MODE =
    import.meta.env.MODE === 'development' ? 'development' : 'production';

export const FLEET_MANAGER_BASE = getEnv(
    'FLEET_BASE_URL',
    window.location.host
);
const FLEET_SECURE = getEnv(
    'FLEET_SECURE',
    window.location.protocol === 'https:' ? '1' : '0'
);
export const SECURE = FLEET_SECURE === '1';

export const FLEET_MANAGER_WEBSOCKET =
    (SECURE ? 'wss://' : 'ws://') + FLEET_MANAGER_BASE;
export const FLEET_MANAGER_HTTP =
    (SECURE ? 'https://' : 'http://') + FLEET_MANAGER_BASE;

// Transport paths — runtime-injected so deploys can mount the API at a
// custom path (e.g. behind a reverse proxy that adds a prefix) without a
// frontend rebuild. Defaults are the canonical paths.
const runtimeRpcBase =
    typeof window.__FM_RUNTIME_CONFIG__?.rpcBaseUrl === 'string'
        ? window.__FM_RUNTIME_CONFIG__!.rpcBaseUrl!
        : '/rpc';
const runtimeWsBase =
    typeof window.__FM_RUNTIME_CONFIG__?.wsBaseUrl === 'string'
        ? window.__FM_RUNTIME_CONFIG__!.wsBaseUrl!
        : '/';
export const RPC_URL = FLEET_MANAGER_HTTP + runtimeRpcBase;
export const WS_URL = FLEET_MANAGER_WEBSOCKET + runtimeWsBase;

// Runtime-overridable UI tunables. Runtime > Vite env > default.
export const LOG_BUFFER_MAX = intCfg('logBufferMax', {
    envName: 'LOG_BUFFER_MAX',
    defaultValue: 2000
});
export const LOG_CATEGORY_MAX = intCfg('logCategoryMax', {
    envName: 'LOG_CATEGORY_MAX',
    defaultValue: 100
});
export const AUDIT_PAGE_SIZE = intCfg('auditPageSize', {
    envName: 'AUDIT_PAGE_SIZE',
    defaultValue: 100
});
export const ZITADEL_PASSWORD_MIN_LENGTH = intCfg('zitadelPasswordMinLength', {
    envName: 'ZITADEL_PASSWORD_MIN_LENGTH',
    defaultValue: 8
});
export const AUTHZ_UNUSED_THRESHOLD_DAYS = intCfg('authzUnusedThresholdDays', {
    envName: 'AUTHZ_UNUSED_THRESHOLD_DAYS',
    defaultValue: 90
});

// Polling intervals — single source of truth, runtime > env > default.
export const WAITING_ROOM_REFRESH_MS = intCfg('waitingRoomRefreshMs', {
    envName: 'WAITING_ROOM_REFRESH_MS',
    defaultValue: 30000
});
export const SW_UPDATE_POLL_INTERVAL_MS = intCfg('swUpdatePollIntervalMs', {
    envName: 'SW_UPDATE_POLL_INTERVAL_MS',
    defaultValue: 30 * 60_000
});

export const WAITING_ROOM_ACCEPT_DEBOUNCE_MS = intCfg(
    'waitingRoomAcceptDebounceMs',
    {
        envName: 'WAITING_ROOM_ACCEPT_DEBOUNCE_MS',
        defaultValue: 150
    }
);
export const WAITING_ROOM_ACCEPT_CHUNK_SIZE = intCfg(
    'waitingRoomAcceptChunkSize',
    {
        envName: 'WAITING_ROOM_ACCEPT_CHUNK_SIZE',
        defaultValue: 200
    }
);
// Above this count, use the background job instead of the inline path.
export const WAITING_ROOM_BULK_THRESHOLD = intCfg('waitingRoomBulkThreshold', {
    envName: 'WAITING_ROOM_BULK_THRESHOLD',
    defaultValue: 500
});
export const WAITING_ROOM_BULK_POLL_MS = intCfg('waitingRoomBulkPollMs', {
    envName: 'WAITING_ROOM_BULK_POLL_MS',
    defaultValue: 1000
});
// Max devices configured in parallel by the config-deploy modal. Caps the
// Device.Call burst (one RPC per device in flight) on a large group.
export const CONFIG_DEPLOY_CONCURRENCY = intCfg('configDeployConcurrency', {
    envName: 'CONFIG_DEPLOY_CONCURRENCY',
    defaultValue: 6
});
// Consecutive failed status polls tolerated before the job is treated as lost.
export const WAITING_ROOM_BULK_POLL_MAX_FAILURES = intCfg(
    'waitingRoomBulkPollMaxFailures',
    {
        envName: 'WAITING_ROOM_BULK_POLL_MAX_FAILURES',
        defaultValue: 3
    }
);

// Touch-gesture tunables — single source of truth, runtime > env > default.
export const LONG_PRESS_MS = intCfg('longPressMs', {
    envName: 'LONG_PRESS_MS',
    defaultValue: 500
});
export const SWIPE_THRESHOLD_PX = intCfg('swipeThresholdPx', {
    envName: 'SWIPE_THRESHOLD_PX',
    defaultValue: 50
});
export const PULL_REFRESH_PX = intCfg('pullRefreshPx', {
    envName: 'PULL_REFRESH_PX',
    defaultValue: 80
});

// Route paths — runtime > Vite env > default. Single source of truth across
// router guards, redirects, nav menu, and page links.
export const LOGIN_PATH = strCfg('loginPath', {
    envName: 'LOGIN_PATH',
    defaultValue: '/login'
});
export const PROFILE_PATH = strCfg('profilePath', {
    envName: 'PROFILE_PATH',
    defaultValue: '/settings/user'
});
export const DASHBOARDS_PATH = strCfg('dashboardsPath', {
    envName: 'DASHBOARDS_PATH',
    defaultValue: '/dash'
});
export const DEVICES_PATH = strCfg('devicesPath', {
    envName: 'DEVICES_PATH',
    defaultValue: '/devices'
});
export const WAITING_ROOM_PATH = strCfg('waitingRoomPath', {
    envName: 'WAITING_ROOM_PATH',
    defaultValue: '/waiting-room'
});
export const ORGANIZE_PATH = strCfg('organizePath', {
    envName: 'ORGANIZE_PATH',
    defaultValue: '/organize/locations'
});
export const ALERTS_PATH = strCfg('alertsPath', {
    envName: 'ALERTS_PATH',
    defaultValue: '/settings/alerts'
});
export const GRAPHS_PATH = strCfg('graphsPath', {
    envName: 'GRAPHS_PATH',
    defaultValue: '/automations/grafana'
});
export const AUTOMATIONS_PATH = strCfg('automationsPath', {
    envName: 'AUTOMATIONS_PATH',
    defaultValue: '/automations/actions'
});
export const OPERATIONS_PATH = strCfg('operationsPath', {
    envName: 'OPERATIONS_PATH',
    defaultValue: '/operations/jobs'
});
export const MONITORING_PATH = strCfg('monitoringPath', {
    envName: 'MONITORING_PATH',
    defaultValue: '/settings/monitoring'
});
export const SETTINGS_PATH = strCfg('settingsPath', {
    envName: 'SETTINGS_PATH',
    defaultValue: '/settings/app'
});
export const RPC_AUDIT_LOG_PATH = strCfg('rpcAuditLogPath', {
    envName: 'RPC_AUDIT_LOG_PATH',
    defaultValue: '/settings/monitoring/audit-log'
});

export const BG_OPS_SNAPSHOT_KEY = 'fm:bgops-jobs';
export const AUDIT_PAYLOAD_PREVIEW_MAX = intCfg('auditPayloadPreviewMax', {
    envName: 'AUDIT_PAYLOAD_PREVIEW_MAX',
    defaultValue: 80
});

function intCfg(
    rtKey: string,
    lookup: {envName: string; defaultValue: number}
): number {
    const rt = window.__FM_RUNTIME_CONFIG__?.[rtKey];
    if (rt !== undefined) {
        if (typeof rt === 'number' && rt > 0) return rt;
        if (import.meta.env.DEV) {
            console.warn(
                `[constants] runtime ${rtKey}=${rt} not a positive number; falling back`
            );
        }
    }
    const raw = import.meta.env[`VITE_${lookup.envName}`];
    if (raw !== undefined && raw !== '') {
        const v = Number(raw);
        if (Number.isFinite(v) && v > 0) return v;
        if (import.meta.env.DEV) {
            console.warn(
                `[constants] VITE_${lookup.envName}=${raw} not a positive number; falling back`
            );
        }
    }
    return lookup.defaultValue;
}

function strCfg(
    rtKey: string,
    lookup: {envName: string; defaultValue: string}
): string {
    const rt = window.__FM_RUNTIME_CONFIG__?.[rtKey];
    if (typeof rt === 'string' && rt.length > 0) return rt;
    const v = import.meta.env[`VITE_${lookup.envName}`];
    return typeof v === 'string' && v.length > 0 ? v : lookup.defaultValue;
}

// Float in [0, 1]. Used for normalized weights / elasticity / gravity.
function floatCfg(
    rtKey: string,
    lookup: {envName: string; defaultValue: number}
): number {
    const rt = window.__FM_RUNTIME_CONFIG__?.[rtKey];
    if (rt !== undefined) {
        if (typeof rt === 'number' && rt >= 0 && rt <= 1) return rt;
        if (import.meta.env.DEV) {
            console.warn(
                `[constants] runtime ${rtKey}=${rt} out of [0,1]; falling back`
            );
        }
    }
    const raw = import.meta.env[`VITE_${lookup.envName}`];
    if (raw !== undefined && raw !== '') {
        const v = Number(raw);
        if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
        if (import.meta.env.DEV) {
            console.warn(
                `[constants] VITE_${lookup.envName}=${raw} out of [0,1]; falling back`
            );
        }
    }
    return lookup.defaultValue;
}

function boolCfg(
    rtKey: string,
    lookup: {envName: string; defaultValue: boolean}
): boolean {
    const rt = window.__FM_RUNTIME_CONFIG__?.[rtKey];
    if (rt !== undefined) {
        if (typeof rt === 'boolean') return rt;
        if (import.meta.env.DEV) {
            console.warn(
                `[constants] runtime ${rtKey}=${rt} not a boolean; falling back`
            );
        }
    }
    const raw = import.meta.env[`VITE_${lookup.envName}`];
    if (raw !== undefined && raw !== '') {
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (import.meta.env.DEV) {
            console.warn(
                `[constants] VITE_${lookup.envName}=${raw} not 'true'/'false'; falling back`
            );
        }
    }
    return lookup.defaultValue;
}

export const NODE_RED_ENABLED = boolCfg('nodeRedEnabled', {
    envName: 'NODE_RED_ENABLED',
    defaultValue: false
});
export const NODE_RED_URL = strCfg('nodeRedUrl', {
    envName: 'NODE_RED_URL',
    defaultValue: `${MODE === 'development' ? FLEET_MANAGER_HTTP : ''}/node-red/red`
});
export const NODE_RED_SESSION_URL = strCfg('nodeRedSessionUrl', {
    envName: 'NODE_RED_SESSION_URL',
    defaultValue: deriveNodeRedSessionUrl(NODE_RED_URL)
});

// Mobile.SyncDelta tunables (runtime config overridable).
export const MOBILE_RESUME_THRESHOLD_MS = intCfg('mobileResumeThresholdMs', {
    envName: 'MOBILE_RESUME_THRESHOLD_MS',
    defaultValue: 30_000
});
export const MOBILE_SYNC_DEBOUNCE_MS = intCfg('mobileSyncDebounceMs', {
    envName: 'MOBILE_SYNC_DEBOUNCE_MS',
    defaultValue: 5_000
});

// EM net-energy tunables (runtime config overridable).
export const EM_NET_PREVIEW_ROWS = intCfg('emNetPreviewRows', {
    envName: 'EM_NET_PREVIEW_ROWS',
    defaultValue: 12
});
export const EM_NET_PAGE_LIMIT = intCfg('emNetPageLimit', {
    envName: 'EM_NET_PAGE_LIMIT',
    defaultValue: 200
});

// Operations dashboard "X seconds ago" ticker — faster than NOW_TICKER for live job refresh.
export const OPS_REFRESH_MS = intCfg('opsRefreshMs', {
    envName: 'OPS_REFRESH_MS',
    defaultValue: 5000
});

// Map / visualization tunables — runtime > Vite env > default.
// OpenFreeMap dark style — free public CDN, exposes the `openmaptiles`
// source layer the 3D building extrusion toggle expects. The previous
// Carto Dark Matter style silently disabled that toggle.
export const MAP_STYLE_URL = strCfg('mapStyleUrl', {
    envName: 'MAP_STYLE_URL',
    defaultValue: 'https://tiles.openfreemap.org/styles/dark'
});
export const MAP_SINGLE_PIN_ZOOM = intCfg('mapSinglePinZoom', {
    envName: 'MAP_SINGLE_PIN_ZOOM',
    defaultValue: 11
});
export const MAP_DETAIL_ZOOM = intCfg('mapDetailZoom', {
    envName: 'MAP_DETAIL_ZOOM',
    defaultValue: 15
});
export const MAP_FIT_PADDING_PX = intCfg('mapFitPaddingPx', {
    envName: 'MAP_FIT_PADDING_PX',
    defaultValue: 48
});
export const MAP_FIT_MAX_ZOOM = intCfg('mapFitMaxZoom', {
    envName: 'MAP_FIT_MAX_ZOOM',
    defaultValue: 12
});
export const MAP_FLY_DURATION_MS = intCfg('mapFlyDurationMs', {
    envName: 'MAP_FLY_DURATION_MS',
    defaultValue: 600
});

// Locations redesign kill-switch. ON by default — the rebuild is now the
// canonical path. Flip via runtime config or env var to disable the
// workspace without a code deploy. Read through helpers/featureFlags.
export const LOCATIONS_REDESIGN_V2_ENABLED = boolCfg('locationsRedesignV2', {
    envName: 'LOCATIONS_REDESIGN_V2',
    defaultValue: true
});

// Building floor-stack 3D — vertical gap between floor planes (world units).
export const FLOOR_STACK_GAP_Y = intCfg('floorStackGapY', {
    envName: 'FLOOR_STACK_GAP_Y',
    defaultValue: 4
});

// Building floor-stack 3D — edge length of each floor plane (world units).
export const FLOOR_STACK_PLANE_SIZE = intCfg('floorStackPlaneSize', {
    envName: 'FLOOR_STACK_PLANE_SIZE',
    defaultValue: 18
});

// Building floor-stack 3D — thickness (Y) of each floor slab.
export const FLOOR_STACK_SLAB_THICKNESS_TENTHS = intCfg(
    'floorStackSlabThicknessTenths',
    {envName: 'FLOOR_STACK_SLAB_THICKNESS_TENTHS', defaultValue: 6}
);

// Building floor-stack 3D — camera framing factor; how far the camera
// pulls back relative to the stack's planeSize so the stack fills the
// viewport without clipping.
export const FLOOR_STACK_CAMERA_DISTANCE_FACTOR_TENTHS = intCfg(
    'floorStackCameraDistanceFactorTenths',
    {envName: 'FLOOR_STACK_CAMERA_DISTANCE_FACTOR_TENTHS', defaultValue: 18}
);

// Building floor-stack 3D — Y-position multiplier for camera height
// relative to stack top, so the orbit centers above the middle of the stack.
export const FLOOR_STACK_CAMERA_HEIGHT_FACTOR_TENTHS = intCfg(
    'floorStackCameraHeightFactorTenths',
    {envName: 'FLOOR_STACK_CAMERA_HEIGHT_FACTOR_TENTHS', defaultValue: 15}
);

// Building floor-stack 3D — opacity (0..100) of each floor slab so the
// stack reads as semi-transparent, not opaque shoeboxes.
export const FLOOR_STACK_SLAB_OPACITY_PCT = intCfg('floorStackSlabOpacityPct', {
    envName: 'FLOOR_STACK_SLAB_OPACITY_PCT',
    defaultValue: 55
});

// Floor plan canvas — runtime > Vite env > default.
export const FLOORPLAN_HEIGHT_PX = intCfg('floorPlanHeightPx', {
    envName: 'FLOORPLAN_HEIGHT_PX',
    defaultValue: 480
});
export const FLOORPLAN_MOBILE_HEIGHT_PX = intCfg('floorPlanMobileHeightPx', {
    envName: 'FLOORPLAN_MOBILE_HEIGHT_PX',
    defaultValue: 360
});

// Floor plan 3D — scene tunables. Runtime > Vite env > default.
export const FLOORPLAN_3D_PLAN_SIZE = intCfg('floorPlan3dPlanSize', {
    envName: 'FLOORPLAN_3D_PLAN_SIZE',
    defaultValue: 100
});
export const FLOORPLAN_3D_WALL_HEIGHT = intCfg('floorPlan3dWallHeight', {
    envName: 'FLOORPLAN_3D_WALL_HEIGHT',
    defaultValue: 4.8
});
export const FLOORPLAN_3D_WALL_OPACITY = floatCfg('floorPlan3dWallOpacity', {
    envName: 'FLOORPLAN_3D_WALL_OPACITY',
    defaultValue: 0.32
});
export const FLOORPLAN_3D_PIN_HEIGHT = intCfg('floorPlan3dPinHeight', {
    envName: 'FLOORPLAN_3D_PIN_HEIGHT',
    defaultValue: 3.2
});
export const FLOORPLAN_3D_PIN_RADIUS = intCfg('floorPlan3dPinRadius', {
    envName: 'FLOORPLAN_3D_PIN_RADIUS',
    defaultValue: 0.55
});
export const FLOORPLAN_3D_CAMERA_FOV = intCfg('floorPlan3dCameraFov', {
    envName: 'FLOORPLAN_3D_CAMERA_FOV',
    defaultValue: 45
});
export const FLOORPLAN_3D_CAMERA_HEIGHT = intCfg('floorPlan3dCameraHeight', {
    envName: 'FLOORPLAN_3D_CAMERA_HEIGHT',
    defaultValue: 70
});
export const FLOORPLAN_3D_CAMERA_DIST = intCfg('floorPlan3dCameraDist', {
    envName: 'FLOORPLAN_3D_CAMERA_DIST',
    defaultValue: 90
});
export const FLOORPLAN_3D_ORBIT_MIN_DIST = intCfg('floorPlan3dOrbitMinDist', {
    envName: 'FLOORPLAN_3D_ORBIT_MIN_DIST',
    defaultValue: 30
});
export const FLOORPLAN_3D_ORBIT_MAX_DIST = intCfg('floorPlan3dOrbitMaxDist', {
    envName: 'FLOORPLAN_3D_ORBIT_MAX_DIST',
    defaultValue: 220
});
export const FLOORPLAN_3D_ORBIT_DAMPING = floatCfg('floorPlan3dOrbitDamping', {
    envName: 'FLOORPLAN_3D_ORBIT_DAMPING',
    defaultValue: 0.08
});
export const FLOORPLAN_3D_CLICK_THRESHOLD_PX = intCfg(
    'floorPlan3dClickThresholdPx',
    {envName: 'FLOORPLAN_3D_CLICK_THRESHOLD_PX', defaultValue: 5}
);
export const FLOORPLAN_3D_AMBIENT_INTENSITY = floatCfg(
    'floorPlan3dAmbientIntensity',
    {envName: 'FLOORPLAN_3D_AMBIENT_INTENSITY', defaultValue: 0.55}
);
export const FLOORPLAN_3D_KEY_INTENSITY = floatCfg('floorPlan3dKeyIntensity', {
    envName: 'FLOORPLAN_3D_KEY_INTENSITY',
    defaultValue: 0.95
});
export const FLOORPLAN_3D_FILL_INTENSITY = floatCfg(
    'floorPlan3dFillIntensity',
    {envName: 'FLOORPLAN_3D_FILL_INTENSITY', defaultValue: 0.35}
);
export const FLOORPLAN_3D_MAX_POLAR_RATIO = intCfg('floorPlan3dMaxPolarRatio', {
    envName: 'FLOORPLAN_3D_MAX_POLAR_RATIO',
    defaultValue: 2.05
});
export const FLOORPLAN_3D_PIXEL_RATIO_CAP = intCfg('floorPlan3dPixelRatioCap', {
    envName: 'FLOORPLAN_3D_PIXEL_RATIO_CAP',
    defaultValue: 2
});
export const FLOORPLAN_3D_LABEL_OPACITY = floatCfg('floorPlan3dLabelOpacity', {
    envName: 'FLOORPLAN_3D_LABEL_OPACITY',
    defaultValue: 0.85
});
export const FLOORPLAN_3D_LABEL_OFFSET_Y = intCfg('floorPlan3dLabelOffsetY', {
    envName: 'FLOORPLAN_3D_LABEL_OFFSET_Y',
    defaultValue: 1.4
});
export const FLOORPLAN_3D_NEAR_PLANE = floatCfg('floorPlan3dNearPlane', {
    envName: 'FLOORPLAN_3D_NEAR_PLANE',
    defaultValue: 0.1
});
export const FLOORPLAN_3D_FAR_PLANE = intCfg('floorPlan3dFarPlane', {
    envName: 'FLOORPLAN_3D_FAR_PLANE',
    defaultValue: 1000
});
export const FLOORPLAN_3D_HOVER_SCALE = floatCfg('floorPlan3dHoverScale', {
    envName: 'FLOORPLAN_3D_HOVER_SCALE',
    defaultValue: 0.03
});
export const FLOORPLAN_3D_HOVER_EMISSIVE_BOOST = floatCfg(
    'floorPlan3dHoverEmissiveBoost',
    {envName: 'FLOORPLAN_3D_HOVER_EMISSIVE_BOOST', defaultValue: 0.5}
);
export const FLOORPLAN_3D_HOVER_LERP = floatCfg('floorPlan3dHoverLerp', {
    envName: 'FLOORPLAN_3D_HOVER_LERP',
    defaultValue: 0.18
});
export const FLOORPLAN_3D_CLICK_FLASH_MS = intCfg('floorPlan3dClickFlashMs', {
    envName: 'FLOORPLAN_3D_CLICK_FLASH_MS',
    defaultValue: 320
});
export const FLOORPLAN_3D_DBLCLICK_MS = intCfg('floorPlan3dDblclickMs', {
    envName: 'FLOORPLAN_3D_DBLCLICK_MS',
    defaultValue: 320
});
export const FLOORPLAN_3D_FLYTO_MS = intCfg('floorPlan3dFlytoMs', {
    envName: 'FLOORPLAN_3D_FLYTO_MS',
    defaultValue: 700
});
export const FLOORPLAN_3D_IDLE_ORBIT_MS = intCfg('floorPlan3dIdleOrbitMs', {
    envName: 'FLOORPLAN_3D_IDLE_ORBIT_MS',
    defaultValue: 10_000
});
export const FLOORPLAN_3D_AUTO_ORBIT_RAD_PER_SEC = floatCfg(
    'floorPlan3dAutoOrbitRadPerSec',
    {envName: 'FLOORPLAN_3D_AUTO_ORBIT_RAD_PER_SEC', defaultValue: 0.05}
);
export const FLOORPLAN_3D_INSTANCE_THRESHOLD = intCfg(
    'floorPlan3dInstanceThreshold',
    {envName: 'FLOORPLAN_3D_INSTANCE_THRESHOLD', defaultValue: 30}
);

// Event replay TripsLayer trail length (seconds).
export const REPLAY_TRAIL_LENGTH_SEC = intCfg('replayTrailLengthSec', {
    envName: 'REPLAY_TRAIL_LENGTH_SEC',
    defaultValue: 300
});

// World map overview zoom when fitBounds is pending (multi-pin first paint).
export const MAP_OVERVIEW_ZOOM = intCfg('mapOverviewZoom', {
    envName: 'MAP_OVERVIEW_ZOOM',
    defaultValue: 2
});

// Cytoscape topology layout (cose-bilkent).
export const TOPOLOGY_ANIMATION_DURATION_MS = intCfg(
    'topologyAnimationDurationMs',
    {envName: 'TOPOLOGY_ANIMATION_DURATION_MS', defaultValue: 800}
);
export const TOPOLOGY_NODE_REPULSION = intCfg('topologyNodeRepulsion', {
    envName: 'TOPOLOGY_NODE_REPULSION',
    defaultValue: 4500
});
export const TOPOLOGY_IDEAL_EDGE_LENGTH = intCfg('topologyIdealEdgeLength', {
    envName: 'TOPOLOGY_IDEAL_EDGE_LENGTH',
    defaultValue: 80
});
export const TOPOLOGY_EDGE_ELASTICITY = floatCfg('topologyEdgeElasticity', {
    envName: 'TOPOLOGY_EDGE_ELASTICITY',
    defaultValue: 0.45
});
export const TOPOLOGY_GRAVITY = floatCfg('topologyGravity', {
    envName: 'TOPOLOGY_GRAVITY',
    defaultValue: 0.25
});
export const TOPOLOGY_TILE = boolCfg('topologyTile', {
    envName: 'TOPOLOGY_TILE',
    defaultValue: true
});

// OIDC config: injected by entrypoint.sh via runtime-config.js when
// FM_DEV_MODE=false. Absent in dev mode. Consumers read this directly via
// __FM_RUNTIME_CONFIG__.oidc — no constant alias, no build-time fallback.

function getEnv(name: string, orElse: string) {
    const envVar = import.meta.env[`VITE_${name}`];
    return typeof envVar === 'string' && envVar.length > 0 ? envVar : orElse;
}

function deriveNodeRedSessionUrl(editorUrl: string): string {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(editorUrl);
    const url = new URL(editorUrl, window.location.origin);
    const basePath = url.pathname.replace(/\/red\/?$/, '');
    url.pathname =
        basePath === url.pathname
            ? `${url.pathname.replace(/\/$/, '')}/session`
            : `${basePath}/session`;
    url.hash = '';
    return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

if (import.meta.env.DEV) {
    // Skip under vitest: import.meta.env there is the full process env (secrets).
    if (import.meta.env.MODE !== 'test') {
        debug('FM environment', import.meta.env);
    }
    debug('FM connection', {
        FLEET_MANAGER_BASE,
        SECURE,
        FLEET_MANAGER_HTTP,
        FLEET_MANAGER_WEBSOCKET,
        RPC_URL,
        WS_URL,
        NODE_RED_URL
    });
}
