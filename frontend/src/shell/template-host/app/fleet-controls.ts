// The only raw device-method table behind the semantic control surface.

import type {DeviceControlSubmitter} from '../core/controls';
import type {DeviceControlRequest} from '../core/types';
import {fleetRpcTransport} from './fleet-rpc';

function wireCommand(request: DeviceControlRequest): {
    method: string;
    params: Record<string, unknown>;
} {
    const {id} = request;
    if (request.kind === 'relay') {
        return {method: 'Switch.Set', params: {id, on: request.on}};
    }
    if (request.kind === 'light') {
        return {
            method: 'Light.Set',
            params: {
                id,
                ...(request.on === undefined ? {} : {on: request.on}),
                ...(request.brightness === undefined
                    ? {}
                    : {brightness: request.brightness})
            }
        };
    }
    if (request.kind === 'cover') {
        if (request.action === 'position') {
            return {
                method: 'Cover.GoToPosition',
                params: {id, pos: request.position}
            };
        }
        const operation = {
            open: 'Cover.Open',
            close: 'Cover.Close',
            stop: 'Cover.Stop'
        }[request.action];
        return {method: operation, params: {id}};
    }
    const method =
        request.action === 'increase'
            ? 'Thermostat.IncreaseTargetTemperature'
            : 'Thermostat.DecreaseTargetTemperature';
    return {
        method,
        params: {
            id,
            ...(request.delta === undefined ? {} : {delta: request.delta})
        }
    };
}

export const fleetControlSubmitter: DeviceControlSubmitter = async (
    request
) => {
    const command = wireCommand(request);
    await fleetRpcTransport.call('device.call', {
        shellyID: request.shellyID,
        method: command.method,
        params: command.params
    });
};
