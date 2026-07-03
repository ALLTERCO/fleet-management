// Import order matters: polyfills load Symbol.metadata for decorators,
// dotenv/config populates process.env, then './config' reads it. Anything
// new here must respect that chain or the boot crashes with import-loop.
import './polyfills';
import 'dotenv/config';
import {bootstrapOrgNames} from './modules/bootstrapOrgNames';
import * as EventDistributor from './modules/EventDistributor';
import './config';
import * as log4js from 'log4js';
import {
    bootstrapFs,
    configRc,
    DEV_MODE,
    exitOnFatalErrors,
    logBootConfig,
    logDevModeBannerIfActive,
    mdnsEnabled,
    requireAllPlugins,
    tuning,
    warnIfInsecureProduction,
    wipeComponentsIfRequested
} from './config';
import {envInt} from './config/envReader';
import {isComponentEnabled} from './config/featureFlags';
import initGrafana from './config/grafana';
import {groupPolicy} from './config/groupPolicy';
import {createAttributeWindowRepo} from './model/analytics/attributeWindowRepo';
// Components — grouped for registration; see registerDefaultComponents() below.
import AddonComponent from './model/component/AddonComponent';
import AdminComponent from './model/component/AdminComponent';
import AlertComponent from './model/component/AlertComponent';
import AlexaComponent from './model/component/AlexaComponent';
import AnalyticsComponent from './model/component/AnalyticsComponent';
import AssetComponent from './model/component/AssetComponent';
import AssignmentComponent from './model/component/AssignmentComponent';
import AuditComponent, {
    startAuditExportsCleanup,
    stopAuditExportsCleanup
} from './model/component/AuditComponent';
import AuthComponent from './model/component/AuthComponent';
import AuthzAuditComponent from './model/component/AuthzAuditComponent';
import BackupComponent from './model/component/BackupComponent';
import BillActualComponent from './model/component/BillActualComponent';
import BleComponent from './model/component/BleComponent';
import BluAssistComponent from './model/component/BluAssistComponent';
import BluGwComponent from './model/component/BluGwComponent';
import BmComponent from './model/component/BmComponent';
import BrandingComponent from './model/component/BrandingComponent';
import BTHomeComponent from './model/component/BTHomeComponent';
import BTHomeDeviceComponent from './model/component/BTHomeDeviceComponent';
import BTHomeSensorComponent from './model/component/BTHomeSensorComponent';
import ButtonComponent from './model/component/ButtonComponent';
import CameraComponent from './model/component/CameraComponent';
import CbComponent from './model/component/CbComponent';
import CctComponent from './model/component/CctComponent';
import CertificateComponent from './model/component/CertificateComponent';
import ChannelComponent from './model/component/ChannelComponent';
import ClientComponent from './model/component/ClientComponent';
import CloudComponent from './model/component/CloudComponent';
import CoverComponent from './model/component/CoverComponent';
import CredentialComponent from './model/component/CredentialComponent';
import CuryComponent from './model/component/CuryComponent';
import DaliComponent from './model/component/DaliComponent';
import DashboardComponent from './model/component/DashboardComponent';
import DeviceComponent from './model/component/DeviceComponent';
import DeviceEventComponent from './model/component/DeviceEventComponent';
import DeviceIngressComponent from './model/component/DeviceIngressComponent';
import DevicePowerComponent from './model/component/DevicePowerComponent';
import DiscoveryComponent from './model/component/DiscoveryComponent';
import DomainPolicyComponent from './model/component/DomainPolicyComponent';
import Em1Component from './model/component/Em1Component';
import Em1DataComponent from './model/component/Em1DataComponent';
import EmComponent from './model/component/EmComponent';
import EmDataComponent from './model/component/EmDataComponent';
import EnergyComponent from './model/component/EnergyComponent';
import EntityComponent from './model/component/EntityComponent';
import EthComponent from './model/component/EthComponent';
import FanComponent from './model/component/FanComponent';
import FirmwareComponent from './model/component/FirmwareComponent';
import FleetComponent from './model/component/FleetComponent';
import FleetMapComponent from './model/component/FleetMapComponent';
import FleetSummaryComponent from './model/component/FleetSummaryComponent';
import FloodComponent from './model/component/FloodComponent';
import GrafanaComponent from './model/component/GrafanaComponent';
import GroupComponent from './model/component/GroupComponent';
import HttpComponent from './model/component/HttpComponent';
import HumidityComponent from './model/component/HumidityComponent';
import IlluminanceComponent from './model/component/IlluminanceComponent';
import InputComponent from './model/component/InputComponent';
import JobComponent from './model/component/JobComponent';
import KindComponent from './model/component/KindComponent';
import KnxComponent from './model/component/KnxComponent';
import KvsComponent from './model/component/KvsComponent';
import LedStripComponent from './model/component/LedStripComponent';
import LightComponent from './model/component/LightComponent';
import LnmComponent from './model/component/LnmComponent';
import LocationComponent from './model/component/LocationComponent';
import LoginTextComponent from './model/component/LoginTextComponent';
import MailComponent from './model/component/MailComponent';
import MatterComponent from './model/component/MatterComponent';
import MbRtuClientComponent from './model/component/MbRtuClientComponent';
import MdnsComponent from './model/component/MdnsComponent';
import MediaComponent from './model/component/MediaComponent';
import MessageTextComponent from './model/component/MessageTextComponent';
import ModbusComponent from './model/component/ModbusComponent';
import MqttComponent from './model/component/MqttComponent';
import NotificationComponent from './model/component/NotificationComponent';
import NotificationPolicyComponent from './model/component/NotificationPolicyComponent';
import ObjectComponent from './model/component/ObjectComponent';
import OrganizationComponent from './model/component/OrganizationComponent';
import OtaComponent from './model/component/OtaComponent';
import PermissionComponent from './model/component/PermissionComponent';
import PersonaComponent from './model/component/PersonaComponent';
import PillComponent from './model/component/PillComponent';
import PluginManagerComponent from './model/component/PluginManagerComponent';
import Pm1Component from './model/component/Pm1Component';
import PolicyComponent from './model/component/PolicyComponent';
import PresenceComponent from './model/component/PresenceComponent';
import PresenceZoneComponent from './model/component/PresenceZoneComponent';
import PrivacyComponent from './model/component/PrivacyComponent';
import ReportComponent from './model/component/ReportComponent';
import ReportTemplateComponent from './model/component/ReportTemplateComponent';
import RestrictionsComponent from './model/component/RestrictionsComponent';
import RgbCctComponent from './model/component/RgbCctComponent';
import RgbComponent from './model/component/RgbComponent';
import RgbwComponent from './model/component/RgbwComponent';
import ScheduleComponent from './model/component/ScheduleComponent';
import ScriptComponent from './model/component/ScriptComponent';
import SecurityComponent from './model/component/SecurityComponent';
import SerialComponent from './model/component/SerialComponent';
import ServesComponent from './model/component/ServesComponent';
import ServiceComponent from './model/component/ServiceComponent';
import ShellyComponent from './model/component/ShellyComponent';
import SmokeComponent from './model/component/SmokeComponent';
import StorageComponent from './model/component/StorageComponent';
import SwitchComponent from './model/component/SwitchComponent';
import SysComponent from './model/component/SysComponent';
import SystemComponent from './model/component/SystemComponent';
import TagComponent from './model/component/TagComponent';
import TariffComponent from './model/component/TariffComponent';
import TemperatureComponent from './model/component/TemperatureComponent';
import ThermostatComponent from './model/component/ThermostatComponent';
import TrvComponent from './model/component/TrvComponent';
import UiComponent from './model/component/UiComponent';
import UserGroupComponent from './model/component/UserGroupComponent';
import VariablesComponent from './model/component/VariablesComponent';
import VirtualComponent from './model/component/VirtualComponent';
import VirtualDeviceComponent from './model/component/VirtualDeviceComponent';
import VirtualMetaComponent from './model/component/VirtualMetaComponent';
import VoltmeterComponent from './model/component/VoltmeterComponent';
import WaitingRoomComponent from './model/component/WaitingRoomComponent';
import WebComponent from './model/component/WebComponent';
import WebhookComponent from './model/component/WebhookComponent';
import WifiComponent from './model/component/WifiComponent';
import WsComponent from './model/component/WsComponent';
import XmodComponent from './model/component/XmodComponent';
import ZigbeeComponent from './model/component/ZigbeeComponent';
import {runReportExportJob} from './model/energy/reportExportTask';
import {
    startReportArtifactCleanup,
    stopReportArtifactCleanup
} from './model/report/reportArtifactCleanup';
import * as AlertEngine from './modules/AlertEngine';
import * as AuditLogger from './modules/AuditLogger';
import * as RuleSweep from './modules/alert/RuleSweep';
import * as AuditRetentionScheduler from './modules/auditRetentionScheduler';
import {initAuthzRuntime, shutdownAuthzRuntime} from './modules/authz';
import * as BackupJobWorker from './modules/backup/jobWorker';
import * as Commander from './modules/Commander';
import * as CertificateExpiryMonitor from './modules/certificate/expiryMonitor';
import * as CertificatePushWorker from './modules/certificate/pushWorker';
import * as CredentialPushWorker from './modules/credential/pushWorker';
import * as DeviceCollector from './modules/DeviceCollector';
import * as DeviceEventLogger from './modules/DeviceEventLogger';
import * as OutboxWorker from './modules/delivery/OutboxWorker';
import {
    startOAuthStatePruner,
    stopOAuthStatePruner
} from './modules/delivery/oauthConsent';
import {drainTransporterPool} from './modules/delivery/transporterPool';
import * as CustomKindGaugeScheduler from './modules/device/CustomKindGaugeScheduler';
import {startDeviceEventDrainer} from './modules/deviceEvents/DeviceEventDrainer';
import {
    setDeviceEventLogCallMethod,
    writeDeviceEventRowBatch
} from './modules/deviceEvents/writeDeviceEventRow';
import {
    startDeviceIngressCleanup,
    stopDeviceIngressCleanup
} from './modules/deviceIngress/cleanup';
import {
    startDeviceSeenFlusher,
    stopDeviceSeenFlusher
} from './modules/deviceIngress/deviceSeenFlusher';
import {
    startIngressAuditFlusher,
    stopIngressAuditFlusher
} from './modules/deviceIngress/ingressAuditFlusher';
import {
    bindAutoAdmittedDeviceOrg,
    recordAutoAdmitAudit
} from './modules/discovery/autoAdmitFinalize';
import * as EmSumCheckScheduler from './modules/emSumCheckScheduler';
import {seedAllOverrides} from './modules/energyOverrideLoader';
import * as FirmwareScheduler from './modules/FirmwareScheduler';
import * as FirmwareJobWorker from './modules/firmware/jobWorker';
import * as firmwareLibrary from './modules/firmwareLibrary';
import {seedGroupKindCatalog} from './modules/groupKindSeeder';
import {seedPolicyDefaults} from './modules/groupPolicySeed';
import IdentityComponent from './modules/identity/IdentityComponent';
import * as Mdns from './modules/Mdns';
import MobileComponent from './modules/mobile/MobileComponent';
import * as Observability from './modules/Observability';
import {registerClientDeviceUsageQuery} from './modules/observability/clientDeviceUsage';
import * as postgres from './modules/PostgresProvider';
import {PluginLoader} from './modules/plugins';
import Workers from './modules/plugins/Workers';
import {
    handleUnhandledRejection,
    makeUncaughtExceptionHandler
} from './modules/processErrorHandlers';
import * as Registry from './modules/Registry';
import {
    assertSaasZitadelManagementApiConfigured,
    assertSaasZitadelOrganizationsConfigured
} from './modules/saasMode';
import * as LiveTariffPullScheduler from './modules/tariff/liveTariffPullScheduler';
import {assertJwtSecretConfigured, getUserComponent} from './modules/user';
import {
    evictCachedUserByCredentialId,
    evictCachedUserByUserId,
    startUserCacheSweep,
    stopUserCacheSweep
} from './modules/user/cache';
import * as PatRevokeWorker from './modules/user/patRevokeWorker';
import {startScopedPatRetentionSweep} from './modules/user/tokenStore';
import * as WaitingRoom from './modules/WaitingRoom';
import * as web from './modules/web';
import {start as startWeb} from './modules/web';
import {stopRateLimitSweep} from './modules/web/rateLimit';

// ------------------------------------------------------------------------------------------------
// Configure
// ------------------------------------------------------------------------------------------------

log4js.configure(configRc.logger);
const logger = log4js.getLogger();

// ------------------------------------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------------------------------------

process.on('unhandledRejection', handleUnhandledRejection);
process.on(
    'uncaughtException',
    makeUncaughtExceptionHandler(() => {
        if (exitOnFatalErrors()) onShutdown(1);
    })
);

// Signal → POSIX exit code (128 + signal number). One function, one job:
// onShutdown stays pure on number; this owns the translation.
const SIGNAL_EXIT_CODE: Readonly<Record<NodeJS.Signals, number>> = {
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
    SIGABRT: 134
} as Record<NodeJS.Signals, number>;

function handleShutdownSignal(signal: NodeJS.Signals): void {
    void onShutdown(SIGNAL_EXIT_CODE[signal] ?? 0);
}

for (const signal of Object.keys(SIGNAL_EXIT_CODE) as NodeJS.Signals[]) {
    process.on(signal, handleShutdownSignal);
}

let shuttingDown = false;
// Run a single shutdown step. Errors are logged so one failed stop()
// doesn't stop the rest from running.
async function runShutdownStep(
    label: string,
    fn: () => Promise<unknown> | unknown
): Promise<void> {
    try {
        await fn();
    } catch (err) {
        logger.error(`${label} failed:`, err);
    }
}

async function onShutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.fatal('Shutting down (exit %d)...', exitCode);

    // 0. Snapshot live sessions before closing — peer process reads on boot.
    await runShutdownStep('sessionSnapshot.write', async () => {
        if (!tuning.session.snapshotPath) return;
        const {composeSnapshot} = await import(
            './modules/web/ws/sessionSnapshotComposer.js'
        );
        const {writeSnapshot} = await import(
            './modules/web/ws/sessionSnapshot.js'
        );
        writeSnapshot(tuning.session.snapshotPath, composeSnapshot());
    });

    // 0b. Stop the pending-filter sweep so the timer does not pin the loop.
    await runShutdownStep('pendingFilterSweep.stop', async () => {
        const {stopPendingFilterSweep} = await import(
            './modules/web/ws/pendingSubscriptionRestore.js'
        );
        stopPendingFilterSweep();
    });

    // 1. Stop accepting new work.
    await runShutdownStep('web.stop', () => web.stop(10_000));

    // 2. Reject new RPCs + wait for in-flight to finish.
    await runShutdownStep('Commander.drain', () => Commander.drain(5_000));

    // 2b. Flush in-memory device-data buffers (status, em_stats, lifetime)
    //     while PG is up and the status drainer can still absorb a spill —
    //     before both stop below — so a graceful reboot doesn't drop them.
    await runShutdownStep('deviceData.flushPending', async () => {
        const {flushPendingOnShutdown} = await import(
            './modules/ShellyMessageHandler.js'
        );
        await flushPendingOnShutdown();
    });

    // 3. Stop schedulers + workers + drainers in dependency order.
    const steps: Array<[string, () => Promise<unknown> | unknown]> = [
        ['FirmwareScheduler.stop', () => FirmwareScheduler.stopScheduler()],
        [
            'AuditRetentionScheduler.stop',
            () => AuditRetentionScheduler.stopScheduler()
        ],
        ['EmSumCheckScheduler.stop', () => EmSumCheckScheduler.stopScheduler()],
        [
            'LiveTariffPullScheduler.stop',
            () => LiveTariffPullScheduler.stopScheduler()
        ],
        [
            'firmwareLibrary.stopTemporaryFirmwareCleanup',
            () => firmwareLibrary.stopTemporaryFirmwareCleanup()
        ],
        ['stopAuditExportsCleanup', () => stopAuditExportsCleanup()],
        ['stopReportArtifactCleanup', () => stopReportArtifactCleanup()],
        ['stopUserCacheSweep', () => stopUserCacheSweep()],
        ['stopDeviceIngressCleanup', () => stopDeviceIngressCleanup()],
        ['stopDeviceSeenFlusher', () => stopDeviceSeenFlusher()],
        // Just stop the timer — the tail stays in the durable Redis buffer and
        // the next process drains it on boot, so no audit rows are lost.
        ['stopIngressAuditFlusher', () => stopIngressAuditFlusher()],
        ['stopRateLimitSweep', () => stopRateLimitSweep()],
        [
            'CustomKindGaugeScheduler.stop',
            () => CustomKindGaugeScheduler.stop()
        ],
        ['RuleSweep.stop', () => RuleSweep.stopScheduler()],
        ['AlertEngine.stop', () => AlertEngine.stop()],
        ['WaitingRoom.stop', () => WaitingRoom.stop()],
        [
            'Mdns.stop',
            () => {
                if (Mdns.started()) Mdns.stop();
            }
        ],
        ['OutboxWorker.stop', () => OutboxWorker.stop()],
        ['BackupJobWorker.stop', () => BackupJobWorker.stop()],
        ['FirmwareJobWorker.stop', () => FirmwareJobWorker.stop()],
        ['CertificatePushWorker.stop', () => CertificatePushWorker.stop()],
        ['CredentialPushWorker.stop', () => CredentialPushWorker.stop()],
        ['PatRevokeWorker.stop', () => PatRevokeWorker.stop()],
        [
            'CertificateExpiryMonitor.stop',
            () => CertificateExpiryMonitor.stop()
        ],
        ['stopOAuthStatePruner', () => stopOAuthStatePruner()],
        // Redis Streams drainers — let in-flight XACKs flush before exit.
        [
            'stopAuditDrainer',
            async () => {
                const {stopAuditDrainer} = await import(
                    './modules/audit/AuditDrainer.js'
                );
                await stopAuditDrainer();
            }
        ],
        [
            'stopStatusDrainer',
            async () => {
                const {stopStatusDrainer} = await import(
                    './modules/status/StatusDrainer.js'
                );
                await stopStatusDrainer();
            }
        ],
        [
            'stopEmSyncDrainer',
            async () => {
                const {stopEmSyncDrainer} = await import(
                    './modules/device/EmSyncDrainer.js'
                );
                await stopEmSyncDrainer();
            }
        ],
        [
            'stopIngestDrainer',
            async () => {
                const {stopIngestDrainer} = await import(
                    './modules/device/IngestDrainer.js'
                );
                await stopIngestDrainer();
            }
        ],
        [
            'stopDeviceEventDrainer',
            async () => {
                const {stopDeviceEventDrainer} = await import(
                    './modules/deviceEvents/DeviceEventDrainer.js'
                );
                await stopDeviceEventDrainer();
            }
        ],
        ['drainTransporterPool', () => drainTransporterPool()],
        ['Plugin workers terminate', () => Workers.terminateAll()]
    ];
    for (const [label, fn] of steps) {
        await runShutdownStep(label, fn);
    }

    // 4. Flush pending audit logs before DB + device teardown.
    await runShutdownStep('stopAuditFlushTimer', () =>
        AuditLogger.stopAuditFlushTimer()
    );
    await runShutdownStep('stopEntityIndexListeners', () =>
        DeviceCollector.stopEntityIndexListeners()
    );
    await runShutdownStep('AuditLogger.flush', () => AuditLogger.flush());
    await runShutdownStep('stopDeviceEventFlushTimer', () =>
        DeviceEventLogger.stopFlushTimer()
    );
    await runShutdownStep('DeviceEventLogger.flush', () =>
        DeviceEventLogger.flush()
    );
    // Drop-on-overflow during the final flush spills to Redis Streams via a
    // fire-and-forget hook — wait for those writes to land before redis quits.
    await runShutdownStep('audit overflow drain', async () => {
        const {awaitInflightSpills} = await import(
            './modules/audit/AuditOverflowStream.js'
        );
        await awaitInflightSpills();
    });

    // 5. Close pg pool last among storage so all earlier writes land.
    await runShutdownStep('postgres.shutdown', () => postgres.shutdown());
    await runShutdownStep('authz runtime shutdown', () =>
        shutdownAuthzRuntime()
    );

    // 6. Clear observability intervals + GC observer.
    await runShutdownStep('Observability.shutdown', () =>
        Observability.shutdown()
    );

    // 7. Release device connections. Promise.resolve wrap future-proofs
    //    against an async destroy override.
    await runShutdownStep('device destroy', () =>
        Promise.all(
            DeviceCollector.getAll().map((shelly) =>
                Promise.resolve(shelly.destroy({skipDeleteEvent: true}))
            )
        )
    );

    // 8. Release named leases before quitting Redis so peers can acquire.
    await runShutdownStep('leader gates stop', async () => {
        const {stopLeaderGates} = await import('./modules/redis/leaderGate.js');
        await stopLeaderGates();
    });

    // 9. Quit Redis so subscriptions/BLOCKed reads release server-side.
    await runShutdownStep('redis disconnect', async () => {
        const {shutdownSharedRedis} = await import(
            './modules/redis/RedisClients.js'
        );
        await shutdownSharedRedis();
    });

    // Give Node one tick to flush stdio before exit.
    setImmediate(() => process.exit(exitCode));
}

// Register default components.
//
// Three concern groups, enforced by section below. Adding a new component
// means deciding which group it belongs to — per the architectural split
// documented in docs/architecture/api.md § "Namespace inventory".
//
//   Group A — Device Operations   (physical Shelly control)
//   Group B — Fleet Operations    (organize + analyze across devices)
//   Group C — System & Admin      (infrastructure, integrations, ops)
//
function registerDefaultComponents() {
    // ── Group A — Device Operations ─────────────────────────────────
    // Per-device control, lifecycle, inventory, capability abstraction.
    Commander.registerComponent(new EntityComponent());
    Commander.registerComponent(new DeviceComponent());
    Commander.registerComponent(new ShellyComponent());
    Commander.registerComponent(new AddonComponent());
    Commander.registerComponent(new BleComponent());
    Commander.registerComponent(new BluAssistComponent());
    Commander.registerComponent(new BmComponent());
    Commander.registerComponent(new BTHomeComponent());
    Commander.registerComponent(new BTHomeDeviceComponent());
    Commander.registerComponent(new BTHomeSensorComponent());
    Commander.registerComponent(new BluGwComponent());
    Commander.registerComponent(new ButtonComponent());
    Commander.registerComponent(new CbComponent());
    Commander.registerComponent(new CctComponent());
    Commander.registerComponent(new CloudComponent());
    Commander.registerComponent(new CoverComponent());
    Commander.registerComponent(new CuryComponent());
    Commander.registerComponent(new DaliComponent());
    Commander.registerComponent(new DevicePowerComponent());
    Commander.registerComponent(new EthComponent());
    Commander.registerComponent(new FanComponent());
    Commander.registerComponent(new FloodComponent());
    Commander.registerComponent(new HttpComponent());
    Commander.registerComponent(new HumidityComponent());
    Commander.registerComponent(new IdentityComponent());
    Commander.registerComponent(new IlluminanceComponent());
    Commander.registerComponent(new InputComponent());
    Commander.registerComponent(new KnxComponent());
    Commander.registerComponent(new KvsComponent());
    Commander.registerComponent(new LedStripComponent());
    Commander.registerComponent(new LightComponent());
    Commander.registerComponent(new LnmComponent());
    Commander.registerComponent(new MatterComponent());
    Commander.registerComponent(new MbRtuClientComponent());
    Commander.registerComponent(new MediaComponent());
    Commander.registerComponent(new EmComponent());
    Commander.registerComponent(new Em1Component());
    Commander.registerComponent(new EmDataComponent());
    Commander.registerComponent(new Em1DataComponent());
    Commander.registerComponent(new ModbusComponent());
    Commander.registerComponent(new MobileComponent());
    Commander.registerComponent(new MqttComponent());
    Commander.registerComponent(new ObjectComponent());
    Commander.registerComponent(new OtaComponent());
    Commander.registerComponent(new PillComponent());
    Commander.registerComponent(new Pm1Component());
    Commander.registerComponent(new RgbComponent());
    Commander.registerComponent(new RgbCctComponent());
    Commander.registerComponent(new RgbwComponent());
    Commander.registerComponent(new ScriptComponent());
    Commander.registerComponent(new SecurityComponent());
    Commander.registerComponent(new SerialComponent());
    Commander.registerComponent(new ServiceComponent());
    Commander.registerComponent(new SmokeComponent());
    Commander.registerComponent(new SwitchComponent());
    Commander.registerComponent(new SysComponent());
    Commander.registerComponent(new TemperatureComponent());
    Commander.registerComponent(new ThermostatComponent());
    Commander.registerComponent(new TrvComponent());
    Commander.registerComponent(new UiComponent());
    Commander.registerComponent(new VirtualComponent());
    Commander.registerComponent(new VirtualDeviceComponent());
    Commander.registerComponent(new VirtualMetaComponent());
    Commander.registerComponent(new VoltmeterComponent());
    Commander.registerComponent(new WebhookComponent());
    Commander.registerComponent(new WifiComponent());
    Commander.registerComponent(new WsComponent());
    Commander.registerComponent(new XmodComponent());
    Commander.registerComponent(new ZigbeeComponent());
    Commander.registerComponent(new FirmwareComponent());
    Commander.registerComponent(new BackupComponent());
    Commander.registerComponent(new WaitingRoomComponent());
    Commander.registerComponent(new DiscoveryComponent());
    Commander.registerComponent(new AssetComponent());
    Commander.registerComponent(new AuthComponent());
    if (isComponentEnabled('schedule')) {
        Commander.registerComponent(new ScheduleComponent());
    }
    if (isComponentEnabled('camera')) {
        Commander.registerComponent(new CameraComponent());
    }
    if (isComponentEnabled('presence')) {
        Commander.registerComponent(new PresenceComponent());
        Commander.registerComponent(new PresenceZoneComponent());
    }

    // ── Group B — Fleet Operations ──────────────────────────────────
    // Cross-device: grouping, analytics, reports, UI composition.
    Commander.registerComponent(new GroupComponent());
    Commander.registerComponent(new KindComponent());
    Commander.registerComponent(new BillActualComponent());
    Commander.registerComponent(new ReportTemplateComponent());
    Commander.registerComponent(new LocationComponent());
    Commander.registerComponent(new ServesComponent());
    Commander.registerComponent(new TagComponent());
    Commander.registerComponent(new FleetComponent());
    Commander.registerComponent(new FleetSummaryComponent());
    Commander.registerComponent(new FleetMapComponent());
    Commander.registerComponent(new EnergyComponent());
    Commander.registerComponent(new TariffComponent());
    Commander.registerComponent(
        new AnalyticsComponent(createAttributeWindowRepo())
    );
    Commander.registerComponent(new ReportComponent());
    Commander.registerComponent(new DashboardComponent());
    Commander.registerComponent(new StorageComponent());
    Commander.registerComponent(new AlertComponent());
    Commander.registerComponent(new NotificationComponent());
    Commander.registerComponent(new ChannelComponent());
    Commander.registerComponent(new PolicyComponent());
    Commander.registerComponent(new VariablesComponent());

    // ── Group C — System & Admin ────────────────────────────────────
    // System/infrastructure config, admin ops, external integrations.
    Commander.registerComponent(new SystemComponent());
    Commander.registerComponent(new OrganizationComponent());
    Commander.registerComponent(new PersonaComponent());
    Commander.registerComponent(new PermissionComponent());
    Commander.registerComponent(new UserGroupComponent());
    Commander.registerComponent(new AssignmentComponent());
    Commander.registerComponent(new AuthzAuditComponent());
    Commander.registerComponent(new JobComponent());
    Commander.registerComponent(new CertificateComponent());
    Commander.registerComponent(new CredentialComponent());
    Commander.registerComponent(new DeviceIngressComponent());
    Commander.registerComponent(new AdminComponent());
    Commander.registerComponent(new BrandingComponent());
    Commander.registerComponent(new PrivacyComponent());
    Commander.registerComponent(new MessageTextComponent());
    Commander.registerComponent(new LoginTextComponent());
    Commander.registerComponent(new NotificationPolicyComponent());
    Commander.registerComponent(new RestrictionsComponent());
    Commander.registerComponent(new DomainPolicyComponent());
    Commander.registerComponent(new AuditComponent());
    Commander.registerComponent(new DeviceEventComponent());
    Commander.registerComponent(new PluginManagerComponent());
    Commander.registerComponent(new MailComponent());
    Commander.registerComponent(new MdnsComponent());
    Commander.registerComponent(new WebComponent());
    Commander.registerComponent(new GrafanaComponent());
    Commander.registerComponent(new AlexaComponent());
    Commander.registerComponent(new ClientComponent());
    Commander.registerComponent(getUserComponent());
}

function registerDevComponents() {
    if (!DEV_MODE) return;
    // Add dev components below
}

async function setupPlugins() {
    let result: Awaited<ReturnType<typeof PluginLoader.setup>>;
    try {
        result = await PluginLoader.setup();
    } catch (error) {
        logger.error('Plugin setup aborted before any plugin loaded', error);
        if (requireAllPlugins()) throw error;
        return;
    }
    if (result.failed.length > 0) {
        logger.error(
            'Plugin setup: %d loaded, %d failed (%s)',
            result.loaded.length,
            result.failed.length,
            result.failed.map((f) => `${f.name}: ${f.error}`).join('; ')
        );
        if (requireAllPlugins()) {
            throw new Error(
                `FM_REQUIRE_ALL_PLUGINS=true and ${result.failed.length} plugin(s) failed`
            );
        }
    } else {
        logger.info('Plugin setup: %d loaded', result.loaded.length);
    }
}

// ------------------------------------------------------------------------------------------------
// Start Fleet Manager
// ------------------------------------------------------------------------------------------------

function logBootSafety(): void {
    // Hoisted from config module-load so test imports stay side-effect-free.
    logBootConfig();
    wipeComponentsIfRequested();
    logDevModeBannerIfActive();
    warnIfInsecureProduction();
    // Fail fast on invalid FM_GROUP_POLICY_* env values.
    groupPolicy();
    assertSaasZitadelOrganizationsConfigured();
    assertSaasZitadelManagementApiConfigured();
}

async function initPersistenceAndAuthz(): Promise<void> {
    await postgres.initDatabase(configRc.internalStorage);
    // Inject the DB query primitive into the device-usage exporter so it never
    // imports PostgresProvider directly (would close an Observability↔DB cycle).
    registerClientDeviceUsageQuery(postgres.queryRows);
    // Seed the runtime-editable policy table from env once per deploy.
    // ON CONFLICT DO NOTHING — admin edits survive.
    await seedPolicyDefaults();
    // UPSERT the group_kind catalog from the TS source of truth.
    await seedGroupKindCatalog();
    // Starter catalog for the Custom-path wizard. Idempotent.
    try {
        const {seedSystemVirtualDeviceProfiles} = await import(
            './modules/virtualDeviceProfileSeeder.js'
        );
        await seedSystemVirtualDeviceProfiles();
    } catch (err) {
        logger.warn(
            'system virtual-device profile seed failed (non-fatal): %s',
            err
        );
    }
    // Authz runtime (Redis cache + resolver). Fail-safe — Redis unreachable
    // leaves the runtime null, callers degrade gracefully.
    await initAuthzRuntime();
}

// Composition root for Redis: boot-time impl selection per
// FM_REDIS_DISABLED. Null adapters are the default; consumers
// depend on the port and never check a flag.
async function initRedisAndDrainers(): Promise<void> {
    if (tuning.redis.disabled) {
        logger.warn('FM_REDIS_DISABLED=true — null Redis adapters active.');
        return;
    }
    {
        const {initSharedRedis} = await import(
            './modules/redis/RedisClients.js'
        );
        initSharedRedis({url: tuning.redis.url});
    }
    const {installRedisServices} = await import('./modules/redis/services.js');
    installRedisServices();
    // Stream-length watchdog (opt-in: FM_STREAM_HEALTH_MONITOR_ENABLED).
    if (tuning.observability.healthMonitorEnabled) {
        const {getSharedRedis} = await import(
            './modules/redis/RedisClients.js'
        );
        const {StreamHealthMonitor} = await import(
            './modules/redis/StreamHealthMonitor.js'
        );
        const {cmd} = getSharedRedis();
        const monitor = new StreamHealthMonitor(
            cmd,
            [
                {
                    key: tuning.audit.overflowStreamKey,
                    maxlen: tuning.audit.overflowMaxlen,
                    label: 'audit-overflow'
                },
                {
                    key: tuning.status.overflowStreamKey,
                    maxlen: tuning.status.overflowMaxlen,
                    label: 'status-overflow'
                },
                {
                    key: tuning.deviceSnapshot.streamKey,
                    maxlen: tuning.deviceSnapshot.streamMaxlen,
                    label: 'device-snapshot'
                },
                {
                    key: tuning.deviceEvents.streamKey,
                    maxlen: tuning.deviceEvents.streamMaxlen,
                    label: 'device-event'
                }
            ],
            tuning.observability.healthMonitorPollMs,
            tuning.observability.healthOverflowRatio
        );
        monitor.start();
    }
    // Cross-instance signals — fail-safe boot, never crash FM here.
    // Subscribe BEFORE the audit drainer starts so the drainer doesn't
    // observe a signal-driven cache invalidation before its subscriber
    // is wired (C4-2: boot-order independence; OWASP A09).
    try {
        await EventDistributor.subscribeToOrgSignals();
    } catch (err) {
        logger.warn('subscribeToOrgSignals failed (continuing): %s', err);
    }
    // Audit DLQ.
    {
        const {setAuditSpillHook} = await import('./modules/AuditLogger.js');
        const {spillAuditEntry} = await import(
            './modules/audit/AuditOverflowStream.js'
        );
        const {startAuditDrainer} = await import(
            './modules/audit/AuditDrainer.js'
        );
        setAuditSpillHook((entry) => {
            void spillAuditEntry(entry);
        });
        startAuditDrainer();
    }
    try {
        const {subscribeDeviceTrustInvalidations} = await import(
            './modules/deviceIngress/deviceTrustCache.js'
        );
        await subscribeDeviceTrustInvalidations();
    } catch (err) {
        logger.warn(
            'device trust invalidations subscribe failed (continuing): %s',
            err
        );
    }
    try {
        const {onSession} = await import('./modules/redis/SessionSignals.js');
        const {ConnectionContext} = await import(
            './modules/web/ws/ConnectionContext.js'
        );
        await onSession((signal) => {
            if (signal.kind === 'force-disconnect') {
                // Admin-initiated hard-close (deactivate/delete) — peers
                // must close any open sockets for this user.
                evictCachedUserByUserId(signal.userId);
                ConnectionContext.forceSenderDisconnect(
                    signal.userId,
                    signal.reason ?? 'user-disabled'
                );
            } else if (
                signal.kind === 'disconnect' ||
                signal.kind === 'reconnect'
            ) {
                // Informational only — one socket opened or closed
                // normally. Peers do nothing; treating either as a
                // hard-close would let a single browser tab close kick
                // the same user's sessions on every other pod.
            } else if (signal.kind === 'auth-changed') {
                // Role grant / revoke / reactivation — peer rebuilds
                // user_t + force live WS senders to re-fetch.
                evictCachedUserByUserId(signal.userId);
                ConnectionContext.forceSenderRefresh(signal.userId);
            } else if (signal.kind === 'credential-revoked') {
                if (signal.credentialId) {
                    evictCachedUserByCredentialId(signal.credentialId);
                }
                // Real userId → kick the PAT-bound session by forcing
                // the sender to re-resolve (fails for revoked PAT).
                // userId='' (rotation) — no sessions to target. The
                // credentialId eviction above already cleared the cache.
                if (signal.userId) {
                    ConnectionContext.forceSenderRefresh(signal.userId);
                }
            }
        });
    } catch (err) {
        logger.warn('SessionSignals subscribe failed (continuing): %s', err);
    }
    // Status flush DLQ.
    {
        const {startStatusDrainer} = await import(
            './modules/status/StatusDrainer.js'
        );
        const PG = await import('./modules/PostgresProvider.js');
        const {projectStatusBatch} = await import(
            './modules/virtualDevice/historyProjection.js'
        );
        const {
            bluetoothProjectedStatusBatch,
            recordBluetoothGatewayStatusBatch
        } = await import('./modules/virtualDevice/bluetoothProvenance.js');
        type ProjectionBatchEntry = Parameters<
            typeof projectStatusBatch
        >[0] extends readonly (infer E)[]
            ? E
            : never;
        const Observability = await import('./modules/Observability.js');
        const projectionLogger = log4js.getLogger('virtual-projection');
        startStatusDrainer(async (batch) => {
            await PG.rawCall('device.fn_status_push', batch);
            void runProjection(batch).catch((err) => {
                Observability.incrementCounter(
                    'virtual_projection_drain_errors'
                );
                projectionLogger.warn(
                    'projection batch failed (non-fatal): %s',
                    err instanceof Error ? err.message : String(err)
                );
            });

            async function runProjection(b: typeof batch) {
                const entries: ProjectionBatchEntry[] = [];
                for (let i = 0; i < b.p_ts.length; i++) {
                    const tsIso = msToIsoSafe(b.p_ts[i] as number);
                    if (!tsIso) continue;
                    entries.push({
                        sourceDeviceListId: b.p_id[i] as number,
                        field: b.p_field[i] as string,
                        value: b.p_value[i],
                        prevValue: b.p_prev_value[i],
                        ts: tsIso
                    });
                }
                if (entries.length === 0) return;
                const [projection, bluetooth] = await Promise.all([
                    projectStatusBatch(entries),
                    recordBluetoothGatewayStatusBatch(entries)
                ]);
                const bluetoothStatusBatch = bluetoothProjectedStatusBatch(
                    bluetooth.statusRows
                );
                if (bluetoothStatusBatch) {
                    await PG.rawCall(
                        'device.fn_status_push',
                        bluetoothStatusBatch
                    );
                }
                if (
                    projection.projected > 0 ||
                    bluetooth.recorded > 0 ||
                    bluetooth.statusRows.length > 0
                ) {
                    Observability.incrementCounter(
                        'virtual_projection_rows',
                        projection.projected +
                            bluetooth.recorded +
                            bluetooth.statusRows.length
                    );
                }
            }
        });
    }
    // Device snapshots: Redis-first persist path drains compact snapshots to PG.
    {
        const {startDeviceSnapshotDrainer} = await import(
            './modules/device/SnapshotDrainer.js'
        );
        const PG = await import('./modules/PostgresProvider.js');
        const dc = await import('./modules/DeviceCollector.js');
        startDeviceSnapshotDrainer(async (rows) => {
            await PG.storeBatch(rows);
            for (const row of rows) {
                const device = dc.getDevice(row.externalId) as
                    | {reconcilePersistedBluetoothChildren?: () => void}
                    | undefined;
                device?.reconcilePersistedBluetoothChildren?.();
            }
        });
    }
    // em-sync buffer drainer: writes buffered blocks to PG via the atomic
    // raw+bookmark function, then rolls them up.
    {
        const {startEmSyncDrainer} = await import(
            './modules/device/EmSyncDrainer.js'
        );
        const {appendEmStatsSynced} = await import('./modules/energyRollup.js');
        const PG = await import('./modules/PostgresProvider.js');
        startEmSyncDrainer((batch) =>
            appendEmStatsSynced(batch.rows, batch.cursor, {
                callDb: PG.callMethod
            })
        );
    }
    // FM-issued scoped PAT retention sweep.
    startScopedPatRetentionSweep();
}

function msToIsoSafe(ms: number): string | null {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

async function loadDevicesAndIngestReplay(): Promise<void> {
    await postgres.loadSavedDevices();
    // Device ingest drainer — opt-in. Replays Phase E captured frames after a
    // prior FM crashed mid-process. Off by default because the consumer
    // (AbstractDevice.onMessage) hasn't been proven idempotent for double
    // processing of the same frame.
    if (
        !tuning.redis.disabled &&
        tuning.ingest.capture &&
        tuning.ingest.drainAtBoot
    ) {
        const {startIngestDrainer} = await import(
            './modules/device/IngestDrainer.js'
        );
        const dc = await import('./modules/DeviceCollector.js');
        startIngestDrainer(async (_lane, fields) => {
            const dev = dc.getDevice(fields.shellyID);
            if (!dev) return; // device removed between capture and replay
            const msg = JSON.parse(fields.msg);
            const req = fields.req ? JSON.parse(fields.req) : undefined;
            (
                dev as unknown as {
                    onMessage: (m: unknown, r?: unknown) => void;
                }
            ).onMessage(msg, req);
        });
    }
}

function armInProcessCaches(): void {
    // Entity-index cache is event-driven (Entity.Added / Entity.Removed).
    // Subscribe before any device registers entities.
    DeviceCollector.startEntityIndexListeners();
    // Periodic batch-flush of the audit queue. Lifecycle pair —
    // stopAuditFlushTimer is called in onShutdown.
    AuditLogger.startAuditFlushTimer();
    // Inject the DB writer so the event-log module stays off the
    // PostgresProvider import graph (breaks a logger->DB cycle).
    setDeviceEventLogCallMethod(postgres.callMethod);
    if (
        !tuning.redis.disabled &&
        (tuning.deviceEvents.redisFirst || tuning.deviceEvents.redisShadow)
    ) {
        startDeviceEventDrainer(writeDeviceEventRowBatch);
    }
    // Periodic batch-flush of the device-event-log queue. Lifecycle pair —
    // stopFlushTimer is called in onShutdown.
    DeviceEventLogger.startFlushTimer();
    // Single consolidated TTL sweep for the 4 user/token caches.
    startUserCacheSweep();
    // Bind device→org BEFORE approve (so Shelly.Connect sees the org),
    // audit AFTER the intent is consumed.
    WaitingRoom.setAutoAdmitHooks({
        preApproveBind: bindAutoAdmittedDeviceOrg,
        postFinalizeAudit: recordAutoAdmitAudit
    });
}

async function seedEmSyncQueue(): Promise<void> {
    try {
        const {seedEmSyncFromDeviceCollector} = await import(
            './modules/ShellyMessageHandler.js'
        );
        await seedEmSyncFromDeviceCollector();
    } catch (err) {
        logger.warn('EM sync boot-seed failed (non-fatal): %s', err);
    }
}

async function primeGeoReferenceCaches(): Promise<void> {
    // Reference data is deploy-static. Empty/missing tables are fine —
    // SearchPlaces/ListCountries fall back to live queries.
    try {
        const {primeGeoCaches} = await import(
            './modules/geocoding/geocoding.js'
        );
        await primeGeoCaches();
    } catch (err) {
        logger.warn(
            'geo reference cache prime failed (import-geonames not yet run?): %s',
            err
        );
    }
}

async function registerComponentsAndPlugins(): Promise<void> {
    registerDefaultComponents();
    registerDevComponents();
    await setupPlugins();
    // Pre-warm registry caches (actions, dashboards, menu items) so the
    // first client request is a cache hit — no DB query latency.
    await Registry.warmCache();
}

function enableObservabilityAndMdns(): void {
    // Light tier is always-on baseline: cheap module gauges + system vitals.
    // FM_OBSERVABILITY=true escalates to FM_OBSERVABILITY_LEVEL (default Medium).
    Observability.setLevel(
        configRc.observability ? tuning.observability.bootLevel : 1
    );
    if (mdnsEnabled()) Mdns.start();
}

async function startBackgroundWorkers(): Promise<void> {
    // One-shot cleanup of leftover temporary firmware uploads, then arm
    // the periodic sweep. Lifecycle pair — stop in onShutdown.
    await firmwareLibrary.cleanupStaleTemporaryFirmwareFiles();
    firmwareLibrary.startTemporaryFirmwareCleanup();
    // Periodic sweep of expired audit-log CSV exports.
    startAuditExportsCleanup();
    startReportArtifactCleanup();
    FirmwareScheduler.startScheduler();
    AuditRetentionScheduler.startScheduler();
    EmSumCheckScheduler.startScheduler();
    LiveTariffPullScheduler.startScheduler();
    await startDeviceIngressCleanup();
    startDeviceSeenFlusher();
    startIngressAuditFlusher();
    CustomKindGaugeScheduler.start(tuning.observability.kindGaugePollMs);
    // Tier 1 cache must be warm before the first energy frame; failure
    // here would silently let tier 2 misclassify a row the operator
    // already overrode, so we surface and continue rather than swallow.
    try {
        await seedAllOverrides();
    } catch (e) {
        logger.error('Energy override seed failed at startup: %s', e);
    }
    OutboxWorker.registerReportExportHandler(runReportExportJob);
    await OutboxWorker.start(configRc.internalStorage);
    await BackupJobWorker.start();
    await FirmwareJobWorker.start();
    await CertificatePushWorker.start();
    await CredentialPushWorker.start();
    await PatRevokeWorker.start();
    await CertificateExpiryMonitor.start();
    startOAuthStatePruner();
    // Alert engine subscribes to device events + evaluates rules — must
    // come after all event publishers are live.
    AlertEngine.start();
    // Periodic sweep for time/absence kinds — needs the engine fire path live.
    RuleSweep.startScheduler();
}

async function main() {
    logger.debug('Boot config loaded (see startup log for redacted details)');
    console.time('boot');

    logBootSafety();
    await initPersistenceAndAuthz();
    await initRedisAndDrainers();
    // Subscribe to Entity.Added / Entity.Removed before loadSavedDevices
    // emits any — the lazy entity index then sees a consistent post-load
    // snapshot on first lookup.
    armInProcessCaches();
    await loadDevicesAndIngestReplay();
    await seedEmSyncQueue();
    await primeGeoReferenceCaches();
    await EventDistributor.loadDeviceOrgMap();
    await bootstrapOrgNames();
    await bootstrapFs();
    await initGrafana(configRc);
    await registerComponentsAndPlugins();
    // UserComponent is registered now → getJwtToken() reflects live config.
    assertJwtSecretConfigured();
    enableObservabilityAndMdns();
    await startBackgroundWorkers();
    await restoreSessionSnapshot();
    startWeb();

    console.timeEnd('boot');
}

async function restoreSessionSnapshot(): Promise<void> {
    if (!tuning.session.snapshotPath) return;
    const {consumeSnapshot} = await import(
        './modules/web/ws/sessionSnapshot.js'
    );
    const {loadPendingFilters, startPendingFilterSweep} = await import(
        './modules/web/ws/pendingSubscriptionRestore.js'
    );
    const snap = consumeSnapshot(tuning.session.snapshotPath);
    if (!snap) return;
    const ageMs = Date.now() - snap.capturedAtMs;
    if (ageMs > tuning.session.snapshotTtlMs) {
        Observability.incrementCounter('session_snapshot_stale_skipped');
        logger.warn(
            'session snapshot stale (age=%dms ttl=%dms) — skipping restore',
            ageMs,
            tuning.session.snapshotTtlMs
        );
        return;
    }
    const seeds = snap.sessions.map((s) => ({
        userId: String(s.userId),
        connectionId: s.connectionId,
        eventTypes: s.eventTypes,
        deviceIds: s.deviceIds
    }));
    const restored = loadPendingFilters(seeds, tuning.session.snapshotTtlMs);
    Observability.setGauge(
        'session_snapshot_restored_sessions',
        snap.sessions.length
    );
    // loadPendingFilters already sets session_pending_filter_restore.
    logger.info(
        'session snapshot restored sessions=%d filters=%d capturedAt=%s',
        snap.sessions.length,
        restored,
        new Date(snap.capturedAtMs).toISOString()
    );
    if (restored > 0) {
        startPendingFilterSweep(tuning.ws.pendingFilterSweepIntervalMs);
    }
}

// Bounded boot; envInt rejects garbage so setTimeout doesn't get NaN.
const BOOT_TIMEOUT_MS = envInt('FM_BOOT_TIMEOUT_MS', 180_000, 1_000);
const bootTimeout = setTimeout(() => {
    logger.fatal(
        `Boot did not complete within ${BOOT_TIMEOUT_MS}ms — exiting so the orchestrator can restart.`
    );
    process.exit(1);
}, BOOT_TIMEOUT_MS);
bootTimeout.unref();

main().then(
    () => clearTimeout(bootTimeout),
    (err) => {
        clearTimeout(bootTimeout);
        logger.fatal('Boot failed:', err);
        // Run onShutdown so DB pool / audit drainer / WS state flush
        // cleanly. process.exit() inside onShutdown closes the process.
        void onShutdown(1);
    }
);
