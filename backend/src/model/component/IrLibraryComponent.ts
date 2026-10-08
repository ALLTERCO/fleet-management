// irlibrary.*: org-level IR code library (FM-served). CRUD + file import
// (IRDB CSV / Flipper .ir) + push-to-device. Payloads are stored and
// pushed faithfully: the BR2 preview firmware does not document the
// IRCode write shape, so PushToDevice is hardware-pending by design.

import {requireTenantWideComponentPermission} from '../../modules/authz/evaluator';
import {
    type CatalogRemote,
    getCatalogRemote,
    searchCatalog
} from '../../modules/irLibrary/catalog';
import {parseImportFile} from '../../modules/irLibrary/parseImportFile';
import {
    type ImportSkip,
    IrImportParseError,
    type ParsedImport,
    type ParsedIrCode
} from '../../modules/irLibrary/types';
import * as postgres from '../../modules/PostgresProvider';
import {translatePgError} from '../../rpc/dbErrors';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse, paginateAndBuild} from '../../rpc/listResponse';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    IR_LIBRARY_IMPORT_MAX_ENTRIES,
    IRLIBRARY_CATALOG_LIST_PARAMS,
    IRLIBRARY_DELETE_PARAMS,
    IRLIBRARY_DESCRIBE,
    IRLIBRARY_IMPORT_CATALOG_PARAMS,
    IRLIBRARY_IMPORT_FILE_PARAMS,
    IRLIBRARY_LIST_PARAMS,
    IRLIBRARY_PUSH_TO_DEVICE_PARAMS,
    IRLIBRARY_SAVE_PARAMS,
    IRLIBRARY_UPDATE_PARAMS,
    type IrCatalogRemote,
    type IrLibraryEntry,
    type IrLibrarySource
} from '../../types/api/irlibrary';
import type CommandSender from '../CommandSender';
import {
    getDeviceOrThrow,
    isPlainObject,
    wrapDeviceRpc
} from '../deviceAdminRpc';
import Component from './Component';

interface EntryRow {
    id: number | string;
    organization_id: string;
    name: string;
    brand: string | null;
    device_type: string | null;
    protocol: string | null;
    payload: Record<string, unknown>;
    source: IrLibrarySource;
    source_detail: string | null;
    created_by: string | null;
    created_at: Date | string;
    updated_at: Date | string | null;
}

type ListRow = Partial<EntryRow> & {total_count?: number | string};

// Matches the name VARCHAR(128) column; over-long import names are
// reported as skips, never silently truncated.
const ENTRY_NAME_MAX_LEN = 128;
const SOURCE_DETAIL_MAX_LEN = 250;
// Matches the List default page size.
const CATALOG_DEFAULT_LIMIT = 100;

function rowToEntry(row: EntryRow): IrLibraryEntry {
    return {
        // BIGSERIAL comes back as string from pg; coerce for the wire.
        id: Number(row.id),
        organizationId: row.organization_id,
        name: row.name,
        brand: row.brand,
        deviceType: row.device_type,
        protocol: row.protocol,
        payload: row.payload ?? {},
        source: row.source,
        sourceDetail: row.source_detail,
        createdBy: row.created_by,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}

function parseOrThrow(filename: string, content: string): ParsedImport {
    try {
        return parseImportFile(filename, content);
    } catch (err: unknown) {
        if (err instanceof IrImportParseError) {
            throw RpcError.InvalidParams(err.message);
        }
        throw err;
    }
}

// Over-long names become reported skips: loud, never truncated.
function dropOversizedNames(parsed: ParsedImport): {
    codes: ParsedIrCode[];
    skipped: ImportSkip[];
} {
    const skipped = [...parsed.skipped];
    const codes = parsed.codes.filter((code) => {
        if (code.name.length <= ENTRY_NAME_MAX_LEN) return true;
        skipped.push({
            line: 0,
            reason: `code "${code.name.slice(0, 40)}…" name exceeds ${ENTRY_NAME_MAX_LEN} chars`
        });
        return false;
    });
    return {codes, skipped};
}

interface ImportBatchArgs {
    orgId: string;
    entries: Array<{
        name: string;
        brand: string | null;
        deviceType: string | null;
        protocol: string | null;
        payload: Record<string, unknown>;
    }>;
    source: IrLibrarySource;
    sourceDetail: string;
    createdBy: string | null;
}

async function importBatch(args: ImportBatchArgs): Promise<EntryRow[]> {
    const result = await postgres.callMethod('fm.fn_ir_library_import_batch', {
        p_organization_id: args.orgId,
        // Arrays must go over as JSON text; node-pg would render
        // a JS array as a PG array literal, not jsonb.
        p_entries: JSON.stringify(args.entries),
        p_source: args.source,
        p_source_detail: args.sourceDetail.slice(0, SOURCE_DETAIL_MAX_LEN),
        p_created_by: args.createdBy
    });
    return (result?.rows ?? []) as EntryRow[];
}

// Catalog reads never blame the caller: a missing/corrupt bundled pack is
// a deployment defect and surfaces as OperationFailed with the cause.
function catalogOrThrow<T>(read: () => T): T {
    try {
        return read();
    } catch (err: unknown) {
        throw RpcError.OperationFailed('ir catalog read', err);
    }
}

function toWireCatalogRemote(remote: CatalogRemote): IrCatalogRemote {
    return {
        id: remote.id,
        name: remote.name,
        brand: remote.brand,
        deviceType: remote.deviceType,
        codeCount: remote.codeCount,
        protocols: remote.protocols,
        sourceRepo: remote.sourceRepo,
        sourcePath: remote.sourcePath,
        license: remote.license
    };
}

function fetchCatalogRemotesOrThrow(ids: string[]): CatalogRemote[] {
    const remotes: CatalogRemote[] = [];
    const missing: string[] = [];
    for (const id of ids) {
        const remote = catalogOrThrow(() => getCatalogRemote(id));
        if (remote) remotes.push(remote);
        else missing.push(id);
    }
    if (missing.length > 0) {
        throw RpcError.NotFound('ir catalog remote', missing.join(', '));
    }
    return remotes;
}

// Bundled content failing the standard parser is a pack defect, not a
// caller error — OperationFailed, never InvalidParams.
function parseCatalogRemote(remote: CatalogRemote): ParsedImport {
    let parsed: ParsedImport;
    try {
        parsed = parseImportFile(remote.sourcePath, remote.content);
    } catch (err: unknown) {
        if (err instanceof IrImportParseError) {
            throw RpcError.OperationFailed(
                `ir catalog remote ${remote.id}`,
                err
            );
        }
        throw err;
    }
    if (
        parsed.codes.length === 0 ||
        parsed.codes.length > IR_LIBRARY_IMPORT_MAX_ENTRIES
    ) {
        throw RpcError.OperationFailed(
            `ir catalog remote ${remote.id}`,
            new Error(`bundled pack yields ${parsed.codes.length} codes`)
        );
    }
    return parsed;
}

// Catalog imports reuse the Flipper import path; provenance keeps the
// upstream file path so every stored code stays traceable to its source.
async function storeCatalogRemote(args: {
    orgId: string;
    remote: CatalogRemote;
    codes: ParsedIrCode[];
    createdBy: string | null;
}): Promise<EntryRow[]> {
    const entries = args.codes.map((code) => ({
        name: code.name,
        brand: args.remote.brand,
        deviceType: args.remote.deviceType,
        protocol: code.protocol,
        payload: code.payload
    }));
    try {
        return await importBatch({
            orgId: args.orgId,
            entries,
            source: 'import_flipper',
            sourceDetail: `catalog:${args.remote.sourcePath}`,
            createdBy: args.createdBy
        });
    } catch (err: unknown) {
        throw translatePgError(err, 'irlibrary catalog import');
    }
}

// The IR.AddDevice response shape is firmware-defined and undocumented.
// Accept the two plausible spellings of a component id; anything else is
// a loud failure so codes are never written to a guessed target.
function extractIrDeviceId(response: unknown): number | null {
    if (!isPlainObject(response)) return null;
    const direct = (response as {id?: unknown}).id;
    if (typeof direct === 'number' && Number.isInteger(direct)) return direct;
    const nested = (response as {irdevice?: {id?: unknown}}).irdevice;
    if (
        isPlainObject(nested) &&
        typeof nested.id === 'number' &&
        Number.isInteger(nested.id)
    ) {
        return nested.id;
    }
    return null;
}

// An IR library entry is not a configuration profile: no scope selector names it.
const NOT_A_CONFIGURATION_KEY = (): undefined => undefined;

export default class IrLibraryComponent extends Component {
    constructor() {
        super('irlibrary', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return IRLIBRARY_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('configurations', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            query?: string;
            brand?: string;
            deviceType?: string;
            source?: IrLibrarySource;
            limit?: number;
            offset?: number;
        }>(params, IRLIBRARY_LIST_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 100;
        const offset = p.offset ?? 0;

        const result = await postgres.callMethod('fm.fn_ir_library_list', {
            p_organization_id: orgId,
            p_query: p.query ?? null,
            p_brand: p.brand ?? null,
            p_device_type: p.deviceType ?? null,
            p_source: p.source ?? null,
            p_limit: limit,
            p_offset: offset
        });
        const rows = (result?.rows ?? []) as ListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: IrLibraryEntry[] = [];
        for (const r of rows) {
            if (r.id == null) continue;
            items.push(rowToEntry(r as EntryRow));
        }
        return buildListResponse(items, total, limit, offset);
    }

    @Component.Expose('Save')
    @Component.CrudPermission('configurations', 'create')
    async save(
        params: unknown,
        sender: CommandSender
    ): Promise<IrLibraryEntry> {
        const p = validateOrThrow<{
            organizationId?: string;
            name: string;
            brand?: string | null;
            deviceType?: string | null;
            protocol?: string | null;
            payload: Record<string, unknown>;
            source?: 'learned' | 'manual';
            sourceDetail?: string | null;
        }>(params, IRLIBRARY_SAVE_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod('fm.fn_ir_library_save', {
                p_organization_id: orgId,
                p_name: p.name.trim(),
                p_brand: p.brand ?? null,
                p_device_type: p.deviceType ?? null,
                p_protocol: p.protocol ?? null,
                p_payload: p.payload,
                p_source: p.source ?? 'manual',
                p_source_detail: p.sourceDetail ?? null,
                p_created_by: sender.getUser()?.username ?? null
            });
            const row = result?.rows?.[0] as EntryRow | undefined;
            if (!row) throw RpcError.OperationFailed('irlibrary save');
            return rowToEntry(row);
        } catch (err: unknown) {
            throw translatePgError(err, 'irlibrary save');
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission(
        'configurations',
        'update',
        NOT_A_CONFIGURATION_KEY
    )
    async update(
        params: unknown,
        sender: CommandSender
    ): Promise<IrLibraryEntry> {
        await requireTenantWideComponentPermission(
            sender,
            'configurations',
            'update'
        );
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                brand?: string | null;
                deviceType?: string | null;
                protocol?: string | null;
                payload?: Record<string, unknown>;
            };
        }>(params, IRLIBRARY_UPDATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const patch = p.patch ?? {};

        try {
            const result = await postgres.callMethod(
                'fm.fn_ir_library_update',
                {
                    p_organization_id: orgId,
                    p_id: p.id,
                    p_name: patch.name?.trim() ?? null,
                    p_brand: patch.brand ?? null,
                    p_clear_brand: patch.brand === null,
                    p_device_type: patch.deviceType ?? null,
                    p_clear_device_type: patch.deviceType === null,
                    p_protocol: patch.protocol ?? null,
                    p_clear_protocol: patch.protocol === null,
                    p_payload: patch.payload ?? null
                }
            );
            const row = result?.rows?.[0] as EntryRow | undefined;
            if (!row) throw RpcError.NotFound('irlibrary entry', p.id);
            return rowToEntry(row);
        } catch (err: unknown) {
            throw translatePgError(err, 'irlibrary update');
        }
    }

    @Component.Expose('Delete')
    @Component.CrudPermission(
        'configurations',
        'delete',
        NOT_A_CONFIGURATION_KEY
    )
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean; id: number}> {
        await requireTenantWideComponentPermission(
            sender,
            'configurations',
            'delete'
        );
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            IRLIBRARY_DELETE_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod(
                'fm.fn_ir_library_delete',
                {p_organization_id: orgId, p_id: p.id}
            );
            const row = result?.rows?.[0] as {id: number} | undefined;
            return {deleted: row?.id != null, id: p.id};
        } catch (err: unknown) {
            throw translatePgError(err, 'irlibrary delete');
        }
    }

    @Component.Expose('ImportFile')
    @Component.CrudPermission('configurations', 'create')
    async importFile(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            filename: string;
            content: string;
            brand?: string | null;
            deviceType?: string | null;
            dryRun?: boolean;
        }>(params, IRLIBRARY_IMPORT_FILE_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const parsed = parseOrThrow(p.filename, p.content);
        const {codes, skipped} = dropOversizedNames(parsed);
        if (codes.length === 0) {
            throw RpcError.InvalidParams(
                `no importable IR codes found in "${p.filename}"`
            );
        }
        if (codes.length > IR_LIBRARY_IMPORT_MAX_ENTRIES) {
            throw RpcError.InvalidParams(
                `file contains ${codes.length} codes; the import cap is ${IR_LIBRARY_IMPORT_MAX_ENTRIES}`
            );
        }
        if (p.dryRun) {
            return {
                format: parsed.format,
                parsed: codes.length,
                imported: 0,
                skipped,
                dryRun: true,
                preview: codes
            };
        }

        const source =
            parsed.format === 'irdb_csv' ? 'import_irdb' : 'import_flipper';
        const entries = codes.map((code) => ({
            name: code.name,
            brand: p.brand ?? null,
            deviceType: p.deviceType ?? null,
            protocol: code.protocol,
            payload: code.payload
        }));
        try {
            const rows = await importBatch({
                orgId,
                entries,
                source,
                sourceDetail: p.filename,
                createdBy: sender.getUser()?.username ?? null
            });
            return {
                format: parsed.format,
                parsed: codes.length,
                imported: rows.length,
                skipped,
                dryRun: false,
                entries: rows.map(rowToEntry)
            };
        } catch (err: unknown) {
            throw translatePgError(err, 'irlibrary import');
        }
    }

    @Component.NoAudit
    @Component.Expose('CatalogList')
    @Component.CrudPermission('configurations', 'read')
    async catalogList(params: unknown) {
        const p = validateOrThrow<{
            organizationId?: string;
            query?: string;
            brand?: string;
            deviceType?: string;
            limit?: number;
            offset?: number;
        }>(params, IRLIBRARY_CATALOG_LIST_PARAMS);
        const remotes = catalogOrThrow(() => searchCatalog(p));
        return paginateAndBuild(
            remotes.map(toWireCatalogRemote),
            p,
            CATALOG_DEFAULT_LIMIT
        );
    }

    @Component.Expose('ImportCatalog')
    @Component.CrudPermission('configurations', 'create')
    async importCatalog(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            ids: string[];
            dryRun?: boolean;
        }>(params, IRLIBRARY_IMPORT_CATALOG_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        if (new Set(p.ids).size !== p.ids.length) {
            throw RpcError.InvalidParams('ids contains duplicates');
        }
        const remotes = fetchCatalogRemotesOrThrow(p.ids);

        const remoteResults: Array<{
            id: string;
            name: string;
            parsed: number;
            imported: number;
            skipped: ImportSkip[];
        }> = [];
        const storedEntries: IrLibraryEntry[] = [];
        for (const remote of remotes) {
            const {codes, skipped} = dropOversizedNames(
                parseCatalogRemote(remote)
            );
            if (p.dryRun) {
                remoteResults.push({
                    id: remote.id,
                    name: remote.name,
                    parsed: codes.length,
                    imported: 0,
                    skipped
                });
                continue;
            }
            const rows = await storeCatalogRemote({
                orgId,
                remote,
                codes,
                createdBy: sender.getUser()?.username ?? null
            });
            storedEntries.push(...rows.map(rowToEntry));
            remoteResults.push({
                id: remote.id,
                name: remote.name,
                parsed: codes.length,
                imported: rows.length,
                skipped
            });
        }
        return {
            imported: storedEntries.length,
            dryRun: p.dryRun ?? false,
            remotes: remoteResults,
            ...(p.dryRun ? {} : {entries: storedEntries})
        };
    }

    @Component.Expose('PushToDevice')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    async pushToDevice(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            shellyID: string;
            entryIds: number[];
            irDeviceId?: number;
            createDeviceName?: string;
        }>(params, IRLIBRARY_PUSH_TO_DEVICE_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const hasTarget = p.irDeviceId !== undefined;
        const hasCreate = p.createDeviceName !== undefined;
        if (hasTarget === hasCreate) {
            throw RpcError.InvalidParams(
                'provide exactly one of irDeviceId or createDeviceName'
            );
        }

        const entries = await this.#fetchEntriesOrThrow(orgId, p.entryIds);
        const device = getDeviceOrThrow(p.shellyID);

        let irDeviceId = p.irDeviceId ?? null;
        let createdDevice = false;
        if (hasCreate) {
            const response = await wrapDeviceRpc('IR.AddDevice', () =>
                device.sendRPC('IR.AddDevice', {name: p.createDeviceName})
            );
            irDeviceId = extractIrDeviceId(response);
            createdDevice = true;
            if (irDeviceId === null) {
                // Never write codes to a guessed component id.
                throw RpcError.OperationFailed(
                    'IR.AddDevice returned no component id (preview firmware)'
                );
            }
        }

        const results = [];
        for (const entry of entries) {
            results.push(await pushEntry(device, irDeviceId as number, entry));
        }
        return {
            shellyID: p.shellyID,
            irDeviceId,
            createdDevice,
            // Flips to true once firmware docs pin the IRCode write shape.
            hardwarePinned: false,
            results
        };
    }

    async #fetchEntriesOrThrow(
        orgId: string,
        entryIds: number[]
    ): Promise<IrLibraryEntry[]> {
        const result = await postgres.callMethod('fm.fn_ir_library_get_batch', {
            p_organization_id: orgId,
            p_ids: entryIds
        });
        const rows = (result?.rows ?? []) as EntryRow[];
        const entries = rows.map(rowToEntry);
        const found = new Set(entries.map((e) => e.id));
        const missing = entryIds.filter((id) => !found.has(id));
        if (missing.length > 0) {
            throw RpcError.NotFound('irlibrary entry', missing.join(', '));
        }
        return entries;
    }
}

// One IRCode.SetConfig per entry, following the only SetConfig convention
// observed on this firmware ({id, config}); the stored payload is merged
// into config untouched. Hardware-pending: not pinned by firmware docs.
async function pushEntry(
    device: ReturnType<typeof getDeviceOrThrow>,
    irDeviceId: number,
    entry: IrLibraryEntry
): Promise<{
    entryId: number;
    ok: boolean;
    error?: string;
    response?: Record<string, unknown>;
}> {
    try {
        const response = await device.sendRPC('IRCode.SetConfig', {
            id: irDeviceId,
            config: {name: entry.name, ...entry.payload}
        });
        return {
            entryId: entry.id,
            ok: true,
            ...(isPlainObject(response)
                ? {response: response as Record<string, unknown>}
                : {})
        };
    } catch (err: unknown) {
        return {
            entryId: entry.id,
            ok: false,
            error: RpcError.messageOf(err) ?? 'device call failed'
        };
    }
}
