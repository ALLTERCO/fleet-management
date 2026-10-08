export type CoverageDisposition =
    | 'mcp_catalog_method'
    | 'mcp_transport'
    | 'mcp_discovery'
    | 'mcp_polling_equivalent'
    | 'external_callback'
    | 'protocol_adapter'
    | 'browser_ui'
    | 'static_asset'
    | 'operational_endpoint'
    | 'identity_session'
    | 'catalog_excluded_internal'
    | 'development_only';

export interface CoverageDecision {
    disposition: CoverageDisposition;
    tool?: string;
    method?: string;
    rationale: string;
    action: string;
}

export interface ReviewedMount extends CoverageDecision {
    path: string;
    expectedCount: number;
}

const method = (
    name: string,
    action = `Call ${name} through fm_read or fm_write.`
): CoverageDecision => ({
    disposition: 'mcp_catalog_method',
    tool: 'fm_read/fm_write',
    method: name,
    rationale: 'The generated RPC catalog is the MCP operation contract.',
    action
});

const poll = (name: string): CoverageDecision => ({
    disposition: 'mcp_polling_equivalent',
    tool: 'fm_read',
    method: name,
    rationale:
        'MCP has no unsolicited Fleet event stream; this read exposes the durable or current state.',
    action: `Poll ${name}; use the Fleet WebSocket event transport when edge-trigger delivery is required.`
});

const excluded = (
    disposition: CoverageDisposition,
    rationale: string,
    action: string
): CoverageDecision => ({disposition, rationale, action});

const HTTP = new Map<string, CoverageDecision>();
const route = (
    sourceFile: string,
    httpMethod: string,
    path: string,
    decision: CoverageDecision
) => HTTP.set(`${sourceFile}|${httpMethod}|${path}`, decision);
const routes = (
    sourceFile: string,
    decision: CoverageDecision,
    operations: readonly [string, string][]
) =>
    operations.forEach(([verb, path]) => {
        route(sourceFile, verb, path, decision);
    });

const INDEX = 'backend/src/modules/web/index.ts';
const ROUTES = 'backend/src/modules/web/routes/';

routes(
    INDEX,
    excluded(
        'static_asset',
        'These paths render the Fleet or admin browser application.',
        'Use the browser UI; MCP operations are exposed through the RPC catalog.'
    ),
    [
        ['GET', '/*splat'],
        ['GET', '/admin/*splat']
    ]
);
routes(
    INDEX,
    excluded(
        'operational_endpoint',
        'This is a deployment control-plane contract rather than a tenant operation.',
        'Use the authenticated control-plane client; do not add a generic MCP HTTP caller.'
    ),
    [
        ['GET', '/api/control-plane/deploy-manifest'],
        ['GET', '/api/control-plane/device-usage']
    ]
);
route(
    INDEX,
    'POST',
    '/auth/login_flow',
    excluded(
        'protocol_adapter',
        'This Home Assistant-compatible response advances a device login protocol.',
        'Use the device onboarding protocol; it is not a user-authored Fleet operation.'
    )
);
routes(
    INDEX,
    excluded(
        'operational_endpoint',
        'These endpoints are process health, readiness, version, or Prometheus scraper contracts.',
        'Use the deployment health or metrics client; no tenant MCP equivalent is intended.'
    ),
    [
        ['GET', '/health'],
        ['GET', '/health/live'],
        ['GET', '/health/ready'],
        ['GET', '/health/redis'],
        ['GET', '/metrics'],
        ['GET', '/version'],
        ['GET', '/health/components/coverage']
    ]
);
route(INDEX, 'GET', '/health/db-writes', method('system.DbWrites.Get'));
route(INDEX, 'POST', '/health/db-writes', method('system.DbWrites.Set'));
route(
    INDEX,
    'GET',
    '/health/debug-report',
    method('system.Health.GetDebugReport')
);
route(INDEX, 'GET', '/health/full', method('system.Health.GetFull'));
route(INDEX, 'GET', '/health/streams', method('system.Health.GetStreams'));
route(INDEX, 'POST', '/health/log-level', method('system.Log.SetLevel'));
route(INDEX, 'GET', '/health/log-levels', method('system.Log.ListLevels'));
route(
    INDEX,
    'POST',
    '/health/observability',
    method('system.Observability.Set')
);
route(
    INDEX,
    'POST',
    '/health/observability/reset',
    method('system.Observability.Reset')
);
route(
    INDEX,
    'GET',
    '/media/firmware-file/:token',
    excluded(
        'protocol_adapter',
        'A device consumes this short-lived firmware download URL without Fleet credentials.',
        'Use firmware.CreateLibraryDownloadUrl to mint the protocol URL.'
    )
);
routes(
    INDEX,
    excluded(
        'mcp_transport',
        'This is the raw Fleet JSON-RPC transport behind catalogued MCP calls.',
        'Use fm_read or fm_write with the catalogued method.'
    ),
    [
        ['POST', '/rpc'],
        ['POST', '/rpc/:method']
    ]
);
route(
    INDEX,
    'GET',
    '/rpc/:method',
    excluded(
        'protocol_adapter',
        'The removed GET RPC transport is a 405 compatibility stub.',
        'Use fm_read, fm_write, or POST /rpc.'
    )
);

route(
    'backend/src/modules/web/deviceGuiOrigin.ts',
    'ALL',
    '/api/device-gui/:sessionId/{*devicePath}',
    excluded(
        'browser_ui',
        'This session-bound reverse proxy renders a physical device web UI.',
        'Use typed device RPC methods for automation; use the browser for the device GUI.'
    )
);

routes(
    `${ROUTES}apiDocs.ts`,
    excluded(
        'mcp_discovery',
        'These endpoints publish generated API documentation and embedded-app metadata.',
        'Use list_methods and get_api_method for bounded MCP discovery.'
    ),
    [
        ['GET', '/'],
        ['GET', '/embedded-apps'],
        ['GET', '/openapi.json']
    ]
);
route(
    `${ROUTES}assetUpload.ts`,
    'GET',
    '/assets/:id',
    method('asset.ReadChunk')
);
route(
    `${ROUTES}assetUpload.ts`,
    'POST',
    '/uploads/asset',
    method('asset.Upload')
);
routes(`${ROUTES}auditDownload.ts`, method('fileTransfer.ReadChunk'), [
    ['POST', '/audit-log/download-ticket/:filename'],
    ['GET', '/audit-log/download/:filename'],
    ['GET', '/exports/download/:filename'],
    ['GET', '/reports/download/:filename']
]);
routes(
    `${ROUTES}authSession.ts`,
    excluded(
        'identity_session',
        'These endpoints create or clear the browser session cookie.',
        'Authenticate the MCP transport with its supported bearer credential.'
    ),
    [
        ['DELETE', '/'],
        ['POST', '/']
    ]
);
route(
    `${ROUTES}backupImport.ts`,
    'POST',
    '/importBackup',
    method('fileTransfer.Begin')
);
routes(
    `${ROUTES}device-proxy.ts`,
    excluded(
        'protocol_adapter',
        'These routes proxy camera, device-info, or GUI traffic to a device LAN address.',
        'Use typed camera/device RPCs where catalogued; keep streaming and GUI traffic on this bounded proxy.'
    ),
    [
        ['GET', '/:shellyID/camera/:componentId/snapshot'],
        ['POST', '/:shellyID/camera/streamer/stop'],
        ['GET', '/:shellyID/gui-debug'],
        ['GET', '/:shellyID/info'],
        ['POST', '/devices/:deviceId/gui-session'],
        ['GET', '/devices/:deviceId/info']
    ]
);
route(
    `${ROUTES}emailAssets.ts`,
    'POST',
    '/email-assets',
    method('fileTransfer.Begin')
);
route(
    `${ROUTES}emailAssets.ts`,
    'GET',
    '/email-assets/:id',
    method('fileTransfer.ReadChunk')
);
route(
    `${ROUTES}firmwareUpload.ts`,
    'POST',
    '/uploadFirmwareFile',
    method('fileTransfer.Begin')
);
route(
    `${ROUTES}floorPlanUpload.ts`,
    'POST',
    '/floor-plan',
    method('fileTransfer.Begin')
);
routes(
    `${ROUTES}automationHooks.ts`,
    excluded(
        'external_callback',
        'Outside services call Node-RED webhooks here; the Node-RED node checks each hook secret.',
        'Point the outside service at this URL; agents inspect the flow through automation.GetActivity.'
    ),
    [
        ['GET', '/:hookId'],
        ['POST', '/:hookId'],
        ['PUT', '/:hookId']
    ]
);
route(
    `${ROUTES}grafanaAlertWebhook.ts`,
    'POST',
    '/alert-webhook/:orgId',
    excluded(
        'external_callback',
        'Grafana pushes signed alert state into Fleet on this inbound callback.',
        'Configure Grafana to call this endpoint; agents inspect resulting alert.Instance records.'
    )
);
routes(
    `${ROUTES}mcp.ts`,
    excluded(
        'mcp_transport',
        'These are the Streamable HTTP MCP session operations themselves.',
        'Use an MCP SDK; do not recurse through a generic HTTP tool.'
    ),
    [
        ['DELETE', '/'],
        ['GET', '/'],
        ['POST', '/']
    ]
);
route(
    `${ROUTES}media.ts`,
    'GET',
    '/getAllBackgrounds',
    method('media.Background.List')
);
routes(`${ROUTES}media.ts`, method('media.Background.Delete'), [
    ['GET', '/deleteBackground'],
    ['POST', '/deleteBackground']
]);
route(
    `${ROUTES}media.ts`,
    'GET',
    '/getAllReportImages',
    method('media.ReportImage.List')
);
route(
    `${ROUTES}media.ts`,
    'POST',
    '/uploadBackground',
    method('fileTransfer.Begin')
);
route(
    `${ROUTES}media.ts`,
    'POST',
    '/uploadProfilePic',
    method('fileTransfer.Begin')
);
route(
    `${ROUTES}media.ts`,
    'POST',
    '/uploadReportImage',
    method('fileTransfer.Begin')
);
route(
    INDEX,
    'POST',
    '/node-red/session',
    excluded(
        'browser_ui',
        'This exchanges Fleet authentication for a Node-RED editor session cookie and renews it.',
        'Use automation.Graph methods for graph authoring; use this route only for the editor UI.'
    )
);
route(
    INDEX,
    'DELETE',
    '/node-red/session',
    excluded(
        'identity_session',
        'This ends the Node-RED editor browser session on logout.',
        'Authenticate the MCP transport with its supported bearer credential.'
    )
);
route(
    `${ROUTES}oauthEmail.ts`,
    'GET',
    '/callback/email',
    excluded(
        'external_callback',
        'The email provider completes OAuth through this state-bound redirect.',
        'Start OAuth through notification.OAuth.Start and let the provider call this URL.'
    )
);
route(
    `${ROUTES}providerReceipts.ts`,
    'POST',
    '/provider-receipts/:provider',
    excluded(
        'external_callback',
        'Notification providers deliver signed delivery receipts here.',
        'Inspect delivery state through notification.History methods.'
    )
);
route(
    `${ROUTES}tariffLivePush.ts`,
    'POST',
    '/tariff/live/:token',
    excluded(
        'external_callback',
        'A configured tariff source pushes signed live prices to this tokenized endpoint.',
        'Inspect tariff state through catalogued tariff reads.'
    )
);
routes(
    `${ROUTES}uploadAssets.ts`,
    excluded(
        'static_asset',
        'These authenticated routes serve previously stored browser media.',
        'Use fileTransfer.ReadChunk for agent-safe bounded binary reads.'
    ),
    [
        ['GET', '/uploads/backgrounds/*assetPath'],
        ['GET', '/uploads/profilePics/*assetPath'],
        ['GET', '/uploads/reportImages/*assetPath']
    ]
);
routes(
    `${ROUTES}zitadelActions.ts`,
    excluded(
        'external_callback',
        'Zitadel calls these signed lifecycle webhooks and their dedicated health probe.',
        'Configure Zitadel Actions; use user methods for operator-initiated identity changes.'
    ),
    [
        ['POST', '/grant-removed'],
        ['GET', '/healthz'],
        ['POST', '/user-removed']
    ]
);

export const HTTP_OPERATION_COVERAGE = HTTP;

const EVENT = new Map<string, CoverageDecision>();
const events = (names: readonly string[], decision: CoverageDecision) =>
    names.forEach((name) => {
        EVENT.set(name, decision);
    });

events(
    ['Alert.Created', 'Alert.Resolved', 'Alert.Updated'],
    poll('alert.Instance.List')
);
events(
    ['Alert.RuleCreated', 'Alert.RuleDeleted', 'Alert.RuleUpdated'],
    poll('alert.Rule.List')
);
events(['BTHome.ControlLearning'], poll('bthome.Control.GetLearningState'));
events(['BTHome.ControlsUpdated'], poll('bthome.Control.List'));
events(
    ['BTHome.DiscoveryDone', 'BTHome.DiscoveryResult'],
    poll('bthome.ListDiscovered')
);
events(
    [
        'Certificate.Created',
        'Certificate.Deleted',
        'Certificate.Expiring',
        'Certificate.Updated'
    ],
    poll('certificate.List')
);
events(
    ['Certificate.JobUpdated', 'Certificate.PushRow'],
    poll('certificate.ListPushes')
);
events(
    [
        'Channel.AutoDisabled',
        'Channel.Created',
        'Channel.Deleted',
        'Channel.HealthReset',
        'Channel.Updated'
    ],
    poll('channel.List')
);
events(
    ['Console.Log'],
    excluded(
        'protocol_adapter',
        'Console.Log is an ephemeral device event and has no durable Fleet record.',
        'Use the authenticated Fleet WebSocket event transport when live console delivery is required.'
    )
);
events(['Credential.Changed'], poll('credential.List'));
events(['Credential.PushRow'], poll('credential.ListPushes'));
events(
    [
        'Dashboard.Created',
        'Dashboard.Deleted',
        'Dashboard.ItemsChanged',
        'Dashboard.OrderChanged',
        'Dashboard.SettingsChanged',
        'Dashboard.Updated'
    ],
    poll('dashboard.List')
);
events(
    [
        'Destination.Created',
        'Destination.Deleted',
        'Destination.MembersAdded',
        'Destination.MembersRemoved',
        'Destination.Updated'
    ],
    poll('notification.Destination.List')
);
events(['Device.RelationshipsChanged'], poll('device.Relationships.Query'));
events(['DeviceEvent.Change'], poll('deviceevents.Query'));
events(
    ['Entity.Added', 'Entity.Removed', 'Entity.Updated'],
    poll('entity.List')
);
events(
    ['Entity.Event'],
    excluded(
        'protocol_adapter',
        'Entity.Event is an edge-triggered device event without a guaranteed durable replay record.',
        'Use the Fleet WebSocket event transport; poll entity.Get only for current state.'
    )
);
events(
    [
        'Group.Created',
        'Group.Deleted',
        'Group.MembersAdded',
        'Group.MembersRemoved',
        'Group.Updated'
    ],
    poll('group.List')
);
events(['Job.UnitUpdated', 'Job.Updated'], poll('job.Get'));
events(
    [
        'Location.AssignmentRemoved',
        'Location.AssignmentSet',
        'Location.AssignmentsSet',
        'Location.Created',
        'Location.Deleted',
        'Location.Updated'
    ],
    poll('location.List')
);
events(
    ['Notification.Created', 'Notification.ReadStateChanged'],
    poll('notification.Inbox.List')
);
events(['Notification.DeliveryUpdated'], poll('notification.History.List'));
events(['Organization.ProfileUpdated'], poll('organization.GetProfile'));
events(
    ['Persona.Created', 'Persona.Deleted', 'Persona.Updated'],
    poll('persona.List')
);
events(
    ['Report.Anomaly', 'Report.Progress', 'Report.Ready'],
    poll('report.GetReport')
);
events(
    [
        'Shelly.Connect',
        'Shelly.Delete',
        'Shelly.Disconnect',
        'Shelly.Info',
        'Shelly.OtaProgress',
        'Shelly.Presence',
        'Shelly.PresenceTrack',
        'Shelly.Settings',
        'Shelly.Status'
    ],
    poll('device.Get')
);
events(
    ['Shelly.Message'],
    excluded(
        'protocol_adapter',
        'Shelly.Message is the raw device protocol envelope and is not a stable agent contract.',
        'Use typed device/entity methods; use Fleet WebSocket diagnostics only when the raw envelope is required.'
    )
);
events(
    [
        'Tag.Assigned',
        'Tag.Created',
        'Tag.Deleted',
        'Tag.Unassigned',
        'Tag.Updated'
    ],
    poll('tag.List')
);
events(
    ['User.Created', 'User.Deleted', 'User.Updated'],
    poll('user.ListZitadelUsers')
);
events(
    [
        'UserGroup.Created',
        'UserGroup.Deleted',
        'UserGroup.MembersAdded',
        'UserGroup.MembersRemoved',
        'UserGroup.Updated'
    ],
    poll('user_group.List')
);
events(['Variables.Changed'], poll('variables.List'));
events(
    ['WaitingRoomEvent.Accepted', 'WaitingRoomEvent.Denied'],
    poll('waitingroom.List')
);

export const EVENT_OPERATION_COVERAGE = EVENT;

export const REVIEWED_CATALOG_ONLY_METHODS = new Set([
    'fleet.Describe',
    'fleetMap.Describe',
    'fleetSummary.Describe'
]);

export const REVIEWED_MOUNTS: readonly ReviewedMount[] = [
    {
        path: '/',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Fleet SPA static root.',
            'Use the browser UI.'
        )
    },
    {
        path: '/admin',
        expectedCount: 2,
        ...excluded(
            'browser_ui',
            'Admin SPA fallback and static root.',
            'Use the admin browser UI.'
        )
    },
    {
        path: '/admin/assets',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Admin browser assets.',
            'Use the admin browser UI.'
        )
    },
    {
        path: '/api',
        expectedCount: 3,
        ...excluded(
            'protocol_adapter',
            'Mounts reviewed child HTTP routers.',
            'See the exact child route coverage rows.'
        )
    },
    {
        path: '/api/auth/session',
        expectedCount: 1,
        ...excluded(
            'identity_session',
            'Browser session router.',
            'Use MCP bearer authentication.'
        )
    },
    {
        path: '/api/device-proxy',
        expectedCount: 1,
        ...excluded(
            'protocol_adapter',
            'Device LAN proxy router.',
            'Use typed device RPCs when available.'
        )
    },
    {
        path: '/api/docs',
        expectedCount: 1,
        ...excluded(
            'mcp_discovery',
            'Browser API documentation router.',
            'Use list_methods and get_api_method.'
        )
    },
    {
        path: '/api/grafana',
        expectedCount: 1,
        ...excluded(
            'external_callback',
            'Grafana alert callback router.',
            'Configure Grafana webhook delivery.'
        )
    },
    {
        path: '/api/notifications',
        expectedCount: 2,
        ...excluded(
            'protocol_adapter',
            'Notification callback and media routers.',
            'See the exact child route coverage rows.'
        )
    },
    {
        path: '/api/oauth',
        expectedCount: 1,
        ...excluded(
            'external_callback',
            'Provider OAuth callback router.',
            'Start with notification.OAuth.Start.'
        )
    },
    {path: '/api/uploads', expectedCount: 1, ...method('fileTransfer.Begin')},
    {
        path: '/api/zitadel/actions',
        expectedCount: 1,
        ...excluded(
            'external_callback',
            'Zitadel Action callback router.',
            'Configure signed Zitadel callbacks.'
        )
    },
    {
        path: '/assets',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Frontend build assets.',
            'Use the browser UI.'
        )
    },
    {
        path: '/grafana',
        expectedCount: 1,
        ...excluded(
            'browser_ui',
            'Authenticated Grafana reverse proxy.',
            'Use grafana.GetDashboard for bounded reads; use the browser for the full UI.'
        )
    },
    {
        path: '/images',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Frontend image assets.',
            'Use the browser UI.'
        )
    },
    {
        path: '/images/devices',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Device model images.',
            'Use device.GetImage for catalogued image data.'
        )
    },
    {
        path: '/llms.txt',
        expectedCount: 1,
        ...excluded(
            'mcp_discovery',
            'Static agent discovery document.',
            'Use list_methods and get_api_method for live discovery.'
        )
    },
    {
        path: '/mcp',
        expectedCount: 1,
        ...excluded(
            'mcp_transport',
            'Streamable HTTP MCP transport.',
            'Use an MCP SDK.'
        )
    },
    {
        path: '/media',
        expectedCount: 3,
        ...excluded(
            'protocol_adapter',
            'Legacy media upload routers.',
            'Use fileTransfer methods and media catalog methods.'
        )
    },
    {
        path: '/node-red',
        expectedCount: 1,
        ...excluded(
            'browser_ui',
            'Authenticated Node-RED editor and protocol proxy.',
            'Use automation.Graph methods for graph authoring.'
        )
    },
    {
        path: '/plugins/:plugin/public',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Plugin browser assets only.',
            'Use catalogued plugin RPC methods for operations.'
        )
    },
    {
        path: '/uploads/floor-plans',
        expectedCount: 1,
        ...excluded(
            'static_asset',
            'Authenticated floor-plan browser assets.',
            'Use fileTransfer.ReadChunk for bounded agent reads.'
        )
    }
];
