import {sendRPC} from '@/tools/websocket';

export interface UploadTicketResponse {
    uploadTicket: string;
    expiresAt: string;
}

export async function createUploadTicket(
    method: string,
    params: Record<string, unknown> = {}
): Promise<string> {
    const result = await sendRPC<UploadTicketResponse>(
        'FLEET_MANAGER',
        method,
        params
    );
    return result.uploadTicket;
}
