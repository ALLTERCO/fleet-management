import ShellyDevice from "./model/ShellyDevice";
import * as EventManager from "./EventManager";
import * as log4js from "log4js";
import Commander from "./model/Commander";
import Component from "./model/component/Component";
const logger = log4js.getLogger('DeviceManager');

const devices = new Map<string, ShellyDevice>();

export function register(shelly: ShellyDevice) {
    const old = devices.get(shelly.shellyID);

    if (old != undefined) {
        logger.mark("destroying old connection shellyID:[%s]", shelly.shellyID)
        old.destroy();
    }

    if (shelly.source === 'local') {
        if (devices.get(shelly.shellyID.replace('.local', '')) != undefined) {
            logger.mark("destroying duplicate mdns connection shellyID:[%s]", shelly.shellyID)
            shelly.destroy();
            return;
        }
    }

    logger.mark("registering new device id:[%s] prot:[%s]", shelly.shellyID, shelly.source);

    shelly.on('close', () => {
        unregister(shelly, false);
    })

    shelly.on('message', (res, req) => {
        handleMessage(shelly, res, req);
    });

    devices.set(shelly.shellyID, shelly);
}

export function unregister(shelly: ShellyDevice, destroy = true) {
    logger.info("Unregister device id:[%s] prot:[%s] destroy:[%s]", shelly.shellyID, shelly.source, destroy);

    if (destroy) {
        shelly.destroy();
    }
    if (devices.has(shelly.shellyID)) {
        EventManager.emitShellyDisconnected(shelly);
        devices.delete(shelly.shellyID);
    }
}

export function getAll(): IterableIterator<ShellyDevice> {
    return devices.values();
}

export function getDevice(shellyID: string) {
    return devices.get(shellyID);
}

export function destroyAll() {
    for (const shelly of getAll())
        shelly.destroy();
}

function mergeStatusObjects(original: any, patch: any) {
    if (typeof original === 'object' && typeof patch === 'object' && patch != null) {
        for (const key in original) if (original.hasOwnProperty(key)) {
            if (!patch.hasOwnProperty(key) || typeof patch[key] === 'undefined') continue;

            if (typeof original[key] === 'object') {
                original[key] = mergeStatusObjects(original[key], patch[key])
            } else {
                original[key] = patch[key]
            }
        }
    }
    return original;
}

function patchStatus(shelly: ShellyDevice, data: any) {
    let status = undefined;

    for (const key in data) {
        if (shelly.status[key]) {
            if (status == undefined) { // only copy when needed
                status = Object.assign({}, shelly.status)
            }
            status[key] = mergeStatusObjects(status[key], data[key]);
        }
    }

    if (status != undefined) {
        shelly.status = status;
    }
}

function handleMessage(shelly: ShellyDevice, res: ShellyMessageIncoming, req?: ShellyMessageData) {
    if (typeof req?.method === 'string' && res.result != undefined) {
        let old_ready = shelly.ready;
        switch (req.method.toLocaleLowerCase()) {
            case 'shelly.getstatus':
                shelly.status = res.result;
                break;
            case 'shelly.getconfig':
                shelly.settings = res.result;
                break;
            case 'shelly.getdeviceinfo':
                shelly.deviceInfo = res.result;
                break;
            case 'kvs.getmany':
                const component = Commander.getInstance().Groups;
                let groups = component.getConfig();
                if (typeof res.result?.items === 'object') {
                    const items: Record<string, { value: string, etag: string }> = res.result.items;
                    logger.info('kvs values', Object.keys(items))
                    const foundGroups: Record<string, string> = {};
                    for (const item in items) if (item.startsWith('_FM:')) {
                        const groupName = item.substring(4);
                        const groupValue = items[item].value;
                        if (groups[groupName] && groups[groupName].includes(groupValue)) {
                            foundGroups[groupName] = groupValue;
                        }
                    }
                    shelly.groups = foundGroups;
                }
                break;
        }

        // ready status has changed
        if (!old_ready && shelly.ready) {
            logger.info("successfully connected new shellyID:[%s]", shelly.shellyID)
            EventManager.emitShellyConnected(shelly)
        }
    }

    // period updates
    if (res.method == "NotifyStatus") {
        patchStatus(shelly, res.params);
    }

    if (res.method == 'NotifyEvent') {
        if (typeof res.params?.events === 'object' && Array.isArray(res.params.events)) {
            for (const event of res.params.events) {
                if (typeof event === 'object') {
                    if (event.component === 'sys' && event.event == 'config_changed') {
                        // config has changed, update it
                        shelly.shellyRPC('Shelly.GetConfig');
                        shelly.shellyRPC('Shelly.GetDeviceInfo');
                    }
                }
            }
        }
    }

    // logger.debug("new message shelly_id:[%s] msg:[%s]", shelly.shellyID, JSON.stringify(res));

    EventManager.emitShellyMessage(shelly, res, req)
}