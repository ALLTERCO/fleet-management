<template>
    <section class="ua-panel" aria-labelledby="gas-conversion-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="gas-conversion-title">Gas conversion</h2>
                <p>
                    Version pricing zones, meter conversion profiles, and published calorific
                    values. Stored volume is converted by the backend; the browser does not
                    calculate billable energy.
                </p>
            </div>
            <Button v-if="canWrite" type="green" size="sm" @click="openEditor">
                Add {{ addLabel }}
            </Button>
        </header>

        <div class="ua-filterbar">
            <fieldset class="ua-segment">
                <legend class="sr-only">Gas conversion records</legend>
                <button
                    v-for="tab in GAS_TABS"
                    :key="tab.value"
                    type="button"
                    :aria-pressed="view === tab.value"
                    :class="{'is-active': view === tab.value}"
                    @click="view = tab.value"
                >
                    {{ tab.label }}
                </button>
            </fieldset>
        </div>

        <GasZoneForm
            v-if="showEditor && view === 'zones'"
            ref="editorRoot"
            :draft="zoneDraft"
            :error="formError"
            :saving="saving"
            @submit="saveZone"
            @cancel="closeEditor"
        />

        <GasProfileForm
            v-if="showEditor && view === 'profiles'"
            ref="editorRoot"
            :draft="profileDraft"
            :devices="devices"
            :zones="zones"
            :error="formError"
            :saving="saving"
            @submit="saveProfile"
            @cancel="closeEditor"
        />

        <GasCalorificValueForm
            v-if="showEditor && view === 'values'"
            ref="editorRoot"
            :draft="valueDraft"
            :zones="zones"
            :error="formError"
            :saving="saving"
            @submit="saveCalorificValue"
            @cancel="closeEditor"
        />

        <div v-if="loadError" class="ua-state ua-state--error" role="alert">
            <div>
                <strong>Couldn’t load gas conversion records.</strong>
                <span>{{ loadError }}</span>
            </div>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>

        <div v-if="view === 'zones' && !loadError">
            <DataList
                :rows="zones"
                :columns="GAS_ZONE_COLUMNS"
                row-key="id"
                :loading="loading"
                empty-message="No gas pricing zones have been configured."
            >
                <template #cell-name="{row}">
                    <span class="ua-primary" dir="auto">{{ row.name }}</span>
                </template>
                <template #cell-code="{row}">
                    <span dir="auto">{{ row.externalCode }}</span>
                </template>
                <template #cell-clock="{row}">{{ row.timezone }} · {{ row.dayBoundary }}</template>
            </DataList>
            <LoadOlder
                v-if="zoneCursor"
                :loading="loadingMore"
                label="Load older zones"
                @click="loadOlder('zones')"
            />
        </div>
        <div v-if="view === 'profiles' && !loadError">
            <DataList
                :rows="profiles"
                :columns="GAS_PROFILE_COLUMNS"
                row-key="id"
                :loading="loading"
                empty-message="No gas conversion profiles have been configured."
            >
                <template #cell-meter="{row}">
                    <span class="ua-primary" dir="auto">
                        {{ row.deviceExternalId
                        }}{{ row.channel == null ? '' : ` · ch ${row.channel}` }}
                    </span>
                </template>
                <template #cell-units="{row}">
                    {{ row.meteredUnit }} → {{ row.billedUnit }}
                </template>
                <template #cell-revision="{row}">
                    <span class="ua-badge">Revision {{ row.revision }}</span>
                </template>
                <template #cell-period="{row}">
                    {{ row.effectiveFrom }} – {{ row.effectiveTo ?? 'Open ended' }}
                </template>
            </DataList>
            <LoadOlder
                v-if="profileCursor"
                :loading="loadingMore"
                label="Load older profiles"
                @click="loadOlder('profiles')"
            />
        </div>
        <div v-if="view === 'values' && !loadError">
            <DataList
                :rows="values"
                :columns="GAS_VALUE_COLUMNS"
                row-key="id"
                :loading="loading"
                empty-message="No calorific values have been recorded."
            >
                <template #cell-day="{row}">
                    <span class="ua-primary">{{ row.gasDay }}</span>
                </template>
                <template #cell-value="{row}">
                    <span class="ua-number">{{ row.value }} {{ row.unit }}</span>
                </template>
                <template #cell-zone="{row}">{{ gasZoneLabel(zones, row.pricingZoneId) }}</template>
                <template #cell-revision="{row}">
                    <span class="ua-badge">Revision {{ row.revision }}</span>
                </template>
            </DataList>
            <LoadOlder
                v-if="valueCursor"
                :loading="loadingMore"
                label="Load older values"
                @click="loadOlder('values')"
            />
        </div>
    </section>
</template>

<script setup lang="ts">
import {
    type ComponentPublicInstance,
    computed,
    nextTick,
    onMounted,
    reactive,
    ref,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList from '@/components/core/DataList.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import GasCalorificValueForm from './GasCalorificValueForm.vue';
import GasProfileForm from './GasProfileForm.vue';
import GasZoneForm from './GasZoneForm.vue';
import {
    blankCalorificValueDraft,
    blankProfileDraft,
    blankZoneDraft,
    calorificValueSubmission,
    GAS_ADD_LABELS,
    GAS_PROFILE_COLUMNS,
    GAS_TABS,
    GAS_VALUE_COLUMNS,
    GAS_ZONE_COLUMNS,
    type GasCalorificValue,
    type GasProfile,
    type GasRecordPage,
    type GasSubmission,
    type GasView,
    type GasZone,
    gasDeviceLabel,
    gasZoneLabel,
    profileSubmission,
    zoneSubmission
} from './gasConversion';
import {LoadOlder} from './gasEditorChrome';

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const deviceStore = useDevicesStore();
const canWrite = computed(() => auth.canPerformComponent('reports', 'update'));
const devices = computed(() =>
    Object.values(deviceStore.devices).sort((a, b) =>
        gasDeviceLabel(a).localeCompare(gasDeviceLabel(b))
    )
);
const view = ref<GasView>('zones');
const showEditor = ref(false);
const saving = ref(false);
const formError = ref('');
const editorRoot = ref<ComponentPublicInstance | null>(null);
const zones = ref<GasZone[]>([]);
const profiles = ref<GasProfile[]>([]);
const values = ref<GasCalorificValue[]>([]);
const zoneCursor = ref<number | null>(null);
const profileCursor = ref<number | null>(null);
const valueCursor = ref<number | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref('');
const addLabel = computed(() => GAS_ADD_LABELS[view.value]);

// The drafts outlive their form: closing the editor must not throw away what
// the operator typed.
const zoneDraft = reactive(blankZoneDraft());
const profileDraft = reactive(blankProfileDraft());
const valueDraft = reactive(blankCalorificValueDraft());

watch(view, () => closeEditor());

async function loadPage<T>(
    method: string,
    beforeId?: number
): Promise<GasRecordPage<T>> {
    return (await sendRPC('FLEET_MANAGER', method, {
        limit: 100,
        ...(beforeId ? {beforeId} : {})
    })) as GasRecordPage<T>;
}
async function reload(): Promise<void> {
    loading.value = true;
    loadError.value = '';
    try {
        const [zonePage, profilePage, valuePage] = await Promise.all([
            loadPage<GasZone>('gasconversion.listzones'),
            loadPage<GasProfile>('gasconversion.listprofiles'),
            loadPage<GasCalorificValue>('gasconversion.listcalorificvalues')
        ]);
        zones.value = zonePage.items;
        zoneCursor.value = zonePage.nextBeforeId;
        profiles.value = profilePage.items;
        profileCursor.value = profilePage.nextBeforeId;
        values.value = valuePage.items;
        valueCursor.value = valuePage.nextBeforeId;
    } catch (error) {
        loadError.value = rpcErrorMessage(error, 'Request failed');
    } finally {
        loading.value = false;
    }
}
onMounted(() => void Promise.all([reload(), deviceStore.fetchDevices()]));
async function loadOlder(kind: GasView): Promise<void> {
    if (loadingMore.value) return;
    loadingMore.value = true;
    try {
        if (kind === 'zones') {
            await loadOlderZones();
        } else if (kind === 'profiles') {
            await loadOlderProfiles();
        } else {
            await loadOlderCalorificValues();
        }
    } catch (error) {
        toast.error(rpcErrorMessage(error, 'Could not load older records'));
    } finally {
        loadingMore.value = false;
    }
}

async function loadOlderZones(): Promise<void> {
    if (!zoneCursor.value) return;
    const result = await loadPage<GasZone>(
        'gasconversion.listzones',
        zoneCursor.value
    );
    zones.value.push(...result.items);
    zoneCursor.value = result.nextBeforeId;
}

async function loadOlderProfiles(): Promise<void> {
    if (!profileCursor.value) return;
    const result = await loadPage<GasProfile>(
        'gasconversion.listprofiles',
        profileCursor.value
    );
    profiles.value.push(...result.items);
    profileCursor.value = result.nextBeforeId;
}

async function loadOlderCalorificValues(): Promise<void> {
    if (!valueCursor.value) return;
    const result = await loadPage<GasCalorificValue>(
        'gasconversion.listcalorificvalues',
        valueCursor.value
    );
    values.value.push(...result.items);
    valueCursor.value = result.nextBeforeId;
}

function closeEditor(): void {
    showEditor.value = false;
    formError.value = '';
}
function openEditor(): void {
    if (showEditor.value) {
        closeEditor();
        return;
    }
    showEditor.value = true;
    formError.value = '';
    void nextTick(focusFirstControl);
}
function focusFirstControl(): void {
    const form = editorRoot.value?.$el as HTMLElement | undefined;
    form?.querySelector<HTMLElement>('input, select')?.focus();
}

async function saveZone(): Promise<void> {
    await submitRecord(zoneSubmission(zoneDraft));
}
async function saveProfile(): Promise<void> {
    await submitRecord(profileSubmission(profileDraft));
}
async function saveCalorificValue(): Promise<void> {
    await submitRecord(calorificValueSubmission(valueDraft));
}

async function submitRecord(submission: GasSubmission): Promise<void> {
    if (!canWrite.value || saving.value) return;
    if (submission.error) {
        formError.value = submission.error;
        return;
    }
    await persistRecord(submission);
}

async function persistRecord(submission: GasSubmission): Promise<void> {
    saving.value = true;
    formError.value = '';
    try {
        await sendRPC('FLEET_MANAGER', submission.method, submission.input);
        toast.success(submission.success);
        closeEditor();
        await reload();
    } catch (error) {
        formError.value = rpcErrorMessage(error, 'Could not save the record');
    } finally {
        saving.value = false;
    }
}
</script>
