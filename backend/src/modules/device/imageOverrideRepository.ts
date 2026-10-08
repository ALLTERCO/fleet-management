// Per-device visual override on device.list: image_asset_id + visual_json ({icon, accent}).

import * as postgres from '../PostgresProvider';

export interface DeviceDecoration {
    imageAssetId: string | null;
    icon: string | null;
    accent: string | null;
}

export interface SetDeviceDecorationInput {
    organizationId: string;
    shellyID: string;
    decoration: DeviceDecoration;
}

interface DeviceDecorationRow {
    external_id: string;
    image_asset_id: string | null;
    visual_json: {icon?: string; accent?: string} | null;
}

const EMPTY: DeviceDecoration = {imageAssetId: null, icon: null, accent: null};

// A decoration is a picture OR an icon (optionally tinted) — never both, and
// an accent only colors an icon. Returns why a combination is invalid, or null.
export function decorationConflict(
    decoration: DeviceDecoration
): string | null {
    const {imageAssetId, icon, accent} = decoration;
    if (imageAssetId && icon) {
        return 'a decoration is a picture or an icon, not both';
    }
    if (imageAssetId && accent) {
        return 'a picture cannot carry an accent color';
    }
    if (accent && !icon) {
        return 'an accent color requires an icon';
    }
    return null;
}

function rowToDecoration(row: DeviceDecorationRow): DeviceDecoration {
    return {
        imageAssetId: row.image_asset_id,
        icon: row.visual_json?.icon ?? null,
        accent: row.visual_json?.accent ?? null
    };
}

// Device.List reads kind and decoration of one page in a single query.
export async function listDeviceKindsAndDecorations(
    organizationId: string,
    shellyIDs: readonly string[],
    physicalIDs: readonly string[]
): Promise<{
    kinds: Map<string, string>;
    decorations: Map<string, DeviceDecoration>;
}> {
    const kinds = new Map<string, string>();
    const decorations = new Map<string, DeviceDecoration>();
    if (shellyIDs.length === 0) return {kinds, decorations};
    const rows = await postgres.queryRows<
        DeviceDecorationRow & {kind: string | null}
    >(
        `SELECT external_id, image_asset_id::text, visual_json, catalog_kind AS kind FROM device.list
          WHERE external_id = ANY($1::varchar[]) AND organization_id = $2`,
        [[...shellyIDs], organizationId]
    );
    const physical = new Set(physicalIDs);
    for (const row of rows) {
        if (row.kind) kinds.set(row.external_id, row.kind);
        if (physical.has(row.external_id)) {
            decorations.set(row.external_id, rowToDecoration(row));
        }
    }
    return {kinds, decorations};
}

function decorationToVisualJson(decoration: DeviceDecoration): {
    icon?: string;
    accent?: string;
} {
    const visual: {icon?: string; accent?: string} = {};
    if (decoration.icon) visual.icon = decoration.icon;
    if (decoration.accent) visual.accent = decoration.accent;
    return visual;
}

export async function setDeviceDecoration(
    input: SetDeviceDecorationInput
): Promise<DeviceDecoration | null> {
    const rows = await postgres.queryRows<DeviceDecorationRow>(
        `UPDATE device.list
            SET image_asset_id = $3,
                visual_json = $4::jsonb,
                updated = CURRENT_TIMESTAMP
          WHERE organization_id = $1
            AND external_id = $2
         RETURNING external_id, image_asset_id::text, visual_json`,
        [
            input.organizationId,
            input.shellyID,
            input.decoration.imageAssetId,
            JSON.stringify(decorationToVisualJson(input.decoration))
        ]
    );
    return rows[0] ? rowToDecoration(rows[0]) : null;
}

export async function getDeviceDecoration(
    organizationId: string,
    shellyID: string
): Promise<DeviceDecoration> {
    const rows = await postgres.queryRows<DeviceDecorationRow>(
        `SELECT external_id, image_asset_id::text, visual_json
           FROM device.list
          WHERE organization_id = $1 AND external_id = $2
          LIMIT 1`,
        [organizationId, shellyID]
    );
    return rows[0] ? rowToDecoration(rows[0]) : EMPTY;
}
