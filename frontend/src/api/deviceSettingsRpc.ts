import {sendRPC} from '@/tools/websocket';

export function setDeviceName(
    shellyID: string,
    name: string
): Promise<{restart_required: boolean}> {
    return sendRPC(shellyID, 'Sys.SetConfig', {
        config: {device: {name}}
    });
}
