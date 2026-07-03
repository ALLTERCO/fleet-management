import {createHostDomain} from './domain';

export const configurations = {
    device: createHostDomain('device'),
    cloud: createHostDomain('cloud'),
    wifi: createHostDomain('wifi'),
    eth: createHostDomain('eth'),
    ble: createHostDomain('ble'),
    knx: createHostDomain('knx'),
    modbus: createHostDomain('modbus'),
    mqtt: createHostDomain('mqtt'),
    script: createHostDomain('script'),
    sys: createHostDomain('sys'),
    web: createHostDomain('web')
};
