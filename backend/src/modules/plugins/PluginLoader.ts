import child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import * as log4js from 'log4js';
import {configRc, PLUGINS_FOLDER} from '../../config';
import PluginComponent from '../../model/component/PluginComponent';
import * as Commander from '../../modules/Commander';
import type {PluginData} from '../../types';
import {rebuild as rebuildFrontend} from '../Frontend';
import * as Observability from '../Observability';
import DirectoryScanner from './DirectoryScanner';
import FrontendHandler from './FrontendHandler';
import {pluginsToAdd, pluginsToRemove} from './pluginDiff';
import Workers from './Workers';

const FRONTEND_SOURCE = path.join(__dirname, '../../../frontend');
const HAS_NPM =
    fs.existsSync('/usr/local/bin/npm') || fs.existsSync('/usr/bin/npm');

const exec = util.promisify(child_process.exec);
log4js.configure(configRc.logger);
const logger = log4js.getLogger('Plugin Loader');

// Allowlist for the env passed to `npm install` so plugin install scripts
// and any subprocess npm spawns never see FM_* / ZITADEL_* secrets.
// PATH/HOME/USER/SHELL/LANG/LC_ALL/NODE_PATH are required for npm itself;
// NPM_CONFIG_* and PROXY are passed through so ops can tune proxy/registry.
const NPM_ENV_ALLOW = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'LANG',
    'LC_ALL',
    'NODE_PATH',
    'TMP',
    'TMPDIR',
    'TEMP'
];
function safeNpmEnv(): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = {};
    for (const key of NPM_ENV_ALLOW) {
        const v = process.env[key];
        if (v !== undefined) out[key] = v;
    }
    for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        if (k.startsWith('NPM_CONFIG_')) out[k] = v;
        if (k === 'HTTP_PROXY' || k === 'HTTPS_PROXY' || k === 'NO_PROXY') {
            out[k] = v;
        }
        const lower = k.toLowerCase();
        if (
            lower === 'http_proxy' ||
            lower === 'https_proxy' ||
            lower === 'no_proxy'
        ) {
            out[k] = v;
        }
    }
    return out;
}

export interface PluginSetupResult {
    loaded: string[];
    failed: Array<{name: string; error: string}>;
}

export default class PluginLoader {
    private static readonly pluginDataMap = new Map<string, PluginData>();
    private static readonly failedPlugins = new Map<string, string>();
    private static syncWorking = false;
    private static syncQueued = false;
    private static watcher: fs.FSWatcher | null = null;

    private static async sync(): Promise<PluginSetupResult> {
        const {add, remove, existingByName} = await PluginLoader.diffDisk();
        const failedThisRun: Array<{name: string; error: string}> = [];
        for (const name of add) {
            const found = existingByName.get(name);
            if (!found) continue;
            try {
                await PluginLoader.addPlugin(found);
                PluginLoader.failedPlugins.delete(name);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error('Plugin %s failed to load: %s', name, msg);
                Observability.incrementCounter('plugin_init_failures_total');
                PluginLoader.failedPlugins.set(name, msg);
                failedThisRun.push({name, error: msg});
            }
        }
        for (const name of remove) {
            await PluginLoader.removePlugin(name);
        }
        if (add.length > 0 || remove.length > 0) {
            PluginLoader.rebuildFrontendIfPossible();
        }
        return {
            loaded: Array.from(PluginLoader.pluginDataMap.keys()),
            failed: failedThisRun
        };
    }

    private static async diffDisk(): Promise<{
        add: string[];
        remove: string[];
        existingByName: Map<
            string,
            Awaited<ReturnType<typeof DirectoryScanner.scanPluginsDir>>[number]
        >;
    }> {
        const loadedNames = Array.from(PluginLoader.pluginDataMap.values()).map(
            (d) => d.info.name
        );
        const existing = await DirectoryScanner.scanPluginsDir(loadedNames);
        const newNames = existing.map((i) => i.pluginInfo.name);
        const existingByName = new Map(
            existing.map((p) => [p.pluginInfo.name, p])
        );
        return {
            add: pluginsToAdd(newNames, loadedNames),
            remove: pluginsToRemove(newNames, loadedNames),
            existingByName
        };
    }

    private static async addPlugin(
        p: Awaited<ReturnType<typeof DirectoryScanner.scanPluginsDir>>[number]
    ): Promise<void> {
        const name = p.pluginInfo.name;
        PluginLoader.pluginDataMap.set(name, {
            location: p.pluginFolder,
            info: p.pluginInfo
        });
        const component = new PluginComponent(name);
        Commander.registerComponent(component);
        const config = component.getConfig();

        // Skip in Docker — deps are pre-installed at build time.
        if (HAS_NPM) {
            const {stdout, stderr} = await exec(
                'npm install --ignore-scripts',
                {cwd: p.pluginFolder, env: safeNpmEnv()}
            );
            logger.mark('plugin npm i stdout:', stdout);
            logger.mark('plugin npm i stderr:', stderr);
        }

        if (config.enable === true) {
            await PluginLoader.enablePlugin(name);
        }
    }

    private static async removePlugin(name: string): Promise<void> {
        Commander.unregisterComponent(name);
        await PluginLoader.disablePlugin(name);
        PluginLoader.pluginDataMap.delete(name);
    }

    // In Docker the frontend is pre-built — no source tree to rebuild from.
    private static rebuildFrontendIfPossible(): void {
        if (!fs.existsSync(FRONTEND_SOURCE)) return;
        rebuildFrontend().catch((err) => {
            logger.error('Failed to rebuild frontend during sync', err);
        });
    }

    // ----------------------------------------------------------------------------------
    // Plugin interactions
    // ----------------------------------------------------------------------------------

    public static listPlugins() {
        return Object.fromEntries(PluginLoader.pluginDataMap.entries());
    }

    // ----------------------------------------------------------------------------------
    // Enable & Disable
    // ----------------------------------------------------------------------------------

    public static async enablePlugin(name: string, buildFrontend = true) {
        logger.mark('starting enablePlugin for', name);
        if (!PluginLoader.pluginDataMap.has(name)) {
            return false;
        }
        const pluginData = PluginLoader.pluginDataMap.get(name)!;
        // Handle menu items
        const menuItems = pluginData.info.config?.menuItems;
        if (menuItems) {
            await FrontendHandler.addMenuItems(menuItems);
        }

        // Handle frontend
        if (buildFrontend) {
            void FrontendHandler.buildFrontendIfNeeded(name).catch((err) => {
                logger.error(
                    "Failed to build frontend for plugin '%s'",
                    name,
                    err
                );
            });
        }

        Workers.createWorker(pluginData);
        return true;
    }

    public static async disablePlugin(name: string) {
        if (!PluginLoader.pluginDataMap.has(name)) {
            return false;
        }
        const pluginData = PluginLoader.pluginDataMap.get(name)!;
        const pluginWorker = Workers.getPluginWorkers().get(
            pluginData.info.name
        );
        // Remove menu items if needed
        const menuItems = pluginData.info.config?.menuItems;
        if (menuItems) {
            await FrontendHandler.removeMenuItems(menuItems);
        }

        if (pluginWorker === undefined) {
            logger.mark('no plugin worker active for %s', name);
            return false;
        }

        pluginWorker.postMessage(['unload']);

        // Do not leave plugin running in background
        // Law-abiding plugins should terminate on unload, but this won't hurt
        setTimeout(() => {
            logger.mark('terminating plugin worker for %s', name);
            pluginWorker.terminate();
        }, 100).unref();

        FrontendHandler.removeFrontendIfNeeded(name);

        Workers.unloadPlugin(name);
        Commander.unregisterComponent(name);

        return true;
    }

    private static folderChanged() {
        logger.debug('plugin folder changed');
        if (PluginLoader.syncWorking) {
            logger.debug('sync already in process, queue another pass');
            PluginLoader.syncQueued = true;
            return;
        }
        PluginLoader.syncWorking = true;
        PluginLoader.sync().finally(() => {
            PluginLoader.syncWorking = false;
            if (PluginLoader.syncQueued) {
                PluginLoader.syncQueued = false;
                PluginLoader.folderChanged();
            }
        });
    }

    public static async setup(): Promise<PluginSetupResult> {
        try {
            await fsp.access(PLUGINS_FOLDER);
        } catch {
            logger.warn(
                `Plugins folder "${PLUGINS_FOLDER}" does not exist. Creating it now...`
            );
            await fsp.mkdir(PLUGINS_FOLDER, {recursive: true});
        }

        const result = await PluginLoader.sync();
        if (!PluginLoader.watcher) {
            PluginLoader.watcher = fs.watch(PLUGINS_FOLDER, () => {
                PluginLoader.folderChanged();
            });
        }
        return result;
    }

    public static stopWatching(): void {
        PluginLoader.watcher?.close();
        PluginLoader.watcher = null;
        PluginLoader.syncQueued = false;
    }

    public static getPluginData() {
        return PluginLoader.pluginDataMap;
    }

    public static getFailedPlugins(): ReadonlyMap<string, string> {
        return PluginLoader.failedPlugins;
    }
}

Observability.registerModule('plugins', {
    stats: () => ({
        loadedPlugins: PluginLoader.getPluginData().size,
        failedPlugins: PluginLoader.getFailedPlugins().size
    }),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'integrations',
        upstreams: ['events'],
        label: 'Plugins',
        description: 'Plugin loader registry',
        route: '/monitoring/services'
    }
});
