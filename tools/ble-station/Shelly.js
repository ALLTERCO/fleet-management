"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connect = void 0;
const stream_1 = require("stream");
//Shelly BLE service and characteristics UUID (Gen2)
const SHELLY_GATT_SERVICE_UUID = '5f6d4f53-5f52-5043-5f53-56435f49445f';
const SHELLY_GATT_CHARACTERISTICS = {
    RPC_CHAR_DATA_UUID: '5f6d4f53-5f52-5043-5f64-6174615f5f5f',
    RPC_CHAR_TX_CTL_UUID: '5f6d4f53-5f52-5043-5f74-785f63746c5f',
    RPC_CHAR_RX_CTL_UUID: '5f6d4f53-5f52-5043-5f72-785f63746c5f',
};
function readShellyDataAsync(characteristic, size) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let _resultString = '';
            while (_resultString.length < size) {
                // console.log('Reading dataCharacteristic for response');
                const _buf = yield characteristic.readValue();
                const _tStr = _buf.toString();
                _resultString += _tStr;
            }
            return _resultString;
        }
        catch (error) {
            console.error(`Error reading ble data`);
            return "";
        }
    });
}
function connect(device, name) {
    return __awaiter(this, void 0, void 0, function* () {
        const eventEmitter = new stream_1.EventEmitter();
        const waiting = new Map();
        let waitingId = 0;
        let openned = false;
        yield device.connect();
        const gattServer = yield device.gatt();
        // console.log('GATT server on peripheral aquired');
        const shellyBLEService = yield gattServer.getPrimaryService(SHELLY_GATT_SERVICE_UUID);
        const dataCharacteristic = yield shellyBLEService.getCharacteristic(SHELLY_GATT_CHARACTERISTICS.RPC_CHAR_DATA_UUID);
        const rxCharacteristic = yield shellyBLEService.getCharacteristic(SHELLY_GATT_CHARACTERISTICS.RPC_CHAR_RX_CTL_UUID);
        const txCharacteristic = yield shellyBLEService.getCharacteristic(SHELLY_GATT_CHARACTERISTICS.RPC_CHAR_TX_CTL_UUID);
        eventEmitter.emit('open');
        openned = true;
        rxCharacteristic.startNotifications();
        rxCharacteristic.on('valuechanged', (buffer) => __awaiter(this, void 0, void 0, function* () {
            try {
                // console.log('Result available', buffer.readUInt32BE());
                const respLength = buffer.readUInt32BE();
                // console.log('Response length', _respLength);
                const response = yield readShellyDataAsync(dataCharacteristic, respLength);
                // console.log('Response', _response);
                const message = JSON.parse(response);
                if (message.id && waiting.has(message.id)) {
                    waiting.get(message.id)(message);
                }
                eventEmitter.emit('message', message);
            }
            catch (error) {
                eventEmitter.emit('read_error', error, buffer);
            }
        }));
        function send(method, params, cb) {
            return __awaiter(this, void 0, void 0, function* () {
                const message = JSON.stringify({
                    id: waitingId,
                    src: 'fleet-manager-ble',
                    method,
                    params
                });
                waitingId++;
                if (cb) {
                    waiting.set(waitingId, cb);
                }
                const _requestBuf = Buffer.from(message, 'ascii');
                let _requestSizeBuf = Buffer.alloc(4);
                _requestSizeBuf.writeUInt32BE(_requestBuf.length);
                // console.log('Request of size', _requestSizeBuf.length, _requestSizeBuf.toString('hex'));
                yield txCharacteristic.writeValue(_requestSizeBuf, { type: 'request' });
                // console.log('Sending request', _requestBuf.toString());
                yield dataCharacteristic.writeValue(_requestBuf, { type: 'request' });
            });
        }
        function disconnect() {
            return __awaiter(this, void 0, void 0, function* () {
                yield rxCharacteristic.stopNotifications();
                yield device.disconnect();
                eventEmitter.emit('close');
                eventEmitter.removeAllListeners();
                console.debug(`[${name}] Disconnected`);
            });
        }
        function on(event, cb) {
            eventEmitter.on(event, cb);
            if (event === 'open' && openned) {
                eventEmitter.emit('open');
            }
        }
        return {
            send,
            disconnect,
            on
        };
    });
}
exports.connect = connect;
