// ------------------------------------------------------------------------------------------------
// Polyfills
// ------------------------------------------------------------------------------------------------

// @ts-expect-error This is read-only property but in current Node.js LTS (22) it is not implemented
Symbol.metadata ??= Symbol('Symbol.metadata');

// ------------------------------------------------------------------------------------------------
// Imports
// ------------------------------------------------------------------------------------------------

/**
 * Module import order is important!
 * Importing the wrong module first, will enter into import loop and crash
 */
import dotenv from 'dotenv';
import './modules/EventDistributor';
import './config';
import * as log4js from 'log4js';
import {DEV_MODE, bootstrapFs, configRc} from './config';
import initGrafana from './config/grafana';
import AlexaComponent from './model/component/AlexaComponent';
import AuditLogComponent from './model/component/AuditLogComponent';
import BackupComponent from './model/component/BackupComponent';
import DeviceComponent from './model/component/DeviceComponent';
import EntityComponent from './model/component/EntityComponent';
import FirmwareComponent from './model/component/FirmwareComponent';
import FleetManagerComponent from './model/component/FleetManagerComponent';
import GrafanaComponent from './model/component/GrafanaComponent';
import GroupComponent from './model/component/GroupComponent';
import MailComponent from './model/component/MailComponent';
import MdnsComponent from './model/component/MdnsComponent';
// Components
import StorageComponent from './model/component/StorageComponent';
import WaitingRoomComponent from './model/component/WaitingRoomComponent';
import WebComponent from './model/component/WebComponent';
import * as AuditLogger from './modules/AuditLogger';
import * as Commander from './modules/Commander';
import * as DeviceCollector from './modules/DeviceCollector';
import * as FirmwareScheduler from './modules/FirmwareScheduler';
import * as Observability from './modules/Observability';
import * as postgres from './modules/PostgresProvider';
import * as Registry from './modules/Registry';
import {PluginLoader} from './modules/plugins';
import {start as startWeb} from './modules/web';
import {init as initValidator} from './validations';

// ------------------------------------------------------------------------------------------------
// Configure
// ------------------------------------------------------------------------------------------------

dotenv.config();
log4js.configure(configRc.logger);
const logger = log4js.getLogger();

// ------------------------------------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------------------------------------

process.on('unhandledRejection', (reason, promise) => {
    logger.error('unhandledRejection', reason, promise);
}); // do nothing

process.on('uncaughtException', (reason, origin) => {
    logger.error('uncaughtException', reason, origin);
}); // do nothing

// Shutdown hooks
process.on('SIGINT', onShutdown);
process.on('SIGTERM', onShutdown);
process.on('SIGHUP', onShutdown);
process.on('SIGABRT', onShutdown);

async function onShutdown() {
    logger.fatal('Shutting down...');
    // Flush pending audit logs before shutdown
    try {
        await AuditLogger.flush();
    } catch (err) {
        logger.error('Failed to flush audit logs on shutdown:', err);
    }
    // Skip delete events on shutdown - clients will be disconnected anyway
    DeviceCollector.getAll().forEach((shelly) =>
        shelly.destroy({skipDeleteEvent: true})
    );
    process.exit(0);
}

// Register default components
function registerDefaultComponents() {
    Commander.registerComponent(new StorageComponent());
    Commander.registerComponent(new GroupComponent());
    Commander.registerComponent(new MailComponent());
    Commander.registerComponent(new WebComponent());
    Commander.registerComponent(new FleetManagerComponent());
    Commander.registerComponent(new EntityComponent());
    Commander.registerComponent(new DeviceComponent());
    Commander.registerComponent(new WaitingRoomComponent());
    Commander.registerComponent(new MdnsComponent());
    Commander.registerComponent(new GrafanaComponent());
    Commander.registerComponent(new AlexaComponent());
    Commander.registerComponent(new FirmwareComponent());
    Commander.registerComponent(new BackupComponent());
    Commander.registerComponent(new AuditLogComponent());
}

function registerDevComponents() {
    if (!DEV_MODE) return;
    // Add dev components below
}

async function setupPlugins() {
    try {
        await PluginLoader.setup();
    } catch (error) {
        logger.error('Error setting up plugins', error);
    }
}

// ------------------------------------------------------------------------------------------------
// Start Fleet Manager
// ------------------------------------------------------------------------------------------------

async function main() {
    console.log(configRc);
    console.time('boot');
    await postgres.initDatabase();
    await postgres.migrateGroupsFromJson();
    await postgres.loadSavedDevices();
    await bootstrapFs();
    await initGrafana(configRc);
    await initValidator();
    // Add JRPC handlers
    registerDefaultComponents();
    registerDevComponents();
    // Load plugins
    await setupPlugins();
    // Pre-warm registry caches (actions, dashboards, menu items) so the
    // first client request is a cache hit — no DB query latency.
    await Registry.warmCache();
    // Enable observability if configured (event loop lag, RPC timing, memory)
    if (configRc.observability) Observability.setLevel(2);
    // Start firmware auto-update scheduler
    FirmwareScheduler.startScheduler();
    // Start web server
    startWeb();
    console.timeEnd('boot');
}

main();
