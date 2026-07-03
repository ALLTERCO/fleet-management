import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getLogger} from 'log4js';
import {CFG_FOLDER} from './paths';

const logger = getLogger('components');

const COMPONENT_CONFIG_FOLDER = path.join(CFG_FOLDER, 'components');

function getCfgPath(component: string) {
    return path.join(
        path.join(
            COMPONENT_CONFIG_FOLDER,
            `${encodeURIComponent(component)}.json`
        )
    );
}

async function deleteTempConfig(tmpPath: string): Promise<void> {
    try {
        await unlink(tmpPath);
    } catch (error) {
        logger.debug('Failed to delete temp config %s: %s', tmpPath, error);
    }
}

export function getConfigSync(
    componentName: string,
    defaultConfig: Record<string, any>
) {
    const cfgPath = getCfgPath(componentName);
    if (existsSync(cfgPath)) {
        try {
            const contents = readFileSync(cfgPath, 'utf-8');
            return JSON.parse(contents);
        } catch (error) {
            logger.error('Failed to parse config %s: %s', cfgPath, error);
        }
    }
    return defaultConfig;
}

export async function getConfig(
    component: string,
    defaultConfig: Record<string, any>
) {
    const cfgPath = getCfgPath(component);
    if (existsSync(cfgPath)) {
        try {
            const contents = await readFile(cfgPath, 'utf-8');
            return JSON.parse(contents);
        } catch (err) {
            logger.error('Failed to load config for %s: %s', component, err);
        }
    }
    return defaultConfig;
}

export async function saveConfig(component: string, config: any) {
    const cfgPath = getCfgPath(component);
    await mkdir(COMPONENT_CONFIG_FOLDER, {recursive: true});
    const tmpPath = `${cfgPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(tmpPath, JSON.stringify(config));
        await rename(tmpPath, cfgPath);
    } catch (error) {
        await deleteTempConfig(tmpPath);
        throw error;
    }
}
