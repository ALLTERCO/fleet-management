import { Device, GattCharacteristic, GattService } from 'node-ble';
import log4js from 'log4js';
const logger = log4js.getLogger('Bluetooth');

//Shelly BLE service and characteristics UUID (Gen2)
const SHELLY_GATT_SERVICE_UUID = '5f6d4f53-5f52-5043-5f53-56435f49445f';
const SHELLY_GATT_CHARACTERISTICS = {
    RPC_CHAR_DATA_UUID: '5f6d4f53-5f52-5043-5f64-6174615f5f5f',
    RPC_CHAR_TX_CTL_UUID: '5f6d4f53-5f52-5043-5f74-785f63746c5f',
    RPC_CHAR_RX_CTL_UUID: '5f6d4f53-5f52-5043-5f72-785f63746c5f',
};

async function readShellyDataAsync(characteristic: GattCharacteristic, size: number) {
    try {
        let _resultString = '';
        while (_resultString.length < size) {
            // console.log('Reading dataCharacteristic for response');
            const _buf = await characteristic.readValue();
            const _tStr = _buf.toString();
            _resultString += _tStr;
        }
        return _resultString;
    } catch (error) {
        logger.error(`Error reading ble data`)
        return "";
    }
}

const SHELLY_GET_DEVICE_INFO = JSON.stringify({ method: 'Shelly.GetDeviceInfo', params: {}, id: 1 });
const SHELLY_GET_WIFI = JSON.stringify({ method: 'Wifi.GetConfig', params: {}, id: 2 });
const SHELLY_SET_WIFI = (ssid: string, pass: string) => JSON.stringify({
    method: 'Wifi.SetConfig',
    id: 3,
    params: {
        config: { ssid, pass, enable: true}
    }
});
const SHELLY_SET_WS = (server: string) => JSON.stringify({
    method: 'Ws.SetConfig',
    id: 4,
    params: {
        config: { server, enable: true, ssl_ca: "*" }
    }
});


export default class ShellyBLE {
    public readonly name;
    private _device: Device;
    private _connected = false;
    private _shellyBLEService?: GattService;
    private _dataCharacteristic?: GattCharacteristic;
    private _rxCharacteristic?: GattCharacteristic;
    private _txCharacteristic?: GattCharacteristic;
    private _cb?: (response: string) => void;

    constructor(device: Device, name: string, responseCb?: (response: string | undefined) => void) {
        this.name = name;
        this._device = device;
        if (responseCb != undefined) {
            this._cb = responseCb;
        }
    }

    async connect() {
        await this._device.connect();

        const gattServer = await this._device.gatt();
        // console.log('GATT server on peripheral aquired');

        this._shellyBLEService = await gattServer.getPrimaryService(SHELLY_GATT_SERVICE_UUID);
        const dataCharacteristic = await this._shellyBLEService.getCharacteristic(SHELLY_GATT_CHARACTERISTICS.RPC_CHAR_DATA_UUID);
        this._dataCharacteristic = dataCharacteristic;
        this._rxCharacteristic = await this._shellyBLEService.getCharacteristic(SHELLY_GATT_CHARACTERISTICS.RPC_CHAR_RX_CTL_UUID);
        this._txCharacteristic = await this._shellyBLEService.getCharacteristic(SHELLY_GATT_CHARACTERISTICS.RPC_CHAR_TX_CTL_UUID);
        this._rxCharacteristic.startNotifications();
        this._rxCharacteristic.on('valuechanged', async (buffer) => {
            let response;
            try {
                // console.log('Result available', buffer.readUInt32BE());
                const _respLength = buffer.readUInt32BE();
                // console.log('Response length', _respLength);
                response = await readShellyDataAsync(dataCharacteristic, _respLength);
                // console.log('Response', _response);

            } catch (error) {
                logger.error(`[${this.name}] failed to parse response`);
            } finally {
                if (this._cb) {
                    this._cb(response || "")
                }
            }
        });
        this._connected = true;
        logger.debug(`[${this.name}] Connected`);
    }

    async send(message: string) {
        if (!this._connected) return false;
        try {
            logger.debug(`[${this.name}] Sending ${message}`);
            const _requestBuf = Buffer.from(message, 'ascii');
            let _requestSizeBuf = Buffer.alloc(4);
            _requestSizeBuf.writeUInt32BE(_requestBuf.length);
            // console.log('Request of size', _requestSizeBuf.length, _requestSizeBuf.toString('hex'));
            await this._txCharacteristic!.writeValue(_requestSizeBuf, { type: 'request' });
            // console.log('Sending request', _requestBuf.toString());
            await this._dataCharacteristic!.writeValue(_requestBuf, { type: 'request' });
            return true;
        } catch (error) {
            logger.error(`[${this.name}] Failed to send message:[${message}]`);

            return false;
        }
    }

    async sendAndWait(message: string, timeout: number) {
        try {
            await this.send(message);
            const resp = new Promise<string | undefined>(resolve => {
                this.onResponse(msg => {
                    logger.debug(`[${this.name}] Received ${msg}`);
                    resolve(msg);
                })
            });
            const timeoutPromise = new Promise<undefined>(
                resolve => setTimeout(() => resolve(undefined), timeout));
            return Promise.race([resp, timeoutPromise]);
        } catch (error) {
            logger.error(`[${this.name}] Error in sendAndWait`);
            return Promise.resolve(undefined)
        }
    }

    async getDeviceInfo(timeout = 5000) {
        return this.sendAndWait(SHELLY_GET_DEVICE_INFO, timeout);
    }

    async getWifi(timeout = 5000) {
        return this.sendAndWait(SHELLY_GET_WIFI, timeout);
    }

    async changeWifi(ssid: string, pass: string, timeout = 5000) {
        return this.sendAndWait(
            SHELLY_SET_WIFI(ssid, pass), timeout
        )
    }

    async changeWs(server: string, timeout = 5000) {
        return this.sendAndWait(SHELLY_SET_WS(server), timeout)
    }

    onResponse(cb: (response: string) => void) {
        this._cb = cb;
    }

    async disconnect() {
        if (!this._connected) return Promise.resolve();
        await this._rxCharacteristic!.stopNotifications();
        await this._device.disconnect();
        logger.debug(`[${this.name}] Disconnected`);
    }
}