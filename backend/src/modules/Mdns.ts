import log4js from 'log4js';
import createMdns from 'multicast-dns';
import ShellyDeviceFactory from '../model/ShellyDeviceFactory';
import HttpTransport from '../model/transport/HttpTransport';
import * as DeviceCollector from './DeviceCollector';
import * as Observability from './Observability';

const logger = log4js.getLogger('local-scanner');
let mdns: ReturnType<typeof createMdns> | undefined;

export function start() {
    if (mdns) {
        logger.warn('mdns already started, not starting again');
        return;
    }

    mdns = createMdns();
    logger.debug('created mdns object');
    mdns.on('response', async (response: any) => {
        const {answers} = response;
        if (
            answers === undefined ||
            !Array.isArray(answers) ||
            answers.length === 0
        )
            return;
        const nameRec = answers.find(({type}) => type === 'A');
        const txtRec = answers.find(({type}) => type === 'TXT');
        if (!nameRec || !txtRec?.data) {
            logger.info(
                'mdns assert fail: nameRec[%s];txtRec?.data[%s]',
                nameRec && JSON.stringify(nameRec),
                txtRec?.data && JSON.stringify(txtRec?.data)
            );
            return;
        }
        const name = nameRec.name.toLowerCase();
        const shellyId = nameRec.name.replace('.local', '');
        if (
            !name.includes('shelly') ||
            DeviceCollector.getDevice(shellyId) ||
            DeviceCollector.getDevice(shellyId.toLowerCase())
        ) {
            logger.info(
                'mdns assert fail: name[%s];name.includes[%s];DeviceManager.getDevice[%s]',
                name,
                name.includes('shelly'),
                shellyId
            );
            return;
        }
        const dataStr = JSON.stringify(
            (Array.isArray(txtRec.data) &&
                txtRec.data.map((b: Buffer) => b.toString('utf8'))) ||
                txtRec.data
        );
        if (!(dataStr.includes('gen=2') || dataStr.includes('gen=3'))) {
            logger.info(
                'mdns assert fail: dataStr.includes:g2|g3[%s]',
                dataStr
            );
            return;
        }
        const ip = nameRec.data;
        const transport = new HttpTransport(ip);
        const shellyDevice = await ShellyDeviceFactory.fromHttp(transport);
        DeviceCollector.register(shellyDevice);
        Observability.incrementCounter('mdns_discovered');
    });
}

export function stop() {
    if (mdns === undefined) {
        logger.warn('mdns not started, nothing to stop');
        return;
    }
    mdns.removeAllListeners();
    mdns.destroy();
    mdns = undefined;
}

export function started() {
    return mdns !== undefined;
}

Observability.registerModule('mdns', () => ({
    running: mdns !== undefined ? 1 : 0
}));
