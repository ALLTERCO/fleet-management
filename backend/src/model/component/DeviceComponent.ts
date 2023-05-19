import Component from "./Component";
import * as DeviceManager from "../../DeviceManager";

export default class DeviceComponent extends Component {
    constructor(){
        super('device');
        this.methods.set('list', () => {
            let printDevices: { [key: string]: any } = {};
            for (const device of DeviceManager.getAll()) if (device.ready) {
                printDevices[device.shellyID] = device.toJSON();
            }
            return printDevices;
        });
    }
}