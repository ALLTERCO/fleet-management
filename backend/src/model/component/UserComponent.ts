import { command_sender_t } from "../Commander";
import Component from "./Component";
import * as UserController from "../../model/User";

export default class UserComponent extends Component {
    constructor() {
        super('user');
        this.methods.set('create', (params) => {
            const { username, password, group, permissions }: {
                username: string,
                password: string,
                group: string,
                permissions: string[]
            } = params;

            if (this.config[username]) {
                return Promise.reject({ error: `User '${username}' already created` })
            }
            this.setConfig({
                [username]: { username, password, group, permissions, enabled: true }
            });
            return { created: username }
        });
        this.methods.set('update', (params) => {
            const { username }: { username: string } = params;
            const user = this.config[username];
            if (!user) {
                return Promise.reject({ error: `User '${username}' does not exist` })
            }
            if (params.password) {
                user.password = params.password;
            }
            if (params.group) {
                user.group = params.group;
            }
            if (params.permissions) {
                user.permissions = params.permissions;
            }
            delete params.username;
            return { updated: username, fields: params }
        })
        this.methods.set('delete', (params) => {
            const { username }: { username: string } = params;
            if (!this.config[username]) {
                return Promise.reject({ error: `User '${username}' does not exist` })
            }
            this.setConfig({ [username]: undefined })
            return { deleted: username }
        });
    }

    public override checkParams(method: string, params?: any): boolean {
        switch (method) {
            case 'create':
                return typeof params === 'object'
                    && typeof params.username === 'string'
                    && params.username !== 'DEBUG' // reserved username
                    && typeof params.password === 'string'
                    && typeof params.group === 'string'
                    && typeof params.permissions === 'object'
                    && Array.isArray(params.permissions)
                    && params.permissions.every((e: any) => typeof e === 'string');
            case 'update':
                return typeof params === 'object'
                    && typeof params.username === 'string'
                    && (typeof params.password === 'string' || typeof params.password === 'undefined')
                    && (typeof params.group === 'string' || typeof params.group === 'undefined')
                    && ((typeof params.permissions === 'object' && Array.isArray(params.permissions) && params.permissions.every((e: any) => typeof e === 'string'))
                        || typeof params.permissions === 'undefined');
            case 'delete':
                return typeof params === 'object'
                    && typeof params.username === 'string'
            default:
                return super.checkParams(method, params);
        }
    }

    protected override checkPermissions(sender: command_sender_t, method: string): boolean {
        if (method === 'setconfig') {
            // setconfig can only be accessed from within
            return false;
        }
        return super.checkPermissions(sender, method);
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        return typeof value == 'object';
    }

    protected override applyConfigKey(key: string, value: any, config: Record<string, any>): void {
        if (value == undefined) {
            delete this.config[key];
            return;
        }
        this.config[key] = value;
    }

    protected override getDefaultConfig(): Record<string, any> {
        return {
            admin: {
                username: "admin",
                password: "admin",
                permissions: ["*"],
                group: "admin",
                enabled: true
            },
            user: {
                username: "user",
                password: "user",
                permissions: [
                    "fleetmanager.subscribe",
                    "device.list"
                ],
                group: "user",
                enabled: true
            },
        }
    }

    protected override configChanged(): void {
        UserController.refreshUserConfig()
    }


}