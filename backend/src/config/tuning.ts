// Tuning knobs extracted from config/index.ts so lean modules can read
// their defaults without pulling the full barrel (which bootstraps
// configRc + plugin loader + runtime metadata and creates circular
// import hazards). config/index.ts re-exports `tuning` for callers that
// still import from the barrel.
//
// Knobs are grouped into namespaces by domain (ws / redis / audit / …).
// Env-var names are unchanged from the previous flat shape; the JS
// surface moved from `tuning.<flatKey>` to `tuning.<namespace>.<field>`.

import {availableParallelism} from 'node:os';
import type {ObsLevel} from '../modules/observability/types';
import {AC_MIN_VOLTAGE_DEFAULT} from '../types/api/componentPower';
import {readContainerResourcesCached} from './containerResources';
import {isSharedSaasDeploymentMode, peekDeploymentMode} from './deploymentMode';
import {
    envBool,
    envCsv,
    envFloat,
    envInt,
    envIntCsv,
    envIntRange,
    envStr
} from './envReader';
import {httpPortFromEnv} from './runtimeEnv';

// availableParallelism() reports host cores, not the container cpu cap.
export function effectiveCpuCount(): number {
    const {cpuLimitCores} = readContainerResourcesCached();
    return cpuLimitCores && cpuLimitCores > 0
        ? Math.max(1, Math.floor(cpuLimitCores))
        : availableParallelism();
}

export function defaultEnergyRollupWorkers(
    availableCpus = effectiveCpuCount()
): number {
    return availableCpus >= 4 ? 2 : 1;
}

// Outbox pool: concurrency plus room for graphile cron and reclaim connections.
const OUTBOX_POOL_HEADROOM = 2;

// Two shared-pool connections (one for background, one kept for users), plus
// the outbox's headroom and a worker.
const MIN_DB_CONNECTIONS = 5;

// Reproduces the pool sizes that shipped before this became one budget.
const DEFAULT_DB_CONNECTIONS = 37;

// Delivery is a minority of the work and its pool stops growing once it has
// enough workers to keep the queue moving.
const OUTBOX_SHARE = 0.2;
const OUTBOX_POOL_MAX_SHARE = 10;

// Background work may use every shared-pool connection but these, so a user
// request never queues behind it. A pool of one has nothing to spare.
function readDbForegroundReserve(sharedPoolMax: number): number {
    const spare = sharedPoolMax - 1;
    const chosen = envInt('FM_DB_FOREGROUND_RESERVE', Math.min(1, spare), 0);
    if (chosen > spare) {
        throw new RangeError(
            `FM_DB_FOREGROUND_RESERVE=${chosen} leaves background work no ` +
                `connection in a shared pool of ${sharedPoolMax}. Set it to ` +
                `${spare} or lower, or raise FM_DB_CONNECTIONS.`
        );
    }
    return chosen;
}

export interface TuningConfig {
    alert: {
        /** System health checks: how often the product looks at its own counters, ms. 0 disables. */
        systemHealthSweepMs: number;
        /** Rejected meter blocks waiting before the system health alert fires. */
        systemHealthRejectedBlocksMin: number;
        /** AlertEngine per-org rules cache max orgs (default: 1000) */
        rulesCacheMax: number;
        /** AlertEngine rules cache TTL in ms (default: 3600000 = 1h) */
        rulesCacheTtlMs: number;
        /** AlertEngine per-rule recipients cache max entries (default: 5000) */
        recipientsCacheMax: number;
        /** AlertEngine recipients cache TTL in ms (default: 30000 = 30s) */
        recipientsCacheTtlMs: number;
        /** subjectForEvent membership cache size (default 10000). */
        subjectCacheMax: number;
        /** subjectForEvent membership cache TTL ms (default 60000). */
        subjectCacheTtlMs: number;
        /** Alert grouping — wait for siblings after first alert before first notify (default: 60s). */
        groupWaitSec: number;
        immediateSeverities: readonly string[];
        /** Alert grouping — min delay between subsequent batches for same group (default: 300s). */
        groupIntervalSec: number;
        /** Alert grouping — renotify unresolved group every (default: 14400s = 4h). */
        repeatIntervalSec: number;
        /** Alert grouping — CSV of label names forming the group key. */
        groupBy: readonly string[];
        /** Alert grouping — max members per group before early flush (default: 1000). */
        groupMaxMembers: number;
        /** Alert grouping — group size threshold → render summary card (default: 25). */
        stormSummaryThreshold: number;
        /** Concurrency cap for AlertEngine.dispatch rule-evaluation fan-out. */
        dispatchConcurrency: number;
        /** Hard deadline on AlertEngine.handleGroupFlush. */
        groupFlushTimeoutMs: number;
        /** RuleSweep tick interval for time/absence kinds (default 30s). */
        sweepIntervalSec: number;
        /** Master switch for the RuleSweep loop (default true). */
        sweepEnabled: boolean;
        /** Least age of remembered alert state before it is read again (default 300000). */
        stateRecheckMinMs: number;
        /** Random spread added to that age so re-reads do not bunch up (default 600000). */
        stateRecheckSpreadMs: number;
        /** Grace added to a heartbeat window before a miss (default 15s). */
        sweepEvalDelaySec: number;
        /** Devices scheduled together by the periodic alert sweep. */
        sweepBatchSize: number;
        /** Maximum concurrent device evaluations in the periodic alert sweep. */
        sweepConcurrency: number;
        /** Stop scheduling new alert evaluations after this tick budget. */
        sweepMaxDurationMs: number;
        /** Most alert fires committed in one transaction (default 200). */
        fireBatchMaxRows: number;
        /** Longest an alert fire waits for others to share its transaction, ms (default 200). */
        fireBatchTickMs: number;
    };
    mcp: {
        /** CSV allowlist of X-MCP-Client names; empty means allow all. */
        readonly allowedClients: string;
        /** Per-user MCP read budget per minute, previews included (default 600). */
        readonly readsPerMin: number;
        /** Per-user MCP budget per minute for calls that change data (default 60). */
        readonly writesPerMin: number;
        /** fm_read array row cap (default 200). */
        readonly readMaxRows: number;
        /** fm_read envelope byte cap (default 262144). */
        readonly readMaxBytes: number;
        /** Seconds to wait for a human to answer an elicitation (default 120). */
        readonly elicitTimeoutSec: number;
        /**
         * Seconds a single tool call may run before the server gives up
         * (default 90). Without a deadline an unresponsive device pends past
         * the client's own cutoff and the socket dies with no JSON-RPC error
         * at all, which reads to the operator as "MCP is broken".
         */
        readonly toolTimeoutSec: number;
        /** Minutes an idle elicitation session survives (default 60). */
        readonly sessionTtlMin: number;
        /** Cap on concurrent elicitation sessions (default 500). */
        readonly maxSessions: number;
        /** Minutes a remembered approval stays valid (default 60). */
        readonly standingApprovalTtlMin: number;
        /** Cap on remembered approvals held at once (default 1000). */
        readonly maxStandingApprovals: number;
        /** Retry-After seconds when sign-in could not be checked (default 5). */
        readonly authRetryAfterSec: number;
        /** Every MCP credential acts at the read level when true (default false). */
        readonly readOnly: boolean;
        /** MCP device reads in flight per tenant, all instances (default 16). */
        readonly deviceReadsInFlight: number;
        /** MCP device writes in flight per tenant, all instances (default 4). */
        readonly deviceWritesInFlight: number;
        /** Seconds before a device command slot never given back expires (default 300). */
        readonly deviceCommandSlotTtlSec: number;
    };
    audit: {
        /** Audit log batch flush interval in ms (default: 2000) */
        flushIntervalMs: number;
        /** Audit log max buffered entries before oldest are dropped (default: 100) */
        queueMax: number;
        /** Audit log write retries before drop (default: 3) */
        maxRetries: number;
        /** Max chars before truncating audit-row params JSON (default 10000). */
        maxParamsChars: number;
        /** Audit-export CSV cleanup interval ms (default 300000). */
        exportsCleanupIntervalMs: number;
        /** Audit-export CSV + download-ticket TTL ms (default 3600000 = 1h). */
        exportTtlMs: number;
        /** Audit-export rows fetched per DB batch (default 5000). */
        exportBatchSize: number;
        /** Audit-export hard row cap per CSV (default 100000). */
        exportMaxRows: number;
        /** Hard cap on AuditLogger queue; drops oldest when full (default: 10000) */
        queueHardMax: number;
        /** Max chars retained on audit/delivery error_message columns before truncation. */
        persistedErrorMessageMaxChars: number;
        /** Redis Stream key for audit overflow (BoundedQueue spill target). */
        overflowStreamKey: string;
        /** Hard capacity for accepted audit overflow entries; never trims. */
        overflowMaxlen: number;
        /** Min ms between XLEN saturation probes after a spill — surfaces
         *  approximate-MAXLEN trim loss without an XLEN per append. */
        overflowSaturationCheckMs: number;
        /** Audit overflow stream TTL in ms (refreshed on append). */
        overflowTtlMs: number;
        /** XREADGROUP COUNT for the audit drainer. */
        drainerBatchSize: number;
        /** XREADGROUP BLOCK ms for the audit drainer. */
        drainerBlockMs: number;
        /** Drainer retry backoff after Postgres failure. */
        drainerRetryMs: number;
        /** Drop + log entries whose Redis Stream delivery-count exceeds this,
         *  so a poisoned row (DB rejects every retry) can't loop forever. */
        drainerPoisonDeliveries: number;
    };
    auditRetention: {
        /** Leader-elected per-device audit-retention sweep interval in ms
         *  (default daily). Honors each group's auditRetentionDays. */
        sweepIntervalMs: number;
    };
    baseline: {
        enabled: boolean;
        intervalMs: number;
        windowDays: number;
        minWeeks: number;
        graduateWeeks: number;
        weekendDows: readonly number[];
        runFromHour: number;
        runToHour: number;
        deviceBatchSize: number;
        maxTickDurationMs: number;
        minRecomputeIntervalMs: number;
        residualDays: number;
        cusumK: number;
        cusumH: number;
        minResidualDays: number;
    };
    deviceEvents: {
        /** Persist device events through Redis Stream instead of direct queue. */
        redisFirst: boolean;
        /** Also append to Redis while keeping the legacy direct queue. */
        redisShadow: boolean;
        /** Redis stream key for durable device-event history. */
        streamKey: string;
        /** Hard capacity for accepted device-event entries; never trims. */
        streamMaxlen: number;
        /** Device-event stream TTL in ms. */
        streamTtlMs: number;
        /** Min ms between device-event stream saturation probes. */
        streamSaturationCheckMs: number;
        /** XREADGROUP COUNT for the device-event drainer. */
        drainerBatchSize: number;
        /** Maximum time to collect more Redis entries before one DB write. */
        drainerBatchWindowMs: number;
        /** Maximum event rows in one PostgreSQL call. */
        drainerMaxRowsPerCall: number;
        /** XREADGROUP BLOCK ms for the device-event drainer. */
        drainerBlockMs: number;
        /** Device-event drainer retry backoff. */
        drainerRetryMs: number;
        /** Delivery count past which poison device-event rows are dropped. */
        drainerPoisonDeliveries: number;
        /** Device-event-log batch flush interval in ms (default: 2000). */
        flushIntervalMs: number;
        /** Buffered entries that trigger an early flush (default: 500). */
        queueMax: number;
        /** Hard cap; drops oldest when full (default: 50000). Sized to
         *  absorb a 2k-device burst between flush windows without loss. */
        queueHardMax: number;
        /** Batch-insert write retries before drop (default: 3). */
        maxRetries: number;
    };
    virtualCapture: {
        /**
         * Keep classified Shelly X / XT1 virtual-component readings in the
         * forever sensor rollup. Off leaves them in `device.status` only, which
         * expires after 24 hours and costs no storage cardinality. The rollup
         * has no retention policy and `kind` is a compression segment, so an
         * admitted reading cannot be taken back out: this switch is the way to
         * stop a bad classification without a redeploy.
         */
        rollup: boolean;
    };
    sensorCapture: {
        /** Persist sensor history through Redis Stream instead of direct PostgreSQL calls. */
        redisFirst: boolean;
        /** Redis stream key for durable numeric and discrete sensor history. */
        streamKey: string;
        /** Hard capacity for accepted sensor batches; accepted history is never trimmed. */
        streamMaxlen: number;
        /** Sensor stream TTL in ms. */
        streamTtlMs: number;
        /** Min ms between sensor stream saturation probes. */
        streamSaturationCheckMs: number;
        /** XREADGROUP COUNT for the sensor-history drainer. */
        drainerBatchSize: number;
        /** XREADGROUP BLOCK ms for the sensor-history drainer. */
        drainerBlockMs: number;
        /** Sensor-history drainer retry backoff. */
        drainerRetryMs: number;
        /** Delivery count past which malformed sensor entries are dropped. */
        drainerPoisonDeliveries: number;
    };
    backup: {
        /** Max chars accepted for a backup name (default 200). */
        nameMaxLength: number;
        /** Max send retries per chunk before a restart. */
        restoreChunkMaxRetries: number;
        /** Max full restarts from offset 0 on chunk failure. */
        restoreMaxRestarts: number;
        /** Per-chunk Sys.RestoreBackup send timeout in ms. */
        restoreChunkTimeoutMs: number;
        /** Wait before retrying after a failed chunk in ms. */
        restoreRetryDelayMs: number;
        /** Max bytes accepted for an uploaded backup import (default 50MB —
         *  mirrors the GetFile download cap). */
        importMaxBytes: number;
    };
    bthome: {
        /** BTHome pair: timeout waiting for bthomedevice:N after BTHome.AddDevice (default: 5000) */
        pairKeyTimeoutMs: number;
        /** BTHome pair: poll interval while waiting for bthomedevice:N (default: 250) */
        pairKeyPollMs: number;
        /** BTHome pair: timeout waiting for first device broadcast (default: 20000) */
        pairBroadcastTimeoutMs: number;
        /** BTHome pair: poll interval while waiting for first broadcast (default: 500) */
        pairBroadcastPollMs: number;
        /** Per-device BLE discovery cache cap — keyed by untrusted device-reported
         *  BLE addr; LRU evicted so spoofed broadcasts can't grow it (default: 256). */
        discoveryCacheMax: number;
        /** BLE discovery scan window in seconds (default: 30, the firmware
         *  default). A gateway only reports what it hears while scanning, and
         *  idle BLU devices beacon minutes to hours apart (BTHomeData), so a
         *  short window reads as "no devices found". */
        discoveryDurationSec: number;
        /** A BLU heard longer ago than this is forgotten by the scan list (default: 900). */
        discoveryTtlSec: number;
    };
    controlPlaneContract: {
        /** Enables the admin-only sanitized deploy manifest API. */
        exportSanitizedManifest: boolean;
        /** Enables the admin-only aggregate device usage API. */
        deviceUsageApi: boolean;
        /** Runtime deploy manifest path used by contract freshness metrics. */
        deployManifestPath: string;
        /** CI contract summary path used by contract freshness metrics. */
        contractSummaryPath: string;
        /** Stable environment label for aggregate control-plane metrics. */
        environmentId: string;
    };
    dashboard: {
        /** Default dashboard name for first-org bootstrap (default: "Default Dashboard") */
        dashboardName: string;
        /** Default dashboard type for first-org bootstrap (default: "classic") */
        dashboardType: string;
        /** Max items per dashboard (default: 200) */
        maxItems: number;
        /** Max templates per org (default: 100) */
        maxTemplatesPerOrg: number;
        /** Max pinned dashboards per user (default: 50) */
        maxPinsPerUser: number;
        /** Grafana JSON minimum schemaVersion accepted on import (default: 39) */
        grafanaSchemaVersionFloor: number;
        /** Grafana JSON schemaVersion written on export (default: 39) */
        grafanaSchemaVersionWrite: number;
        /** Device state persist debounce in ms (default: 5000) */
        persistDebounceMs: number;
        persistRoutineDebounceMs: number;
    };
    db: {
        /** Max connections of the one pool for stored procedures and SQL (default 30). */
        poolMax: number;
        /** graphile-worker pool max connections (outbox concurrency + headroom). */
        outboxPoolMax: number;
        /** Shared-pool connections that only user requests may take (default 1). */
        foregroundReserve: number;
        /** PostgreSQL connect timeout ms (default 7000). */
        connectionTimeoutMs: number;
        /** PostgreSQL idle-connection timeout ms (default 60000). */
        idleTimeoutMs: number;
        /** Idle shared-pool connections never closed for idleness (default 2). */
        poolMin: number;
        /** Seconds before a pooled connection is replaced (default 1800). */
        maxLifetimeSeconds: number;
        /** Most shared-pool connections one kind of work may hold at once. */
        workloadCaps: {
            alert: number;
            energy: number;
            'em-sync': number;
            rollup: number;
        };
        /** entity.list early-exit page cap (default: 500) */
        entityListPageMax: number;
        /** True under `node --test`. Drives test-only error messages. */
        underNodeTest: boolean;
    };
    delivery: {
        /** Outbox worker concurrent delivery jobs (default: 5) */
        outboxConcurrency: number;
        /** Outbox worker max retry attempts per delivery_job (default: 6) */
        outboxMaxAttempts: number;
        /** Outbox stranded-job reclaim interval in minutes (default: 5). */
        outboxReclaimIntervalMinutes: number;
        /** Digest inbox flush interval in minutes (default: 15). */
        digestFlushIntervalMinutes: number;
        /** Default delay before digest-mode inbox entries flush (default: 60). */
        digestDefaultDelayMinutes: number;
        /** Delivery rate limit per org, jobs/minute (0 disables). */
        rateOrgRpm: number;
        /** Delivery rate limit per endpoint, jobs/minute (0 disables). */
        rateEndpointRpm: number;
        /** Provider-level delivery rate limits, jobs/minute (0 disables). */
        rateProviderRpm: {
            emailSmtp: number;
            genericWebhook: number;
            slackWebhook: number;
            teamsWorkflowWebhook: number;
            telegramBot: number;
            pushFcm: number;
            smsTwilio: number;
            voiceTwilio: number;
            webhookSigned: number;
        };
        /** Per-recipient delivery rate limit across all channels, jobs/minute
         *  (0 disables) so one recipient can't be stormed. */
        rateRecipientRpm: number;
        /** Max attempts for the job that re-writes a delivery's terminal state
         *  after its inline write failed (default: 10). */
        outboxRecordReconcileMaxAttempts: number;
        /** Provider retry delay when an FM delivery rate limit blocks. */
        rateRetryAfterSec: number;
        /** Extra positive jitter for provider Retry-After schedules. */
        retryJitterMs: number;
        /** Poll interval for delivery metrics gauges. */
        metricsPollMs: number;
        /** Stale window before a 'processing' delivery_job is reclaimed (default: 300000ms / 5 min). */
        outboxReclaimStaleMs: number;
        /** Age after which a never-claimed alert delivery_job gets its group re-flushed (default: 10 min). */
        outboxUnflushedStaleMs: number;
        /** Oldest never-claimed alert delivery_job the re-flush sweep still sends (default: 24 h). */
        outboxUnflushedMaxAgeMs: number;
        /** Consecutive delivery failures before an endpoint is auto-disabled (default: 10) */
        endpointAutoOffThreshold: number;
        /** OutboxWorker secret cache size (default 1000). */
        outboxSecretsCacheMax: number;
        /** OutboxWorker secret cache TTL ms (default 300000). */
        outboxSecretsCacheTtlMs: number;
        /** recordAttempt retry count on DB error (default 3). Each retry backs
         *  off 100 / 300 / 900 ms. Shrinks the orphan window after a
         *  successful adapter send. */
        outboxRecordAttemptRetries: number;
        /** recordAttempt base backoff ms (default 100). */
        outboxRecordAttemptBackoffMs: number;
        /** Full-jitter cap for recordAttempt retry sleep (Marc Brooker / AWS pattern). */
        outboxRecordAttemptBackoffCapMs: number;
        /** Hard cap on Channel.Test (verify + send). Hung adapter must not pin the worker. */
        integrationTestTimeoutMs: number;
        /** Periodic sweep for in_progress push rows orphaned by a worker crash. */
        pushReclaimIntervalMs: number;
    };
    device: {
        /** Max devices queued waiting for an init slot before new upgrades are dropped (default 1000). */
        initQueueMax: number;
        /** Shed new admissions above this percent of the init queue (default 70). */
        initQueueHighWaterPct: number;
        /** Reject inits queued longer than this in ms (default 30000). */
        initQueueMaxWaitMs: number;
        /** A held init slot older than this is reclaimed by the watchdog (default 90000). */
        initSlotMaxHoldMs: number;
        /** Init-slot watchdog sweep interval in ms (default 10000). */
        initSlotWatchdogIntervalMs: number;
        /** Re-load interval for saved devices missing from memory in ms, 0 disables (default 300000). */
        loadReconcileMs: number;
        /** A build slower than this is counted slow and logged (default 3000). */
        buildSlowLogMs: number;
        /** Min gap between slow-build log lines, so a storm can't flood (default 2000). */
        buildSlowLogIntervalMs: number;
        /** A device command (FM→device RPC) slower than this is counted slow and logged (default 1000). */
        commandSlowLogMs: number;
        /** Min gap between slow-command log lines (default 2000). */
        commandSlowLogIntervalMs: number;
        /** Bounded ring of recent slow device commands (default 200). */
        commandRingSize: number;
        /** Init-failure cooldown ladder in ms, CSV; doubles per fail (default 30000,60000,120000,300000). */
        initFailureCooldownLadderMs: readonly number[];
        /** Stable-connection ms that clears the cooldown ladder (default 300000). */
        initFailureStableMs: number;
        /** Max tracked devices in the init-failure tracker (default 10000). */
        initFailureTrackerMaxKeys: number;
        /** Filtered device list cache TTL in ms (default: 5000) */
        cacheTtlMs: number;
        /** Device HTTP probe timeout in ms — /api/device-proxy health check (default: 5000) */
        probeTimeoutMs: number;
        /** Camera snapshot proxy fetch timeout in ms — the JPEG is larger than a HEAD probe (default: 8000) */
        cameraSnapshotTimeoutMs: number;
        /** shellyID→groups cache max entries, LRU (default: 10000) */
        groupsCacheMax: number;
        /** device.list DB-side page cap (default: 500) */
        listDbPageMax: number;
        /** device.Relationships.Query default graph page size (default: 25) */
        relationshipQueryDefaultLimit: number;
        /** device.Relationships.Query max graph page size (default: 50) */
        relationshipQueryMaxLimit: number;
        /** device.Relationships.Get depth=2 related device expansion cap (default: 25) */
        relationshipDepthTwoMaxExpansions: number;
        /** Device-side relationship facts read per family (default: 50) */
        relationshipDeviceSideFamilyLimit: number;
        /** Location.EventReplay materialised-row cap per request (default: 50000) */
        eventReplayMaxRows: number;
        /** Location.EventReplay Redis cache TTL for historical (immutable) windows in seconds. */
        eventReplayCacheHistoricalSec: number;
        /** Location.EventReplay Redis cache TTL for rolling (open-ended) windows in seconds. */
        eventReplayCacheRollingSec: number;
        /** A window is "historical" when its `to` is older than this many seconds. */
        eventReplayCacheImmutableLagSec: number;
        /** Redis key prefix for the Location.EventReplay cache. */
        eventReplayCacheKeyPrefix: string;
        /** Max usernames in DeviceComponent filtered-list cache (default: 200) */
        filteredCacheMaxEntries: number;
        /** Max bytes for Device.Call params payload (default: 65536) */
        callMaxParamsBytes: number;
        /** Max method-name length in Device.Call (default: 160) */
        callMaxMethodLength: number;
        /**
         * Most devices one CallMany may touch. A bulk action is one human
         * approval, so the cap is what bounds the blast radius of a single
         * "yes" — keep it small enough that an operator can still read the
         * list they are approving.
         */
        callManyMaxDevices: number;
        /** Per-sender device-access cache size, LRU evicted (default: 5000) */
        accessCacheMax: number;
        /** EWMA smoothing factor for per-device event rate (0..1). */
        rateEwmaAlpha: number;
        /** Per-second event rate at which a device is flagged anomalous. */
        rateAnomalyHz: number;
        /** Per-second rate below which the anomaly flag clears (hysteresis). */
        rateRecoveryHz: number;
        /** Max tracked devices in the anomaly map (LRU evicted). */
        rateTrackedMax: number;
        /** Cap on per-event instant rate (Hz). Prevents a single sub-ms gap from
         *  blowing up the EWMA (e.g. NotifyFullStatus + NotifyStatus back-to-back). */
        rateInstantCapHz: number;
        /** Cluster-wide concurrent device-init cap (0 disables — opt-in). */
        initsClusterCap: number;
        /** Reservation TTL for device-init cluster slots (seconds). */
        initsClusterTtlSec: number;
    };
    deviceIngress: {
        /** Device ingress feature flag. Disabled keeps legacy paths record-only. */
        enabled: boolean;
        /** Enforcement mode: record_only, enforce_new, or enforce_all. */
        enforcementMode: 'record_only' | 'enforce_new' | 'enforce_all';
        /** Whether unknown/unbound devices may enter the operator Waiting Room. */
        waitingRoomEnabled: boolean;
        /** Backend acceptance gate for legacy plain WS identities. */
        allowPlainWs: boolean;
        /** Connector child auto-approval gate. Default false. */
        allowConnectorChildAutoApproval: boolean;
        /** Default org for record-only unknown /shelly Waiting Room rows. */
        defaultOrganizationId: string;
        /** Public Shelly WS base URL used in generated setup bundles. */
        publicWsBaseUrl: string;
        /** Trusted proxy header carrying a verified client cert fingerprint. */
        trustedCertFingerprintHeader: string;
        /** Trusted proxy header carrying a verified client cert PEM. */
        trustedCertPemHeader: string;
        /** CIDRs whose forwarded address and scheme headers are trusted. Empty = none. */
        trustedProxyCidrs: string[];
        /** Device mTLS on: forwarded certificate headers may be read from a trusted proxy. */
        mtlsEnabled: boolean;
        /** A proxy fronts /shelly: refuse to start without a trusted proxy list. */
        proxyRequired: boolean;
        /** Token byte length before base64url encoding. */
        tokenBytes: number;
        /** Default token validity in days. */
        tokenValidityDays: number;
        /** Hard cap on an enrollment token's validity (minutes). */
        enrollmentMaxValidityMinutes: number;
        /** Hard cap on an enrollment token's max_uses. */
        enrollmentMaxUses: number;
        /** Cap on live (active, unexpired) enrollment tokens per org. */
        enrollmentMaxActivePerOrg: number;
        /** Pending token/certificate rotation grace in days. */
        pendingCredentialGraceDays: number;
        /** Concurrent fn_credential_stage_push calls in a bulk rotate. */
        credentialStageConcurrency: number;
        /** Per-device stage timeout in a bulk rotate (ms). */
        credentialStageTimeoutMs: number;
        /** Operator-visible direct token prefix. */
        tokenPrefix: string;
        /** Production ingress token auth requires an explicit pepper. */
        tokenPepperRequired: boolean;
        /** Default list limit for deviceIngress.* list RPCs. */
        listLimit: number;
        /** Max initial handshake payload bytes. */
        maxPayloadBytes: number;
        /** Max device ingress messages per minute per connection. */
        maxMessagesPerMinute: number;
        /** Max live connections per ingress identity. */
        maxConnectionsPerIdentity: number;
        /** Max live connections per organization. */
        maxConnectionsPerOrg: number;
        /** Max live connections per IP. */
        maxConnectionsPerIp: number;
        /** Handshake rate per IP per minute. */
        handshakesPerIpPerMinute: number;
        /** Tracked source-IP cap for the per-IP reconnect limiter. */
        reconnectIpKeyMax: number;
        /** Per-IP reconnect limiter window in ms. */
        reconnectIpWindowMs: number;
        /** Reconnect admission attempts allowed per IP per window. */
        reconnectIpMaxPerWindow: number;
        /** Per-IP reconnect limiter block duration in ms once tripped. */
        reconnectIpBlockMs: number;
        /** Handshake rate per organization per minute. */
        handshakesPerOrgPerMinute: number;
        /** Handshake rate per identity per minute. */
        handshakesPerIdentityPerMinute: number;
        /** Mutation rate per actor per minute. */
        mutationsPerActorPerMinute: number;
        /** Waiting Room retention in days. */
        waitingRoomRetentionDays: number;
        /** Rejection retention in days. */
        rejectionRetentionDays: number;
        /** Connection history retention in days. */
        connectionHistoryRetentionDays: number;
        /** Days to keep a setup record after it expires. */
        setupSessionRetentionDays: number;
        /** Max sanitized Waiting Room sample bytes. */
        waitingRoomSampleMaxBytes: number;
        /** Max sanitized rejection detail bytes. */
        rejectionDetailMaxBytes: number;
        /** Setup session TTL in minutes. */
        provisioningSessionTtlMinutes: number;
        /** Max active provisioning sessions per actor. */
        provisioningMaxActivePerActor: number;
        /** Max bundle fetches per provisioning session. */
        provisioningMaxBundleFetches: number;
        /** Allow FM-issued private-key fallback when certificate flow needs it. */
        provisioningAllowFmIssuedPrivateKey: boolean;
        /** Leader-gated ingress cleanup interval. */
        cleanupIntervalMs: number;
        /** Trusted-device read cache TTL in seconds (min 5). */
        trustCacheTtlSec: number;
        /** Days ahead to list credentials that are about to end. */
        credentialExpiryWarnDays: number;
        /** Run the token rotation worker on the leader node. */
        rotationEnabled: boolean;
        /** Rotation worker poll interval in ms. */
        rotationPollMs: number;
        /** Devices told to restart at the same time. */
        rotationInFlight: number;
        /** Minutes a sent job may stay silent before it is marked waiting. */
        rotationWaitCapMinutes: number;
        /** Max identities in one Rotation.Start call. */
        rotationBatchMax: number;
        /** Timeout for the Ws.SetConfig call over the live socket, ms. */
        rotationSendTimeoutMs: number;
    };
    devSimulation: {
        /** Stable tenant identity used to spread simulator connections and telemetry. */
        instanceSeed: string;
    };
    electricityMaps: {
        /** ElectricityMaps API key. Empty disables real-time intensity — static LBM curve used instead. */
        apiKey: string;
        /** ElectricityMaps API base URL. Override for proxies or self-hosted mirrors. */
        url: string;
        /** Per-call HTTP timeout (ms). */
        timeoutMs: number;
        /** ElectricityMaps zone code (e.g. 'BG', 'DE', 'US-CAL-CISO'). */
        zone: string;
    };
    energy: {
        /** Energy.Query id-map cache TTL in ms (default: 60000 = 1 min). */
        idMapCacheTtlMs: number;
        /** Energy.Query id-map cache max entries (default: 5000) */
        idMapCacheMax: number;
        /** Energy.Query DB row limit (default: 2 000 000) */
        queryRowLimit: number;
        /** Energy.Query fan-out parallelism cap (default: 4) */
        queryConcurrency: number;
        /** Fraction of day-side consumption assumed shiftable to night (0-1, default 0.2) */
        touShiftableFraction: number;
        /** Grid emission factor in g CO₂e per kWh (location-based marginal, default 414) */
        emissionFactorLbmGPerKWh: number;
        /** Default kWp of PV used by the "what-if solar" recommendation. 0 = disable. */
        whatIfSolarKwP: number;
        /** Max kWh proposed for hour-to-hour shift in the recommendations section. */
        timeShiftMaxKWh: number;
        /** Redis stream key buffering em-sync writes ahead of the PG drainer. */
        emSyncStreamKey: string;
        /** Most entries the EM push buffer holds; a backstop behind the byte budget. */
        emSyncStreamMaxlen: number;
        /** Byte budget of the EM push buffer: entry and key list bytes. */
        emSyncStreamMaxBytes: number;
        /** Pause history pulls at this percentage of the push buffer byte budget. */
        emSyncCatchupHighWaterPct: number;
        /** Pause history pulls while the oldest push buffer entry is older (ms). */
        emSyncPullPauseAgeMs: number;
        /** Meter history pages fetched or being stored per em-sync DB connection. */
        emSyncPullPagesPerConnection: number;
        /** Longest a live push waits to share one Redis call with others (ms). */
        emSyncPushBatchMs: number;
        /** Most push records in one Redis call; a full batch is sent at once. */
        emSyncPushBatchMaxEntries: number;
        /** EM sync stream TTL in ms. */
        emSyncStreamTtlMs: number;
        /** Min ms between EM sync stream saturation probes. */
        emSyncSaturationCheckMs: number;
        /** XREADGROUP COUNT for the EM sync drainer. */
        emSyncDrainerBatchSize: number;
        /** XREADGROUP BLOCK ms for the EM sync drainer. */
        emSyncDrainerBlockMs: number;
        /** EM sync drainer retry backoff. */
        emSyncDrainerRetryMs: number;
        /** Max raw rows per EM sync DB write (drainer batch or pulled page piece). */
        emSyncDrainerMaxRows: number;
        /** Delivery count past which poison EM sync rows are dropped. */
        emSyncDrainerPoisonDeliveries: number;
        /** EM sync stream health probe interval in ms. */
        emSyncHealthIntervalMs: number;
        /** Live em_stats and lifetime flush cadence in ms. */
        emStatsFlushIntervalMs: number;
        /** Live em_stats rows held in memory while PostgreSQL is failing. */
        emStatsRetryMaxRows: number;
        /** Longest wait between live em_stats flush retries in ms. */
        emStatsRetryBackoffMaxMs: number;
        /** Live em_stats rows older than this are dropped, in seconds. */
        emStatsMaxAgeS: number;
        /** Redis stream that holds live em_stats rows over the memory budget. */
        emStatsOverflowStreamKey: string;
        /** Entries the em_stats overflow stream keeps before refusing spills. */
        emStatsOverflowMaxlen: number;
        /** Max live em_stats rows per database write; whole devices per write. */
        emStatsWriteMaxRows: number;
        /** Dirty 15-minute buckets recomputed per transaction. */
        rollupBatchSize: number;
        /** Concurrent rollup consumers. Auto: 2 with >=4 CPUs, otherwise 1. */
        rollupWorkers: number;
        /** Idle delay for the rollup worker. */
        rollupPollMs: number;
        /** Maximum adaptive delay while the rollup queue remains empty. */
        rollupIdlePollMaxMs: number;
        /** Rollup backlog health probe interval. */
        rollupHealthIntervalMs: number;
        /** Maximum report wait for affected rollups. */
        rollupReportWaitMs: number;
        /** Report retry delay while affected rollups are pending. */
        rollupReportPollMs: number;
        /** Days held rollup work keeps its raw rows before it is abandoned with evidence. */
        heldCorrectionDays: number;
        /** Wait after an open EM record bucket ends before it closes on the timer
         *  when the meter's records have not passed its end (ms). */
        rollupCloseGraceMs: number;
        /** Wait before a late EM record makes a closed bucket due again, so a
         *  burst of late minutes gives one recompute (ms). */
        rollupLateDebounceMs: number;
        /** Hours a live EM debug capture runs before it stops and deletes its frames (1-24). */
        liveDebugHours: number;
        /** Device ids scoped into multi-block em-data catch-up. Empty = all devices. */
        catchupDeviceIds: readonly number[];
        /** Percent of the EM sync slot budget reserved for catch-up, so a
         *  fleet-wide backlog can never take the slots live-edge devices
         *  need (default 25). */
        emSyncCatchupSharePct: number;
        /** First retry delay after a failed EM sync pass, seconds (default 2). */
        emSyncFailBackoffBaseS: number;
        /** Ceiling on the failed-pass retry back-off, seconds. At the default
         *  a permanently failing device costs exactly what a healthy one
         *  costs (default 540 = the gentle cadence). */
        emSyncFailBackoffMaxS: number;
    };
    firmware: {
        /** Expired temporary firmware sweep interval ms (default 900000). */
        tempCleanupIntervalMs: number;
        /** Firmware verify total wait in ms (default: 120000) */
        verifyTimeoutMs: number;
        /** Firmware verify poll interval in ms (default: 5000) */
        verifyPollMs: number;
        /** Firmware build ids blocked as update targets (known-vulnerable). */
        vulnerableBuildIds: readonly string[];
        /** Max devices a single auto-update job may target (staged rollout). */
        autoUpdateMaxDevicesPerJob: number;
        /** TTL of the once-per-slot fire claim that stops two leaders both
         *  running the auto-update across a hand-off (default: 6h). */
        schedulerFireClaimTtlSec: number;
    };
    geocoding: {
        /** Nominatim base URL. Override for self-hosted instances. */
        nominatimUrl: string;
        /** Nominatim User-Agent (required by their policy). */
        nominatimUserAgent: string;
        /** Per-call Nominatim HTTP timeout (ms). */
        nominatimTimeoutMs: number;
        /** Cap on global Nominatim calls per second (shared across instances). */
        nominatimRpsCap: number;
        /** TTL for cached geocoding hits (seconds). */
        cachePositiveTtlSec: number;
        /** TTL for negative-sentinel cache entries (seconds). */
        cacheNegativeTtlSec: number;
    };
    grafana: {
        /** Grafana proxy request timeout in ms (default: 30000) */
        proxyTimeoutMs: number;
        /** Grafana proxy response size cap in bytes (default: 50 MiB) */
        proxyMaxBytes: number;
        /** Shared secret asserting the call came from FM (empty = not enforced). */
        proxySecret: string;
        /** Grafana datasource pool: max open connections (default: 10) */
        dsMaxOpenConns: number;
        /** Grafana datasource pool: max idle connections (default: 10) */
        dsMaxIdleConns: number;
        /** Grafana datasource pool: connection lifetime in seconds (default: 14400) */
        dsConnLifetimeSec: number;
        /** Grafana API fetch timeout in ms (default: 15000) */
        fetchTimeoutMs: number;
        /** Wait for Grafana readiness before setup: total timeout in ms (default: 60000) */
        setupReadyTimeoutMs: number;
        /** Wait for Grafana readiness: health-probe poll interval in ms (default: 1000) */
        setupReadyPollMs: number;
        /** Grafana alert webhook: max request body bytes (default: 1048576) */
        webhookMaxBytes: number;
        /** Grafana alert webhook: rate-limit token capacity (default: 60) */
        webhookRateCapacity: number;
        /** Grafana alert webhook: rate-limit refill per second (default: 1) */
        webhookRateRefillPerSec: number;
    };
    http: {
        /** RPC rate limit for general methods, requests per minute per user (default: 240) */
        rateLimitGeneralRpm: number;
        /** RPC rate limit for admin/write methods (default: 30) */
        rateLimitExpensiveRpm: number;
        /** RPC rate limit for billing quotes (default: 120). */
        rateLimitBillingRpm: number;
        /** RPC methods charged against the expensive bucket. CSV env. */
        rateLimitExpensiveMethods: readonly string[];
        /** Per-org overlay for general methods, rpm (default 2400). */
        rateLimitOrgGeneralRpm: number;
        /** Per-org overlay for expensive methods, rpm (default 300). */
        rateLimitOrgExpensiveRpm: number;
        /** Per-org overlay for billing quotes, rpm (default 1200). */
        rateLimitOrgBillingRpm: number;
        /** FM container HTTP listen port (default 7011). */
        fmPort: number;
        /** /api/switch per-caller cap/min (default: 60) */
        rateLimitApiSwitchPerMin: number;
        /** /api/reports/download per-caller cap/min (default: 30) */
        rateLimitReportsDownloadPerMin: number;
        /** /media/upload* per-caller cap/min (default: 20) */
        rateLimitMediaUploadPerMin: number;
        /** /media/uploadFirmwareFile per-caller cap/min (default: 10) */
        rateLimitFirmwareUploadPerMin: number;
        /** /api/device-proxy/* per-caller cap/min (default: 60) */
        rateLimitDeviceProxyPerMin: number;
        /** /api/docs per-caller cap/min (default: 30) */
        rateLimitApiDocsPerMin: number;
        /** /metrics per-caller cap/min (default: 120 — 2/sec, well above typical Prometheus 15s interval) */
        rateLimitMetricsPerMin: number;
        /** Unauthenticated Bearer scoped-token attempts on /rpc, per-IP cap/min (default: 60) */
        rateLimitScopedTokenPerMin: number;
        /** POST /auth/login_flow per-caller cap/min (default: 60) */
        rateLimitLoginFlowPerMin: number;
        /** POST/DELETE /api/auth/session per-caller cap/min (default: 30) */
        rateLimitAuthSessionPerMin: number;
        /** GET /media/firmware-file/:token per-caller cap/min (default: 60) */
        rateLimitFirmwareDownloadPerMin: number;
        /** POST /media/importBackup per-caller cap/min (default: 10) */
        rateLimitBackupImportPerMin: number;
        /** Enable gzip for compressible HTTP responses. */
        compressionEnabled: boolean;
        /** Compress responses at or above this size in bytes. */
        compressionMinBytes: number;
        /** zlib gzip compression level. */
        compressionLevel: number;
        /** HTTP/HTTPS socket idle timeout in ms (default: 120000) */
        httpSocketTimeoutMs: number;
        /** Idle keep-alive close in ms; above the proxy's idle timeout (default: 95000) */
        keepAliveTimeoutMs: number;
        /** OS-level TCP keepalive initial delay in ms (0 disables). */
        tcpKeepaliveDelayMs: number;
    };
    ingest: {
        /** Device ingestion stream key prefix (shuffle-sharded). */
        streamPrefix: string;
        /** Number of shuffle-shard lanes for device ingestion. */
        lanes: number;
        /** Device ingestion stream MAXLEN ~. */
        maxlen: number;
        /** Device ingestion stream TTL in ms. */
        ttlMs: number;
        /** XREADGROUP COUNT for the device ingest drainer. */
        drainerBatchSize: number;
        /** XREADGROUP BLOCK ms for the device ingest drainer. */
        drainerBlockMs: number;
        /** Device ingest drainer retry backoff. */
        drainerRetryMs: number;
        /** Delivery count past which poison ingest rows are dropped (ack'd) — parity with audit/status drainers. */
        drainerPoisonDeliveries: number;
        /** Hot-path Redis XADD timeout before durable persistence is marked degraded. */
        xaddTimeoutMs: number;
        /** Minimum degraded-mode cooldown after Redis append failure/timeout. */
        degradedCooldownMs: number;
        /** If false, AbstractDevice skips per-frame XADD to ingest stream. */
        capture: boolean;
        /** If true, IngestDrainer runs at boot to replay any pending PEL frames. */
        drainAtBoot: boolean;
    };
    mobile: {
        bootstrapDeviceLimit: number;
        syncDeltaLimit: number;
    };
    nodeRed: {
        /** Enables standalone Node-RED proxy routes (default: false). */
        enabled: boolean;
        /** Internal Node-RED target for the FM reverse proxy. */
        proxyTarget: string;
        /** Shared proxy header secret expected by the Node-RED settings file. */
        proxySecret: string;
        /** Production requires a non-empty proxy secret (fail closed). */
        proxySecretRequired: boolean;
        /** Node-RED proxy request timeout in ms (default: 30000). */
        proxyTimeoutMs: number;
        /** Retry interval while the service user is unresolved (ms). */
        serviceUserRetryMs: number;
        /** CSV of actions that grant editor access. */
        uiPermissions: readonly string[];
        /** Browser origins allowed to bootstrap a Node-RED editor session. */
        sessionAllowedOrigins: readonly string[];
        /** SameSite mode for the Node-RED editor auth cookie. */
        sessionCookieSameSite: 'strict' | 'lax' | 'none';
        /** Editor session idle timeout, slid on each use, in ms (default: 900000). */
        sessionTtlMs: number;
        /** Editor session hard lifetime in ms (default: 43200000). */
        sessionMaxAgeMs: number;
        /** Node-RED user directory (default: ./cfg/node-red) */
        userDir: string;
        /** Node-RED admin UI port (default: 1880) */
        port: number;
        /** Node-RED admin UI bind host (default: 0.0.0.0) */
        host: string;
        /** Node-RED flow file name (default: flows_fleetmanager.json) */
        flowFile: string;
        /** The one organization this Node-RED belongs to (empty = unlocked). */
        orgId: string;
        /** TCP keepalive for proxied editor WebSockets in ms (default: 30000). */
        wsKeepAliveMs: number;
        /** How long an admin-API flow read is reused in ms (default: 10000). */
        flowCacheMs: number;
        /** Health probe timeout in ms (default: 3000). */
        statusTimeoutMs: number;
        /** How long a health probe answer is reused in ms (default: 15000). */
        statusCacheMs: number;
        /** Max webhook body in bytes (default: 262144). */
        hookBodyLimitBytes: number;
        /** Webhook calls per client IP per minute (default: 60). */
        hookRateLimitPerMin: number;
    };
    observability: {
        /** Observability metric Map key cap, LRU (default: 5000) */
        metricKeyLimit: number;
        /** Boot level 0-3 when observability is on (FM_OBSERVABILITY_LEVEL). */
        bootLevel: ObsLevel;
        /** Per-phase DB call timing and the 1 ms loop-delay window (FM_DB_TIMING_DETAIL). */
        dbTimingDetail: boolean;
        /** Max distinct label-sets per labeled metric before excess folds into
         *  an `overflow="other"` bucket, bounding device-influenced labels so
         *  they can't evict core series (default: 200). */
        labeledSeriesPerNameMax: number;
        /** Max distinct labeled metric names tracked, LRU (default: 500). */
        labeledNameMax: number;
        /** Max distinct RPC method names retained for latency P95 sampling,
         *  LRU; bounds attacker-controlled Device.Call method names (default: 500). */
        rpcSampleMaxMethods: number;
        /** Max distinct telemetry keys accepted by System.SubmitTelemetry (default: 200) */
        telemetryMaxKeys: number;
        /** Bearer token gating /metrics + observability GET endpoints. Empty = session-only. */
        authToken: string;
        /** Opt-in periodic XLEN probe of registered streams. */
        healthMonitorEnabled: boolean;
        /** XLEN poll interval in ms. */
        healthMonitorPollMs: number;
        /** XLEN/MAXLEN ratio that raises `fm_stream_overflow_total`. */
        healthOverflowRatio: number;
        /** Refresh interval for the `fm_custom_kind_in_use` gauge. */
        kindGaugePollMs: number;
        /** Topology anomaly thresholds (Phase 10 of monitoring redesign). */
        dbWarnMs: number;
        dbCritMs: number;
        rpcWarnMs: number;
        rpcCritMs: number;
        statusQueueWarn: number;
        statusQueueCrit: number;
        /** Recent RPC-error ring capacity (level >= 2). */
        rpcErrorRingSize: number;
        /** Recent device init-failure ring capacity (level >= 2). */
        initFailureRingSize: number;
        /** Slow-RPC entry ring capacity. */
        slowRpcRingSize: number;
        /** Ms over rolling P95 that flags an RPC as slow. */
        slowRpcOffsetMs: number;
        /** Rolling window for per-method RPC latency samples (ms). */
        rpcSampleWindowMs: number;
        /** Max retained latency samples per RPC method. */
        rpcSampleMaxPerMethod: number;
        /** Min samples before a method's P95 is trusted. */
        rpcSampleMinForP95: number;
        /** Device init-duration ring capacity. */
        initDurationRingSize: number;
        /** Metric-snapshot history ring capacity (~1h at 5s). */
        historyRingSize: number;
        /** Topology snapshot cache TTL (ms). */
        topologyCacheMs: number;
        /** Per-module stats history ring capacity. */
        moduleHistorySize: number;
        /** Topology-diff baseline ring capacity. */
        topologyDiffRingSize: number;
        /** Min edge-throughput %% change surfaced by the topology diff. */
        topologyDiffPctThreshold: number;
        /** Min interval between repeated getter-failure warnings (ms). */
        getterWarnMinIntervalMs: number;
        /** Rolling window for edge-counter rate sampling (ms). */
        edgeCounterWindowMs: number;
    };
    plugin: {
        /** Plugin command pending timeout in ms (default: 30000) */
        commandTimeoutMs: number;
        /** Plugin worker shutdown grace in ms (default: 5000) */
        shutdownTimeoutMs: number;
        /** Max entries in an uploaded plugin zip (zip-bomb guard). */
        maxFiles: number;
        /** Max directory nesting depth inside an uploaded plugin zip. */
        maxDepth: number;
        /** Max total uncompressed bytes in an uploaded plugin zip. */
        maxUncompressedBytes: number;
        /** Soft cap on a single plugin worker IPC frame (JSON-serialized). */
        ipcMaxBytes: number;
        /** Hard cap on post-decode plugin upload buffer size (bytes). */
        maxDecodedBytes: number;
        /** Max in-flight commands per plugin worker. Reject when full. */
        commandQueueMax: number;
        /** Max concurrently loaded plugin workers. */
        maxWorkers: number;
        /** V8 old-generation heap cap per plugin worker (MB). */
        workerMaxOldGenerationSizeMb: number;
        /** V8 young-generation heap cap per plugin worker (MB). */
        workerMaxYoungGenerationSizeMb: number;
        /** Native stack cap per plugin worker (MB). */
        workerStackSizeMb: number;
    };
    redis: {
        /** Per-domain organization-version cache cap. LRU; eviction is safe. */
        organizationVersionCacheMax: number;
        /** Max orgs in CommandSender shared group cache, LRU evicted (default: 500) */
        groupCacheMaxOrgs: number;
        /** Per-step deadline on Registry.warmCache() entry. */
        warmCacheStepTimeoutMs: number;
        /** Redis URL — single source of truth across all subsystems. */
        url: string;
        /** Disables Redis hot-path at boot via FM_REDIS_DISABLED or FM_STREAMS_KILL_SWITCH. */
        disabled: boolean;
        /** Deployment-wide Redis key prefix for new shapes (default fm:). */
        keyPrefix: string;
        /** TCP connect timeout for the shared Redis client in ms. */
        connectTimeoutMs: number;
        /** Per-command timeout for the shared Redis client in ms (0 = disabled). */
        commandTimeoutMs: number;
        /** Max pending best-effort writes on one Redis client. 0 disables. */
        writeMaxPendingCommands: number;
        /** Redis cmd-client max retries per request. */
        cmdRetriesMax: number;
        /** Redis sub-client backoff ceiling in ms. */
        subBackoffMaxMs: number;
        /** Opt-in per-stream XADD token-bucket. Dropped XADDs counted. */
        rateLimitEnabled: boolean;
        /** Token-bucket burst capacity per stream. */
        rateLimitCapacity: number;
        /** Token-bucket steady-state refill per second per stream. */
        rateLimitRefillPerSec: number;
        /** Channel prefix for cross-instance Pub/Sub signals. */
        pubsubChannelPrefix: string;
        /** Leader lease lifetime in ms. */
        leaderLeaseMs: number;
        /** Leader renewal interval in ms (< leaseMs). */
        leaderRenewMs: number;
    };
    report: {
        /** Streaming report pre-flight row cap. 0 disables it. */
        maxRows: number;
        /** Report pre-flight device cap. */
        maxDevices: number;
        /** Report CSV stream chunk size in rows (default: 1000) */
        streamChunkRows: number;
        /**
         * Target rows per export time-window. The timeseries export paginates
         * the range into bucket-aligned windows of ~this many rows so each COPY
         * is a separate, bounded statement that fits statement_timeout.
         */
        chunkTargetRows: number;
        /** PostgreSQL work_mem used only by a streamed report transaction. */
        queryWorkMemMb: number;
        /** Max generated energy-report date range in days. */
        maxRangeDays: number;
        /** Write generated report CSV artifacts as .csv.gz. */
        gzipCsvArtifacts: boolean;
        /** Max rows retained for generated report HTML summaries. */
        htmlSummaryMaxRows: number;
        /** Max rows rendered into a formatted PDF; CSV remains complete. */
        pdfSummaryMaxRows: number;
        /** Hard byte ceiling for one generated PDF artifact. */
        pdfMaxBytes: number;
        /** Operational render-time budget for one formatted PDF. */
        pdfRenderBudgetMs: number;
        /** Simultaneous PDF render workers. Each is a core drawing flat out. */
        pdfRenderConcurrency: number;
        /** Report artifact owner/job TTL in days. */
        artifactTtlDays: number;
        /** Report artifact cleanup sweep interval in ms. */
        cleanupIntervalMs: number;
        /** Poll interval for cooperative report cancellation in ms. */
        cancelPollMs: number;
        /** Durable raw-export job retry attempts (default: 3) */
        exportMaxAttempts: number;
        /** Power-quality nominal voltage (V) for the EN-50160 band — EU 230, US 120. */
        nominalVoltage: number;
        /** Power-quality nominal frequency (Hz) — EU 50, US 60. */
        nominalHz: number;
    };
    rpc: {
        /** Max concurrent device initializations on connect (default: 100) */
        maxConcurrentInits: number;
        /** Max concurrent energy meter data syncs (default: 40) */
        maxConcurrentEmSyncs: number;
        /** Max concurrent EM sync CHANNELS. Additive ceiling beside
         *  maxConcurrentEmSyncs, which counts devices — a device syncs every
         *  channel in parallel, so the real peak is devices x channels
         *  (default 120 = 40 x the triphase worst case, so it binds nothing
         *  at the defaults and exists to make the ceiling honest). */
        maxConcurrentEmSyncChannels: number;
        /** An in-flight EM sync held longer than this is flagged stuck (default 90000). */
        emSyncStuckMs: number;
        /** Hard deadline on a single EM sync, aborted past this so its
         *  concurrency slot is reclaimed. Must exceed emSyncStuckMs
         *  (default 120000). */
        emSyncReclaimMs: number;
        /** Device RPC call timeout in ms (default: 60000) */
        rpcTimeoutMs: number;
        /** Connect-time probe timeout per RPC. Lower than rpcTimeoutMs so a
         *  slow device frees its init slot in finite time (default 20s). */
        initProbeTimeoutMs: number;
        /** Max pending RPC calls per device (default: 10) */
        maxPendingRpcs: number;
    };
    session: {
        /** Path for shutdown session snapshot (empty disables). */
        snapshotPath: string;
        /** Max age of restored filter entries before they're ignored on reconnect. */
        snapshotTtlMs: number;
    };
    deviceSnapshot: {
        /** If true, device snapshot persists append to Redis instead of calling Postgres. */
        redisFirst: boolean;
        /** If true, device snapshot persists append to Redis while keeping the old Postgres write. */
        redisShadow: boolean;
        /** Redis Stream key for device snapshot persistence. */
        streamKey: string;
        /** Device snapshot stream MAXLEN ~. */
        streamMaxlen: number;
        /** Min ms between XLEN saturation probes after an append. */
        streamSaturationCheckMs: number;
        /** Device snapshot stream TTL in ms. */
        streamTtlMs: number;
        /** XREADGROUP COUNT for the device snapshot drainer. */
        drainerBatchSize: number;
        /** Maximum time to collect a device-snapshot micro-batch after the first entry. */
        drainerBatchWindowMs: number;
        /** XREADGROUP BLOCK ms for the device snapshot drainer. */
        drainerBlockMs: number;
        /** Device snapshot drainer retry backoff. */
        drainerRetryMs: number;
        /** Delivery count past which poison snapshot rows are dropped. */
        drainerPoisonDeliveries: number;
    };
    status: {
        /** Max buffered status messages before oldest are dropped (default: 50000) */
        queueMax: number;
        /** Status message batch flush interval in ms (default: 250) */
        flushIntervalMs: number;
        /** If true, normal status flushes append to Redis instead of calling Postgres. */
        redisFirst: boolean;
        /** If true, status flushes append to Redis while keeping the old Postgres write. */
        redisShadow: boolean;
        /** Redis Stream key for normal status persistence. */
        streamKey: string;
        /** Redis Stream key for status flush overflow (compatibility alias). */
        overflowStreamKey: string;
        /** Status stream MAXLEN ~. */
        streamMaxlen: number;
        /** Status overflow stream MAXLEN ~ (compatibility alias). */
        overflowMaxlen: number;
        /** Min ms between XLEN saturation probes after an append. */
        streamSaturationCheckMs: number;
        /** Min ms between XLEN saturation probes after a spill (compatibility alias). */
        overflowSaturationCheckMs: number;
        /** Status stream TTL in ms. */
        streamTtlMs: number;
        /** Status overflow stream TTL in ms (compatibility alias). */
        overflowTtlMs: number;
        /** XREADGROUP COUNT for the status drainer. */
        drainerBatchSize: number;
        /** Maximum time to collect more Redis entries before one DB write. */
        drainerBatchWindowMs: number;
        /** Max rows per coalesced PG batch when draining status overflow. */
        drainerMaxRowsPerCall: number;
        /** XREADGROUP BLOCK ms for the status drainer. */
        drainerBlockMs: number;
        /** Status drainer retry backoff. */
        drainerRetryMs: number;
        /** Delivery count past which poison status rows are dropped (ack'd). */
        drainerPoisonDeliveries: number;
    };
    storage: {
        /** Storage.GetAll response-size cap in bytes; throws above this so callers fall back to Keys+GetItem. 0 = uncapped. Default 2 MB. */
        getAllMaxBytes: number;
    };
    energyClassifier: {
        /** Toggle between legacy regex path ('v1') and new classifier module ('v2'). Default 'v2': v1 drops BTHome and virtual-component readings. */
        version: 'v1' | 'v2';
        /** Only read when version is 'v1': runs v2 in shadow and records parity counters. Inert on the 'v2' default. */
        parallelWrite: boolean;
        /** AC-mains detection threshold (V): with no frequency, a reading at/above this stays AC, below it is DC. Default 90 (covers US 120 V / EU 230 V). */
        acMinVoltage: number;
    };
    upload: {
        /** One-time upload ticket TTL in ms (default: 300000) */
        ticketTtlMs: number;
        /** Resumable upload session TTL in ms (default: 3600000) */
        sessionTtlMs: number;
        /** Authenticated upload asset browser cache in seconds (default: 86400) */
        assetCacheMaxAgeSec: number;
        /** Signed upload asset URL TTL in seconds (default: 300) */
        assetUrlTtlSec: number;
    };
    virtualDevice: {
        /** Profile.MatchSources cap on candidate matches returned per role slot (default: 25). */
        profileMatchMaxPerSlot: number;
        /** Max orgs retained in the in-process BLU-snapshot cache; oldest is evicted at the cap (default: 256). */
        bluCacheMaxOrgs: number;
        /** Process-wide BLU gateway reconcile concurrency. 0 = unlimited. */
        bluReconcileConcurrency: number;
        /** BLU gateway reconciles allowed to wait behind the active set. */
        bluReconcileQueueMax: number;
        /** Primary silence before one secondary gateway may own telemetry. */
        bluTelemetryFailoverMs: number;
        /** Max BLU telemetry owners retained by the in-process Redis-disabled fallback. */
        bluTelemetryOwnerMaxEntries: number;
        /** Max gateway route maps retained in the process-local BLU cache. */
        bluRouteCacheMaxGateways: number;
        /** Days a BLU sample's gateway provenance row is kept (default: 30). */
        bluProvenanceRetentionDays: number;
        /** Profile.SuggestFromDevice cap on ranked candidates returned (default: 10). */
        profileSuggestMaxResults: number;
    };
    waitingRoom: {
        /** Waiting Room pending-device memory cap (default: 2000) */
        max: number;
        /** Waiting Room pending-device TTL in ms (default: 3600000 = 1 hour) */
        ttlMs: number;
        /** Waiting Room TTL sweep interval in ms (default: 60000 = 1 min) */
        sweepMs: number;
        /** Re-read of devices whose access left ALLOWED, so a lost deny signal still closes the socket, in ms (default: 60000 = 1 min) */
        accessRecheckMs: number;
        /** Waiting Room update event debounce in ms (default: 300) */
        notifyDebounceMs: number;
        /** Waiting Room pre-approval enrichment RPC timeout in ms (default: 5000) */
        enrichTimeoutMs: number;
        /** Waiting Room reconnect limiter tracked shellyID cap (default: 10000) */
        reconnectKeyMax: number;
        /** Waiting Room reconnect limiter window in ms (default: 60000 = 1 min) */
        reconnectWindowMs: number;
        /** Waiting Room reconnect attempts allowed per window (default: 20) */
        reconnectMaxPerWindow: number;
        /** Waiting Room reconnect limiter block duration in ms (default: 300000 = 5 min) */
        reconnectBlockMs: number;
        /** Waiting Room sanitize max string length per field (default: 256) */
        sanitizeMaxStringLen: number;
        /** Waiting Room sanitize max component keys kept per device (default: 64) */
        sanitizeMaxComponentKeys: number;
        /** Opt-in deadline on the waiting-room config DB read during /shelly admission. 0 = disabled. */
        configTimeoutMs: number;
        /** Waiting store per-entry TTL in seconds (default: 90). */
        redisTtlSec: number;
        /** Waiting store per-org pending-entry cap (default: 2000). */
        maxPerOrg: number;
        /** Cooldown after a reject before a device may re-enter, seconds. */
        rejectCooldownSec: number;
        /** Devices admitted per batched DB write when accepting in bulk (default: 200). */
        acceptChunkSize: number;
        /** Bulk-accept chunks processed concurrently (default: 6). */
        acceptConcurrency: number;
        /** Bulk-accept job record TTL in seconds (default: 3600). */
        bulkJobTtlSec: number;
        /** A running bulk-accept job idle this long is treated as dead (default: 60s). */
        bulkJobStaleSec: number;
        /** Card-fill probe fan-out cap while devices wait (default: 50). */
        probeConcurrency: number;
        /** Heavier gather (paginated components) fan-out cap (default: 50). */
        gatherConcurrency: number;
        /** Hard deadline for one waiting-room gather, every probe RPC included (default: 60000). Under device.initSlotMaxHoldMs so a joined gather settles before the slot watchdog fires. */
        gatherMaxMs: number;
        /** How long an accept waits on an in-flight gather before abandoning it and probing fresh (default: 60000, the gather's own deadline, so a slow but healthy gather is never cut short by the accept). */
        gatherTakeMs: number;
    };
    ws: {
        /** Max queued WS messages from a client during token validation (default: 25) */
        authQueueMax: number;
        /** WS log-appender batch flush debounce in ms (default: 250) */
        logFlushMs: number;
        /** Max bytes of stringified params/payload included in WS debug log. */
        debugLogMaxBytes: number;
        /** Per-session WS event stream key prefix. */
        streamPrefix: string;
        /** Per-session WS stream MAXLEN ~ trim point. */
        streamMaxlen: number;
        /** Per-session WS stream TTL in ms (refreshed on append). */
        streamTtlMs: number;
        /** How long a closed socket's events keep being captured for resume, ms (default: 60000). */
        resumeGraceMs: number;
        /** Max events captured while a socket is away; more forces resync (default: 5000). */
        resumeMaxEvents: number;
        /** Wait for a pong from a still-bound socket before taking over its session, ms (default: 2000). */
        resumeProbeMs: number;
        /** XREADGROUP BLOCK ms for the WS sender loop. */
        streamBlockMs: number;
        /** XREADGROUP COUNT for the WS sender loop. */
        streamBatchSize: number;
        /** Max elements in a single client JSON-array batch message. */
        maxBatchSize: number;
        /** bufferedAmount above which the sender loop pauses. */
        senderPauseBytes: number;
        /** Bounded wait for WS to reach OPEN before PEL replay / live loop. */
        socketOpenTimeoutMs: number;
        /** Poll interval used inside the WS-open bounded wait. */
        socketOpenPollMs: number;
        /** WS heartbeat ping interval in ms (default: 30000) */
        heartbeatMs: number;
        /** Client-cohort heartbeat — staggered from wsHeartbeatMs. */
        clientHeartbeatMs: number;
        /** CIDRs whose XFF on client WS upgrades is trusted. Empty = none. */
        clientTrustedProxyCidrs: string[];
        /** Consecutive missed pongs before a WS socket is terminated (default: 2) */
        heartbeatMissedPongsMax: number;
        /** Clients pinged per heartbeat tick batch (default: 100) */
        heartbeatChunkSize: number;
        /** Enable per-message-deflate (RFC 7692) on the device /shelly socket. */
        compressionEnabled: boolean;
        /** zlib compression level (1=fastest, 9=best), both sockets. */
        compressionLevel: number;
        /** zlib memory level (1-9), both sockets. Lower = less RAM per stream. */
        compressionMemLevel: number;
        /** Device socket: skip compression for payloads smaller than this (bytes). */
        compressionThreshold: number;
        /** Process-wide cap on concurrent zlib threadpool ops (ws shares one limiter). */
        compressionConcurrencyLimit: number;
        /** Enable per-message-deflate on the browser/API client socket (default: true). */
        clientCompressionEnabled: boolean;
        /** Client socket: skip compression for payloads smaller than this (bytes, default: 4096). */
        clientCompressionThreshold: number;
        /** Client socket: server deflate window bits (9-15, default: 14); bounds RAM per socket. */
        clientCompressionWindowBits: number;
        /** Max accepted WS upgrades per second per cohort (0 disables). */
        admissionMaxPerSec: number;
        /** How often the pending-filter sweep runs (ms). */
        pendingFilterSweepIntervalMs: number;
        /** Auto-admit reservation claim TTL (s); a stale claim is reclaimable after this. */
        admissionReserveGraceSeconds: number;
    };
    zitadel: {
        /** Seen-login-token dedup TTL in ms — exceeds OIDC access-token lifetime (default: 7200000). */
        seenLoginTokenTtlMs: number;
        /** Seen-login-token dedup cache max entries (default: 10000). */
        seenLoginTokenCacheMax: number;
        /** Definitive rejected-token cache max entries (default: 10000). */
        tokenRejectionCacheMax: number;
        /** Introspected-user cache TTL in ms — skip Zitadel for fresh tokens (default: 30000). */
        introspectedUserTtlMs: number;
        /** OIDC userinfo fetch timeout in ms — bounds a hung IdP on the auth path (default: 5000). */
        userinfoFetchTimeoutMs: number;
        /** OIDC token introspection timeout in ms — bounds a hung IdP so fresh auth fails fast instead of stalling (default: 5000). */
        introspectionTimeoutMs: number;
        /** Scoped-PAT user cache TTL in ms — tunable independent of Zitadel introspection. Default 30000. */
        scopedPatCacheTtlMs: number;
        /** Identity-provider account state cache TTL in ms — the longest a deactivated or locked user's credentials keep working when no webhook arrives (default 30000, range 1000..300000). */
        accountStateTtlMs: number;
        /** Account state cache max entries, one per user (default 10000). */
        accountStateCacheMax: number;
        /** User.BulkRotatePATs concurrency cap (default 5). */
        patBulkRotateConcurrency: number;
        /** User/token cache sweep interval ms (default 60000). */
        userCacheSweepIntervalMs: number;
        /** TTL on authz version keys — bounds leak from deleted tenants. */
        authzVersionTtlSeconds: number;
    };
    tariffPull: {
        /** Enable periodic ENTSO-E day-ahead price fetch (default: false — opt-in). */
        enabled: boolean;
        /** Fetch interval in ms (default: 21600000 = 6 h). */
        intervalMs: number;
        /** ENTSO-E HTTP fetch timeout in ms (default: 20000). */
        fetchTimeoutMs: number;
    };
}

const DEFAULT_RATE_LIMIT_EXPENSIVE_METHODS = [
    'Notification.History.Requeue',
    'Notification.Destination.Create',
    'Notification.Destination.Update',
    'Notification.Destination.Delete',
    'Notification.Destination.AddMembers',
    'Notification.Destination.RemoveMembers',
    'Alert.Rule.Create',
    'Alert.Rule.Update',
    'Alert.Rule.Delete',
    'Channel.Create',
    'Channel.Update',
    'Channel.Delete',
    'Channel.Test',
    'User.CreateScopedPAT',
    'User.RotateToken',
    'Location.SearchPlaces',
    'Location.ReverseGeocode',
    'Location.BackfillGeo',
    'Location.BackfillGeography',
    // Fans out to up to 500 device round-trips per call — keep it off the
    // general pool so it can't be used to amplify load.
    'Firmware.CheckForUpdateBulk'
] as const;

function readNodeRedCookieSameSite(): 'strict' | 'lax' | 'none' {
    const raw = envStr('FM_NODE_RED_SESSION_COOKIE_SAMESITE', 'strict')
        .trim()
        .toLowerCase();
    if (raw === 'strict' || raw === 'lax' || raw === 'none') return raw;
    return 'strict';
}

// SSOT for the ingress enforcement enum. record_only is the safe default;
// enforce_new grandfathers already-approved devices; enforce_all admits no one
// without a live credential.
const DEVICE_INGRESS_ENFORCEMENT_MODES = [
    'record_only',
    'enforce_new',
    'enforce_all'
] as const;

type DeviceIngressEnforcementMode =
    (typeof DEVICE_INGRESS_ENFORCEMENT_MODES)[number];

// Fail loud on an explicitly-set unrecognized value: silently falling back to
// record_only would disable device mTLS ingress enforcement — a security
// control — without any signal. Unset/empty still resolves to the documented
// default via envStr.
export function readDeviceIngressEnforcementMode(): DeviceIngressEnforcementMode {
    const raw = envStr('FM_DEVICE_INGRESS_ENFORCEMENT_MODE', 'record_only')
        .trim()
        .toLowerCase();
    if ((DEVICE_INGRESS_ENFORCEMENT_MODES as readonly string[]).includes(raw)) {
        return raw as DeviceIngressEnforcementMode;
    }
    throw new Error(
        `FM_DEVICE_INGRESS_ENFORCEMENT_MODE (${raw}) must be one of: ${DEVICE_INGRESS_ENFORCEMENT_MODES.join(', ')}`
    );
}

// The transport is observed per socket now; the old global label is ignored.
export function deviceIngressTransportSettingIgnored(): boolean {
    // Plain process.env: this is not a knob, only a leftover to warn about.
    return (process.env.FM_DEVICE_INGRESS_SHELLY_WS_TRANSPORT ?? '').length > 0;
}

export function readDeviceIngressTrustedProxyCidrs(): string[] {
    return [...envCsv('FM_DEVICE_INGRESS_TRUSTED_PROXY_CIDRS', [])];
}

function nodeRedProxySecretRequired(): boolean {
    return (
        envBool('FM_NODE_RED_ENABLED', false) &&
        envStr('NODE_ENV', '') === 'production' &&
        envStr('NODE_TEST_CONTEXT', '').length === 0
    );
}

function deviceIngressTokenPepperRequired(): boolean {
    return (
        envBool('FM_DEVICE_INGRESS_ENABLED', true) &&
        envStr('NODE_ENV', '') === 'production' &&
        envStr('NODE_TEST_CONTEXT', '').length === 0
    );
}

export function readRedisDisabledFlag(): boolean {
    return (
        envBool('FM_REDIS_DISABLED', false) ||
        envBool('FM_STREAMS_KILL_SWITCH', false)
    );
}

// Exported so a test can read the shape under a different environment; the
// module-level `tuning` below is frozen at first load.
export function readTuning(): TuningConfig {
    // Read once so concurrency and the pool sized from it never disagree.
    // FM_DB_CONNECTIONS is the entire budget for this instance, because the
    // number of connections is the only thing PostgreSQL counts. It used to
    // take two knobs to say that: FM_DB_POOL_MAX sized one pool but bought two,
    // and FM_OUTBOX_CONCURRENCY was a connection count wearing another name,
    // since an outbox worker holds its connection for the whole task. A tenant
    // asking for 3 spent 10, and on a shared host that surprise multiplies by
    // tenant count.
    //
    // It is a ceiling, not a throughput dial. Past roughly (cores * 2), more
    // connections make PostgreSQL slower rather than faster: each one is a
    // backend process competing for locks and buffers. A tenant that needs more
    // work done wants a pooler in front, not a bigger number here.
    //
    // The outbox is sized by what it needs: headroom for graphile's cron and
    // reclaim plus its workers. Stored procedures and plain SQL share one pool
    // with the rest, so background work can use any free connection but the
    // foreground reserve. The outbox keeps the odd connection the old two
    // equal halves left over, so delivery concurrency is unchanged: 37 gives
    // 30 + 7, and 10 gives 6 + 4.
    const connectionBudget = envInt(
        'FM_DB_CONNECTIONS',
        DEFAULT_DB_CONNECTIONS,
        MIN_DB_CONNECTIONS
    );
    const outboxTarget = Math.min(
        OUTBOX_POOL_MAX_SHARE,
        Math.max(
            OUTBOX_POOL_HEADROOM + 1,
            Math.round(connectionBudget * OUTBOX_SHARE)
        )
    );
    const outboxPoolMax =
        outboxTarget + ((connectionBudget - outboxTarget) % 2);
    const sharedPoolMax = connectionBudget - outboxPoolMax;
    const outboxConcurrency = outboxPoolMax - OUTBOX_POOL_HEADROOM;
    // These knobs are for turning fan-out DOWN. A value above the pool is not a
    // larger setting, it is the same throughput plus a queue, so refuse it out
    // loud instead of quietly capping and leaving the operator's number a lie.
    const sharedPoolBound = (name: string, preferred: number): number => {
        const chosen = envInt(name, Math.min(preferred, sharedPoolMax), 1);
        if (chosen > sharedPoolMax) {
            throw new Error(
                `${name}=${chosen} exceeds the shared pool of ${sharedPoolMax} ` +
                    `derived from FM_DB_CONNECTIONS=${connectionBudget}. Each of ` +
                    'these workers holds a pool connection for its whole task, ' +
                    'so the surplus can only wait on the pool. Set ' +
                    `${name} to ${sharedPoolMax} or lower, or raise the budget.`
            );
        }
        return chosen;
    };
    return {
        alert: {
            dispatchConcurrency: sharedPoolBound(
                'FM_ALERT_DISPATCH_CONCURRENCY',
                8
            ),
            groupFlushTimeoutMs: envInt(
                'FM_GROUP_FLUSH_TIMEOUT_MS',
                30_000,
                1000
            ),
            sweepIntervalSec: envInt('FM_ALERT_SWEEP_INTERVAL_SEC', 30, 5),
            systemHealthSweepMs: envInt('FM_SYSTEM_HEALTH_SWEEP_MS', 60_000, 0),
            systemHealthRejectedBlocksMin: envInt(
                'FM_SYSTEM_HEALTH_REJECTED_BLOCKS_MIN',
                1,
                1
            ),
            sweepEnabled: envBool('FM_ALERT_SWEEP_ENABLED', true),
            // Bounds how long a missed peer signal can leave alert state wrong.
            stateRecheckMinMs: envInt(
                'FM_ALERT_STATE_RECHECK_MIN_MS',
                300_000,
                10_000
            ),
            stateRecheckSpreadMs: envInt(
                'FM_ALERT_STATE_RECHECK_SPREAD_MS',
                600_000,
                0
            ),
            sweepEvalDelaySec: envInt('FM_ALERT_SWEEP_EVAL_DELAY_SEC', 15, 0),
            sweepBatchSize: envInt('FM_ALERT_SWEEP_BATCH_SIZE', 200, 1),
            sweepConcurrency: sharedPoolBound('FM_ALERT_SWEEP_CONCURRENCY', 12),
            sweepMaxDurationMs: envInt(
                'FM_ALERT_SWEEP_MAX_DURATION_MS',
                25_000,
                1_000
            ),
            fireBatchMaxRows: envInt('FM_ALERT_FIRE_BATCH_MAX_ROWS', 200, 1),
            fireBatchTickMs: envInt('FM_ALERT_FIRE_BATCH_TICK_MS', 200, 0),
            rulesCacheMax: envInt('FM_ALERT_RULES_CACHE_MAX', 1_000, 10),
            rulesCacheTtlMs: envInt(
                'FM_ALERT_RULES_CACHE_TTL_MS',
                3_600_000,
                60_000
            ),
            recipientsCacheMax: envInt(
                'FM_ALERT_RECIPIENTS_CACHE_MAX',
                5_000,
                10
            ),
            recipientsCacheTtlMs: envInt(
                'FM_ALERT_RECIPIENTS_CACHE_TTL_MS',
                30_000,
                1_000
            ),
            subjectCacheMax: envInt('FM_ALERT_SUBJECT_CACHE_MAX', 10_000, 100),
            subjectCacheTtlMs: envInt(
                'FM_ALERT_SUBJECT_CACHE_TTL_MS',
                60_000,
                1_000
            ),
            groupWaitSec: envInt('FM_ALERT_GROUP_WAIT_SEC', 60, 1),
            // Severities whose first notification skips the group wait.
            // Repeats keep groupIntervalSec so a flapping alert cannot spam.
            immediateSeverities: envCsv('FM_ALERT_IMMEDIATE_SEVERITIES', [
                'critical'
            ]),
            groupIntervalSec: envInt('FM_ALERT_GROUP_INTERVAL_SEC', 300, 60),
            repeatIntervalSec: envInt(
                'FM_ALERT_REPEAT_INTERVAL_SEC',
                14_400,
                300
            ),
            groupBy: envCsv('FM_ALERT_GROUP_BY', [
                'organization_id',
                'rule_id',
                'severity'
            ]),
            groupMaxMembers: envInt('FM_ALERT_GROUP_MAX_MEMBERS', 1000, 10),
            stormSummaryThreshold: envInt(
                'FM_ALERT_STORM_SUMMARY_THRESHOLD',
                25,
                2
            )
        },
        // Live getters: hot-readable so ops can flip a limit mid-process
        // (incident response). Parsing/default still live here.
        mcp: {
            get allowedClients() {
                return envStr('FM_MCP_ALLOWED_CLIENTS', '');
            },
            // Sized against the per-user RPC budget every MCP call also
            // spends (rateLimitGeneralRpm 600 / rateLimitExpensiveRpm 30):
            // a lower MCP ceiling would throttle an agent harder than a plain
            // script doing identical work, and a higher one would never bind.
            get readsPerMin() {
                return envInt('FM_MCP_READS_PER_MIN', 600);
            },
            get writesPerMin() {
                return envInt('FM_MCP_WRITES_PER_MIN', 60);
            },
            get readMaxRows() {
                return envInt('FM_MCP_READ_MAX_ROWS', 200);
            },
            get readMaxBytes() {
                return envInt('FM_MCP_READ_MAX_BYTES', 256 * 1024);
            },
            // How long the server waits for a human to answer an elicitation
            // before treating it as cancelled (never as approved).
            get toolTimeoutSec() {
                return envInt('FM_MCP_TOOL_TIMEOUT_SEC', 90, 5);
            },
            get elicitTimeoutSec() {
                return envInt('FM_MCP_ELICIT_TIMEOUT_SEC', 120, 5);
            },
            // Sessions exist only to correlate elicitation answers, so they are
            // short-lived and capped.
            get sessionTtlMin() {
                return envInt('FM_MCP_SESSION_TTL_MIN', 60, 1);
            },
            get maxSessions() {
                return envInt('FM_MCP_MAX_SESSIONS', 500, 1);
            },
            // A remembered "yes" for one method on one subject. Short by
            // design: standing approvals skip the prompt, never the policy.
            get standingApprovalTtlMin() {
                return envInt('FM_MCP_STANDING_APPROVAL_TTL_MIN', 60, 1);
            },
            get maxStandingApprovals() {
                return envInt('FM_MCP_MAX_STANDING_APPROVALS', 1000, 1);
            },
            // An identity provider outage answers 503 with this hint, so MCP
            // clients retry instead of starting a new sign-in.
            get authRetryAfterSec() {
                return envInt('FM_MCP_AUTH_RETRY_AFTER_SEC', 5, 1);
            },
            // Incident switch: writes hidden and refused for every key at once.
            get readOnly() {
                return envBool('FM_MCP_READ_ONLY', false);
            },
            // Bounds hardware load from agents; per-device pending RPCs cap below it.
            get deviceReadsInFlight() {
                return envIntRange(
                    'FM_MCP_DEVICE_READS_IN_FLIGHT',
                    16,
                    1,
                    1000
                );
            },
            get deviceWritesInFlight() {
                return envIntRange(
                    'FM_MCP_DEVICE_WRITES_IN_FLIGHT',
                    4,
                    1,
                    1000
                );
            },
            // Above the device RPC timeout, so only a lost release waits it out.
            get deviceCommandSlotTtlSec() {
                return envIntRange(
                    'FM_MCP_DEVICE_COMMAND_SLOT_TTL_SEC',
                    300,
                    30,
                    3600
                );
            }
        },
        audit: {
            persistedErrorMessageMaxChars: envInt(
                'FM_PERSISTED_ERROR_MESSAGE_MAX_CHARS',
                2048,
                64
            ),
            overflowStreamKey: envStr(
                'FM_AUDIT_OVERFLOW_STREAM_KEY',
                'fm:audit:overflow'
            ),
            overflowMaxlen: envInt('FM_AUDIT_OVERFLOW_MAXLEN', 100_000, 100),
            overflowSaturationCheckMs: envInt(
                'FM_AUDIT_OVERFLOW_SATURATION_CHECK_MS',
                5_000,
                0
            ),
            overflowTtlMs: envInt(
                'FM_AUDIT_OVERFLOW_TTL_MS',
                86_400_000,
                60_000
            ),
            drainerBatchSize: envInt('FM_AUDIT_DRAINER_BATCH_SIZE', 100, 1),
            drainerBlockMs: envInt('FM_AUDIT_DRAINER_BLOCK_MS', 1_000, 50),
            drainerRetryMs: envInt('FM_AUDIT_DRAINER_RETRY_MS', 5_000, 100),
            drainerPoisonDeliveries: envInt(
                'FM_AUDIT_DRAINER_POISON_DELIVERIES',
                10,
                2
            ),
            flushIntervalMs: envInt('FM_AUDIT_FLUSH_INTERVAL_MS', 2_000, 100),
            queueMax: envInt('FM_AUDIT_QUEUE_MAX', 100, 10),
            maxRetries: envInt('FM_AUDIT_MAX_RETRIES', 3, 1),
            maxParamsChars: envInt('FM_AUDIT_MAX_PARAMS_CHARS', 10_000, 100),
            exportsCleanupIntervalMs: envInt(
                'FM_AUDIT_EXPORTS_CLEANUP_INTERVAL_MS',
                300_000,
                10_000
            ),
            exportTtlMs: envInt(
                'FM_AUDIT_EXPORT_TTL_MS',
                60 * 60 * 1000,
                60_000
            ),
            exportBatchSize: envInt('FM_AUDIT_EXPORT_BATCH_SIZE', 5_000, 100),
            exportMaxRows: envInt('FM_AUDIT_EXPORT_MAX_ROWS', 100_000, 1_000),
            queueHardMax: envInt('FM_AUDIT_QUEUE_HARD_MAX', 10_000, 100)
        },
        auditRetention: {
            sweepIntervalMs: envInt(
                'FM_AUDIT_RETENTION_SWEEP_INTERVAL_MS',
                86_400_000,
                60_000
            )
        },
        baseline: {
            enabled: envBool('FM_BASELINE_ENABLED', true),
            intervalMs: envInt('FM_BASELINE_INTERVAL_MS', 3_600_000, 60_000),
            windowDays: envIntRange('FM_BASELINE_WINDOW_DAYS', 56, 14, 180),
            minWeeks: envIntRange('FM_BASELINE_MIN_WEEKS', 3, 2, 26),
            graduateWeeks: envIntRange('FM_BASELINE_GRADUATE_WEEKS', 8, 1, 53),
            weekendDows: envIntCsv('FM_BASELINE_WEEKEND_DOWS', [0, 6], 0),
            runFromHour: envIntRange('FM_BASELINE_RUN_FROM_HOUR', 1, 0, 23),
            runToHour: envIntRange('FM_BASELINE_RUN_TO_HOUR', 5, 1, 24),
            deviceBatchSize: envInt('FM_BASELINE_DEVICE_BATCH', 200, 10),
            maxTickDurationMs: envInt(
                'FM_BASELINE_MAX_TICK_MS',
                600_000,
                60_000
            ),
            minRecomputeIntervalMs: envInt(
                'FM_BASELINE_MIN_RECOMPUTE_MS',
                20 * 3_600_000,
                3_600_000
            ),
            residualDays: envIntRange('FM_BASELINE_RESIDUAL_DAYS', 2, 1, 14),
            cusumK: envFloat('FM_BASELINE_CUSUM_K', 0.5, 0.1, 3),
            cusumH: envFloat('FM_BASELINE_CUSUM_H', 5, 2, 20),
            minResidualDays: envIntRange(
                'FM_BASELINE_MIN_RESIDUAL_DAYS',
                7,
                3,
                60
            )
        },
        deviceEvents: {
            redisFirst: envBool('FM_DEVICE_EVENTS_REDIS_FIRST', false),
            redisShadow: envBool('FM_DEVICE_EVENTS_REDIS_SHADOW', false),
            streamKey: envStr('FM_DEVICE_EVENTS_STREAM_KEY', 'fm:device-event'),
            streamMaxlen: envInt(
                'FM_DEVICE_EVENTS_STREAM_MAXLEN',
                100_000,
                100
            ),
            streamTtlMs: envInt(
                'FM_DEVICE_EVENTS_STREAM_TTL_MS',
                86_400_000,
                60_000
            ),
            streamSaturationCheckMs: envInt(
                'FM_DEVICE_EVENTS_STREAM_SATURATION_CHECK_MS',
                5_000,
                0
            ),
            drainerBatchSize: envInt(
                'FM_DEVICE_EVENTS_DRAINER_BATCH_SIZE',
                100,
                1
            ),
            drainerBatchWindowMs: envInt(
                'FM_DEVICE_EVENTS_DRAINER_BATCH_WINDOW_MS',
                250,
                0
            ),
            drainerMaxRowsPerCall: envInt(
                'FM_DEVICE_EVENTS_DRAINER_MAX_ROWS_PER_CALL',
                5_000,
                100
            ),
            drainerBlockMs: envInt(
                'FM_DEVICE_EVENTS_DRAINER_BLOCK_MS',
                1_000,
                50
            ),
            drainerRetryMs: envInt(
                'FM_DEVICE_EVENTS_DRAINER_RETRY_MS',
                5_000,
                100
            ),
            drainerPoisonDeliveries: envInt(
                'FM_DEVICE_EVENTS_DRAINER_POISON_DELIVERIES',
                10,
                2
            ),
            flushIntervalMs: envInt(
                'FM_DEVICE_EVENTS_FLUSH_INTERVAL_MS',
                2_000,
                100
            ),
            queueMax: envInt('FM_DEVICE_EVENTS_QUEUE_MAX', 500, 10),
            queueHardMax: envInt(
                'FM_DEVICE_EVENTS_QUEUE_HARD_MAX',
                50_000,
                1_000
            ),
            maxRetries: envInt('FM_DEVICE_EVENTS_MAX_RETRIES', 3, 1)
        },
        virtualCapture: {
            rollup: envBool('FM_VIRTUAL_CAPTURE_ROLLUP', true)
        },
        sensorCapture: {
            redisFirst: envBool('FM_SENSOR_CAPTURE_REDIS_FIRST', false),
            streamKey: envStr(
                'FM_SENSOR_CAPTURE_STREAM_KEY',
                'fm:sensor-capture'
            ),
            streamMaxlen: envInt(
                'FM_SENSOR_CAPTURE_STREAM_MAXLEN',
                500_000,
                100
            ),
            streamTtlMs: envInt(
                'FM_SENSOR_CAPTURE_STREAM_TTL_MS',
                86_400_000,
                60_000
            ),
            streamSaturationCheckMs: envInt(
                'FM_SENSOR_CAPTURE_STREAM_SATURATION_CHECK_MS',
                5_000,
                0
            ),
            drainerBatchSize: envInt(
                'FM_SENSOR_CAPTURE_DRAINER_BATCH_SIZE',
                500,
                1
            ),
            drainerBlockMs: envInt(
                'FM_SENSOR_CAPTURE_DRAINER_BLOCK_MS',
                1_000,
                50
            ),
            drainerRetryMs: envInt(
                'FM_SENSOR_CAPTURE_DRAINER_RETRY_MS',
                5_000,
                100
            ),
            drainerPoisonDeliveries: envInt(
                'FM_SENSOR_CAPTURE_DRAINER_POISON_DELIVERIES',
                10,
                2
            )
        },
        backup: {
            nameMaxLength: envInt('FM_BACKUP_NAME_MAX_LENGTH', 200, 1),
            restoreChunkMaxRetries: envInt(
                'FM_BACKUP_RESTORE_CHUNK_MAX_RETRIES',
                3,
                1
            ),
            restoreMaxRestarts: envInt('FM_BACKUP_RESTORE_MAX_RESTARTS', 3, 0),
            restoreChunkTimeoutMs: envInt(
                'FM_BACKUP_RESTORE_CHUNK_TIMEOUT_MS',
                30_000,
                1_000
            ),
            restoreRetryDelayMs: envInt(
                'FM_BACKUP_RESTORE_RETRY_DELAY_MS',
                5_000,
                100
            ),
            importMaxBytes: envInt(
                'FM_BACKUP_IMPORT_MAX_BYTES',
                50 * 1024 * 1024,
                1024
            )
        },
        bthome: {
            pairKeyTimeoutMs: envInt(
                'FM_BTHOME_PAIR_KEY_TIMEOUT_MS',
                5_000,
                1_000
            ),
            pairKeyPollMs: envInt('FM_BTHOME_PAIR_KEY_POLL_MS', 250, 50),
            pairBroadcastTimeoutMs: envInt(
                'FM_BTHOME_PAIR_BROADCAST_TIMEOUT_MS',
                20_000,
                5_000
            ),
            pairBroadcastPollMs: envInt(
                'FM_BTHOME_PAIR_BROADCAST_POLL_MS',
                500,
                100
            ),
            discoveryCacheMax: envInt('FM_BTHOME_DISCOVERY_CACHE_MAX', 256, 1),
            discoveryDurationSec: envInt(
                'FM_BTHOME_DISCOVERY_DURATION_SEC',
                30,
                1
            ),
            discoveryTtlSec: envInt('FM_BTHOME_DISCOVERY_TTL_SEC', 900, 60)
        },
        controlPlaneContract: {
            exportSanitizedManifest: envBool(
                'FM_CONTRACT_EXPORT_SANITIZED_MANIFEST',
                false
            ),
            deviceUsageApi: envBool('FM_CONTRACT_DEVICE_USAGE_API', false),
            deployManifestPath: envStr(
                'FM_DEPLOY_MANIFEST_PATH',
                'deploy/state/manifest.json'
            ),
            contractSummaryPath: envStr(
                'FM_CONTRACT_SUMMARY_PATH',
                'report/ci/fleet-manager-contract-summary.json'
            ),
            environmentId: envStr(
                'FM_ENVIRONMENT_ID',
                envStr('ENV_NAME', 'unknown')
            )
        },
        dashboard: {
            dashboardName: envStr(
                'FM_DEFAULT_DASHBOARD_NAME',
                'Default Dashboard'
            ),
            dashboardType: envStr('FM_DEFAULT_DASHBOARD_TYPE', 'classic'),
            maxItems: envInt('FM_DASHBOARD_MAX_ITEMS', 200, 1),
            maxTemplatesPerOrg: envInt(
                'FM_DASHBOARD_MAX_TEMPLATES_PER_ORG',
                100,
                1
            ),
            maxPinsPerUser: envInt('FM_DASHBOARD_MAX_PINS_PER_USER', 50, 1),
            grafanaSchemaVersionFloor: envInt(
                'FM_DASHBOARD_GRAFANA_SCHEMA_VERSION_FLOOR',
                39,
                1
            ),
            grafanaSchemaVersionWrite: envInt(
                'FM_DASHBOARD_GRAFANA_SCHEMA_VERSION_WRITE',
                39,
                1
            ),
            persistDebounceMs: envInt('FM_PERSIST_DEBOUNCE_MS', 5_000, 500),
            // Snapshot saves for changes that only move measured numbers.
            persistRoutineDebounceMs: envInt(
                'FM_PERSIST_ROUTINE_DEBOUNCE_MS',
                60_000,
                500
            )
        },
        db: {
            poolMax: sharedPoolMax,
            outboxPoolMax,
            foregroundReserve: readDbForegroundReserve(sharedPoolMax),
            connectionTimeoutMs: envInt(
                'FM_DB_CONNECT_TIMEOUT_MS',
                7_000,
                1_000
            ),
            // Reopening a connection every 10-15 s idle costs a backend fork
            // and auth; HikariCP and PgBouncer keep idle connections 600 s.
            idleTimeoutMs: envInt('FM_DB_IDLE_TIMEOUT_MS', 60_000, 1_000),
            poolMin: Math.min(envInt('FM_DB_POOL_MIN', 2, 0), sharedPoolMax),
            maxLifetimeSeconds: envInt('FM_DB_POOL_MAX_LIFETIME_S', 1_800, 0),
            // Ceilings, not reservations: free connections still serve others.
            workloadCaps: {
                alert: sharedPoolBound('FM_DB_ALERT_MAX_CONNECTIONS', 2),
                energy: sharedPoolBound(
                    'FM_DB_ENERGY_WRITE_MAX_CONNECTIONS',
                    1
                ),
                'em-sync': sharedPoolBound('FM_DB_EMSYNC_MAX_CONNECTIONS', 1),
                rollup: sharedPoolBound('FM_DB_ROLLUP_MAX_CONNECTIONS', 1)
            },
            entityListPageMax: envInt('FM_ENTITY_LIST_DB_PAGE_MAX', 500, 10),
            // Node sets NODE_TEST_CONTEXT under `node --test`; the value
            // varies ("child"|"parent"|...) so presence alone is the signal.
            underNodeTest: envStr('NODE_TEST_CONTEXT', '').length > 0
        },
        delivery: {
            integrationTestTimeoutMs: envInt(
                'FM_INTEGRATION_TEST_TIMEOUT_MS',
                30_000,
                500
            ),
            pushReclaimIntervalMs: envInt(
                'FM_PUSH_RECLAIM_INTERVAL_MS',
                300_000,
                5_000
            ),
            outboxConcurrency,
            outboxMaxAttempts: envInt('FM_OUTBOX_MAX_ATTEMPTS', 6),
            outboxReclaimIntervalMinutes: envInt(
                'FM_OUTBOX_RECLAIM_INTERVAL_MIN',
                5,
                1
            ),
            digestFlushIntervalMinutes: envInt(
                'FM_NOTIFICATION_DIGEST_FLUSH_INTERVAL_MIN',
                15,
                1
            ),
            digestDefaultDelayMinutes: envInt(
                'FM_NOTIFICATION_DIGEST_DEFAULT_DELAY_MIN',
                60,
                1
            ),
            rateOrgRpm: envInt('FM_DELIVERY_RATE_ORG_RPM', 6_000, 0),
            rateEndpointRpm: envInt('FM_DELIVERY_RATE_ENDPOINT_RPM', 600, 0),
            rateProviderRpm: {
                emailSmtp: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_EMAIL_SMTP_RPM',
                    6_000,
                    0
                ),
                genericWebhook: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_GENERIC_WEBHOOK_RPM',
                    600,
                    0
                ),
                slackWebhook: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_SLACK_WEBHOOK_RPM',
                    60,
                    0
                ),
                teamsWorkflowWebhook: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_TEAMS_WORKFLOW_WEBHOOK_RPM',
                    60,
                    0
                ),
                telegramBot: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_TELEGRAM_BOT_RPM',
                    30,
                    0
                ),
                pushFcm: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_PUSH_FCM_RPM',
                    600,
                    0
                ),
                smsTwilio: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_SMS_TWILIO_RPM',
                    60,
                    0
                ),
                voiceTwilio: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_VOICE_TWILIO_RPM',
                    20,
                    0
                ),
                webhookSigned: envInt(
                    'FM_DELIVERY_RATE_PROVIDER_WEBHOOK_SIGNED_RPM',
                    600,
                    0
                )
            },
            rateRecipientRpm: envInt('FM_DELIVERY_RATE_RECIPIENT_RPM', 60, 0),
            outboxRecordReconcileMaxAttempts: envInt(
                'FM_OUTBOX_RECORD_RECONCILE_MAX_ATTEMPTS',
                10,
                1
            ),
            rateRetryAfterSec: envInt(
                'FM_DELIVERY_RATE_RETRY_AFTER_SEC',
                60,
                1
            ),
            retryJitterMs: envInt('FM_DELIVERY_RETRY_JITTER_MS', 2_000, 0),
            metricsPollMs: envInt('FM_DELIVERY_METRICS_POLL_MS', 30_000, 1_000),
            outboxReclaimStaleMs: envInt(
                'FM_OUTBOX_RECLAIM_STALE_MS',
                30 * 60_000,
                30_000
            ),
            // Upper bounds keep both inside the stored procedure's INTEGER ms.
            outboxUnflushedStaleMs: envIntRange(
                'FM_OUTBOX_UNFLUSHED_STALE_MS',
                10 * 60_000,
                60_000,
                24 * 60 * 60_000
            ),
            outboxUnflushedMaxAgeMs: envIntRange(
                'FM_OUTBOX_UNFLUSHED_MAX_AGE_MS',
                24 * 60 * 60_000,
                60_000,
                7 * 24 * 60 * 60_000
            ),
            endpointAutoOffThreshold: envInt(
                'FM_ENDPOINT_AUTOOFF_THRESHOLD',
                10,
                1
            ),
            outboxSecretsCacheMax: envInt(
                'FM_OUTBOX_SECRETS_CACHE_MAX',
                1_000,
                10
            ),
            outboxSecretsCacheTtlMs: envInt(
                'FM_OUTBOX_SECRETS_CACHE_TTL_MS',
                300_000,
                1_000
            ),
            outboxRecordAttemptRetries: envInt(
                'FM_OUTBOX_RECORD_ATTEMPT_RETRIES',
                3,
                0
            ),
            outboxRecordAttemptBackoffMs: envInt(
                'FM_OUTBOX_RECORD_ATTEMPT_BACKOFF_MS',
                100,
                10
            ),
            outboxRecordAttemptBackoffCapMs: envInt(
                'FM_OUTBOX_RECORD_ATTEMPT_BACKOFF_CAP_MS',
                30_000,
                100
            )
        },
        device: {
            rateEwmaAlpha: envFloat('FM_DEVICE_RATE_EWMA_ALPHA', 0.3, 0, 1),
            rateAnomalyHz: envInt('FM_DEVICE_RATE_ANOMALY_HZ', 10, 1),
            rateRecoveryHz: envInt('FM_DEVICE_RATE_RECOVERY_HZ', 2, 0),
            rateTrackedMax: envInt('FM_DEVICE_RATE_TRACKED_MAX', 20_000, 100),
            rateInstantCapHz: envInt('FM_DEVICE_RATE_INSTANT_CAP_HZ', 100, 1),
            initQueueMax: envInt('FM_DEVICE_INIT_QUEUE_MAX', 1_000, 10),
            initQueueHighWaterPct: envIntRange(
                'FM_DEVICE_INIT_QUEUE_HIGH_WATER_PCT',
                70,
                1,
                100
            ),
            initQueueMaxWaitMs: envInt(
                'FM_DEVICE_INIT_QUEUE_MAX_WAIT_MS',
                30_000,
                1_000
            ),
            initSlotMaxHoldMs: envInt(
                'FM_DEVICE_INIT_SLOT_MAX_HOLD_MS',
                90_000,
                1_000
            ),
            initSlotWatchdogIntervalMs: envInt(
                'FM_DEVICE_INIT_SLOT_WATCHDOG_INTERVAL_MS',
                10_000,
                1_000
            ),
            loadReconcileMs: envInt('FM_DEVICE_LOAD_RECONCILE_MS', 300_000, 0),
            buildSlowLogMs: envInt('FM_DEVICE_BUILD_SLOW_LOG_MS', 3_000, 0),
            buildSlowLogIntervalMs: envInt(
                'FM_DEVICE_BUILD_SLOW_LOG_INTERVAL_MS',
                2_000,
                0
            ),
            commandSlowLogMs: envInt('FM_DEVICE_COMMAND_SLOW_LOG_MS', 1_000, 0),
            commandSlowLogIntervalMs: envInt(
                'FM_DEVICE_COMMAND_SLOW_LOG_INTERVAL_MS',
                2_000,
                0
            ),
            commandRingSize: envInt('FM_DEVICE_COMMAND_RING_SIZE', 200, 1),
            initFailureCooldownLadderMs: envIntCsv(
                'FM_DEVICE_INIT_FAILURE_COOLDOWN_LADDER_MS',
                [30_000, 60_000, 120_000, 300_000],
                1_000
            ),
            initFailureStableMs: envInt(
                'FM_DEVICE_INIT_FAILURE_STABLE_MS',
                300_000,
                1_000
            ),
            initFailureTrackerMaxKeys: envInt(
                'FM_DEVICE_INIT_FAILURE_TRACKER_MAX_KEYS',
                10_000,
                100
            ),
            cacheTtlMs: envInt('FM_DEVICE_CACHE_TTL_MS', 5_000, 100),
            probeTimeoutMs: envInt('FM_DEVICE_PROBE_TIMEOUT_MS', 5_000, 500),
            cameraSnapshotTimeoutMs: envInt(
                'FM_DEVICE_CAMERA_SNAPSHOT_TIMEOUT_MS',
                8_000,
                500
            ),
            groupsCacheMax: envInt('FM_DEVICE_GROUPS_CACHE_MAX', 10_000, 100),
            listDbPageMax: envInt('FM_DEVICE_LIST_DB_PAGE_MAX', 500, 10),
            relationshipQueryDefaultLimit: envInt(
                'FM_DEVICE_RELATIONSHIP_QUERY_DEFAULT_LIMIT',
                25,
                1
            ),
            relationshipQueryMaxLimit: envInt(
                'FM_DEVICE_RELATIONSHIP_QUERY_MAX_LIMIT',
                50,
                1
            ),
            relationshipDepthTwoMaxExpansions: envInt(
                'FM_DEVICE_RELATIONSHIP_DEPTH_TWO_MAX_EXPANSIONS',
                25,
                1
            ),
            relationshipDeviceSideFamilyLimit: envInt(
                'FM_DEVICE_RELATIONSHIP_DEVICE_SIDE_FAMILY_LIMIT',
                50,
                1
            ),
            eventReplayMaxRows: envInt(
                'FM_LOCATION_EVENT_REPLAY_MAX_ROWS',
                50_000,
                100
            ),
            eventReplayCacheHistoricalSec: envInt(
                'FM_LOCATION_EVENT_REPLAY_CACHE_HISTORICAL_SEC',
                24 * 3600,
                0
            ),
            eventReplayCacheRollingSec: envInt(
                'FM_LOCATION_EVENT_REPLAY_CACHE_ROLLING_SEC',
                30,
                0
            ),
            eventReplayCacheImmutableLagSec: envInt(
                'FM_LOCATION_EVENT_REPLAY_CACHE_IMMUTABLE_LAG_SEC',
                60,
                10
            ),
            eventReplayCacheKeyPrefix: envStr(
                'FM_LOCATION_EVENT_REPLAY_CACHE_KEY_PREFIX',
                'fm:eventreplay:v1'
            ),
            filteredCacheMaxEntries: envInt(
                'FM_DEVICE_FILTERED_CACHE_MAX_ENTRIES',
                200,
                10
            ),
            callManyMaxDevices: envInt(
                'FM_DEVICE_CALL_MANY_MAX_DEVICES',
                50,
                1
            ),
            callMaxParamsBytes: envInt(
                'FM_DEVICE_CALL_MAX_PARAMS_BYTES',
                64 * 1024,
                1024
            ),
            callMaxMethodLength: envInt(
                'FM_DEVICE_CALL_MAX_METHOD_LENGTH',
                160,
                16
            ),
            accessCacheMax: envInt('FM_DEVICE_ACCESS_CACHE_MAX', 5_000, 100),
            initsClusterCap: envInt('FM_DEVICE_INITS_CLUSTER_CAP', 0, 0),
            initsClusterTtlSec: envInt('FM_DEVICE_INITS_CLUSTER_TTL_SEC', 60, 1)
        },
        deviceIngress: {
            enabled: envBool('FM_DEVICE_INGRESS_ENABLED', true),
            enforcementMode: readDeviceIngressEnforcementMode(),
            waitingRoomEnabled: envBool(
                'FM_DEVICE_INGRESS_WAITING_ROOM_ENABLED',
                true
            ),
            allowPlainWs: envBool('FM_DEVICE_INGRESS_ALLOW_PLAIN_WS', false),
            allowConnectorChildAutoApproval: envBool(
                'FM_DEVICE_INGRESS_ALLOW_CONNECTOR_CHILD_AUTO_APPROVAL',
                false
            ),
            // Gate-less legacy devices land under this org in the waiting
            // room. Single-tenant modes get a sentinel so knocking devices
            // are visible with zero extra config; shared SaaS keeps them
            // hidden by default (tenant isolation) unless set explicitly.
            defaultOrganizationId: envStr(
                'FM_DEVICE_INGRESS_DEFAULT_ORGANIZATION_ID',
                isSharedSaasDeploymentMode(peekDeploymentMode())
                    ? ''
                    : 'default'
            ),
            publicWsBaseUrl: envStr('FM_DEVICE_INGRESS_PUBLIC_WS_BASE_URL', ''),
            trustedCertFingerprintHeader: envStr(
                'FM_DEVICE_INGRESS_TRUSTED_CERT_FINGERPRINT_HEADER',
                ''
            ),
            trustedCertPemHeader: envStr(
                'FM_DEVICE_INGRESS_TRUSTED_CERT_PEM_HEADER',
                'X-Forwarded-Tls-Client-Cert'
            ),
            trustedProxyCidrs: readDeviceIngressTrustedProxyCidrs(),
            mtlsEnabled: envBool('FM_DEVICE_MTLS', false),
            proxyRequired: envBool('FM_DEVICE_INGRESS_PROXY_REQUIRED', false),
            tokenBytes: envInt('FM_DEVICE_INGRESS_TOKEN_BYTES', 32, 16),
            tokenValidityDays: envInt(
                'FM_DEVICE_INGRESS_TOKEN_VALIDITY_DAYS',
                365,
                1
            ),
            enrollmentMaxValidityMinutes: envInt(
                'FM_DEVICE_INGRESS_ENROLLMENT_MAX_VALIDITY_MINUTES',
                1440,
                1
            ),
            enrollmentMaxUses: envInt(
                'FM_DEVICE_INGRESS_ENROLLMENT_MAX_USES',
                1000,
                1
            ),
            enrollmentMaxActivePerOrg: envInt(
                'FM_DEVICE_INGRESS_ENROLLMENT_MAX_ACTIVE_PER_ORG',
                100,
                1
            ),
            pendingCredentialGraceDays: envInt(
                'FM_DEVICE_INGRESS_PENDING_TOKEN_GRACE_DAYS',
                14,
                1
            ),
            credentialStageConcurrency: sharedPoolBound(
                'FM_DEVICE_INGRESS_CREDENTIAL_STAGE_CONCURRENCY',
                8
            ),
            credentialStageTimeoutMs: envInt(
                'FM_DEVICE_INGRESS_CREDENTIAL_STAGE_TIMEOUT_MS',
                10_000,
                1_000
            ),
            tokenPrefix: envStr('FM_DEVICE_INGRESS_TOKEN_PREFIX', 'fmws'),
            tokenPepperRequired: deviceIngressTokenPepperRequired(),
            listLimit: envInt('FM_DEVICE_INGRESS_LIST_LIMIT', 100, 1),
            maxPayloadBytes: envInt(
                'FM_DEVICE_INGRESS_MAX_PAYLOAD_BYTES',
                262_144,
                1024
            ),
            maxMessagesPerMinute: envInt(
                'FM_DEVICE_INGRESS_MAX_MESSAGES_PER_MINUTE',
                600,
                1
            ),
            maxConnectionsPerIdentity: envInt(
                'FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_IDENTITY',
                5,
                1
            ),
            maxConnectionsPerOrg: envInt(
                'FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_ORG',
                500,
                1
            ),
            // Per-address limits are sized for one site behind one address,
            // not for one device; identity and organization caps bound the rest.
            maxConnectionsPerIp: envInt(
                'FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_IP',
                500,
                1
            ),
            handshakesPerIpPerMinute: envInt(
                'FM_DEVICE_INGRESS_HANDSHAKES_PER_IP_PER_MINUTE',
                600,
                1
            ),
            reconnectIpKeyMax: envInt(
                'FM_DEVICE_INGRESS_RECONNECT_IP_KEY_MAX',
                50_000,
                100
            ),
            reconnectIpWindowMs: envInt(
                'FM_DEVICE_INGRESS_RECONNECT_IP_WINDOW_MS',
                60_000,
                1_000
            ),
            reconnectIpMaxPerWindow: envInt(
                'FM_DEVICE_INGRESS_RECONNECT_IP_MAX_PER_WINDOW',
                1_000,
                1
            ),
            reconnectIpBlockMs: envInt(
                'FM_DEVICE_INGRESS_RECONNECT_IP_BLOCK_MS',
                60_000,
                1_000
            ),
            handshakesPerOrgPerMinute: envInt(
                'FM_DEVICE_INGRESS_HANDSHAKES_PER_ORG_PER_MINUTE',
                300,
                1
            ),
            handshakesPerIdentityPerMinute: envInt(
                'FM_DEVICE_INGRESS_HANDSHAKES_PER_IDENTITY_PER_MINUTE',
                60,
                1
            ),
            mutationsPerActorPerMinute: envInt(
                'FM_DEVICE_INGRESS_MUTATIONS_PER_ACTOR_PER_MINUTE',
                30,
                1
            ),
            waitingRoomRetentionDays: envInt(
                'FM_DEVICE_INGRESS_WAITING_ROOM_RETENTION_DAYS',
                30,
                1
            ),
            rejectionRetentionDays: envInt(
                'FM_DEVICE_INGRESS_REJECTION_RETENTION_DAYS',
                90,
                1
            ),
            connectionHistoryRetentionDays: envInt(
                'FM_DEVICE_INGRESS_CONNECTION_HISTORY_RETENTION_DAYS',
                180,
                1
            ),
            setupSessionRetentionDays: envInt(
                'FM_DEVICE_INGRESS_SETUP_SESSION_RETENTION_DAYS',
                7,
                1
            ),
            waitingRoomSampleMaxBytes: envInt(
                'FM_DEVICE_INGRESS_WAITING_ROOM_SAMPLE_MAX_BYTES',
                4096,
                128
            ),
            rejectionDetailMaxBytes: envInt(
                'FM_DEVICE_INGRESS_REJECTION_DETAIL_MAX_BYTES',
                1024,
                128
            ),
            provisioningSessionTtlMinutes: envInt(
                'FM_DEVICE_INGRESS_PROVISIONING_SESSION_TTL_MINUTES',
                30,
                1
            ),
            provisioningMaxActivePerActor: envInt(
                'FM_DEVICE_INGRESS_PROVISIONING_MAX_ACTIVE_PER_ACTOR',
                20,
                1
            ),
            provisioningMaxBundleFetches: envInt(
                'FM_DEVICE_INGRESS_PROVISIONING_MAX_BUNDLE_FETCHES',
                2,
                1
            ),
            provisioningAllowFmIssuedPrivateKey: envBool(
                'FM_DEVICE_INGRESS_PROVISIONING_ALLOW_FM_ISSUED_PRIVATE_KEY',
                true
            ),
            cleanupIntervalMs: envInt(
                'FM_DEVICE_INGRESS_CLEANUP_INTERVAL_MS',
                900_000,
                60_000
            ),
            trustCacheTtlSec: envInt('FM_DEVICE_TRUST_CACHE_TTL_SEC', 30, 5),
            credentialExpiryWarnDays: envInt(
                'FM_DEVICE_INGRESS_CREDENTIAL_EXPIRY_WARN_DAYS',
                30,
                1
            ),
            rotationEnabled: envBool(
                'FM_DEVICE_INGRESS_ROTATION_ENABLED',
                true
            ),
            rotationPollMs: envInt(
                'FM_DEVICE_INGRESS_ROTATION_POLL_MS',
                5_000,
                1_000
            ),
            rotationInFlight: envInt(
                'FM_DEVICE_INGRESS_ROTATION_IN_FLIGHT',
                5,
                1
            ),
            rotationWaitCapMinutes: envInt(
                'FM_DEVICE_INGRESS_ROTATION_WAIT_CAP_MINUTES',
                10,
                1
            ),
            rotationBatchMax: envInt(
                'FM_DEVICE_INGRESS_ROTATION_BATCH_MAX',
                200,
                1
            ),
            rotationSendTimeoutMs: envInt(
                'FM_DEVICE_INGRESS_ROTATION_SEND_TIMEOUT_MS',
                15_000,
                1_000
            )
        },
        devSimulation: {
            instanceSeed: envStr('FM_CLIENT_ID', 'shared')
        },
        electricityMaps: {
            apiKey: envStr('FM_ELECTRICITY_MAPS_API_KEY', ''),
            url: envStr(
                'FM_ELECTRICITY_MAPS_URL',
                'https://api.electricitymap.org/v3'
            ),
            timeoutMs: envInt('FM_ELECTRICITY_MAPS_TIMEOUT_MS', 5_000, 500),
            zone: envStr('FM_ELECTRICITY_MAPS_ZONE', 'BG')
        },
        energy: {
            idMapCacheTtlMs: envInt(
                'FM_ENERGY_IDMAP_CACHE_TTL_MS',
                60_000,
                1_000
            ),
            idMapCacheMax: envInt('FM_ENERGY_IDMAP_CACHE_MAX', 5_000, 10),
            queryRowLimit: envInt(
                'FM_ENERGY_QUERY_ROW_LIMIT',
                2_000_000,
                10_000
            ),
            queryConcurrency: sharedPoolBound('FM_ENERGY_QUERY_CONCURRENCY', 4),
            touShiftableFraction: envFloat(
                'FM_ENERGY_TOU_SHIFTABLE_FRACTION',
                0.2,
                0,
                1
            ),
            emissionFactorLbmGPerKWh: envFloat(
                'FM_ENERGY_EMISSION_FACTOR_LBM_G_PER_KWH',
                414,
                0,
                5000
            ),
            whatIfSolarKwP: envFloat('FM_ENERGY_WHAT_IF_SOLAR_KWP', 5, 0, 100),
            timeShiftMaxKWh: envFloat(
                'FM_ENERGY_TIMESHIFT_MAX_KWH',
                5,
                0,
                1_000
            ),
            emSyncStreamKey: envStr('FM_EMSYNC_STREAM_KEY', 'fm:emsync:buffer'),
            emSyncStreamMaxlen: envInt('FM_EMSYNC_STREAM_MAXLEN', 2_000_000),
            emSyncStreamMaxBytes: envInt(
                'FM_EMSYNC_STREAM_MAX_BYTES',
                128 * 1024 * 1024,
                1024
            ),
            emSyncCatchupHighWaterPct: envIntRange(
                'FM_EMSYNC_CATCHUP_HIGH_WATER_PCT',
                75,
                10,
                95
            ),
            emSyncPullPauseAgeMs: envInt(
                'FM_EMSYNC_PULL_PAUSE_AGE_MS',
                60_000,
                1_000
            ),
            emSyncPullPagesPerConnection: envIntRange(
                'FM_EMSYNC_PULL_PAGES_PER_CONNECTION',
                2,
                1,
                16
            ),
            emSyncPushBatchMs: envIntRange(
                'FM_EMSYNC_PUSH_BATCH_MS',
                100,
                0,
                1000
            ),
            emSyncPushBatchMaxEntries: envIntRange(
                'FM_EMSYNC_PUSH_BATCH_MAX_ENTRIES',
                500,
                1,
                5000
            ),
            emSyncStreamTtlMs: envInt(
                'FM_EMSYNC_STREAM_TTL_MS',
                7 * 24 * 60 * 60 * 1000
            ),
            emSyncSaturationCheckMs: envInt(
                'FM_EMSYNC_SATURATION_CHECK_MS',
                30_000
            ),
            emSyncDrainerBatchSize: envInt('FM_EMSYNC_DRAINER_BATCH_SIZE', 512),
            emSyncDrainerBlockMs: envInt('FM_EMSYNC_DRAINER_BLOCK_MS', 2000),
            emSyncDrainerRetryMs: envInt('FM_EMSYNC_DRAINER_RETRY_MS', 1000),
            emSyncDrainerMaxRows: envInt('FM_EMSYNC_DRAINER_MAX_ROWS', 5000),
            emSyncDrainerPoisonDeliveries: envInt(
                'FM_EMSYNC_DRAINER_POISON_DELIVERIES',
                5
            ),
            emStatsFlushIntervalMs: envInt(
                'FM_EM_STATS_FLUSH_INTERVAL_MS',
                120_000,
                1_000
            ),
            emStatsRetryMaxRows: envInt(
                'FM_EM_STATS_RETRY_MAX_ROWS',
                500_000,
                1_000
            ),
            emStatsRetryBackoffMaxMs: envInt(
                'FM_EM_STATS_RETRY_BACKOFF_MAX_MS',
                900_000,
                1_000
            ),
            emStatsMaxAgeS: envInt('FM_EM_STATS_MAX_AGE_S', 7_200, 60),
            emStatsOverflowStreamKey: envStr(
                'FM_EM_STATS_OVERFLOW_STREAM_KEY',
                'fm:em-stats:overflow'
            ),
            emStatsOverflowMaxlen: envInt(
                'FM_EM_STATS_OVERFLOW_MAXLEN',
                200_000,
                100
            ),
            emStatsWriteMaxRows: envInt(
                'FM_EM_STATS_WRITE_MAX_ROWS',
                2_000,
                100
            ),
            emSyncHealthIntervalMs: envInt(
                'FM_EMSYNC_HEALTH_INTERVAL_MS',
                30_000
            ),
            rollupBatchSize: envInt('FM_EM_ROLLUP_BATCH_SIZE', 500, 1),
            rollupWorkers: envIntRange(
                'FM_EM_ROLLUP_WORKERS',
                defaultEnergyRollupWorkers(),
                1,
                2
            ),
            rollupPollMs: envInt('FM_EM_ROLLUP_POLL_MS', 250, 25),
            rollupIdlePollMaxMs: envInt(
                'FM_EM_ROLLUP_IDLE_POLL_MAX_MS',
                2_000,
                25
            ),
            rollupHealthIntervalMs: envInt(
                'FM_EM_ROLLUP_HEALTH_INTERVAL_MS',
                30_000,
                1_000
            ),
            rollupReportWaitMs: envInt('FM_EM_ROLLUP_REPORT_WAIT_MS', 5_000, 0),
            rollupReportPollMs: envInt('FM_EM_ROLLUP_REPORT_POLL_MS', 100, 10),
            heldCorrectionDays: envInt('FM_EM_HELD_CORRECTION_DAYS', 7, 1),
            rollupCloseGraceMs: envIntRange(
                'FM_EM_ROLLUP_CLOSE_GRACE_MS',
                180_000,
                0,
                3_600_000
            ),
            rollupLateDebounceMs: envIntRange(
                'FM_EM_ROLLUP_LATE_DEBOUNCE_MS',
                30_000,
                0,
                3_600_000
            ),
            liveDebugHours: envIntRange('FM_EM_LIVE_DEBUG_HOURS', 4, 1, 24),
            catchupDeviceIds: envIntCsv('FM_EMDATA_CATCHUP_DEVICE_IDS', [], 1),
            emSyncCatchupSharePct: envIntRange(
                'FM_EMDATA_CATCHUP_SHARE_PCT',
                25,
                5,
                90
            ),
            emSyncFailBackoffBaseS: envInt(
                'FM_EMDATA_FAIL_BACKOFF_BASE_S',
                2,
                1
            ),
            emSyncFailBackoffMaxS: envInt(
                'FM_EMDATA_FAIL_BACKOFF_MAX_S',
                540,
                1
            )
        },
        firmware: {
            tempCleanupIntervalMs: envInt(
                'FM_FIRMWARE_TEMP_CLEANUP_INTERVAL_MS',
                15 * 60_000,
                60_000
            ),
            verifyTimeoutMs: envInt(
                'FM_FIRMWARE_VERIFY_TIMEOUT_MS',
                120_000,
                30_000
            ),
            verifyPollMs: envInt('FM_FIRMWARE_VERIFY_POLL_MS', 5_000, 1_000),
            vulnerableBuildIds: envCsv('FM_FIRMWARE_VULNERABLE_BUILD_IDS', []),
            autoUpdateMaxDevicesPerJob: envInt(
                'FM_FIRMWARE_AUTO_UPDATE_MAX_DEVICES_PER_JOB',
                50,
                1
            ),
            schedulerFireClaimTtlSec: envInt(
                'FM_FIRMWARE_SCHEDULER_FIRE_CLAIM_TTL_SEC',
                6 * 60 * 60,
                60
            )
        },
        geocoding: {
            nominatimUrl: envStr(
                'FM_NOMINATIM_URL',
                'https://nominatim.openstreetmap.org'
            ),
            nominatimUserAgent: envStr(
                'FM_NOMINATIM_USER_AGENT',
                'FleetManager/devops (no-contact)'
            ),
            nominatimTimeoutMs: envInt('FM_NOMINATIM_TIMEOUT_MS', 5_000, 500),
            nominatimRpsCap: envInt('FM_NOMINATIM_RPS_CAP', 1, 1),
            cachePositiveTtlSec: envInt(
                'FM_GEOCODING_CACHE_TTL_POSITIVE_SEC',
                30 * 24 * 60 * 60,
                60
            ),
            cacheNegativeTtlSec: envInt(
                'FM_GEOCODING_CACHE_TTL_NEGATIVE_SEC',
                24 * 60 * 60,
                60
            )
        },
        grafana: {
            proxyTimeoutMs: envInt(
                'FM_GRAFANA_PROXY_TIMEOUT_MS',
                30_000,
                1_000
            ),
            proxyMaxBytes: envInt(
                'FM_GRAFANA_PROXY_MAX_BYTES',
                50 * 1024 * 1024,
                1_024
            ),
            proxySecret: envStr('FM_GRAFANA_PROXY_SECRET', '').trim(),
            dsMaxOpenConns: envInt('FM_GRAFANA_DS_MAX_OPEN_CONNS', 10, 1),
            dsMaxIdleConns: envInt('FM_GRAFANA_DS_MAX_IDLE_CONNS', 10, 1),
            dsConnLifetimeSec: envInt(
                'FM_GRAFANA_DS_CONN_LIFETIME_SEC',
                14_400,
                60
            ),
            fetchTimeoutMs: envInt(
                'FM_GRAFANA_FETCH_TIMEOUT_MS',
                15_000,
                1_000
            ),
            setupReadyTimeoutMs: envInt(
                'FM_GRAFANA_SETUP_READY_TIMEOUT_MS',
                60_000,
                1_000
            ),
            setupReadyPollMs: envInt(
                'FM_GRAFANA_SETUP_READY_POLL_MS',
                1_000,
                100
            ),
            webhookMaxBytes: envInt(
                'FM_GRAFANA_WEBHOOK_MAX_BYTES',
                1_048_576,
                1_024
            ),
            webhookRateCapacity: envInt(
                'FM_GRAFANA_WEBHOOK_RATE_CAPACITY',
                60,
                1
            ),
            webhookRateRefillPerSec: envInt(
                'FM_GRAFANA_WEBHOOK_RATE_REFILL_PER_SEC',
                1,
                0
            )
        },
        http: {
            rateLimitGeneralRpm: envInt('FM_RATE_LIMIT_GENERAL_RPM', 600, 10),
            rateLimitExpensiveRpm: envInt('FM_RATE_LIMIT_EXPENSIVE_RPM', 30, 5),
            rateLimitBillingRpm: envInt('FM_RATE_LIMIT_BILLING_RPM', 120, 5),
            rateLimitOrgGeneralRpm: envInt(
                'FM_RATE_LIMIT_ORG_GENERAL_RPM',
                6_000,
                10
            ),
            rateLimitOrgExpensiveRpm: envInt(
                'FM_RATE_LIMIT_ORG_EXPENSIVE_RPM',
                300,
                5
            ),
            rateLimitOrgBillingRpm: envInt(
                'FM_RATE_LIMIT_ORG_BILLING_RPM',
                1_200,
                5
            ),
            rateLimitExpensiveMethods: envCsv(
                'FM_RATE_LIMIT_EXPENSIVE_METHODS',
                DEFAULT_RATE_LIMIT_EXPENSIVE_METHODS
            ),
            fmPort: httpPortFromEnv(),
            rateLimitApiSwitchPerMin: envInt(
                'FM_HTTP_RATELIMIT_API_SWITCH_PER_MIN',
                60,
                1
            ),
            rateLimitReportsDownloadPerMin: envInt(
                'FM_HTTP_RATELIMIT_REPORTS_DOWNLOAD_PER_MIN',
                30,
                1
            ),
            rateLimitMediaUploadPerMin: envInt(
                'FM_HTTP_RATELIMIT_MEDIA_UPLOAD_PER_MIN',
                20,
                1
            ),
            rateLimitFirmwareUploadPerMin: envInt(
                'FM_HTTP_RATELIMIT_FIRMWARE_UPLOAD_PER_MIN',
                10,
                1
            ),
            rateLimitDeviceProxyPerMin: envInt(
                'FM_HTTP_RATELIMIT_DEVICE_PROXY_PER_MIN',
                60,
                1
            ),
            rateLimitApiDocsPerMin: envInt(
                'FM_HTTP_RATELIMIT_API_DOCS_PER_MIN',
                30,
                1
            ),
            rateLimitMetricsPerMin: envInt(
                'FM_HTTP_RATELIMIT_METRICS_PER_MIN',
                120,
                1
            ),
            rateLimitScopedTokenPerMin: envInt(
                'FM_HTTP_RATELIMIT_SCOPED_TOKEN_PER_MIN',
                60,
                1
            ),
            rateLimitLoginFlowPerMin: envInt(
                'FM_HTTP_RATELIMIT_LOGIN_FLOW_PER_MIN',
                60,
                1
            ),
            rateLimitAuthSessionPerMin: envInt(
                'FM_HTTP_RATELIMIT_AUTH_SESSION_PER_MIN',
                30,
                1
            ),
            rateLimitFirmwareDownloadPerMin: envInt(
                'FM_HTTP_RATELIMIT_FIRMWARE_DOWNLOAD_PER_MIN',
                60,
                1
            ),
            rateLimitBackupImportPerMin: envInt(
                'FM_HTTP_RATELIMIT_BACKUP_IMPORT_PER_MIN',
                10,
                1
            ),
            compressionEnabled: envBool('FM_HTTP_COMPRESSION_ENABLED', true),
            compressionMinBytes: envInt(
                'FM_HTTP_COMPRESSION_MIN_BYTES',
                1024,
                0
            ),
            compressionLevel: envIntRange('FM_HTTP_COMPRESSION_LEVEL', 1, 1, 9),
            httpSocketTimeoutMs: envInt(
                'FM_HTTP_SOCKET_TIMEOUT_MS',
                120_000,
                1_000
            ),
            // Traefik reuses idle upstream connections for 90 s; Fleet must close later or Traefik answers 502.
            keepAliveTimeoutMs: envInt(
                'FM_HTTP_KEEP_ALIVE_TIMEOUT_MS',
                95_000,
                1_000
            ),
            tcpKeepaliveDelayMs: envInt('FM_TCP_KEEPALIVE_DELAY_MS', 62_000, 0)
        },
        ingest: {
            streamPrefix: envStr(
                'FM_DEVICE_INGEST_STREAM_PREFIX',
                'fm:device:ingest'
            ),
            lanes: envInt('FM_DEVICE_INGEST_LANES', 32, 1),
            maxlen: envInt('FM_DEVICE_INGEST_MAXLEN', 50_000, 100),
            ttlMs: envInt('FM_DEVICE_INGEST_TTL_MS', 3_600_000, 60_000),
            drainerBatchSize: envInt(
                'FM_DEVICE_INGEST_DRAINER_BATCH_SIZE',
                200,
                1
            ),
            drainerBlockMs: envInt(
                'FM_DEVICE_INGEST_DRAINER_BLOCK_MS',
                1_000,
                50
            ),
            drainerRetryMs: envInt(
                'FM_DEVICE_INGEST_DRAINER_RETRY_MS',
                5_000,
                100
            ),
            drainerPoisonDeliveries: envInt(
                'FM_DEVICE_INGEST_DRAINER_POISON_DELIVERIES',
                5,
                1
            ),
            xaddTimeoutMs: envInt('FM_DEVICE_INGEST_XADD_TIMEOUT_MS', 100, 0),
            degradedCooldownMs: envInt(
                'FM_DEVICE_INGEST_DEGRADED_COOLDOWN_MS',
                5_000,
                0
            ),
            capture: envBool('FM_DEVICE_INGEST_CAPTURE', false),
            drainAtBoot: envBool('FM_DEVICE_INGEST_DRAIN_AT_BOOT', false)
        },
        mobile: {
            bootstrapDeviceLimit: Math.min(
                500,
                envInt('FM_MOBILE_BOOTSTRAP_DEVICE_LIMIT', 100, 1)
            ),
            syncDeltaLimit: Math.min(
                1000,
                envInt('FM_MOBILE_SYNC_DELTA_LIMIT', 500, 1)
            )
        },
        nodeRed: {
            enabled: envBool('FM_NODE_RED_ENABLED', false),
            proxyTarget: envStr(
                'FM_NODE_RED_PROXY_TARGET',
                'http://nodered:1880'
            ),
            proxySecret: envStr('FM_NODE_RED_PROXY_SECRET', ''),
            proxySecretRequired: nodeRedProxySecretRequired(),
            proxyTimeoutMs: envInt(
                'FM_NODE_RED_PROXY_TIMEOUT_MS',
                30_000,
                1_000
            ),
            serviceUserRetryMs: envInt(
                'FM_NODE_RED_SERVICE_USER_RETRY_MS',
                30_000,
                1_000
            ),
            uiPermissions: envCsv('FM_NODE_RED_UI_PERMISSIONS', [
                'automation:update',
                'automation:*'
            ]),
            sessionAllowedOrigins: envCsv(
                'FM_NODE_RED_SESSION_ALLOWED_ORIGINS',
                []
            ),
            sessionCookieSameSite: readNodeRedCookieSameSite(),
            // Above the editor's 60 s keepalive, so one late tick never ends it.
            sessionTtlMs: envInt(
                'FM_NODE_RED_SESSION_TTL_MS',
                180_000,
                120_000
            ),
            sessionMaxAgeMs: envInt(
                'FM_NODE_RED_SESSION_MAX_AGE_MS',
                43_200_000,
                60_000
            ),
            userDir: envStr('FM_NODE_RED_USER_DIR', './cfg/node-red'),
            port: envInt('FM_NODE_RED_PORT', 1880, 1),
            host: envStr('FM_NODE_RED_HOST', '0.0.0.0'),
            flowFile: envStr(
                'FM_NODE_RED_FLOW_FILE',
                'flows_fleetmanager.json'
            ),
            orgId: envStr('FM_NODE_RED_ORG_ID', '').trim(),
            wsKeepAliveMs: envInt('FM_NODE_RED_WS_KEEPALIVE_MS', 30_000, 1_000),
            flowCacheMs: envInt('FM_NODE_RED_FLOW_CACHE_MS', 10_000, 0),
            statusTimeoutMs: envInt(
                'FM_NODE_RED_STATUS_TIMEOUT_MS',
                3_000,
                100
            ),
            statusCacheMs: envInt('FM_NODE_RED_STATUS_CACHE_MS', 15_000, 0),
            hookBodyLimitBytes: envInt(
                'FM_NODE_RED_HOOK_BODY_LIMIT_BYTES',
                262_144,
                1
            ),
            hookRateLimitPerMin: envInt(
                'FM_NODE_RED_HOOK_RATE_LIMIT_PER_MIN',
                60,
                1
            )
        },
        observability: {
            authToken: envStr('FM_OBS_AUTH_TOKEN', ''),
            dbWarnMs: envInt('FM_OBS_DB_WARN_MS', 50, 1),
            dbCritMs: envInt('FM_OBS_DB_CRIT_MS', 200, 1),
            rpcWarnMs: envInt('FM_OBS_RPC_WARN_MS', 200, 1),
            rpcCritMs: envInt('FM_OBS_RPC_CRIT_MS', 1_000, 1),
            statusQueueWarn: envInt('FM_OBS_STATUS_QUEUE_WARN', 100, 1),
            statusQueueCrit: envInt('FM_OBS_STATUS_QUEUE_CRIT', 500, 1),
            healthMonitorEnabled: envBool(
                'FM_STREAM_HEALTH_MONITOR_ENABLED',
                false
            ),
            healthMonitorPollMs: envInt(
                'FM_STREAM_HEALTH_MONITOR_POLL_MS',
                30_000,
                1_000
            ),
            healthOverflowRatio: envFloat(
                'FM_STREAM_HEALTH_OVERFLOW_RATIO',
                1.2,
                1.0,
                10.0
            ),
            kindGaugePollMs: envInt('FM_KIND_GAUGE_POLL_MS', 60_000, 1_000),
            metricKeyLimit: envInt(
                'FM_OBSERVABILITY_METRIC_KEY_LIMIT',
                5_000,
                100
            ),
            // envIntRange clamps to [0,3] — exactly the ObsLevel domain.
            bootLevel: envIntRange(
                'FM_OBSERVABILITY_LEVEL',
                2,
                0,
                3
            ) as ObsLevel,
            // Off by default: the 1 ms loop timer costs 1-2% of a core.
            dbTimingDetail: envBool('FM_DB_TIMING_DETAIL', false),
            labeledSeriesPerNameMax: envInt(
                'FM_OBS_LABELED_SERIES_PER_NAME_MAX',
                200,
                2
            ),
            labeledNameMax: envInt('FM_OBS_LABELED_NAME_MAX', 500, 10),
            rpcSampleMaxMethods: envInt(
                'FM_OBS_RPC_SAMPLE_MAX_METHODS',
                500,
                10
            ),
            telemetryMaxKeys: envInt('FM_TELEMETRY_MAX_KEYS', 200, 10),
            rpcErrorRingSize: envInt('FM_OBS_RPC_ERROR_RING_SIZE', 50, 1),
            initFailureRingSize: envInt('FM_OBS_INIT_FAILURE_RING_SIZE', 50, 1),
            slowRpcRingSize: envInt('FM_OBS_SLOW_RPC_RING_SIZE', 1_000, 1),
            slowRpcOffsetMs: envInt('FM_OBS_SLOW_RPC_OFFSET_MS', 100, 1),
            rpcSampleWindowMs: envInt(
                'FM_OBS_RPC_SAMPLE_WINDOW_MS',
                5 * 60 * 1000,
                1_000
            ),
            rpcSampleMaxPerMethod: envInt(
                'FM_OBS_RPC_SAMPLE_MAX_PER_METHOD',
                300,
                1
            ),
            rpcSampleMinForP95: envInt('FM_OBS_RPC_SAMPLE_MIN_FOR_P95', 5, 1),
            initDurationRingSize: envInt(
                'FM_OBS_INIT_DURATION_RING_SIZE',
                100,
                1
            ),
            historyRingSize: envInt('FM_OBS_HISTORY_RING_SIZE', 720, 1),
            topologyCacheMs: envInt('FM_OBS_TOPOLOGY_CACHE_MS', 500, 0),
            moduleHistorySize: envInt('FM_OBS_MODULE_HISTORY_SIZE', 300, 1),
            topologyDiffRingSize: envInt(
                'FM_OBS_TOPOLOGY_DIFF_RING_SIZE',
                5,
                1
            ),
            topologyDiffPctThreshold: envInt(
                'FM_OBS_TOPOLOGY_DIFF_PCT_THRESHOLD',
                50,
                0
            ),
            getterWarnMinIntervalMs: envInt(
                'FM_OBS_GETTER_WARN_MIN_INTERVAL_MS',
                5 * 60 * 1000,
                1
            ),
            edgeCounterWindowMs: envInt(
                'FM_OBS_EDGE_COUNTER_WINDOW_MS',
                60_000,
                1_000
            )
        },
        plugin: {
            maxFiles: envInt('FM_PLUGIN_MAX_FILES', 10_000, 1),
            maxDepth: envInt('FM_PLUGIN_MAX_DEPTH', 3, 1),
            maxUncompressedBytes: envInt(
                'FM_PLUGIN_MAX_UNCOMPRESSED_BYTES',
                104_857_600,
                1024
            ),
            ipcMaxBytes: envInt('FM_PLUGIN_IPC_MAX_BYTES', 1_048_576, 4096),
            maxDecodedBytes: envInt(
                'FM_PLUGIN_MAX_DECODED_BYTES',
                52_428_800,
                1024
            ),
            commandTimeoutMs: envInt(
                'FM_PLUGIN_COMMAND_TIMEOUT_MS',
                30_000,
                1_000
            ),
            shutdownTimeoutMs: envInt(
                'FM_PLUGIN_SHUTDOWN_TIMEOUT_MS',
                5_000,
                500
            ),
            commandQueueMax: envInt('FM_PLUGIN_COMMAND_QUEUE_MAX', 1_000, 10),
            maxWorkers: envInt('FM_PLUGIN_MAX_WORKERS', 16, 1),
            workerMaxOldGenerationSizeMb: envInt(
                'FM_PLUGIN_WORKER_MAX_OLD_MB',
                128,
                16
            ),
            workerMaxYoungGenerationSizeMb: envInt(
                'FM_PLUGIN_WORKER_MAX_YOUNG_MB',
                16,
                4
            ),
            workerStackSizeMb: envInt('FM_PLUGIN_WORKER_STACK_MB', 4, 1)
        },
        redis: {
            warmCacheStepTimeoutMs: envInt(
                'FM_REGISTRY_WARM_CACHE_STEP_TIMEOUT_MS',
                5000,
                100
            ),
            organizationVersionCacheMax: envInt(
                'FM_GROUP_VERSION_CACHE_MAX',
                50_000,
                100
            ),
            url: envStr('FM_REDIS_URL', ''),
            disabled: readRedisDisabledFlag(),
            keyPrefix: envStr('FM_REDIS_KEY_PREFIX', 'fm'),
            connectTimeoutMs: envInt(
                'FM_REDIS_CONNECT_TIMEOUT_MS',
                10_000,
                100
            ),
            commandTimeoutMs: envInt('FM_REDIS_COMMAND_TIMEOUT_MS', 0, 0),
            writeMaxPendingCommands: envInt(
                'FM_REDIS_WRITE_MAX_PENDING_COMMANDS',
                512,
                0
            ),
            cmdRetriesMax: envInt('FM_REDIS_CMD_RETRIES_MAX', 3, 1),
            subBackoffMaxMs: envInt('FM_REDIS_SUB_BACKOFF_MAX_MS', 5_000, 100),
            rateLimitEnabled: envBool('FM_XADD_RATE_LIMIT_ENABLED', false),
            rateLimitCapacity: envInt('FM_XADD_RATE_LIMIT_CAPACITY', 1_000, 10),
            rateLimitRefillPerSec: envInt(
                'FM_XADD_RATE_LIMIT_REFILL_PER_SEC',
                100,
                1
            ),
            pubsubChannelPrefix: envStr('FM_PUBSUB_CHANNEL_PREFIX', 'fm'),
            leaderLeaseMs: envInt('FM_LEADER_LEASE_MS', 10_000, 1_000),
            leaderRenewMs: envInt('FM_LEADER_RENEW_MS', 3_000, 100),
            groupCacheMaxOrgs: envInt('FM_GROUP_CACHE_MAX_ORGS', 500, 10)
        },
        report: {
            // All report readers are streamed or return bounded aggregates.
            maxRows: envInt('FM_REPORT_MAX_ROWS', 0, 0),
            maxDevices: envInt('FM_REPORT_MAX_DEVICES', 10_000, 1),
            streamChunkRows: envInt('FM_REPORT_STREAM_CHUNK_ROWS', 1_000, 10),
            chunkTargetRows: envInt(
                'FM_REPORT_CHUNK_TARGET_ROWS',
                250_000,
                10_000
            ),
            queryWorkMemMb: envIntRange(
                'FM_REPORT_QUERY_WORK_MEM_MB',
                128,
                1,
                2_048
            ),
            maxRangeDays: envInt('FM_REPORT_MAX_RANGE_DAYS', 365, 1),
            gzipCsvArtifacts: envBool('FM_REPORT_GZIP_CSV_ARTIFACTS', true),
            htmlSummaryMaxRows: envInt(
                'FM_REPORT_HTML_SUMMARY_MAX_ROWS',
                500,
                1
            ),
            pdfSummaryMaxRows: envInt('FM_REPORT_PDF_SUMMARY_MAX_ROWS', 500, 1),
            pdfMaxBytes: envInt(
                'FM_REPORT_PDF_MAX_BYTES',
                32 * 1024 * 1024,
                1024 * 1024
            ),
            pdfRenderConcurrency: envInt(
                'FM_REPORT_PDF_RENDER_CONCURRENCY',
                2,
                1
            ),
            pdfRenderBudgetMs: envInt(
                'FM_REPORT_PDF_RENDER_BUDGET_MS',
                30_000,
                1_000
            ),
            artifactTtlDays: envInt('FM_REPORT_OWNERSHIP_TTL_DAYS', 30, 1),
            cleanupIntervalMs: envInt(
                'FM_REPORT_CLEANUP_INTERVAL_MS',
                300_000,
                10_000
            ),
            cancelPollMs: envInt('FM_REPORT_CANCEL_POLL_MS', 1_000, 100),
            exportMaxAttempts: envInt('FM_REPORT_EXPORT_MAX_ATTEMPTS', 3, 1),
            nominalVoltage: envInt('FM_REPORT_NOMINAL_VOLTAGE', 230, 1),
            nominalHz: envInt('FM_REPORT_NOMINAL_HZ', 50, 1)
        },
        rpc: {
            maxConcurrentInits: envInt('FM_MAX_CONCURRENT_INITS', 100),
            maxConcurrentEmSyncs: envInt('FM_MAX_CONCURRENT_EM_SYNCS', 40),
            maxConcurrentEmSyncChannels: envInt(
                'FM_MAX_CONCURRENT_EM_SYNC_CHANNELS',
                120,
                1
            ),
            emSyncStuckMs: envInt('FM_EM_SYNC_STUCK_MS', 90_000, 1_000),
            emSyncReclaimMs: envInt('FM_EM_SYNC_RECLAIM_MS', 120_000, 1_000),
            rpcTimeoutMs: envInt('FM_RPC_TIMEOUT_MS', 60_000, 1_000),
            initProbeTimeoutMs: envInt(
                'FM_DEVICE_INIT_PROBE_TIMEOUT_MS',
                20_000,
                1_000
            ),
            maxPendingRpcs: envInt('FM_MAX_PENDING_RPCS', 10)
        },
        session: {
            snapshotPath: envStr('FM_SESSION_SNAPSHOT_PATH', ''),
            snapshotTtlMs: envInt('FM_SESSION_SNAPSHOT_TTL_MS', 300_000, 1_000)
        },
        deviceSnapshot: {
            redisFirst: envBool('FM_DEVICE_SNAPSHOT_REDIS_FIRST', false),
            redisShadow: envBool('FM_DEVICE_SNAPSHOT_REDIS_SHADOW', false),
            streamKey: envStr(
                'FM_DEVICE_SNAPSHOT_STREAM_KEY',
                'fm:device:snapshot'
            ),
            streamMaxlen: envInt(
                'FM_DEVICE_SNAPSHOT_STREAM_MAXLEN',
                100_000,
                100
            ),
            streamSaturationCheckMs: envInt(
                'FM_DEVICE_SNAPSHOT_STREAM_SATURATION_CHECK_MS',
                5_000,
                0
            ),
            streamTtlMs: envInt(
                'FM_DEVICE_SNAPSHOT_STREAM_TTL_MS',
                86_400_000,
                60_000
            ),
            drainerBatchSize: envInt(
                'FM_DEVICE_SNAPSHOT_DRAINER_BATCH_SIZE',
                100,
                1
            ),
            drainerBatchWindowMs: envInt(
                'FM_DEVICE_SNAPSHOT_DRAINER_BATCH_WINDOW_MS',
                250,
                0
            ),
            drainerBlockMs: envInt(
                'FM_DEVICE_SNAPSHOT_DRAINER_BLOCK_MS',
                1_000,
                50
            ),
            drainerRetryMs: envInt(
                'FM_DEVICE_SNAPSHOT_DRAINER_RETRY_MS',
                5_000,
                100
            ),
            drainerPoisonDeliveries: envInt(
                'FM_DEVICE_SNAPSHOT_DRAINER_POISON_DELIVERIES',
                10,
                2
            )
        },
        status: {
            redisFirst: envBool('FM_STATUS_REDIS_FIRST', false),
            redisShadow: envBool('FM_STATUS_REDIS_SHADOW', false),
            streamKey: envStr(
                'FM_STATUS_STREAM_KEY',
                envStr('FM_STATUS_OVERFLOW_STREAM_KEY', 'fm:status:overflow')
            ),
            overflowStreamKey: envStr(
                'FM_STATUS_OVERFLOW_STREAM_KEY',
                'fm:status:overflow'
            ),
            streamMaxlen: envInt(
                'FM_STATUS_STREAM_MAXLEN',
                envInt('FM_STATUS_OVERFLOW_MAXLEN', 100_000, 100),
                100
            ),
            overflowMaxlen: envInt('FM_STATUS_OVERFLOW_MAXLEN', 100_000, 100),
            streamSaturationCheckMs: envInt(
                'FM_STATUS_STREAM_SATURATION_CHECK_MS',
                envInt('FM_STATUS_OVERFLOW_SATURATION_CHECK_MS', 5_000, 0),
                0
            ),
            overflowSaturationCheckMs: envInt(
                'FM_STATUS_OVERFLOW_SATURATION_CHECK_MS',
                5_000,
                0
            ),
            streamTtlMs: envInt(
                'FM_STATUS_STREAM_TTL_MS',
                envInt('FM_STATUS_OVERFLOW_TTL_MS', 86_400_000, 60_000),
                60_000
            ),
            overflowTtlMs: envInt(
                'FM_STATUS_OVERFLOW_TTL_MS',
                86_400_000,
                60_000
            ),
            drainerBatchSize: envInt('FM_STATUS_DRAINER_BATCH_SIZE', 100, 1),
            drainerBatchWindowMs: envInt(
                'FM_STATUS_DRAINER_BATCH_WINDOW_MS',
                250,
                0
            ),
            drainerMaxRowsPerCall: envInt(
                'FM_STATUS_DRAINER_MAX_ROWS_PER_CALL',
                5_000,
                100
            ),
            drainerBlockMs: envInt('FM_STATUS_DRAINER_BLOCK_MS', 1_000, 50),
            drainerRetryMs: envInt('FM_STATUS_DRAINER_RETRY_MS', 5_000, 100),
            drainerPoisonDeliveries: envInt(
                'FM_STATUS_DRAINER_POISON_DELIVERIES',
                10,
                2
            ),
            queueMax: envInt('FM_STATUS_QUEUE_MAX', 50_000, 100),
            flushIntervalMs: envInt('FM_STATUS_FLUSH_INTERVAL_MS', 250, 50)
        },
        storage: {
            getAllMaxBytes: envInt(
                'FM_STORAGE_GETALL_MAX_BYTES',
                2 * 1024 * 1024,
                0
            )
        },
        energyClassifier: {
            version:
                envStr('FM_ENERGY_CLASSIFIER', 'v2') === 'v1' ? 'v1' : 'v2',
            parallelWrite: envBool(
                'FM_ENERGY_CLASSIFIER_PARALLEL_WRITE',
                false
            ),
            acMinVoltage: envInt(
                'FM_ENERGY_AC_MIN_VOLTAGE',
                AC_MIN_VOLTAGE_DEFAULT,
                1
            )
        },
        upload: {
            ticketTtlMs: envInt('FM_UPLOAD_TICKET_TTL_MS', 300_000, 10_000),
            sessionTtlMs: envInt('FM_UPLOAD_SESSION_TTL_MS', 3_600_000, 60_000),
            assetCacheMaxAgeSec: envInt(
                'FM_UPLOAD_ASSET_CACHE_MAX_AGE_SEC',
                86_400,
                0
            ),
            assetUrlTtlSec: envInt('FM_UPLOAD_ASSET_URL_TTL_SEC', 300, 30)
        },
        virtualDevice: {
            profileMatchMaxPerSlot: envInt(
                'FM_VIRTUAL_PROFILE_MATCH_MAX_PER_SLOT',
                25,
                1
            ),
            bluCacheMaxOrgs: envInt('FM_VIRTUAL_BLU_CACHE_MAX_ORGS', 256, 1),
            bluReconcileConcurrency: envInt(
                'FM_BLU_RECONCILE_CONCURRENCY',
                0,
                0
            ),
            bluReconcileQueueMax: envInt(
                'FM_BLU_RECONCILE_QUEUE_MAX',
                20_000,
                0
            ),
            bluTelemetryFailoverMs: envInt(
                'FM_BLU_TELEMETRY_FAILOVER_MS',
                60_000,
                5_000
            ),
            bluTelemetryOwnerMaxEntries: envInt(
                'FM_BLU_TELEMETRY_OWNER_MAX_ENTRIES',
                100_000,
                1
            ),
            bluRouteCacheMaxGateways: envInt(
                'FM_BLU_ROUTE_CACHE_MAX_GATEWAYS',
                50_000,
                1
            ),
            bluProvenanceRetentionDays: envInt(
                'FM_BLU_PROVENANCE_RETENTION_DAYS',
                30,
                1
            ),
            profileSuggestMaxResults: envInt(
                'FM_VIRTUAL_PROFILE_SUGGEST_MAX_RESULTS',
                10,
                1
            )
        },
        waitingRoom: {
            configTimeoutMs: envInt('FM_WAITING_ROOM_CONFIG_TIMEOUT_MS', 0, 0),
            redisTtlSec: envInt('FM_WAITING_ROOM_REDIS_TTL_SEC', 90, 5),
            maxPerOrg: envInt('FM_WAITING_ROOM_MAX_PER_ORG', 2_000, 1),
            rejectCooldownSec: envInt(
                'FM_WAITING_ROOM_REJECT_COOLDOWN_SEC',
                300,
                5
            ),
            acceptChunkSize: envInt(
                'FM_WAITING_ROOM_ACCEPT_CHUNK_SIZE',
                200,
                1
            ),
            acceptConcurrency: sharedPoolBound(
                'FM_WAITING_ROOM_ACCEPT_CONCURRENCY',
                6
            ),
            bulkJobTtlSec: envInt(
                'FM_WAITING_ROOM_BULK_JOB_TTL_SEC',
                3_600,
                60
            ),
            bulkJobStaleSec: envInt(
                'FM_WAITING_ROOM_BULK_JOB_STALE_SEC',
                60,
                10
            ),
            probeConcurrency: envInt('FM_WAITING_PROBE_CONCURRENCY', 50, 1),
            gatherConcurrency: envInt('FM_WAITING_GATHER_CONCURRENCY', 50, 1),
            gatherMaxMs: envInt('FM_WAITING_GATHER_MAX_MS', 60_000, 1_000),
            gatherTakeMs: envInt('FM_WAITING_GATHER_TAKE_MS', 60_000, 1_000),
            max: envInt('FM_WAITING_ROOM_MAX', 2_000, 1),
            ttlMs: envInt('FM_WAITING_ROOM_TTL_MS', 3_600_000, 1_000),
            sweepMs: envInt('FM_WAITING_ROOM_SWEEP_MS', 60_000, 1_000),
            accessRecheckMs: envInt(
                'FM_DEVICE_ACCESS_RECHECK_MS',
                60_000,
                1_000
            ),
            notifyDebounceMs: envInt(
                'FM_WAITING_ROOM_NOTIFY_DEBOUNCE_MS',
                300,
                0
            ),
            enrichTimeoutMs: envInt(
                'FM_WAITING_ROOM_ENRICH_TIMEOUT_MS',
                5_000,
                500
            ),
            reconnectKeyMax: envInt(
                'FM_WAITING_ROOM_RECONNECT_KEY_MAX',
                10_000,
                100
            ),
            reconnectWindowMs: envInt(
                'FM_WAITING_ROOM_RECONNECT_WINDOW_MS',
                60_000,
                1_000
            ),
            reconnectMaxPerWindow: envInt(
                'FM_WAITING_ROOM_RECONNECT_MAX_PER_WINDOW',
                20,
                1
            ),
            reconnectBlockMs: envInt(
                'FM_WAITING_ROOM_RECONNECT_BLOCK_MS',
                300_000,
                1_000
            ),
            sanitizeMaxStringLen: envInt(
                'FM_WAITING_ROOM_SANITIZE_MAX_STRING_LEN',
                256,
                16
            ),
            sanitizeMaxComponentKeys: envInt(
                'FM_WAITING_ROOM_SANITIZE_MAX_COMPONENT_KEYS',
                64,
                1
            )
        },
        ws: {
            debugLogMaxBytes: envInt('FM_WS_DEBUG_LOG_MAX_BYTES', 4096, 256),
            streamPrefix: envStr('FM_WS_STREAM_PREFIX', 'fm:evt'),
            streamMaxlen: envInt('FM_WS_STREAM_MAXLEN', 10_000, 100),
            streamTtlMs: envInt('FM_WS_STREAM_TTL_MS', 3_600_000, 60_000),
            resumeGraceMs: envInt('FM_WS_RESUME_GRACE_MS', 60_000, 0),
            resumeMaxEvents: envInt('FM_WS_RESUME_MAX_EVENTS', 5_000, 1),
            resumeProbeMs: envInt('FM_WS_RESUME_PROBE_MS', 2_000, 100),
            streamBlockMs: envInt('FM_WS_STREAM_BLOCK_MS', 1_000, 50),
            streamBatchSize: envInt('FM_WS_STREAM_BATCH_SIZE', 100, 1),
            maxBatchSize: envInt('FM_WS_MAX_BATCH_SIZE', 100, 1),
            senderPauseBytes: envInt(
                'FM_WS_SENDER_PAUSE_BYTES',
                1_048_576,
                1_024
            ),
            socketOpenTimeoutMs: envInt(
                'FM_WS_SOCKET_OPEN_TIMEOUT_MS',
                5_000,
                100
            ),
            socketOpenPollMs: envInt('FM_WS_SOCKET_OPEN_POLL_MS', 25, 5),
            authQueueMax: envInt('FM_WS_AUTH_QUEUE_MAX', 25, 1),
            logFlushMs: envInt('FM_WS_LOG_FLUSH_MS', 250, 50),
            heartbeatMs: envInt('FM_WS_HEARTBEAT_MS', 30_000, 1_000),
            clientHeartbeatMs: envInt(
                'FM_WS_CLIENT_HEARTBEAT_MS',
                37_000,
                1_000
            ),
            clientTrustedProxyCidrs: [
                ...envCsv('FM_WS_CLIENT_TRUSTED_PROXY_CIDRS', [])
            ],
            heartbeatMissedPongsMax: envInt(
                'FM_WS_HEARTBEAT_MISSED_PONGS_MAX',
                2,
                2
            ),
            heartbeatChunkSize: envInt('FM_WS_HEARTBEAT_CHUNK_SIZE', 100, 1),
            compressionEnabled: envBool('FM_WS_COMPRESSION_ENABLED', false),
            compressionLevel: envIntRange('FM_WS_COMPRESSION_LEVEL', 1, 1, 9),
            compressionMemLevel: envIntRange(
                'FM_WS_COMPRESSION_MEM_LEVEL',
                4,
                1,
                9
            ),
            compressionThreshold: envInt('FM_WS_COMPRESSION_THRESHOLD', 512, 0),
            compressionConcurrencyLimit: envInt(
                'FM_WS_COMPRESSION_CONCURRENCY_LIMIT',
                10,
                1
            ),
            clientCompressionEnabled: envBool(
                'FM_WS_CLIENT_COMPRESSION_ENABLED',
                true
            ),
            clientCompressionThreshold: envInt(
                'FM_WS_CLIENT_COMPRESSION_THRESHOLD',
                4096,
                0
            ),
            clientCompressionWindowBits: envIntRange(
                'FM_WS_CLIENT_COMPRESSION_WINDOW_BITS',
                14,
                9,
                15
            ),
            admissionMaxPerSec: envInt('FM_WS_ADMISSION_MAX_PER_SEC', 0, 0),
            pendingFilterSweepIntervalMs: envInt(
                'FM_PENDING_FILTER_SWEEP_INTERVAL_MS',
                60_000,
                1_000
            ),
            admissionReserveGraceSeconds: envInt(
                'FM_ADMISSION_RESERVE_GRACE_SECONDS',
                30,
                0
            )
        },
        zitadel: {
            tokenRejectionCacheMax: envInt(
                'FM_TOKEN_REJECTION_CACHE_MAX',
                10_000,
                100
            ),
            seenLoginTokenCacheMax: envInt(
                'FM_SEEN_LOGIN_TOKEN_CACHE_MAX',
                50_000,
                100
            ),
            authzVersionTtlSeconds: envInt(
                'FM_AUTHZ_VERSION_TTL_SECONDS',
                30 * 24 * 3600,
                60
            ),
            seenLoginTokenTtlMs: envInt(
                'FM_SEEN_LOGIN_TOKEN_TTL_MS',
                2 * 60 * 60 * 1000,
                60_000
            ),
            introspectedUserTtlMs: envInt(
                'FM_INTROSPECT_CACHE_TTL_MS',
                30_000,
                1_000
            ),
            userinfoFetchTimeoutMs: envInt(
                'FM_OIDC_USERINFO_TIMEOUT_MS',
                5_000,
                100
            ),
            introspectionTimeoutMs: envInt(
                'FM_OIDC_INTROSPECTION_TIMEOUT_MS',
                5_000,
                100
            ),
            scopedPatCacheTtlMs: envInt(
                'FM_SCOPED_PAT_CACHE_TTL_MS',
                30_000,
                250
            ),
            accountStateTtlMs: envIntRange(
                'FM_ACCOUNT_STATE_TTL_MS',
                30_000,
                1_000,
                300_000
            ),
            accountStateCacheMax: envInt(
                'FM_ACCOUNT_STATE_CACHE_MAX',
                10_000,
                100
            ),
            patBulkRotateConcurrency: envInt(
                'FM_PAT_BULK_ROTATE_CONCURRENCY',
                5,
                1
            ),
            userCacheSweepIntervalMs: envInt(
                'FM_USER_CACHE_SWEEP_INTERVAL_MS',
                60_000,
                1_000
            )
        },
        tariffPull: {
            enabled: envBool('FM_TARIFF_PULL_ENABLED', false),
            intervalMs: envInt(
                'FM_TARIFF_PULL_INTERVAL_MS',
                6 * 60 * 60_000,
                60_000
            ),
            fetchTimeoutMs: envInt(
                'FM_TARIFF_PULL_FETCH_TIMEOUT_MS',
                20_000,
                1_000
            )
        }
    };
}

// Alertmanager/Grafana constraint: repeat_interval must be a whole
// multiple of group_interval, else renotify drifts against batch flushes.
function validateTuning(t: TuningConfig): void {
    if (t.alert.repeatIntervalSec % t.alert.groupIntervalSec !== 0) {
        throw new Error(
            `FM_ALERT_REPEAT_INTERVAL_SEC (${t.alert.repeatIntervalSec}) must be a multiple of FM_ALERT_GROUP_INTERVAL_SEC (${t.alert.groupIntervalSec})`
        );
    }
    if (t.alert.groupWaitSec > t.alert.groupIntervalSec) {
        throw new Error(
            `FM_ALERT_GROUP_WAIT_SEC (${t.alert.groupWaitSec}) must be <= FM_ALERT_GROUP_INTERVAL_SEC (${t.alert.groupIntervalSec})`
        );
    }
    // Hard cap must exceed soft cap, else drop fires before flush.
    if (t.audit.queueHardMax <= t.audit.queueMax) {
        throw new Error(
            `FM_AUDIT_QUEUE_HARD_MAX (${t.audit.queueHardMax}) must be > FM_AUDIT_QUEUE_MAX (${t.audit.queueMax})`
        );
    }
    if (t.deviceEvents.queueHardMax <= t.deviceEvents.queueMax) {
        throw new Error(
            `FM_DEVICE_EVENTS_QUEUE_HARD_MAX (${t.deviceEvents.queueHardMax}) must be > FM_DEVICE_EVENTS_QUEUE_MAX (${t.deviceEvents.queueMax})`
        );
    }
}

const loadedTuning = readTuning();
validateTuning(loadedTuning);
export const tuning: Readonly<TuningConfig> = Object.freeze(loadedTuning);
