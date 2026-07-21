// Strict validator for an UPLOADED Shelly backup archive — a trust boundary.
// An imported file is attacker-controlled, so a genuine backup is required
// before storing: a real ZIP within size + zip-bomb caps, carrying a device-info
// section that names a KNOWN Shelly model. Anything else rejects loud with a
// stable ValidationFailed reason.

import AdmZip from 'adm-zip';
import {isKnownShellyModel} from '../../config/knownShellyModels';
import RpcError from '../../rpc/RpcError';

// Opt-in backup sections a Shelly archive can carry (base config — WiFi, auth,
// KVS — is always present and unlisted). SSOT for the key list: BackupComponent
// imports these rather than re-declaring them.
export const BACKUP_CONTENT_KEYS = [
    'ble_bondings',
    'dynamic_components',
    'persistent_counters',
    'schedules',
    'scripts',
    'webhooks',
    'matter_storage'
] as const;

// Stable reject reasons — carried in RpcError data.details.reason. Clients and
// tests match on these; the numeric code stays ValidationFailed (400).
export const BACKUP_IMPORT_REJECT = {
    notShellyBackup: 'not_a_shelly_backup',
    unknownModel: 'unknown_device_model',
    tooLarge: 'backup_too_large'
} as const;

// Zip-bomb guards: a genuine device backup is a handful of small config files.
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
// Bound the recursive search for the device-info object.
const MAX_IDENTITY_SEARCH_DEPTH = 6;

export interface ParsedBackupArchive {
    model: string;
    app: string;
    fwVersion: string;
    sourceDeviceId: string;
    deviceName: string;
    contents: Record<string, boolean>;
}

interface DeviceIdentity {
    model: string;
    app: string;
    ver: string;
    id: string;
}

function reject(
    reason: (typeof BACKUP_IMPORT_REJECT)[keyof typeof BACKUP_IMPORT_REJECT],
    message: string,
    extra: Record<string, unknown> = {}
): never {
    throw RpcError.Domain('ValidationFailed', {
        message,
        field: 'file',
        details: {reason, ...extra}
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A Shelly.GetDeviceInfo-shaped object: a string model plus a string app. The
// device firmware embeds this so it can reject an incompatible restore; we key
// import validation off the same identity FM's restore preflight already trusts.
function readIdentity(value: unknown): DeviceIdentity | null {
    if (!isRecord(value)) return null;
    const {model, app, ver, version, id} = value;
    if (typeof model !== 'string' || model.trim().length === 0) return null;
    if (typeof app !== 'string' || app.trim().length === 0) return null;
    const fw = typeof ver === 'string' ? ver : version;
    return {
        model: model.trim(),
        app: app.trim(),
        ver: typeof fw === 'string' ? fw : '',
        id: typeof id === 'string' ? id.trim() : ''
    };
}

// Depth-bounded search for the device-info object anywhere in a parsed member.
function findIdentity(value: unknown, depth: number): DeviceIdentity | null {
    if (depth > MAX_IDENTITY_SEARCH_DEPTH) return null;
    const direct = readIdentity(value);
    if (direct) return direct;
    if (isRecord(value)) {
        for (const child of Object.values(value)) {
            const found = findIdentity(child, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

// Device id/mac + name from the always-present sys.device config, wherever the
// archive nests it. Gives the stored record a source shellyID so it scopes and
// restores exactly like a captured backup.
function findDeviceHandle(
    value: unknown,
    depth: number
): {id: string; name: string} | null {
    if (depth > MAX_IDENTITY_SEARCH_DEPTH || !isRecord(value)) return null;
    const device = isRecord(value.device) ? value.device : undefined;
    if (device) {
        const id =
            (typeof value.id === 'string' && value.id) ||
            (typeof device.mac === 'string' && device.mac) ||
            '';
        const name = typeof device.name === 'string' ? device.name : '';
        if (id) return {id, name};
    }
    for (const child of Object.values(value)) {
        const found = findDeviceHandle(child, depth + 1);
        if (found) return found;
    }
    return null;
}

function openArchive(buffer: Buffer): AdmZip {
    try {
        const zip = new AdmZip(buffer);
        // Force header parse — AdmZip is lazy and won't validate until read.
        zip.getEntries();
        return zip;
    } catch (error) {
        reject(
            BACKUP_IMPORT_REJECT.notShellyBackup,
            'Uploaded file is not a valid ZIP archive',
            {cause: RpcError.messageOf(error) ?? 'unreadable'}
        );
    }
}

function assertArchiveBounds(entries: AdmZip.IZipEntry[]): void {
    if (entries.length === 0) {
        reject(BACKUP_IMPORT_REJECT.notShellyBackup, 'Backup archive is empty');
    }
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
        reject(
            BACKUP_IMPORT_REJECT.tooLarge,
            'Backup archive has too many entries',
            {
                entries: entries.length,
                maxEntries: MAX_ARCHIVE_ENTRIES
            }
        );
    }
    let total = 0;
    for (const entry of entries) {
        total += entry.header.size;
        if (total > MAX_UNCOMPRESSED_BYTES) {
            reject(
                BACKUP_IMPORT_REJECT.tooLarge,
                'Backup archive uncompressed size exceeds the cap',
                {maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES}
            );
        }
    }
}

// Parse every JSON member once; return the parsed values for identity search.
function readJsonMembers(entries: AdmZip.IZipEntry[]): unknown[] {
    const parsed: unknown[] = [];
    for (const entry of entries) {
        if (entry.isDirectory) continue;
        if (!entry.entryName.toLowerCase().endsWith('.json')) continue;
        try {
            parsed.push(JSON.parse(entry.getData().toString('utf8')));
        } catch {
            // A non-JSON .json member is not itself fatal — a genuine backup
            // still has to yield a valid identity below, which is what gates.
        }
    }
    return parsed;
}

function detectContents(entries: AdmZip.IZipEntry[]): Record<string, boolean> {
    const names = entries.map((e) => e.entryName.toLowerCase());
    return Object.fromEntries(
        BACKUP_CONTENT_KEYS.map((key) => [
            key,
            names.some((name) => name.includes(key))
        ])
    );
}

// Reject anything that is not a genuine Shelly backup for a known model.
// Throws RpcError.Domain('ValidationFailed') with a stable data.details.reason.
export function parseAndValidateBackupArchive(
    buffer: Buffer,
    maxBytes: number
): ParsedBackupArchive {
    if (buffer.length > maxBytes) {
        reject(
            BACKUP_IMPORT_REJECT.tooLarge,
            'Backup file exceeds the size cap',
            {
                sizeBytes: buffer.length,
                maxBytes
            }
        );
    }

    const zip = openArchive(buffer);
    const entries = zip.getEntries();
    assertArchiveBounds(entries);

    const members = readJsonMembers(entries);
    let identity: DeviceIdentity | null = null;
    let handle: {id: string; name: string} | null = null;
    for (const member of members) {
        identity = identity ?? findIdentity(member, 0);
        handle = handle ?? findDeviceHandle(member, 0);
    }

    // A genuine backup names its device (info section) and carries its identity.
    const sourceDeviceId = identity?.id || handle?.id || '';
    if (!identity || !sourceDeviceId) {
        reject(
            BACKUP_IMPORT_REJECT.notShellyBackup,
            'File is not a recognizable Shelly device backup'
        );
    }

    // Reject a foreign/forged archive whose model isn't a supported Shelly family.
    if (!isKnownShellyModel(identity.model)) {
        reject(
            BACKUP_IMPORT_REJECT.unknownModel,
            `Unknown or unsupported device model: ${identity.model}`,
            {model: identity.model, app: identity.app}
        );
    }

    return {
        model: identity.model,
        app: identity.app,
        fwVersion: identity.ver,
        sourceDeviceId,
        deviceName: handle?.name || sourceDeviceId,
        contents: detectContents(entries)
    };
}
