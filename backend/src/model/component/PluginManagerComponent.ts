/**
 * Plugin namespace — plugin registry + lifecycle.
 *
 * Fleet-wide plugin management methods:
 *   - Plugin.List
 *   - Plugin.Upload
 *   - Plugin.Remove
 *
 * Not to be confused with the pre-existing per-plugin `PluginComponent`
 * instances (one per loaded plugin, namespace `plugin:<name>`) — this
 * component owns the bare `plugin` namespace for management operations.
 *
 * Permissions: `mapLegacyComponentName('plugin')` returns null so each
 * method carries an explicit decorator. Upload / Remove require admin;
 * List uses an explicit authenticated-read policy because plugin listing is
 * already visible to any
 * logged-in user through the per-plugin config endpoints). Config values
 * are redacted for non-admins so stored API keys, tokens, etc. never
 * leak through List.
 */

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PLUGINS_FOLDER, tuning} from '../../config';
import {
    canUseAuthenticatedRead,
    canUsePlatformAdmin
} from '../../modules/authz/evaluator';
import * as Commander from '../../modules/Commander';
import {PluginLoader} from '../../modules/plugins';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {redactSecrets} from '../../rpc/redact';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {PluginData} from '../../types';
import {
    PLUGIN_DESCRIBE,
    PLUGIN_LIST_PARAMS_SCHEMA,
    PLUGIN_REMOVE_PARAMS_SCHEMA,
    PLUGIN_UPLOAD_PARAMS_SCHEMA
} from '../../types/api/plugin';
import type CommandSender from '../CommandSender';
import Component from './Component';

// redactSecrets / SECRET_KEY_PATTERN live in rpc/redact.ts so they
// are testable in isolation (importing this component pulls the full
// plugin graph, which TDZ-faults in a bare node --test context).

export default class PluginManagerComponent extends Component {
    constructor() {
        super('plugin', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PLUGIN_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.Alias('pluginmgr.list')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    list(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            PLUGIN_LIST_PARAMS_SCHEMA
        );
        const pluginsMap = PluginLoader.listPlugins() as Record<
            string,
            PluginData & {config?: unknown}
        >;
        // Raw config can carry instance secrets — provider support only.
        const seeSecrets = canUsePlatformAdmin(sender);
        const items = Object.entries(pluginsMap).map(([name, plugin]) => {
            // Commander.registerComponent lowercases the key, so match that
            // path here — otherwise a plugin registered as `plugin:Foo`
            // would be registered as `plugin:foo` and this lookup would
            // miss, leaving `config` permanently undefined.
            const rawConfig = Commander.getComponent(
                `plugin:${name.toLowerCase()}`
            )?.getConfig();
            const config = seeSecrets ? rawConfig : redactSecrets(rawConfig);
            return {name, ...plugin, config};
        });
        return buildListResponse(items, items.length, 0, 0);
    }

    // Plugins run in-process fleet-wide — provider support only.
    @Component.Expose('Upload')
    @Component.Alias('pluginmgr.upload')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async upload(params: unknown) {
        const v = validateOrThrow<{data: string}>(
            params,
            PLUGIN_UPLOAD_PARAMS_SCHEMA
        );
        if (v.data.length > 67_108_864) {
            // 67MB base64 ≈ 50MB decoded
            throw RpcError.InvalidParams(
                'Plugin data must be under 50MB (67MB base64-encoded)'
            );
        }
        const fileData = Buffer.from(v.data, 'base64');
        // OWASP ASVS V12.2.1 — belt-and-braces post-decode cap. Base64 length
        // is an upper bound only; an actor can pad with high-entropy data
        // pushing the decoded buffer up to ~75% of the encoded length.
        if (fileData.byteLength > tuning.plugin.maxDecodedBytes) {
            throw RpcError.InvalidParams(
                `Plugin decoded size ${fileData.byteLength} exceeds cap ${tuning.plugin.maxDecodedBytes}`
            );
        }
        const filePath = path.join(PLUGINS_FOLDER, 'upload.zip');
        await fs.writeFile(filePath, fileData);
        return null;
    }

    @Component.Expose('Remove')
    @Component.Alias('pluginmgr.remove')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async remove(params: unknown) {
        const v = validateOrThrow<{name: string}>(
            params,
            PLUGIN_REMOVE_PARAMS_SCHEMA
        );
        const dir = path.resolve(PLUGINS_FOLDER, v.name);
        const pluginsRoot = path.resolve(PLUGINS_FOLDER) + path.sep;
        if (!dir.startsWith(pluginsRoot)) {
            throw RpcError.InvalidParams('Invalid plugin name');
        }
        // Resolve symlinks to prevent escape via symlinked directories
        let realDir: string;
        try {
            realDir = fsSync.realpathSync(dir);
        } catch {
            // Directory doesn't exist — nothing to delete
            return {removed: v.name};
        }
        const realRoot = fsSync.realpathSync(PLUGINS_FOLDER) + path.sep;
        if (!realDir.startsWith(realRoot)) {
            throw RpcError.InvalidParams('Invalid plugin path');
        }
        await PluginLoader.disablePlugin(v.name);
        try {
            await fs.rm(dir, {recursive: true, force: true});
            this.logger.mark(`Deleted plugin folder: ${dir}`);
        } catch (err) {
            this.logger.error(`Failed to delete plugin folder ${dir}`, err);
            throw err;
        }
        return {removed: v.name};
    }
}
