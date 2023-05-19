import createMdns from "multicast-dns";
import log4js from 'log4js';
const logger = log4js.getLogger('local-scanner');
import * as DeviceManager from "../DeviceManager";
import ShellyDevice from "../model/ShellyDevice";
import LocalNetworkTransport from "../model/transport/LocalNetworkTransport";

let mdns: ReturnType<typeof createMdns> | undefined = undefined;
export const devices = [] as string[];

async function addLocalDevice(shellyID: string) {
    devices.push(shellyID);
    try {
        const response = await fetch(`http://${shellyID}/shelly`).then(res => res.json());
        // mainly check for a valid json response, but also double check for gen 2
        if (response.gen == 2) {
            DeviceManager.register(new ShellyDevice(shellyID, {
                transport: new LocalNetworkTransport(shellyID),
                source: 'local'
            }))
        }
    } catch (error) {
        logger.mark("cannot connect to discovered local shellyID:[%s], ignoring", shellyID);
    }
}

function matchesShellyPattern(name: string, type: string) {
    return name.includes("shelly") && name.includes("._http._tcp") && type === 'TXT'
}

export function start() {
    if (mdns) {
        logger.warn("mdns already started, not starting again");
        return;
    }

    mdns = createMdns();
    mdns.on('response', async (response, info) => {
        const { answers } = response;
        if (answers == undefined || !Array.isArray(answers) || answers.length == 0) return;

        for (const ans of answers) {
            const name = ans.name.toLowerCase();
            if (!matchesShellyPattern(name, ans.type)) continue;
            const shellyID = name.replace("._http._tcp", "").toLowerCase();
            // check if already discovered
            if (devices.includes(shellyID)) continue;
            const data = String((<any>ans).data);
            // check for gen 2
            if (!data.includes("gen=2")) continue;
            logger.mark("found data app=[%s] data=[%s]", ans.name, data);
            addLocalDevice(shellyID);
        }
    });
}

export function stop(){
    if(mdns == undefined){
        logger.warn("mdns not started, nothing to stop");
        return;
    }
    for(const shellyID of devices){
        const shelly = DeviceManager.getDevice(shellyID);
        if(shelly){
            DeviceManager.unregister(shelly, true)
        }
    }
    devices.length = 0;
    mdns = undefined;
}

export function started(){
    return mdns !== undefined;
}
