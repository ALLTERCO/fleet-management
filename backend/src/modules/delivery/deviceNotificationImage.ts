import {
    BLU_DEVICES,
    resolveBluPresentationImageModel
} from '../../config/BTHomeData';
import * as postgres from '../PostgresProvider';
import type {DeliveryPayload} from './types';

const DEVICE_IMAGE_CDN = 'https://control.shelly.cloud/images/device_images';

interface DeviceSnapshotRow {
    jdoc: Record<string, unknown> | null;
    kind: string;
    blu_model_id: string | null;
    blu_visual: Record<string, unknown> | null;
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizedModel(model: string): string {
    if (model === 'S4PL-10416EU') return 'S4PL-00416EU';
    if (
        model.length > 5 &&
        model.charAt(2) === 'S' &&
        model.charAt(3) === 'W' &&
        model.charAt(5) !== '0'
    ) {
        const chars = model.split('');
        chars[5] = '0';
        return chars.join('');
    }
    return model;
}

export function deviceImageUrlFromSnapshot(
    snapshot: Record<string, unknown> | null
): string | undefined {
    const info = record(snapshot?.info);
    if (!info) return undefined;
    const jwt = record(info.jwt);
    const xt1 = record(jwt?.xt1);
    const svc0 = record(xt1?.svc0);
    const model = text(svc0?.type) ?? text(jwt?.p) ?? text(info.model);
    if (!model || model === 'S3MX-0A') return undefined;
    return `${DEVICE_IMAGE_CDN}/${encodeURIComponent(normalizedModel(model))}.png`;
}

export function deviceImageUrlFromBluetooth(
    modelId: string | null | undefined,
    visual: Record<string, unknown> | null | undefined
): string | undefined {
    if (!modelId || !BLU_DEVICES[modelId]) return undefined;
    const requestedImageModel = text(visual?.imageModel);
    const imageModel =
        resolveBluPresentationImageModel(modelId, requestedImageModel) ??
        modelId;
    return `${DEVICE_IMAGE_CDN}/${encodeURIComponent(imageModel)}.png`;
}

function deviceId(payload: DeliveryPayload): string | undefined {
    const fromContext = text(payload.context?.shellyID);
    if (fromContext) return fromContext;
    return payload.source?.subjectType === 'device'
        ? payload.source.subjectId
        : undefined;
}

export async function withDeviceNotificationImage(
    payload: DeliveryPayload
): Promise<DeliveryPayload> {
    if (payload.deviceImageUrl) return payload;
    const shellyID = deviceId(payload);
    if (!shellyID) return payload;
    const rows = await postgres.queryRows<DeviceSnapshotRow>(
        `SELECT dl.jdoc,
                dl.kind,
                bd.model_id AS blu_model_id,
                bd.visual_json AS blu_visual
           FROM device.list dl
      LEFT JOIN device.blu_device bd ON bd.device_list_id = dl.id
          WHERE dl.organization_id = $1
            AND dl.external_id = $2
            AND dl.deleted_at IS NULL
          LIMIT 1`,
        [payload.organizationId, shellyID]
    );
    const row = rows[0];
    const deviceImageUrl =
        row?.kind === 'bluetooth'
            ? deviceImageUrlFromBluetooth(row.blu_model_id, row.blu_visual)
            : deviceImageUrlFromSnapshot(row?.jdoc ?? null);
    return deviceImageUrl ? {...payload, deviceImageUrl} : payload;
}
