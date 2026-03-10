import {exec} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import AdmZip from 'adm-zip';
import log4js from 'log4js';
import {PLUGINS_FOLDER} from '../../config';
import type {PluginInfo} from '../../types';

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

            if (loadedPlugins.includes(pluginInfo.name)) {
                logger.debug(
                    'skipping plugin %s, already loaded',
                    pluginInfo.name
                );
                return undefined;
            }

            pluginInfo.name =
                (pluginInfo.name.startsWith('@') &&
                    pluginInfo.name.split('/').at(-1)) ||
                pluginInfo.name;

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
        zip.extractAllTo(PLUGINS_FOLDER, true); // overwrite = true

        // Clean up macOS metadata folder if present
        const macosDir = path.join(PLUGINS_FOLDER, '__MACOSX');
        await fs.rm(macosDir, {recursive: true, force: true}).catch(() => {});

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
