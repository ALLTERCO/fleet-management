import Component from "./Component";
import * as mdns from "../../controller/mdns";

export default class MdnsComponent extends Component {

    constructor(){
        super("mdns");
    }

    override getStatus(params?: any) {
        return {
            running: mdns.started(),
            devices: mdns.devices
        }
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch(key){
            case 'enable':
                return typeof value === 'boolean';
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override applyConfigKey(key: string, value: any, config: Record<string, any>): void {
        if(key === 'enable'){
            if(value && !mdns.started()){
                mdns.start();
            } else if(!value && mdns.started()){
                mdns.stop();
            }
        }
        super.applyConfigKey(key, value, config);
    }

    protected override getDefaultConfig(): Record<string, any> {
        return {
            enable: false
        }
    }
}