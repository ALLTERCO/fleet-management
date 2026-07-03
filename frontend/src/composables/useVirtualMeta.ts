import {onMounted, ref, watch} from 'vue';
import {uploadAsset} from '@/api/assetRpc';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

export interface VirtualMetaGradient {
    angle?: number;
    stops: Array<{color: string; offset: number}>;
}

export interface MeasurementMeta {
    logicalNode?: 'MMXU' | 'MMTR' | 'MMXN' | 'MMDC' | 'MSQI' | 'MHAI';
    dataObject?: string;
    phase?: 'A' | 'B' | 'C' | 'N' | 'total';
    accumulation?: 'instant' | 'cumulative' | 'delta';
    unit?: string;
    direction?: 'import' | 'export' | 'net';
}

export interface VirtualMetaRow {
    organization_id: string;
    host_shelly_id: string;
    component_key: string;
    glyph: string | null;
    color: string | null;
    gradient: VirtualMetaGradient | null;
    promoted_at: string | null;
    image_path: string | null;
    measurement: MeasurementMeta | null;
    created: string;
    updated: string;
}

interface FetchResponse {
    items: VirtualMetaRow[];
}

export function useVirtualMeta(
    shellyID: () => string | undefined,
    componentKey: () => string | undefined
) {
    const toast = useToastStore();
    const row = ref<VirtualMetaRow | null>(null);
    const loading = ref(false);
    const saving = ref(false);

    async function reload(): Promise<void> {
        const id = shellyID();
        const key = componentKey();
        if (!id || !key) {
            row.value = null;
            return;
        }
        loading.value = true;
        try {
            const resp = await sendRPC<FetchResponse>(
                'FLEET_MANAGER',
                'virtual_meta.Fetch',
                {shellyID: id}
            );
            row.value = resp.items.find((r) => r.component_key === key) ?? null;
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to load decoration'));
            row.value = null;
        } finally {
            loading.value = false;
        }
    }

    // `null` clears the field (routed to virtual_meta.Clear), a value sets it
    // (routed to virtual_meta.Set), `undefined` leaves it untouched. Set runs
    // after Clear so row.value reflects the final state.
    async function save(fields: {
        glyph?: string | null;
        color?: string | null;
        gradient?: VirtualMetaGradient | null;
        promoted?: boolean;
        imagePath?: string | null;
        measurement?: MeasurementMeta | null;
    }): Promise<void> {
        const id = shellyID();
        const key = componentKey();
        if (!id || !key) return;
        const setFields: Record<string, unknown> = {};
        const clearFlags: Record<string, boolean> = {};
        const route = <T>(
            value: T | null | undefined,
            setKey: string,
            clearKey: string
        ): void => {
            if (value === undefined) return;
            if (value === null) clearFlags[clearKey] = true;
            else setFields[setKey] = value;
        };
        route(fields.glyph, 'glyph', 'clearGlyph');
        route(fields.color, 'color', 'clearColor');
        route(fields.gradient, 'gradient', 'clearGradient');
        route(fields.imagePath, 'imagePath', 'clearImage');
        route(fields.measurement, 'measurement', 'clearMeasurement');
        if (fields.promoted !== undefined) setFields.promoted = fields.promoted;
        const hasClears = Object.keys(clearFlags).length > 0;
        const hasSets = Object.keys(setFields).length > 0;
        if (!hasClears && !hasSets) return;
        saving.value = true;
        try {
            if (hasClears) {
                const cleared = await sendRPC<VirtualMetaRow | null>(
                    'FLEET_MANAGER',
                    'virtual_meta.Clear',
                    {shellyID: id, componentKey: key, ...clearFlags}
                );
                row.value = cleared ?? null;
            }
            if (hasSets) {
                const updated = await sendRPC<VirtualMetaRow>(
                    'FLEET_MANAGER',
                    'virtual_meta.Set',
                    {shellyID: id, componentKey: key, ...setFields}
                );
                row.value = updated;
            }
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to save decoration'));
        } finally {
            saving.value = false;
        }
    }

    async function clear(flags: {
        glyph?: boolean;
        color?: boolean;
        gradient?: boolean;
        promoted?: boolean;
        image?: boolean;
        measurement?: boolean;
    }): Promise<void> {
        const id = shellyID();
        const key = componentKey();
        if (!id || !key) return;
        saving.value = true;
        try {
            const updated = await sendRPC<VirtualMetaRow | null>(
                'FLEET_MANAGER',
                'virtual_meta.Clear',
                {
                    shellyID: id,
                    componentKey: key,
                    clearGlyph: flags.glyph,
                    clearColor: flags.color,
                    clearGradient: flags.gradient,
                    clearPromoted: flags.promoted,
                    clearImage: flags.image,
                    clearMeasurement: flags.measurement
                }
            );
            row.value = updated ?? null;
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to clear decoration'));
        } finally {
            saving.value = false;
        }
    }

    async function uploadImage(file: File): Promise<string | null> {
        saving.value = true;
        try {
            const asset = await uploadAsset(file, null, 'component');
            await reload();
            return asset.id;
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Image upload failed'));
            return null;
        } finally {
            saving.value = false;
        }
    }

    onMounted(reload);
    watch([shellyID, componentKey], reload);

    return {row, loading, saving, reload, save, clear, uploadImage};
}
