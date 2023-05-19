import { command_sender_t } from "../Commander";
import Component from "./Component";

export default class GroupsComponent extends Component {
    constructor() {
        super("groups");
        this.methods.set('create', (params) => {
            const { name, values }: { name: string, values: string[] } = params;
            if(this.config[name]){
                return Promise.reject({ error: `Group '${name}' already created`})
            }
            this.setConfig({ [name]: values });
            return { created: name }
        });
        this.methods.set('update', (params) => {
            const { name, values }: { name: string, values: string[] } = params;
            if(!this.config[name]){
                return Promise.reject({ error: `Group '${name}' does not exist`})
            }
            this.setConfig({ [name]: values });
            return { updated: name }
        });
        this.methods.set('delete', (params) => {
            const { name }: { name: string } = params;
            if(!this.config[name]){
                return Promise.reject({ error: `Group '${name}' does not exist`})
            }
            this.setConfig({[name]: undefined})
            return { deleted: name }
        });
        this.methods.set('list', () => {
            return this.config;
        })
        this.methods.delete('setconfig');
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        return typeof value == 'object';
    }

    public override checkParams(method: string, params?: any): boolean {
        switch (method) {
            case 'create':
            case 'update':
                return typeof params === 'object'
                    && typeof params.name === 'string'
                    && typeof params.values === 'object'
                    && Array.isArray(params.values)
                    && params.values.every((e:any) => typeof e === 'string')
            case 'delete':
                return typeof params === 'object'
                    && typeof params.name === 'string'
            default:
                return super.checkParams(method, params);
        }
    }

    protected override applyConfigKey(key: string, value: any, config: Record<string, any>): void {
        if(value == undefined){
            delete this.config[key];
            return;
        }
        this.config[key] = value;
    }

    protected override checkPermissions(sender: command_sender_t, method: string): boolean {
        if(method === 'setconfig'){
            // setconfig can only be accessed from within
            return false;
        }
        return super.checkPermissions(sender, method)
    }

}