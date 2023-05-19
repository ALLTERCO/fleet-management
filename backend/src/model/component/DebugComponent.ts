import Component from "./Component";
import * as User from "../../model/User";

export default class DebugComponent extends Component {
    constructor() {
        super("debug")
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case "allowDebugUser":
                return typeof value === 'boolean'
            default:
                return false;
        }
    }

    protected override applyConfigKey(key: string, value: any, config: Record<string, any>): void {
        super.applyConfigKey(key, value, config);
        switch (key) {
            case 'allowDebugUser':
                const allowed = Boolean(value);
                if (allowed != User.allowDebug) {
                    User.setAllowDebugging(allowed);
                }
                break;
        }
    }

    protected override getDefaultConfig(): Record<string, any> {
        return {
            allowDebugUser: false
        }
    }
}