import child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import * as log4js from 'log4js';
import {PLUGINS_FOLDER, configRc} from '../../config';
import PluginComponent from '../../model/component/PluginComponent';
import * as Commander from '../../modules/Commander';
import type {PluginData} from '../../types';
import {rebuild as rebuildFrontend} from '../Frontend';
import * as Observability from '../Observability';
import DirectoryScanner from './DirectoryScanner';
import FrontendHandler from './FrontendHandler';
import Workers from './Workers';

const FRONTEND_SOURCE = path.join(__dirname, '../../../frontend');
const HAS_NPM =
    fs.existsSync('/usr/local/bin/npm') || fs.existsSync('/usr/bin/npm');

const exec = util.promisify(child_process.exec);
log4js.configure(configRc.logger);
const logger = log4js.getLogger('Plugin Loader');

export default class PluginLoader {
    private static readonly pluginDataMap = new Map<string, PluginData>();
    private static syncWorking = false;

    private static getPluginsToAdd(newPlugins: string[], oldPlugins: string[]) {
        return newPlugins.filter((pl) => !oldPlugins.includes(pl));
    }

    private static getPluginsToRemove(
        newPlugins: string[],
        oldPlugins: string[]
    ) {
        return oldPlugins.filter((pl) => !newPlugins.includes(pl));
    }

    private static async sync() {
        const loadedPlugins = Array.from(
            PluginLoader.pluginDataMap.values()
        ).map((plugin) => plugin.info.name);
        const existing = await DirectoryScanner.scanPluginsDir(loadedPlugins);
        const oldPluginNames = Array.from(
            PluginLoader.pluginDataMap.values()
        ).map((data) => data.info.name);
        const newPluginNames = existing.map((i) => i.pluginInfo.name);

        const add = PluginLoader.getPluginsToAdd(
            newPluginNames,
            oldPluginNames
        );
        const remove = PluginLoader.getPluginsToRemove(
            newPluginNames,
            oldPluginNames
        );

        const comps = Commander.getComponents();

        for (const val of add) {
            const p = existing.find((v) => v?.pluginInfo.name === val);
            if (!p) continue;
            PluginLoader.pluginDataMap.set(p.pluginInfo.name, {
                location: p.pluginFolder,
                info: p.pluginInfo
            });

            const name = p?.pluginInfo.name;
            const component = new PluginComponent(name);
            Commander.registerComponent(component);
            const config = component.getConfig();

            // Install plugin deps (skip in Docker — deps are pre-installed at build time)
            if (HAS_NPM) {
                const {stdout, stderr} = await exec('npm install', {
                    cwd: p.pluginFolder,
                    env: {...process.env}
                });
                logger.mark('plugin npm i stdout:', stdout);
                logger.mark('plugin npm i stderr:', stderr);
            }

            if (config.enable === true) {
                await PluginLoader.enablePlugin(name);
            }
        }

        for (const name of remove) {
            comps.delete(name);
            PluginLoader.pluginDataMap.delete(name);
            PluginLoader.disablePlugin(name);
        }

        // Only rebuild frontend when plugins changed and source tree is available
        // (in Docker the frontend is pre-built — no source tree to rebuild from)
        if (
            (add.length > 0 || remove.length > 0) &&
            fs.existsSync(FRONTEND_SOURCE)
        ) {
            // Rebuild in background — backend plugin functionality works immediately
            rebuildFrontend().catch((err) => {
                logger.error('Failed to rebuild frontend during sync', err);
            });
        }
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
            // do not wait for the build
            FrontendHandler.buildFrontendIfNeeded(name).then(
                () => {
                    // TODO: send event for reload
                },
                (err) => {
                    logger.error(
                        "Failed to build frontend for plugin '%s'",
                        name,
                        err
                    );
                }
            );
        }

        Workers.createWorker(pluginData);
        return true;
    }

    public static disablePlugin(name: string) {
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
            FrontendHandler.removeMenuItem(menuItems[0].link);
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
        }, 100);

        FrontendHandler.removeFrontendIfNeeded(name);

        Commander.getComponents().delete(name);

        return true;
    }

    private static folderChanged() {
        logger.debug('plugin folder changed');
        if (PluginLoader.syncWorking) {
            logger.debug('sync already in process, do nothing');
            return;
        }
        PluginLoader.syncWorking = true;
        PluginLoader.sync().finally(() => {
            PluginLoader.syncWorking = false;
        });
    }

    public static async setup() {
        try {
            await fsp.access(PLUGINS_FOLDER);
        } catch {
            // No plugins folder
            logger.warn(
                `Plugins folder "${PLUGINS_FOLDER}" does not exist. Creating it now...`
            );
            await fsp.mkdir(PLUGINS_FOLDER, {recursive: true});
        }

        await PluginLoader.sync();
        fs.watch(PLUGINS_FOLDER, () => {
            PluginLoader.folderChanged();
        });
    }

    public static getPluginData() {
        return PluginLoader.pluginDataMap;
    }
}

Observability.registerModule('plugins', () => ({
    loadedPlugins: PluginLoader.getPluginData().size
}));
