import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';

export interface BTHomeGateway {
    shellyID: string;
    name: string;
}

export function listBTHomeGateways(): Promise<{items: BTHomeGateway[]}> {
    return sendRPC(FM, 'BTHome.ListGateways', {});
}

export function renameBTHomeDevice(input: {
    shellyID: string;
    id: number;
    name: string | null;
}): Promise<{success: boolean}> {
    return sendRPC(FM, 'BTHome.Device.Rename', input);
}
