import * as log4js from 'log4js';
import * as DeviceCollector from '../../modules/DeviceCollector';
import type CommandSender from '../CommandSender';
import Component from './Component';

const logger = log4js.getLogger('FirmwareComponent');

export interface FirmwareComponentConfig {
    enable: boolean;
    autoUpdateDevices: string[]; // shellyIDs with auto-update enabled
    autoUpdateChannel: 'stable' | 'beta';
    lastAutoUpdateRun?: number;
}

interface AutoUpdateParams {
    shellyID: string;
    enabled: boolean;
}

interface AutoUpdateBulkParams {
    shellyIDs: string[];
    enabled: boolean;
}

interface AutoUpdateStatusParams {
    shellyID: string;
}

export default class FirmwareComponent extends Component<FirmwareComponentConfig> {
    constructor() {
        super('firmware', {set_config_methods: false});
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'enable':
                return typeof value === 'boolean';
            case 'autoUpdateDevices':
                return Array.isArray(value);
            case 'autoUpdateChannel':
                return value === 'stable' || value === 'beta';
            case 'lastAutoUpdateRun':
                return typeof value === 'number' || value === undefined;
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override getDefaultConfig(): FirmwareComponentConfig {
        return {
            enable: true,
            autoUpdateDevices: [],
            autoUpdateChannel: 'stable',
            lastAutoUpdateRun: undefined
        };
    }

    @Component.Expose('GetAutoUpdateDevices')
    @Component.ReadOnly
    getAutoUpdateDevices(): string[] {
        return this.config.autoUpdateDevices || [];
    }

    @Component.Expose('SetAutoUpdate')
    @Component.CrudPermission(
        'devices',
        'execute',
        (params) => params?.shellyID
    )
    setAutoUpdate(params: AutoUpdateParams): {success: boolean} {
        const {shellyID, enabled} = params;

        if (!shellyID || typeof enabled !== 'boolean') {
            return {success: false};
        }

        const currentList = this.config.autoUpdateDevices || [];
        const index = currentList.indexOf(shellyID);

        if (enabled && index === -1) {
            // Add to auto-update list
            this.config.autoUpdateDevices = [...currentList, shellyID];
            this._persistConfig();
            logger.info('Auto-update enabled for device:', shellyID);
            return {success: true};
        }

        if (!enabled && index !== -1) {
            // Remove from auto-update list
            this.config.autoUpdateDevices = currentList.filter(
                (id) => id !== shellyID
            );
            this._persistConfig();
            logger.info('Auto-update disabled for device:', shellyID);
            return {success: true};
        }

        // No change needed
        return {success: true};
    }

    @Component.Expose('SetAutoUpdateBulk')
    @Component.WriteOperation
    setAutoUpdateBulk(params: AutoUpdateBulkParams): {updated: string[]} {
        const {shellyIDs, enabled} = params;

        if (!Array.isArray(shellyIDs) || typeof enabled !== 'boolean') {
            return {updated: []};
        }

        const updated: string[] = [];
        let currentList = this.config.autoUpdateDevices || [];

        for (const shellyID of shellyIDs) {
            const index = currentList.indexOf(shellyID);

            if (enabled && index === -1) {
                currentList = [...currentList, shellyID];
                updated.push(shellyID);
            } else if (!enabled && index !== -1) {
                currentList = currentList.filter((id) => id !== shellyID);
                updated.push(shellyID);
            }
        }

        if (updated.length > 0) {
            this.config.autoUpdateDevices = currentList;
            this._persistConfig();
            logger.info(
                'Auto-update %s for devices: %s',
                enabled ? 'enabled' : 'disabled',
                updated.join(', ')
            );
        }

        return {updated};
    }

    @Component.Expose('GetAutoUpdateStatus')
    @Component.ReadOnly
    getAutoUpdateStatus(params: AutoUpdateStatusParams): {enabled: boolean} {
        const {shellyID} = params;

        if (!shellyID) {
            return {enabled: false};
        }

        const isEnabled = (this.config.autoUpdateDevices || []).includes(
            shellyID
        );
        return {enabled: isEnabled};
    }

    @Component.Expose('GetAutoUpdateChannel')
    @Component.ReadOnly
    getAutoUpdateChannel(): {channel: 'stable' | 'beta'} {
        return {channel: this.config.autoUpdateChannel || 'stable'};
    }

    @Component.Expose('SetAutoUpdateChannel')
    @Component.WriteOperation
    setAutoUpdateChannel(params: {channel: 'stable' | 'beta'}): {
        success: boolean;
    } {
        const {channel} = params;

        if (channel !== 'stable' && channel !== 'beta') {
            return {success: false};
        }

        this.config.autoUpdateChannel = channel;
        this._persistConfig();
        logger.info('Auto-update channel set to:', channel);
        return {success: true};
    }

    @Component.Expose('GetLastAutoUpdateRun')
    @Component.ReadOnly
    getLastAutoUpdateRun(): {timestamp: number | null} {
        return {timestamp: this.config.lastAutoUpdateRun || null};
    }

    /**
     * Run auto-update for all devices with auto-update enabled.
     * This method is meant to be called by a cron job.
     */
    async runAutoUpdate(): Promise<{
        checked: number;
        updated: number;
        failed: number;
        results: Array<{
            shellyID: string;
            status: 'updated' | 'no_update' | 'failed' | 'offline';
            error?: string;
        }>;
    }> {
        const channel = this.config.autoUpdateChannel || 'stable';
        const autoUpdateDevices = this.config.autoUpdateDevices || [];

        logger.info(
            'Starting auto-update check for %d devices (channel: %s)',
            autoUpdateDevices.length,
            channel
        );

        const results: Array<{
            shellyID: string;
            status: 'updated' | 'no_update' | 'failed' | 'offline';
            error?: string;
        }> = [];

        let checked = 0;
        let updated = 0;
        let failed = 0;

        for (const shellyID of autoUpdateDevices) {
            const device = DeviceCollector.getDevice(shellyID);

            if (!device) {
                results.push({shellyID, status: 'offline'});
                continue;
            }

            checked++;

            try {
                // Check for updates
                const checkResponse = await device.sendRPC(
                    'Shelly.CheckForUpdate',
                    {}
                );

                const availableUpdate =
                    channel === 'stable'
                        ? checkResponse?.stable
                        : checkResponse?.beta;

                if (!availableUpdate) {
                    results.push({shellyID, status: 'no_update'});
                    continue;
                }

                // Trigger update
                logger.info(
                    'Updating device %s to %s version %s',
                    shellyID,
                    channel,
                    availableUpdate.version
                );

                await device.sendRPC('Shelly.Update', {stage: channel});
                updated++;
                results.push({shellyID, status: 'updated'});
            } catch (error: any) {
                failed++;
                results.push({
                    shellyID,
                    status: 'failed',
                    error: error?.message || String(error)
                });
                logger.error(
                    'Failed to update device %s: %s',
                    shellyID,
                    error?.message || error
                );
            }
        }

        // Update last run timestamp
        this.config.lastAutoUpdateRun = Date.now();
        this._persistConfig();

        logger.info(
            'Auto-update complete: checked=%d, updated=%d, failed=%d',
            checked,
            updated,
            failed
        );

        return {checked, updated, failed, results};
    }

    /**
     * Manually trigger auto-update (for testing or manual invocation).
     * Requires admin permissions.
     */
    @Component.Expose('TriggerAutoUpdate')
    @Component.WriteOperation
    async triggerAutoUpdate(): Promise<{
        checked: number;
        updated: number;
        failed: number;
        results: Array<{
            shellyID: string;
            status: 'updated' | 'no_update' | 'failed' | 'offline';
            error?: string;
        }>;
    }> {
        return await this.runAutoUpdate();
    }
}
