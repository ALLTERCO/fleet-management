import * as fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import log4js from 'log4js';
import {PLUGINS_FOLDER} from '../../config';
import {tuning} from '../../config/tuning';
import type {PluginInfo} from '../../types';
import {bestEffort} from '../util/fireAndForget';
import {normalisePluginName} from './pluginName';

const logger = log4js.getLogger('plugin-loader');

interface LoadedPluginData {
    pluginInfo: PluginInfo;
    pluginFolder: string;
}

function isPluginInfo(pluginInfo: any): pluginInfo is PluginInfo {
    return (
        typeof pluginInfo === 'object' &&
        typeof pluginInfo.name === 'string' &&
        typeof pluginInfo.version === 'string' &&
        typeof pluginInfo.description === 'string'
    );
}

export default class DirectoryScanner {
    private static async readPluginDir(
        entry: string,
        loadedPlugins: string[]
    ): Promise<LoadedPluginData | undefined> {
        // .gitkeep is not a plugin
        if (entry === '.gitkeep') return;
        try {
            const pluginFolder = path.join(PLUGINS_FOLDER, entry);
            const folderStat = await fs.stat(pluginFolder);

            if (!folderStat.isDirectory()) {
                logger.error(`'${pluginFolder}' is not a folder?`);
                return;
            }
            const filePath = path.join(pluginFolder, 'package.json');
            const packageJsonFile = await fs.readFile(filePath);
            const pluginInfo = JSON.parse(packageJsonFile.toString('utf8'));
            // Check if pluginInfo(package.json) has all the required information
            if (!isPluginInfo(pluginInfo)) {
                logger.error(
                    `Invalid data format in 'package.json' in '${pluginFolder}'.`
                );
                return undefined;
            }

            const pluginName = normalisePluginName(pluginInfo.name);
            if (!pluginName) {
                logger.error(
                    `Unsafe plugin name in 'package.json' in '${pluginFolder}'.`
                );
                return undefined;
            }
            pluginInfo.name = pluginName;

            if (loadedPlugins.includes(pluginInfo.name)) {
                logger.debug(
                    'skipping plugin %s, already loaded',
                    pluginInfo.name
                );
                return undefined;
            }

            return {pluginInfo, pluginFolder};
        } catch (e) {
            logger.error('General load error', e);
            return undefined;
        }
    }

    private static async unzip(entry: string) {
        if (!entry.endsWith('.zip')) return;
        const fullpath = path.join(PLUGINS_FOLDER, entry);

        logger.debug('we have detected an uploaded plugin', entry, fullpath);

        const zip = new AdmZip(fullpath);
        const entries = zip.getEntries();

        // Zip-bomb guards — entry count, nesting depth, total uncompressed bytes.
        if (entries.length > tuning.plugin.maxFiles) {
            await bestEffort('rm.plugin-zip-rejected', fs.rm(fullpath));
            throw new Error(
                `plugin zip rejected: ${entries.length} entries exceeds max ${tuning.plugin.maxFiles}`
            );
        }
        let totalBytes = 0;
        const resolvedPlugins = path.resolve(PLUGINS_FOLDER);
        for (const e of entries) {
            const depth =
                e.entryName.split('/').filter((s) => s.length > 0).length - 1;
            if (depth > tuning.plugin.maxDepth) {
                await bestEffort('rm.plugin-zip-rejected', fs.rm(fullpath));
                throw new Error(
                    `plugin zip rejected: entry "${e.entryName}" exceeds max depth ${tuning.plugin.maxDepth}`
                );
            }
            totalBytes += e.header.size;
            if (totalBytes > tuning.plugin.maxUncompressedBytes) {
                await bestEffort('rm.plugin-zip-rejected', fs.rm(fullpath));
                throw new Error(
                    `plugin zip rejected: uncompressed total exceeds ${tuning.plugin.maxUncompressedBytes} bytes`
                );
            }
            const target = path.resolve(PLUGINS_FOLDER, e.entryName);
            if (!target.startsWith(resolvedPlugins + path.sep)) {
                logger.warn(
                    'Zip entry path traversal blocked: %s',
                    e.entryName
                );
                continue;
            }
            // overwrite=false — collisions require manual cleanup.
            zip.extractEntryTo(e, PLUGINS_FOLDER, true, false);
        }

        const macosDir = path.join(PLUGINS_FOLDER, '__MACOSX');
        await bestEffort(
            'rm.plugin-macosx-meta',
            fs.rm(macosDir, {recursive: true, force: true})
        );

        await fs.rm(fullpath);
        logger.debug('unzipped & deleted ', entry);
    }

    public static async scanPluginsDir(
        loadedPlugins: string[] = []
    ): Promise<LoadedPluginData[]> {
        let dir: string[] = [];
        try {
            dir = await fs.readdir(PLUGINS_FOLDER);
        } catch (e) {
            logger.warn('Failed to scan dir %s', PLUGINS_FOLDER, e);
            return [];
        }

        const zipped = dir.find((entry) => entry.endsWith('.zip'));
        if (zipped) {
            await DirectoryScanner.unzip(zipped);
            return await DirectoryScanner.scanPluginsDir(loadedPlugins);
        }

        const pluginDataArr: LoadedPluginData[] = [];

        for (const entry of dir) {
            const pluginData = await DirectoryScanner.readPluginDir(
                entry,
                loadedPlugins
            );
            if (pluginData) {
                pluginDataArr.push(pluginData);
            }
        }

        return pluginDataArr;
    }
}
