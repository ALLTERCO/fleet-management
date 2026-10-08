import type {
    IrCatalogRemote,
    IrLibraryEntry,
    IrLibrarySource
} from '@api/irlibrary';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {createStaleGuard} from '@/stores/staleGuard';
import * as ws from '../tools/websocket';
import {useToastStore} from './toast';

export type {IrCatalogRemote, IrLibraryEntry, IrLibrarySource};

// Matches the backend list schema maximum.
const MAX_ENTRIES_PER_PAGE = 500;

export interface IrImportSkip {
    line: number;
    reason: string;
}

export interface IrImportPreviewCode {
    name: string;
    protocol: string | null;
    payload: Record<string, unknown>;
}

export interface IrImportResult {
    format: 'irdb_csv' | 'flipper_ir';
    parsed: number;
    imported: number;
    skipped: IrImportSkip[];
    dryRun: boolean;
    preview?: IrImportPreviewCode[];
    entries?: IrLibraryEntry[];
}

export interface IrPushResult {
    shellyID: string;
    irDeviceId: number | null;
    createdDevice: boolean;
    hardwarePinned: boolean;
    results: Array<{
        entryId: number;
        ok: boolean;
        error?: string;
        response?: Record<string, unknown>;
    }>;
}

export interface IrPushTarget {
    shellyID: string;
    entryIds: number[];
    irDeviceId?: number;
    createDeviceName?: string;
}

export interface IrCatalogImportRemoteResult {
    id: string;
    name: string;
    parsed: number;
    imported: number;
    skipped: IrImportSkip[];
}

export interface IrCatalogImportResult {
    imported: number;
    dryRun: boolean;
    remotes: IrCatalogImportRemoteResult[];
    entries?: IrLibraryEntry[];
}

export const useIrLibraryStore = defineStore('irLibrary', () => {
    const entries = ref<Record<number, IrLibraryEntry>>({});
    const loading = ref(false);
    const catalog = ref<IrCatalogRemote[]>([]);
    const catalogLoading = ref(false);
    const toast = useToastStore();

    // Writes bump so an in-flight list fetch can't clobber them.
    const entriesGuard = createStaleGuard();
    const catalogGuard = createStaleGuard();

    async function fetchEntries(filters?: {
        query?: string;
        brand?: string;
        deviceType?: string;
        source?: IrLibrarySource;
    }): Promise<void> {
        loading.value = true;
        try {
            const token = entriesGuard.bump();
            const items = await paginate<IrLibraryEntry>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<IrLibraryEntry>>(
                        'FLEET_MANAGER',
                        'irlibrary.list',
                        {...filters, limit: MAX_ENTRIES_PER_PAGE, offset}
                    ),
                MAX_ENTRIES_PER_PAGE
            );
            if (entriesGuard.isStale(token)) return;
            const next: Record<number, IrLibraryEntry> = {};
            for (const e of items) next[e.id] = e;
            entries.value = next;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load IR library');
        } finally {
            loading.value = false;
        }
    }

    async function saveEntry(params: {
        name: string;
        brand?: string | null;
        deviceType?: string | null;
        protocol?: string | null;
        payload: Record<string, unknown>;
        source?: 'learned' | 'manual';
        sourceDetail?: string | null;
    }): Promise<IrLibraryEntry | null> {
        try {
            const entry = await ws.sendRPC<IrLibraryEntry>(
                'FLEET_MANAGER',
                'irlibrary.save',
                params
            );
            entriesGuard.bump();
            entries.value = {...entries.value, [entry.id]: entry};
            return entry;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to save IR code');
            return null;
        }
    }

    async function updateEntry(
        id: number,
        patch: {
            name?: string;
            brand?: string | null;
            deviceType?: string | null;
            protocol?: string | null;
            payload?: Record<string, unknown>;
        }
    ): Promise<IrLibraryEntry | null> {
        try {
            const entry = await ws.sendRPC<IrLibraryEntry>(
                'FLEET_MANAGER',
                'irlibrary.update',
                {id, patch}
            );
            entriesGuard.bump();
            entries.value = {...entries.value, [entry.id]: entry};
            return entry;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update IR code');
            return null;
        }
    }

    async function deleteEntry(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'irlibrary.delete', {id});
            entriesGuard.bump();
            const next = {...entries.value};
            delete next[id];
            entries.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete IR code');
            return false;
        }
    }

    // Dry run: parse on the backend, show the user what a commit would store.
    async function previewImport(params: {
        filename: string;
        content: string;
        brand?: string;
        deviceType?: string;
    }): Promise<IrImportResult | null> {
        try {
            return await ws.sendRPC<IrImportResult>(
                'FLEET_MANAGER',
                'irlibrary.importfile',
                {...params, dryRun: true}
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to parse IR file');
            return null;
        }
    }

    async function commitImport(params: {
        filename: string;
        content: string;
        brand?: string;
        deviceType?: string;
    }): Promise<IrImportResult | null> {
        try {
            const result = await ws.sendRPC<IrImportResult>(
                'FLEET_MANAGER',
                'irlibrary.importfile',
                params
            );
            entriesGuard.bump();
            if (result.entries) {
                const next = {...entries.value};
                for (const e of result.entries) next[e.id] = e;
                entries.value = next;
            }
            return result;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to import IR file');
            return null;
        }
    }

    // The bundled starter catalog is small and static — fetch once, filter
    // client-side in the browser component.
    async function fetchCatalog(): Promise<void> {
        catalogLoading.value = true;
        try {
            const token = catalogGuard.bump();
            const items = await paginate<IrCatalogRemote>(
                (offset) =>
                    ws.sendRPC<PagedEnvelope<IrCatalogRemote>>(
                        'FLEET_MANAGER',
                        'irlibrary.cataloglist',
                        {limit: MAX_ENTRIES_PER_PAGE, offset}
                    ),
                MAX_ENTRIES_PER_PAGE
            );
            if (catalogGuard.isStale(token)) return;
            catalog.value = items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load IR catalog');
        } finally {
            catalogLoading.value = false;
        }
    }

    async function importCatalog(
        ids: string[]
    ): Promise<IrCatalogImportResult | null> {
        try {
            const result = await ws.sendRPC<IrCatalogImportResult>(
                'FLEET_MANAGER',
                'irlibrary.importcatalog',
                {ids}
            );
            entriesGuard.bump();
            if (result.entries) {
                const next = {...entries.value};
                for (const e of result.entries) next[e.id] = e;
                entries.value = next;
            }
            return result;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to import from IR catalog');
            return null;
        }
    }

    async function pushToDevice(
        target: IrPushTarget
    ): Promise<IrPushResult | null> {
        try {
            return await ws.sendRPC<IrPushResult>(
                'FLEET_MANAGER',
                'irlibrary.pushtodevice',
                target
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to push IR codes to device');
            return null;
        }
    }

    return {
        entries,
        loading,
        catalog,
        catalogLoading,
        fetchEntries,
        saveEntry,
        updateEntry,
        deleteEntry,
        previewImport,
        commitImport,
        fetchCatalog,
        importCatalog,
        pushToDevice
    };
});
