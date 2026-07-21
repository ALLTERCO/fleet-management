import log4js from 'log4js';
import createMdns from 'multicast-dns';
import ShellyDeviceFactory from '../model/ShellyDeviceFactory';
import HttpTransport from '../model/transport/HttpTransport';
import * as DeviceCollector from './DeviceCollector';
import {
    claimDeviceRuntimeOwnership,
    releaseDeviceRuntimeOwnership
} from './deviceIdentityRuntime';
import {
    ingressConnect,
    ingressDropped,
    ingressRegistered
} from './deviceIngress/ingressTrace';
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
        const answers: any[] = response.answers ?? [];
        const additional: any[] = response.additionals ?? [];
        const allRecords = [...answers, ...additional];
        if (allRecords.length === 0) return;

        // Only process responses that advertise _shelly._tcp — the official
        // mDNS service type for all Shelly, Powered by Shelly, and Shelly X devices.
        const hasShellyService =
            allRecords.some(
                (r) =>
                    r.type === 'PTR' &&
                    typeof r.data === 'string' &&
                    r.data.includes('_shelly._tcp')
            ) ||
            allRecords.some(
                (r) =>
                    typeof r.name === 'string' &&
                    r.name.includes('_shelly._tcp')
            );
        if (!hasShellyService) return;

        const nameRec = allRecords.find(({type}) => type === 'A');
        if (!nameRec) return;

        const shellyId = nameRec.name.replace(/\.local$/i, '').toLowerCase();
        // Skip if already known
        if (
            DeviceCollector.getDevice(shellyId) ||
            DeviceCollector.getDevice(shellyId.toLowerCase())
        ) {
            return;
        }
        const ip = nameRec.data;
        let ownershipHeld = false;
        try {
            // mDNS is a separate door — the LAN discovery is this device's birth.
            ingressConnect(shellyId);
            ownershipHeld = await claimDeviceRuntimeOwnership(shellyId);
            if (!ownershipHeld) {
                ingressDropped(shellyId, 'mdns_owned_by_peer');
                return;
            }
            const transport = new HttpTransport(ip);
            const shellyDevice = await ShellyDeviceFactory.fromHttp(transport);
            DeviceCollector.register(shellyDevice);
            Observability.incrementCounter('mdns_discovered');
            ingressRegistered(shellyId, `mdns ${shellyDevice.shellyID}`);
        } catch (err) {
            if (ownershipHeld) {
                await releaseDeviceRuntimeOwnership(shellyId);
            }
            ingressDropped(shellyId, 'mdns_fetch_failed');
            logger.warn('Failed to register mDNS device at %s: %s', ip, err);
        }
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

Observability.registerModule('mdns', {
    stats: () => ({
        running: mdns !== undefined ? 1 : 0
    }),
    topology: {
        role: 'source',
        cluster: 'ingest',
        zone: 'device_admission',
        downstreams: ['devices'],
        label: 'mDNS',
        description: 'Local-network device discovery',
        route: '/monitoring/services'
    }
});
