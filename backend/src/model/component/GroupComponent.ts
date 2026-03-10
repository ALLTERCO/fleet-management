import * as log4js from 'log4js';
import * as EventDistributor from '../../modules/EventDistributor';
import * as postgres from '../../modules/PostgresProvider';
import type {Group as Params} from '../../validations/params';
import type CommandSender from '../CommandSender';
import Component from './Component';

const logger = log4js.getLogger('GroupComponent');

interface Group {
    id: number;
    name: string;
    devices: string[];
    metadata?: Record<string, any>;
    parentId?: number | null;
}

export interface GroupComponentConfig {
    enable: boolean;
    // groups are now stored in DB, not in config
}

export default class GroupComponent extends Component<GroupComponentConfig> {
    constructor() {
        super('group', {set_config_methods: false});
    }

    protected override checkConfigKey(key: string, value: any) {
        switch (key) {
            case 'enabled':
                return typeof value === 'boolean';
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override getDefaultConfig(): GroupComponentConfig {
        return {enable: true};
    }

    private normalizeMetadata(value: any): Record<string, any> {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return {};
        return value;
    }

    private normalizeParentId(value: any): number | null {
        if (value === null || typeof value === 'undefined') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    private dbGroupToGroup(dbGroup: postgres.DbGroup): Group {
        return {
            id: dbGroup.id,
            name: dbGroup.name,
            devices: dbGroup.devices || [],
            metadata: dbGroup.metadata || {},
            parentId: dbGroup.parent_id
        };
    }

    @Component.Expose('Create')
    async create(params: Params.Create) {
        const parentId = this.normalizeParentId((params as any).parentId);
        const metadata = this.normalizeMetadata((params as any).metadata);

        try {
            const dbGroup = await postgres.groupCreate(
                params.name,
                metadata,
                parentId,
                params.devices || []
            );

            if (!dbGroup) {
                return {created: false, reason: 'Failed to create group'};
            }

            EventDistributor.invalidateGroupCache();
            return this.dbGroupToGroup(dbGroup);
        } catch (error: any) {
            logger.error('Failed to create group: %s', error.message);
            if (error.message?.includes('Parent group')) {
                return {created: false, reason: 'Parent group does not exist.'};
            }
            return {created: false, reason: error.message};
        }
    }

    @Component.Expose('Add')
    async add({shellyID, id}: Params.Add) {
        try {
            const added = await postgres.groupAddDevice(Number(id), shellyID);
            EventDistributor.invalidateGroupCache(shellyID);
            return {added};
        } catch (error: any) {
            logger.error('Failed to add device to group: %s', error.message);
            return {added: false};
        }
    }

    @Component.Expose('Remove')
    async remove({shellyID, id}: Params.Remove) {
        try {
            const removed = await postgres.groupRemoveDevice(
                Number(id),
                shellyID
            );
            EventDistributor.invalidateGroupCache(shellyID);
            return {removed};
        } catch (error: any) {
            logger.error(
                'Failed to remove device from group: %s',
                error.message
            );
            return {removed: false};
        }
    }

    @Component.Expose('Delete')
    async delete({id}: Params.Delete): Promise<{deleted: boolean}> {
        try {
            // Cascade: delete all children first
            await this.deleteChildren(Number(id));
            const deleted = await postgres.groupDelete(Number(id));
            EventDistributor.invalidateGroupCache();
            return {deleted};
        } catch (error: any) {
            logger.error('Failed to delete group: %s', error.message);
            return {deleted: false};
        }
    }

    private async deleteChildren(parentId: number): Promise<void> {
        const children = await postgres.groupList(parentId);
        for (const child of children) {
            await this.deleteChildren(child.id);
            await postgres.groupDelete(child.id);
        }
    }

    @Component.Expose('List')
    @Component.CrudPermission('groups', 'read')
    async list(params: Params.List, sender: CommandSender) {
        const parentId = this.normalizeParentId((params as any)?.parentId);

        try {
            const dbGroups = await postgres.groupList(parentId);

            // Convert to the expected format (Record<string, Group>)
            const result: Record<string, Group> = {};

            // Admin sees all groups
            if (sender.isAdmin()) {
                for (const dbGroup of dbGroups) {
                    result[dbGroup.id] = this.dbGroupToGroup(dbGroup);
                }
                return result;
            }

            // Use CRUD permission model for scoped access
            for (const dbGroup of dbGroups) {
                if (sender.canPerformOnItem('groups', 'read', dbGroup.id)) {
                    result[dbGroup.id] = this.dbGroupToGroup(dbGroup);
                }
            }

            return result;
        } catch (error: any) {
            logger.error('Failed to list groups: %s', error.message);
            return {};
        }
    }

    @Component.Expose('ListAll')
    @Component.CrudPermission('groups', 'read')
    async listAll(_params: any, sender: CommandSender) {
        try {
            // fn_groups_list(NULL) returns ALL groups in one query
            const dbGroups = await postgres.groupList(null);

            const result: Record<string, Group> = {};
            const isAdmin = sender.isAdmin();
            for (const dbGroup of dbGroups) {
                if (
                    isAdmin ||
                    sender.canPerformOnItem('groups', 'read', dbGroup.id)
                ) {
                    result[dbGroup.id] = this.dbGroupToGroup(dbGroup);
                }
            }
            return result;
        } catch (error: any) {
            logger.error('Failed to list all groups: %s', error.message);
            return {};
        }
    }

    @Component.Expose('Get')
    @Component.CrudPermission('groups', 'read', (params) => params?.id)
    async get({id}: Params.Get) {
        try {
            const dbGroup = await postgres.groupGet(Number(id));
            if (!dbGroup) return null;
            return this.dbGroupToGroup(dbGroup);
        } catch (error: any) {
            logger.error('Failed to get group: %s', error.message);
            return null;
        }
    }

    @Component.Expose('Rename')
    async rename({id, newName}: Params.Rename) {
        try {
            const dbGroup = await postgres.groupUpdate(Number(id), newName);
            if (!dbGroup) {
                return {renamed: false};
            }
            return {renamed: true};
        } catch (error: any) {
            logger.error('Failed to rename group: %s', error.message);
            return {renamed: false};
        }
    }

    @Component.Expose('Set')
    async set(params: Params.Set) {
        const idNum = Number((params as any).id);
        const incoming: any = {...(params as any), id: idNum};

        try {
            // Get existing group to merge with
            const existing = await postgres.groupGet(idNum);

            const parentId =
                typeof incoming.parentId !== 'undefined'
                    ? this.normalizeParentId(incoming.parentId)
                    : (existing?.parent_id ?? null);

            const clearParent = incoming.parentId === null;

            const metadata = this.normalizeMetadata(
                incoming.metadata ?? existing?.metadata
            );

            const devices = Array.isArray(incoming.devices)
                ? incoming.devices
                : (existing?.devices ?? []);

            const dbGroup = await postgres.groupUpdate(
                idNum,
                incoming.name ?? existing?.name,
                metadata,
                parentId,
                devices,
                clearParent
            );

            if (!dbGroup) {
                return params;
            }

            EventDistributor.invalidateGroupCache();
            return this.dbGroupToGroup(dbGroup);
        } catch (error: any) {
            logger.error('Failed to set group: %s', error.message);
            return params;
        }
    }

    @Component.Expose('Find')
    async find({shellyID}: Params.Find) {
        return this.findGroups(shellyID);
    }

    async findGroups(shellyID: string): Promise<number[]> {
        if (!this.config.enable) return [];

        try {
            return await postgres.groupFindByDevice(shellyID);
        } catch (error: any) {
            logger.error('Failed to find groups for device: %s', error.message);
            return [];
        }
    }
}
