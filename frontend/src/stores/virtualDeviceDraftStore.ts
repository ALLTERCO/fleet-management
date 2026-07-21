import type {EnergyMeterRole} from '@api/energy';
import {
    type BindingDraftItem,
    type CreateVirtualDeviceRequest,
    type DraftPreviewResponse,
    type HistoryMode,
    type RoleVisual,
    type SourceComponentCandidate,
    type SourceComponentRef,
    type ValidationResult,
    type VirtualDeviceDto,
    type VirtualDeviceKind,
    type VirtualDeviceProfile,
    type VirtualDeviceVisual,
    virtualDevices
} from '@host/virtualDevices';
import {defineStore} from 'pinia';
import {computed, ref, watch} from 'vue';
import {DEVICE_CATEGORY_KEYS} from '@/helpers/deviceCategories';
import {
    deriveEnergyPhaseMode,
    toLogicalMeterPoint
} from '@/helpers/energyAssignment';
import {humaniseLabel} from '@/helpers/partLabels';
import {uploadVisualAsset} from '@/helpers/uploadVisualAsset';
import {manualVisual, profileVisual} from '@/helpers/virtualDeviceTemplates';
import {useToastStore} from '@/stores/toast';
import {listMeasurementPoints, saveLogicalMeter} from '@/tools/logicalMeters';
import type {shelly_device_t} from '@/types/device';
import type {entity_t} from '@/types/entities';

const DEFAULT_ENERGY_METER_NAME = 'Main meter';
const PREVIEW_EXTERNAL_ID = 'vdev_preview';

export type WizardKind = 'physical' | 'bluetooth' | VirtualDeviceKind | null;

export type WizardStep =
    | 'kind'
    | 'profile'
    | 'details'
    | 'roles'
    | 'review'
    | 'gateway'
    | 'pair'
    | 'identify'
    | 'source';

type RoleValueType = VirtualDeviceProfile['roles'][number]['valueType'];

export interface RoleDraftRow {
    roleKey: string;
    label: string;
    valueType: RoleValueType;
    unit?: string;
    required: boolean;
    writable: boolean;
    suggestedHistoryMode: HistoryMode;
    source: SourceComponentRef | null;
    historyMode: HistoryMode;
    visual?: RoleVisual;
}

export interface DraftDetails {
    name: string;
    typeKey: string;
    categoryKey: string | null;
    locationId: number | null;
    groupIds: number[];
    tagIds: number[];
    imageAssetId: string | null;
    visual: VirtualDeviceVisual;
    // Deferred upload — applied after create() returns the externalId.
    pendingImageFile: File | null;
}

const EMPTY_DETAILS = (): DraftDetails => ({
    name: '',
    typeKey: 'custom_device',
    categoryKey: null,
    locationId: null,
    groupIds: [],
    tagIds: [],
    imageAssetId: null,
    visual: {},
    pendingImageFile: null
});

export const useVirtualDeviceDraftStore = defineStore(
    'virtualDeviceDraft',
    () => {
        const kind = ref<WizardKind>(null);
        const profile = ref<VirtualDeviceProfile | null>(null);
        const manualMode = ref(false);
        const details = ref<DraftDetails>(EMPTY_DETAILS());
        const roles = ref<RoleDraftRow[]>([]);

        const energyRole = ref<EnergyMeterRole | null>(null);

        // Default to 'load' when category is energy; clear when it changes away.
        watch(
            () => details.value.categoryKey,
            (categoryKey) => {
                if (categoryKey === 'energy') {
                    if (energyRole.value === null) energyRole.value = 'load';
                } else {
                    energyRole.value = null;
                }
            }
        );

        const pickedKeys = ref(new Map<string, string>()); // partKey -> roleKey

        const availableProfiles = ref<VirtualDeviceProfile[]>([]);
        const profilesLoading = ref(false);
        const profilesError = ref<string | null>(null);

        const previewState = ref<DraftPreviewResponse | null>(null);
        const previewLoading = ref(false);
        const previewError = ref<string | null>(null);

        const validation = ref<ValidationResult | null>(null);

        const isCustom = computed(() => kind.value === 'composed');

        const allRequiredBound = computed(() =>
            roles.value
                .filter((row) => row.required)
                .every((row) => row.source !== null)
        );

        const hasBoundParts = computed(() =>
            roles.value.some((row) => row.source !== null)
        );

        const templateChosen = computed(
            () => profile.value !== null || manualMode.value
        );

        const readyForDetails = computed(() => {
            if (!isCustom.value) return false;
            if (profile.value) return allRequiredBound.value;
            return hasBoundParts.value;
        });

        const canPreview = computed(() => {
            if (!isCustom.value) return false;
            if (!details.value.name.trim()) return false;
            if (roles.value.length === 0) return false;
            return roles.value.some((row) => row.source !== null);
        });

        const pickedParts = computed(() => roles.value);

        // Draft-local preview; never inserted into the global stores.
        const previewEntities = computed<entity_t[]>(() => {
            if (!isCustom.value) return [];
            return roles.value
                .filter((row) => row.source !== null)
                .map(previewEntityForRole);
        });

        // Fallback so the preview pane renders before the user types a name.
        const previewName = computed(
            () =>
                details.value.name.trim() || profile.value?.name || 'New device'
        );

        const previewDevice = computed<shelly_device_t | null>(() => {
            if (!isCustom.value) return null;
            const entities = previewEntities.value;
            const status = Object.fromEntries(
                entities.map((entity) => [
                    `${entity.type}:${entity.properties.id}`,
                    previewStatusFor(entity)
                ])
            );
            return {
                id: -1,
                shellyID: PREVIEW_EXTERNAL_ID,
                source: 'virtual',
                info: {
                    app: 'Virtual Device',
                    name: previewName.value,
                    model: details.value.typeKey,
                    imageAssetId: details.value.imageAssetId
                },
                status: {
                    sys: {unixtime: Math.floor(Date.now() / 1000)},
                    ...status
                },
                settings: {},
                online: true,
                sleeping: false,
                loading: false,
                selected: false,
                entities: entities.map((entity) => entity.id),
                capabilities: {},
                meta: {
                    preview: true,
                    virtualDevice: {visual: details.value.visual}
                },
                methods: [],
                groupIds: details.value.groupIds,
                locationId: details.value.locationId,
                tagIds: details.value.tagIds
            };
        });

        const partKey = (c: SourceComponentCandidate) =>
            `${c.deviceExternalId}|${c.componentKey}`;

        function mintRoleKey(componentType: string): string {
            let n = 1;
            while (
                roles.value.some((r) => r.roleKey === `${componentType}_${n}`)
            )
                n++;
            return `${componentType}_${n}`;
        }

        function addPart(c: SourceComponentCandidate): void {
            if (pickedKeys.value.has(partKey(c))) return;
            const roleKey = mintRoleKey(c.componentType);
            roles.value.push({
                roleKey,
                label: humaniseLabel(c),
                valueType: c.valueType ?? 'number',
                required: false,
                writable: c.writable,
                suggestedHistoryMode: 'linked',
                historyMode: 'linked',
                source: {
                    deviceExternalId: c.deviceExternalId,
                    componentKey: c.componentKey,
                    ...(c.dynamicCategory
                        ? {dynamicCategory: c.dynamicCategory}
                        : {})
                }
            });
            pickedKeys.value.set(partKey(c), roleKey);
        }

        function removePart(roleKey: string): void {
            roles.value = roles.value.filter((r) => r.roleKey !== roleKey);
            for (const [k, v] of pickedKeys.value) {
                if (v === roleKey) pickedKeys.value.delete(k);
            }
        }

        function isPicked(c: SourceComponentCandidate): boolean {
            return pickedKeys.value.has(partKey(c));
        }

        function reset() {
            kind.value = null;
            profile.value = null;
            manualMode.value = false;
            details.value = EMPTY_DETAILS();
            roles.value = [];
            energyRole.value = null;
            pickedKeys.value.clear();
            previewState.value = null;
            previewError.value = null;
            validation.value = null;
        }

        function setKind(k: WizardKind) {
            kind.value = k;
        }

        function selectProfile(p: VirtualDeviceProfile | null) {
            profile.value = p;
            manualMode.value = p === null;
            // Roles are rebuilt below — the picked-part index must not outlive them.
            pickedKeys.value.clear();
            if (!p) {
                roles.value = [];
                details.value.typeKey = 'custom_device';
                details.value.categoryKey = 'custom';
                details.value.visual = manualVisual();
                return;
            }
            manualMode.value = false;
            roles.value = p.roles.map(
                (def): RoleDraftRow => ({
                    roleKey: def.roleKey,
                    label: def.label,
                    valueType: def.valueType,
                    unit: def.unit,
                    required: def.required ?? false,
                    writable: def.writable ?? false,
                    suggestedHistoryMode: def.historyMode,
                    historyMode: def.historyMode,
                    source: null,
                    visual: def.visual
                })
            );
            if (!details.value.name) {
                details.value.name = p.name;
            }
            if (
                !details.value.typeKey ||
                details.value.typeKey === 'custom_device'
            ) {
                details.value.typeKey = p.key;
            }
            if (Object.keys(details.value.visual).length === 0) {
                details.value.visual = profileVisual(p);
            }
            const metaCategory = p.metadata?.categoryKey;
            if (
                !details.value.categoryKey &&
                typeof metaCategory === 'string' &&
                DEVICE_CATEGORY_KEYS.includes(metaCategory)
            ) {
                details.value.categoryKey = metaCategory;
            }
        }

        function bindRole(roleKey: string, source: SourceComponentRef | null) {
            const row = roles.value.find((r) => r.roleKey === roleKey);
            if (!row) return;
            row.source = source;
        }

        function previewEntityForRole(
            row: RoleDraftRow,
            index: number
        ): entity_t {
            const role = profile.value?.roles.find(
                (candidate) => candidate.roleKey === row.roleKey
            );
            const metadata = roleMetadata(role);
            const type = previewEntityType(row, metadata);
            const id = 200 + index;
            return {
                id: `${PREVIEW_EXTERNAL_ID}:role:${row.roleKey}:virtual`,
                name: row.label,
                type,
                source: PREVIEW_EXTERNAL_ID,
                properties: {
                    id,
                    roleKey: row.roleKey,
                    sourceDeviceExternalId: row.source?.deviceExternalId ?? '',
                    sourceComponentKey: row.source?.componentKey ?? '',
                    available: true,
                    writable: row.writable,
                    ...(row.unit ? {unit: row.unit} : {}),
                    ...previewEntityMetadata(metadata)
                }
            } as entity_t;
        }

        function roleMetadata(
            role: VirtualDeviceProfile['roles'][number] | undefined
        ): Record<string, unknown> {
            const metadata = role?.metadata;
            return metadata && typeof metadata === 'object' ? metadata : {};
        }

        function previewEntityType(
            row: RoleDraftRow,
            metadata: Record<string, unknown>
        ): string {
            return (
                stringMeta(metadata, 'entityType') ??
                stringMeta(metadata, 'componentType') ??
                row.source?.componentKey.split(':')[0] ??
                fallbackEntityType(row)
            );
        }

        function fallbackEntityType(row: RoleDraftRow): string {
            if (row.valueType === 'boolean')
                return row.writable ? 'switch' : 'input';
            if (row.valueType === 'number') return 'number';
            if (row.valueType === 'event') return 'button';
            if (row.valueType === 'string') return 'text';
            return 'text';
        }

        function previewEntityMetadata(
            metadata: Record<string, unknown>
        ): Record<string, unknown> {
            const out: Record<string, unknown> = {};
            for (const key of [
                'objName',
                'sensorType',
                'type',
                'inputType',
                'unit',
                'min',
                'max',
                'step',
                'options'
            ]) {
                if (metadata[key] !== undefined) out[key] = metadata[key];
            }
            if (typeof out.inputType === 'string') {
                out.type = out.inputType;
                delete out.inputType;
            }
            return out;
        }

        function previewStatusFor(entity: entity_t): Record<string, unknown> {
            switch (entity.type) {
                case 'switch':
                case 'light':
                    return {output: false};
                case 'cover':
                    return {state: 'closed', current_pos: 0};
                case 'temperature':
                    return {tC: null};
                case 'humidity':
                    return {rh: null};
                case 'illuminance':
                    return {lux: null};
                case 'voltmeter':
                    return {voltage: null};
                case 'flood':
                case 'smoke':
                    return {alarm: false};
                case 'input':
                    return {state: false};
                case 'bthomesensor':
                    return {value: null};
                case 'number':
                    return {value: null};
                case 'boolean':
                    return {value: false};
                case 'button':
                    return {};
                default:
                    return {};
            }
        }

        function stringMeta(
            metadata: Record<string, unknown>,
            key: string
        ): string | null {
            const value = metadata[key];
            return typeof value === 'string' && value.trim().length > 0
                ? value.trim()
                : null;
        }

        function setRoleHistoryMode(roleKey: string, mode: HistoryMode) {
            const row = roles.value.find((r) => r.roleKey === roleKey);
            if (!row) return;
            row.historyMode = mode;
        }

        async function loadProfiles(query?: string) {
            profilesLoading.value = true;
            profilesError.value = null;
            try {
                const res = await virtualDevices.profiles.list({query});
                availableProfiles.value = res.items;
            } catch (err) {
                profilesError.value =
                    err instanceof Error ? err.message : String(err);
                availableProfiles.value = [];
            } finally {
                profilesLoading.value = false;
            }
        }

        function bindingItems(): BindingDraftItem[] {
            return roles.value
                .filter(
                    (row): row is RoleDraftRow & {source: SourceComponentRef} =>
                        row.source !== null
                )
                .map((row) => ({
                    roleKey: row.roleKey,
                    source: row.source,
                    visual: row.visual
                }));
        }

        function buildCreatePayload(): CreateVirtualDeviceRequest {
            return {
                kind: 'composed',
                name: details.value.name.trim(),
                typeKey: details.value.typeKey,
                categoryKey: details.value.categoryKey ?? undefined,
                profileId: profile.value?.id,
                imageAssetId: details.value.imageAssetId ?? undefined,
                locationId: details.value.locationId ?? undefined,
                groupIds: details.value.groupIds.length
                    ? details.value.groupIds
                    : undefined,
                tagIds: details.value.tagIds.length
                    ? details.value.tagIds
                    : undefined,
                visual: details.value.visual
            };
        }

        async function refreshPreview(): Promise<DraftPreviewResponse | null> {
            if (!canPreview.value) {
                previewState.value = null;
                return null;
            }
            previewLoading.value = true;
            previewError.value = null;
            try {
                const res = await virtualDevices.draft.preview({
                    device: buildCreatePayload(),
                    bindings: bindingItems()
                });
                previewState.value = res;
                validation.value = res.validation;
                return res;
            } catch (err) {
                previewError.value =
                    err instanceof Error ? err.message : String(err);
                previewState.value = null;
                return null;
            } finally {
                previewLoading.value = false;
            }
        }

        async function validateDraft(externalId: string) {
            try {
                validation.value = await virtualDevices.bindings.validateDraft({
                    externalId,
                    bindings: bindingItems()
                });
                return validation.value;
            } catch (err) {
                validation.value = {
                    valid: false,
                    errors: [
                        {
                            message:
                                err instanceof Error ? err.message : String(err)
                        }
                    ]
                };
                return validation.value;
            }
        }

        async function applyEnergyRole(externalId: string): Promise<void> {
            const role = energyRole.value;
            if (!role) return;
            const points = await listMeasurementPoints({
                shellyID: externalId,
                includeAssigned: false
            });
            if (points.length === 0) return;
            const name = details.value.name.trim() || DEFAULT_ENERGY_METER_NAME;
            await saveLogicalMeter({
                name,
                utilityType: 'electric',
                role,
                kindId: null,
                phaseMode: deriveEnergyPhaseMode(points),
                aggregationMode: 'sum_points',
                points: points.map(toLogicalMeterPoint),
                groupId: null,
                locationId: null,
                parentMeterId: null
            });
        }

        async function commit(): Promise<VirtualDeviceDto> {
            await assertDraftValidForCreate();
            const created = await virtualDevices.create({
                ...buildCreatePayload(),
                bindings: bindingItems()
            });
            const revision = created.revision;
            const file = details.value.pendingImageFile;
            if (!file) {
                await applyEnergyRole(created.externalId);
                return created;
            }
            // Upload after create — device exists, image is a follow-up.
            // Surface failures via toast so users know the image was skipped.
            const toast = useToastStore();
            let uploadError: string | null = null;
            const ticket = await virtualDevices.createImageUploadTicket({
                externalId: created.externalId
            });
            const assetId = await uploadVisualAsset({
                file,
                context: 'device',
                ticket: {
                    uploadTicket: ticket.uploadTicket,
                    resourceKind: 'virtual-device',
                    resourceId: created.externalId
                },
                onError: (msg) => {
                    uploadError = msg;
                }
            });
            if (!assetId) {
                toast.warning(
                    uploadError ??
                        'Device created but image upload failed — you can add an image from the device page.'
                );
                await applyEnergyRole(created.externalId);
                return created;
            }
            const updated = await virtualDevices.update({
                externalId: created.externalId,
                expectedRevision: revision,
                imageAssetId: assetId
            });
            await applyEnergyRole(updated.externalId);
            return updated;
        }

        async function assertDraftValidForCreate(): Promise<void> {
            const preview = await refreshPreview();
            if (!preview) {
                throw new Error(previewError.value ?? 'Draft is not ready.');
            }
            if (!preview.validation.valid) {
                throw new Error(validationSummary(preview.validation));
            }
        }

        function validationSummary(result: ValidationResult): string {
            const first = result.errors[0];
            if (!first) return 'Draft is invalid.';
            if (typeof first.message === 'string') return first.message;
            if (typeof first.error === 'string') return first.error;
            return 'Draft is invalid.';
        }

        return {
            kind,
            profile,
            manualMode,
            details,
            roles,
            energyRole,
            availableProfiles,
            profilesLoading,
            profilesError,
            previewState,
            previewLoading,
            previewError,
            previewDevice,
            previewEntities,
            validation,
            isCustom,
            allRequiredBound,
            hasBoundParts,
            templateChosen,
            readyForDetails,
            canPreview,
            pickedParts,
            reset,
            setKind,
            selectProfile,
            bindRole,
            setRoleHistoryMode,
            loadProfiles,
            bindingItems,
            buildCreatePayload,
            refreshPreview,
            validateDraft,
            commit,
            addPart,
            removePart,
            isPicked,
            mintRoleKey
        };
    }
);
