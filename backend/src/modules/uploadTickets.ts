import crypto from 'node:crypto';
import {tuning} from '../config/tuning';
import type CommandSender from '../model/CommandSender';
import {uploadTickets} from './redis/services';

export type UploadTicketKind =
    | 'firmware'
    | 'background'
    | 'profile_picture'
    | 'report_image'
    | 'email_asset'
    | 'floor_plan'
    | 'virtual_image'
    | 'visual_asset';

// Resource kind that owns the uploaded image. Used by 'visual_asset'
// tickets to scope the upload + permission check + storage path.
export type VisualAssetResourceKind =
    | 'virtual-device'
    | 'group'
    | 'bluetooth-device';

export interface UploadTicketPayload {
    locationId?: number;
    username?: string;
    shellyId?: string;
    componentKey?: string;
    resourceKind?: VisualAssetResourceKind;
    resourceId?: string;
}

export interface UploadTicketUser {
    organizationId?: string;
    userId?: string;
    username?: string;
}

export interface UploadTicket {
    kind: UploadTicketKind;
    expiresAt: number;
    organizationId?: string;
    userId?: string;
    username?: string;
    payload: UploadTicketPayload;
}

export interface IssuedUploadTicket extends UploadTicket {
    token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoredTicket(raw: string): UploadTicket | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isRecord(parsed)) return null;
    if (typeof parsed.kind !== 'string') return null;
    if (typeof parsed.expiresAt !== 'number') return null;
    if (!isRecord(parsed.payload)) return null;
    if (
        parsed.organizationId !== undefined &&
        typeof parsed.organizationId !== 'string'
    ) {
        return null;
    }
    if (parsed.userId !== undefined && typeof parsed.userId !== 'string') {
        return null;
    }
    if (parsed.username !== undefined && typeof parsed.username !== 'string') {
        return null;
    }
    if (
        parsed.payload.locationId !== undefined &&
        typeof parsed.payload.locationId !== 'number'
    ) {
        return null;
    }
    if (
        parsed.payload.username !== undefined &&
        typeof parsed.payload.username !== 'string'
    ) {
        return null;
    }
    if (
        parsed.payload.shellyId !== undefined &&
        typeof parsed.payload.shellyId !== 'string'
    ) {
        return null;
    }
    if (
        parsed.payload.componentKey !== undefined &&
        typeof parsed.payload.componentKey !== 'string'
    ) {
        return null;
    }
    if (
        parsed.payload.resourceKind !== undefined &&
        typeof parsed.payload.resourceKind !== 'string'
    ) {
        return null;
    }
    if (
        parsed.payload.resourceId !== undefined &&
        typeof parsed.payload.resourceId !== 'string'
    ) {
        return null;
    }
    return parsed as unknown as UploadTicket;
}

export async function issueUploadTicket(input: {
    kind: UploadTicketKind;
    user?: UploadTicketUser;
    payload?: UploadTicketPayload;
}): Promise<IssuedUploadTicket> {
    const now = Date.now();
    const token = crypto.randomBytes(24).toString('base64url');
    const ticket: UploadTicket = {
        kind: input.kind,
        expiresAt: now + tuning.upload.ticketTtlMs,
        organizationId: input.user?.organizationId,
        userId: input.user?.userId,
        username: input.user?.username,
        payload: input.payload ?? {}
    };
    await uploadTickets.set(
        token,
        JSON.stringify(ticket),
        Math.ceil(tuning.upload.ticketTtlMs / 1000)
    );
    return {token, ...ticket};
}

export async function consumeUploadTicket(input: {
    token: unknown;
    kind: UploadTicketKind;
    user?: UploadTicketUser;
    payload?: UploadTicketPayload;
}): Promise<UploadTicket | null> {
    if (typeof input.token !== 'string' || input.token.length === 0) {
        return null;
    }
    const raw = await uploadTickets.consume(input.token);
    if (!raw) return null;
    const ticket = parseStoredTicket(raw);
    if (!ticket) return null;
    if (!ticket || ticket.kind !== input.kind) return null;
    if (ticket.expiresAt <= Date.now()) return null;
    if (ticket.userId && ticket.userId !== input.user?.userId) return null;
    if (ticket.username && ticket.username !== input.user?.username) {
        return null;
    }
    if (
        ticket.organizationId &&
        ticket.organizationId !== input.user?.organizationId
    ) {
        return null;
    }
    if (
        ticket.payload.locationId !== undefined &&
        ticket.payload.locationId !== input.payload?.locationId
    ) {
        return null;
    }
    if (
        ticket.payload.username !== undefined &&
        ticket.payload.username !== input.payload?.username
    ) {
        return null;
    }
    if (
        ticket.payload.shellyId !== undefined &&
        ticket.payload.shellyId !== input.payload?.shellyId
    ) {
        return null;
    }
    if (
        ticket.payload.componentKey !== undefined &&
        ticket.payload.componentKey !== input.payload?.componentKey
    ) {
        return null;
    }
    if (
        ticket.payload.resourceKind !== undefined &&
        ticket.payload.resourceKind !== input.payload?.resourceKind
    ) {
        return null;
    }
    if (
        ticket.payload.resourceId !== undefined &&
        ticket.payload.resourceId !== input.payload?.resourceId
    ) {
        return null;
    }
    return ticket;
}

export function uploadTicketResponse(ticket: IssuedUploadTicket) {
    return {
        uploadTicket: ticket.token,
        expiresAt: new Date(ticket.expiresAt).toISOString()
    };
}

export function uploadTicketUserFromSender(sender: CommandSender) {
    return {
        organizationId: sender.getOrganizationId(),
        userId: sender.getUserId(),
        username: sender.getUser()?.username
    };
}
