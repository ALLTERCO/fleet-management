import {existsSync} from 'node:fs';
import {stat, symlink, unlink} from 'node:fs/promises';
import path from 'node:path';
import * as Commander from '../Commander';
import {rebuild as rebuildFrontend} from '../Frontend';

export default class FrontendHandler {
    public static async addMenuItems(items: any[]) {
        const existing: Array<{name: string; link: string; icon: string}> =
            (await FrontendHandler.getMenuItems()) ?? [];

        for (const item of items) {
            const {name, link, icon, iconUrl} = item;
            // Use iconUrl if provided, otherwise use icon
            const iconValue = iconUrl || icon;

            // Check if item with same link already exists
            const existingItem = existing.find((e) => e.link === link);

            // If exists with same properties, skip
            if (
                existingItem &&
                existingItem.name === name &&
                existingItem.icon === iconValue
            ) {
                continue;
            }

            // If exists but with different properties, remove old one first
            if (existingItem) {
                await FrontendHandler.removeMenuItem(link);
            }

            await Commander.execInternal('Storage.SetItem', {
                registry: 'ui',
                key: 'menuItems',
                value: {name, link, icon: iconValue}
            });
        }
    }

    public static async removeMenuItem(link: string) {
        return Commander.execInternal('Storage.RemoveItem', {
            registry: 'ui',
            key: 'menuItems',
            value: {link}
        });
    }

    public static async buildFrontendIfNeeded(plugin: string) {
        const {source, dest} = FrontendHandler.getSrcDestPaths(plugin);

        if (!existsSync(source) || existsSync(dest)) {
            return;
        }
        // this will throw if the file does not exist
        await stat(path.join(dest, '../'));
        // hard links are not allowed for directories
        await symlink(source, dest);
        // Rebuild frontend
        rebuildFrontend();
    }

    public static async removeFrontendIfNeeded(plugin: string) {
        const {dest} = FrontendHandler.getSrcDestPaths(plugin);
        if (!existsSync(dest)) {
            // no frontend to remove, do nothing
            return;
        }

        //remove symlink
        await unlink(dest);

        // Rebuild frontend
        rebuildFrontend();
    }

    private static getSrcDestPaths(plugin: string) {
        return {
            source: path.join(
                __dirname,
                '../../../',
                'plugins',
                plugin,
                'frontend'
            ),
            dest: path.join(
                __dirname,
                '../../../../',
                'frontend',
                'src/pages',
                'plugin',
                plugin
            )
        };
    }

    private static async getMenuItems() {
        return await Commander.execInternal('Storage.GetItem', {
            registry: 'ui',
            key: 'menuItems'
        });
    }
}
