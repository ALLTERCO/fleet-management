<template>
    <section class="ua-panel" aria-labelledby="tariff-library-title">
        <EnergyTariffEditor
            v-if="editorOpen"
            :editing-id="editingId"
            :default-currency="organization.profile?.currencyDefault ?? undefined"
            :default-timezone="organization.profile?.timezoneDefault ?? browserTimezone"
            :organization-timezone="organization.profile?.timezoneDefault ?? undefined"
            @close="closeEditor"
            @saved="onSaved"
        />

        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="tariff-library-title">Tariff library</h2>
                <p>
                    Define each utility contract once, then assign it below. Country
                    never selects a price; provider terms, dates, units, charges and
                    taxes stay explicit in the tariff.
                </p>
            </div>
            <Button v-if="canCreate" type="green" size="sm" @click="openEditor(null)">
                New tariff
            </Button>
        </header>

        <div class="ua-filterbar">
            <label class="ua-compact-field ua-search" for="tariff-library-search">
                <span>Search</span>
                <input
                    id="tariff-library-search"
                    v-model.trim="query"
                    class="ua-input"
                    type="search"
                    placeholder="Name, currency, or source"
                />
            </label>
            <label class="ua-compact-field" for="tariff-library-commodity">
                <span>Commodity</span>
                <select id="tariff-library-commodity" v-model="commodity" class="ua-select">
                    <option value="all">All</option>
                    <option value="electricity">Electricity</option>
                    <option value="water">Water</option>
                    <option value="gas">Gas</option>
                    <option value="heat">Heat</option>
                </select>
            </label>
        </div>

        <div v-if="loadError" class="ua-state ua-state--error" role="alert">
            <div>
                <strong>Couldn’t load the tariff library.</strong>
                <span>{{ loadError }}</span>
            </div>
            <Button type="blue-hollow" size="sm" @click="load">Retry</Button>
        </div>

        <section
            v-if="deleteCandidate"
            class="ua-review"
            aria-labelledby="tariff-delete-review-title"
        >
            <div>
                <h3 id="tariff-delete-review-title">Delete tariff?</h3>
                <p>
                    <strong dir="auto">{{ deleteCandidate.name }}</strong> will be
                    removed only if Fleet confirms it is no longer referenced. Existing
                    assignments are never silently redirected to another price.
                </p>
            </div>
            <p v-if="deleteError" class="ua-form-error" role="alert">{{ deleteError }}</p>
            <div class="ua-editor__footer">
                <Button type="blue-hollow" size="sm" @click="cancelDelete">Cancel</Button>
                <Button type="red" size="sm" :loading="deleting" @click="deleteTariff">
                    Delete tariff
                </Button>
            </div>
        </section>

        <DataList
            v-if="!loadError"
            :rows="filteredTariffs"
            :columns="columns"
            row-key="id"
            :loading="loading"
            empty-message="No tariffs match this view."
        >
            <template #cell-name="{row}">
                <span class="ua-primary" dir="auto">{{ row.name }}</span>
            </template>
            <template #cell-pricing="{row}">
                {{ titleCase(row.kind) }} · {{ titleCase(row.commodity) }}/{{ row.billedUnit }}
            </template>
            <template #cell-currency="{row}">
                <span class="ua-badge">{{ row.currency }}</span>
            </template>
            <template #cell-effective="{row}">
                {{ effectiveLabel(row) }}
            </template>
            <template #cell-actions="{row}">
                <div v-if="canUpdate || canDelete" class="ua-row-actions">
                    <Button
                        v-if="canUpdate"
                        type="blue-hollow"
                        size="xs"
                        @click="openEditor(row.id)"
                    >
                        Edit
                    </Button>
                    <Button
                        v-if="canDelete"
                        type="red"
                        size="xs"
                        @click="reviewDelete(row)"
                    >
                        Delete
                    </Button>
                </div>
            </template>
        </DataList>
    </section>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import EnergyTariffEditor from '@/components/dashboard/energy/EnergyTariffEditor.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import type {HostResult} from '@/shell/template-host/generated/contract';
import {useAuthStore} from '@/stores/auth';
import {useOrganizationStore} from '@/stores/organization';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

type Tariff = HostResult<'tariff.list'>['items'][number];
type CommodityFilter = 'all' | Tariff['commodity'];

const emit = defineEmits<{updated: []}>();
const auth = useAuthStore();
const organization = useOrganizationStore();
const toast = useToastStore();
const canCreate = computed(() => auth.canPerformComponent('reports', 'create'));
const canUpdate = computed(() => auth.canPerformComponent('reports', 'update'));
const canDelete = computed(() => auth.canPerformComponent('reports', 'delete'));
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const tariffs = ref<Tariff[]>([]);
const loading = ref(true);
const loadError = ref('');
const query = ref('');
const commodity = ref<CommodityFilter>('all');
const editorOpen = ref(false);
const editingId = ref<number | null>(null);
const deleteCandidate = ref<Tariff | null>(null);
const deleting = ref(false);
const deleteError = ref('');

const columns: DataColumn<Tariff>[] = [
    {key: 'name', label: 'Tariff', role: 'primary'},
    {key: 'pricing', label: 'Type / quantity', role: 'secondary'},
    {key: 'currency', label: 'Currency', role: 'status'},
    {key: 'effective', label: 'Effective dates', role: 'meta'},
    {key: 'actions', label: 'Actions', role: 'action', align: 'right'}
];

const filteredTariffs = computed(() => {
    const needle = query.value.toLocaleLowerCase();
    return tariffs.value.filter((tariff) => {
        if (commodity.value !== 'all' && tariff.commodity !== commodity.value) {
            return false;
        }
        if (!needle) return true;
        return [tariff.name, tariff.currency, tariff.sourceReference ?? '']
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle);
    });
});

async function load(): Promise<void> {
    loading.value = true;
    loadError.value = '';
    try {
        const result = await sendRPC<HostResult<'tariff.list'>>(
            'FLEET_MANAGER',
            'tariff.list',
            {}
        );
        tariffs.value = result.items ?? [];
    } catch (error) {
        loadError.value = rpcErrorMessage(error, 'Request failed');
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void Promise.all([load(), organization.fetchProfile()]);
});

function openEditor(id: number | null): void {
    editingId.value = id;
    editorOpen.value = true;
}

function closeEditor(): void {
    editorOpen.value = false;
    editingId.value = null;
}

async function onSaved(): Promise<void> {
    closeEditor();
    await load();
    emit('updated');
    toast.success('Tariff saved');
}

function reviewDelete(tariff: Tariff): void {
    deleteCandidate.value = tariff;
    deleteError.value = '';
}

function cancelDelete(): void {
    deleteCandidate.value = null;
    deleteError.value = '';
}

async function deleteTariff(): Promise<void> {
    if (!canDelete.value || deleting.value || !deleteCandidate.value) return;
    deleting.value = true;
    deleteError.value = '';
    try {
        await sendRPC('FLEET_MANAGER', 'tariff.delete', {
            id: deleteCandidate.value.id
        });
        cancelDelete();
        await load();
        emit('updated');
        toast.success('Tariff deleted');
    } catch (error) {
        deleteError.value = rpcErrorMessage(error, 'Could not delete tariff');
    } finally {
        deleting.value = false;
    }
}

function effectiveLabel(tariff: Tariff): string {
    if (!tariff.effectiveFrom && !tariff.effectiveTo) return 'No date limit';
    return `${tariff.effectiveFrom ?? 'Open'} → ${tariff.effectiveTo ?? 'Open'}`;
}

function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}
</script>
