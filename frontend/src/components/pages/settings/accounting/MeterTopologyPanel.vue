<template>
    <section class="ua-panel" aria-labelledby="meter-topology-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="meter-topology-title">What each meter measures</h2>
                <p>
                    Review which physical counters feed each logical meter, then
                    assign its flow role and end use without rewriting older
                    report periods.
                </p>
            </div>
            <div class="ua-panel__actions">
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="loading"
                    @click="reload"
                >
                    Refresh evidence
                </Button>
            </div>
        </header>

        <div class="ua-topology-toolbar">
            <fieldset class="ua-segment">
                <legend class="sr-only">Meter review filter</legend>
                <button
                    type="button"
                    :class="{'is-active': filter === 'review'}"
                    :aria-pressed="filter === 'review'"
                    @click="filter = 'review'"
                >
                    Needs review
                    <span class="ua-count">
                        {{ reviewItems.length }}{{ nextReviewCursor ? '+' : '' }}
                    </span>
                </button>
                <button
                    type="button"
                    :class="{'is-active': filter === 'all'}"
                    :aria-pressed="filter === 'all'"
                    @click="filter = 'all'"
                >
                    All meters
                    <span class="ua-count">{{ meters.length }}</span>
                </button>
            </fieldset>
            <label class="ua-search">
                <span class="sr-only">Search meters</span>
                <input
                    v-model="search"
                    class="ua-input"
                    type="search"
                    placeholder="Search meter or device"
                />
            </label>
        </div>

        <div v-if="loadError" class="ua-state ua-state--error" role="alert">
            <div>
                <strong>Meter evidence could not be loaded.</strong>
                <span>{{ loadError }}</span>
            </div>
            <Button type="blue-hollow" size="sm" @click="reload">
                Try again
            </Button>
        </div>
        <p v-else-if="loading" class="ua-state" role="status">
            Loading meter topology and classification evidence…
        </p>
        <div v-else class="ua-topology-layout">
            <section
                class="ua-meter-queue"
                aria-labelledby="meter-review-queue-title"
            >
                <div class="ua-section-heading">
                    <div>
                        <h3 id="meter-review-queue-title">
                            {{ filter === 'review' ? 'Review queue' : 'Logical meters' }}
                        </h3>
                        <p v-if="filter === 'review'">
                            Confidence ranks evidence; it never applies a change.
                        </p>
                    </div>
                </div>

                <div v-if="visibleRows.length === 0" class="ua-state">
                    <div>
                        <strong>{{ emptyState.title }}</strong>
                        <span>{{ emptyState.message }}</span>
                    </div>
                </div>
                <ol v-else class="ua-meter-list">
                    <li v-for="row in visibleRows" :key="row.id">
                        <button
                            type="button"
                            :class="{'is-selected': selectedMeterId === row.id}"
                            :aria-current="selectedMeterId === row.id ? 'true' : undefined"
                            @click="selectMeter(row.id)"
                        >
                            <span class="ua-meter-list__main">
                                <strong>{{ row.name }}</strong>
                                <small>
                                    {{ row.utility }} ·
                                    {{ row.role }} ·
                                    {{ row.kind }}
                                </small>
                            </span>
                            <span
                                v-if="row.confidenceLabel"
                                class="ua-confidence"
                            >
                                {{ row.confidenceLabel }}
                            </span>
                            <span v-else class="ua-badge ua-badge--ok">Classified</span>
                        </button>
                    </li>
                </ol>
                <div
                    v-if="filter === 'review' && nextReviewCursor"
                    class="ua-load-more"
                >
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="loadingMore"
                        @click="loadMoreReviews"
                    >
                        Load more reviews
                    </Button>
                </div>
            </section>

            <section
                v-if="selectedMeter"
                class="ua-topology-editor"
                aria-labelledby="meter-review-title"
            >
                <div class="ua-section-heading">
                    <div>
                        <h3 id="meter-review-title">{{ selectedMeter.name }}</h3>
                        <p>
                            Revision {{ selectedRevision }} ·
                            {{ selectedMeter.points.length }} physical
                            {{ selectedMeter.points.length === 1 ? 'counter' : 'counters' }}
                        </p>
                        <p v-if="!canUpdateSelected">{{ readOnlyReason }}</p>
                    </div>
                    <span
                        v-if="!canUpdateSelected"
                        class="ua-badge ua-badge--warn"
                        :title="readOnlyReason"
                    >
                        Read only
                    </span>
                </div>

                <section aria-labelledby="physical-identity-title">
                    <div class="ua-subsection-heading">
                        <div>
                            <h4 id="physical-identity-title">Physical identity</h4>
                            <p>
                                Device, channel, measured quantity, and direction
                                are recorded facts. Change their mapping from the
                                device only when the wiring evidence changes.
                            </p>
                        </div>
                    </div>
                    <ul class="ua-point-list">
                        <li v-for="point in pointRows" :key="point.key">
                            <span class="ua-point-list__identity">
                                <strong>{{ point.device.name }}</strong>
                                <small>{{ point.device.externalId }}</small>
                            </span>
                            <dl>
                                <div>
                                    <dt>Counter</dt>
                                    <dd>{{ point.counter }}</dd>
                                </div>
                                <div>
                                    <dt>Channel</dt>
                                    <dd>{{ point.channel }}</dd>
                                </div>
                                <div>
                                    <dt>Measurement</dt>
                                    <dd>{{ point.measurement }}</dd>
                                </div>
                                <div>
                                    <dt>Direction</dt>
                                    <dd>{{ point.direction }}</dd>
                                </div>
                            </dl>
                        </li>
                    </ul>
                </section>

                <section aria-labelledby="topology-meaning-title">
                    <div class="ua-subsection-heading">
                        <div>
                            <h4 id="topology-meaning-title">Topology meaning</h4>
                            <p>
                                Utility is fixed by the measured quantity. Role
                                describes flow position; end use describes what
                                consumed or produced it.
                            </p>
                        </div>
                    </div>

                    <div v-if="suggestion" class="ua-evidence" role="note">
                        <div>
                            <strong>
                                Suggested {{ suggestion.role }}
                                · {{ suggestion.kind }}
                            </strong>
                            <span>
                                {{ suggestion.confidence }}%
                                confidence from deterministic evidence.
                            </span>
                        </div>
                        <ul>
                            <li
                                v-for="evidence in suggestion.evidence"
                                :key="`${evidence.code}:${evidence.detail}`"
                            >
                                {{ evidence.detail }}
                            </li>
                        </ul>
                    </div>

                    <form class="ua-meaning-form" @submit.prevent="previewChange">
                        <div class="ua-form-grid">
                            <FormField field-id="meaning-utility" label="Utility">
                                <input
                                    id="meaning-utility"
                                    class="ua-input"
                                    :value="utilityLabel(selectedMeter.utilityType)"
                                    disabled
                                />
                            </FormField>
                            <FormField
                                field-id="meaning-role"
                                label="Flow role"
                                hint="Supply, generation, storage, or final usage in the utility flow."
                            >
                                <select
                                    id="meaning-role"
                                    v-model="form.role"
                                    class="ua-select"
                                    :disabled="!canUpdateSelected"
                                    required
                                >
                                    <option
                                        v-for="option in roleOptions"
                                        :key="option.role"
                                        :value="option.role"
                                    >
                                        {{ option.label }}
                                    </option>
                                </select>
                            </FormField>
                            <FormField
                                field-id="meaning-kind"
                                label="End use / equipment"
                                hint="Optional classification for end-use breakdowns."
                            >
                                <select
                                    id="meaning-kind"
                                    v-model="form.kindId"
                                    class="ua-select"
                                    :disabled="!canUpdateSelected"
                                >
                                    <option value="">No end use</option>
                                    <optgroup
                                        v-for="group in endUseGroups"
                                        :key="group.label"
                                        :label="group.label"
                                    >
                                        <option
                                            v-for="kind in group.items"
                                            :key="kind.id"
                                            :value="kind.id"
                                        >
                                            {{ kind.name }}
                                        </option>
                                    </optgroup>
                                </select>
                            </FormField>
                            <FormField
                                field-id="meaning-effective-from"
                                label="Effective from (UTC)"
                                hint="UTC on a 15-minute boundary. Earlier reports keep their previous meaning."
                            >
                                <input
                                    id="meaning-effective-from"
                                    v-model="form.effectiveFrom"
                                    class="ua-input ua-number"
                                    type="datetime-local"
                                    step="900"
                                    :disabled="!canUpdateSelected"
                                    required
                                />
                            </FormField>
                            <FormField
                                field-id="meaning-source-reference"
                                label="Evidence reference"
                                hint="Work order, drawing, commissioning note, or investigation reference."
                            >
                                <Input
                                    v-model="form.sourceReference"
                                    :maxlength="500"
                                    :disabled="!canUpdateSelected"
                                    required
                                />
                            </FormField>
                        </div>
                        <p v-if="formError" class="ua-form-error" role="alert">
                            {{ formError }}
                        </p>
                        <div class="ua-editor__footer">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :loading="historyLoading"
                                :aria-expanded="historyOpen"
                                aria-controls="meaning-history"
                                @click="toggleHistory"
                            >
                                {{ historyOpen ? 'Hide history' : 'View history' }}
                            </Button>
                            <Button
                                type="blue"
                                size="sm"
                                submit
                                :loading="previewing"
                                :disabled="!canPreview"
                            >
                                Preview impact
                            </Button>
                        </div>
                    </form>
                </section>

                <section
                    v-if="historyOpen"
                    id="meaning-history"
                    class="ua-history"
                    aria-labelledby="meaning-history-title"
                >
                    <h4 id="meaning-history-title">Meaning history</h4>
                    <p v-if="historyError" class="ua-form-error" role="alert">
                        {{ historyError }}
                    </p>
                    <ol v-else>
                        <li v-for="version in revisionRows" :key="version.revision">
                            <strong>Revision {{ version.revision }}</strong>
                            <span>
                                {{ version.role }} ·
                                {{ version.kind }}
                            </span>
                            <small>{{ version.interval }}</small>
                        </li>
                    </ol>
                    <div v-if="nextHistoryBeforeRevision" class="ua-load-more">
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :loading="historyLoading"
                            @click="loadMoreHistory"
                        >
                            Load older revisions
                        </Button>
                    </div>
                </section>

                <section
                    v-if="impact"
                    class="ua-review"
                    aria-labelledby="meaning-impact-title"
                >
                    <div>
                        <h3 id="meaning-impact-title">Review impact before applying</h3>
                        <p>
                            {{ impact.currentRole }} ·
                            {{ impact.currentKind }}
                            →
                            {{ impact.proposedRole }} ·
                            {{ impact.proposedKind }}
                        </p>
                    </div>
                    <dl class="ua-impact-grid">
                        <div v-for="surface in impact.surfaces" :key="surface.key">
                            <dt>{{ surface.label }}</dt>
                            <dd>
                                {{ surface.count }}
                                <template v-if="surface.ids.length > 0">
                                    <br />
                                    <small>
                                    IDs: {{ surface.ids.join(', ') }}
                                    </small>
                                </template>
                                <template v-if="surface.truncated">
                                    <br />
                                    <small>
                                    More records are affected; only the first
                                    {{ surface.ids.length }} IDs are shown.
                                    </small>
                                </template>
                            </dd>
                        </div>
                        <div>
                            <dt>Report interpretation</dt>
                            <dd>{{ impact.reportInterpretation }}</dd>
                        </div>
                    </dl>
                    <div
                        v-if="!impact.eligible"
                        class="ua-state ua-state--error"
                        role="alert"
                    >
                        <div>
                            <strong>This preview cannot be applied.</strong>
                            <ul class="ua-issue-list">
                                <li
                                    v-for="reason in impact.ineligibilityReasons"
                                    :key="reason"
                                >
                                    {{ reason }}
                                </li>
                            </ul>
                        </div>
                    </div>
                    <label v-else class="ua-check">
                        <input v-model="acknowledged" type="checkbox" />
                        <span>
                            {{ impact.acknowledgement }}
                        </span>
                    </label>
                    <p v-if="applyError" class="ua-form-error" role="alert">
                        {{ applyError }}
                    </p>
                    <div class="ua-editor__footer">
                        <Button type="blue-hollow" size="sm" @click="clearPreview">
                            Change proposal
                        </Button>
                        <Button
                            v-if="impact.eligible"
                            type="green"
                            size="sm"
                            :loading="applying"
                            :disabled="!acknowledged"
                            @click="applyChange"
                        >
                            Apply effective-dated change
                        </Button>
                    </div>
                </section>
            </section>
        </div>

        <div v-if="appliedMessage" class="ua-state" role="status" aria-live="polite">
            <div>
                <strong>Classification updated.</strong>
                <span>{{ appliedMessage }}</span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import type {
    EnergyLogicalMeter,
    EnergyLogicalMeterMeaning,
    EnergyLogicalMeterMeaningReviewItem,
    EnergyMeterRole,
    EnergyPreviewLogicalMeterMeaningChangeResponse
} from '@api/energy';
import {computed, onMounted, reactive, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {type KindEntry, listKinds} from '@/api/kindRpc';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import {energyRolesForUtility} from '@/helpers/energyAssignment';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {
    applyLogicalMeterMeaningChange,
    listLogicalMeterMeaningHistory,
    listLogicalMeterMeaningReviewQueue,
    previewLogicalMeterMeaningChange
} from '@/tools/logicalMeterMeaning';
import {listLogicalMeters} from '@/tools/logicalMeters';
import type {shelly_device_t} from '@/types';
import {
    confidencePercent,
    formatDateTime,
    kindGroups,
    kindLabel,
    type MeterDeviceLabels,
    type MeterFilter,
    type MeterVocabulary,
    meterImpactView,
    meterListEmptyState,
    meterListRows,
    meterPointRows,
    meterRevisionRows,
    parseUtcDateTime,
    roleLabel,
    utcQuarterHour,
    utilityLabel,
    visibleMeterRows
} from './meterTopologyView';

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const deviceStore = useDevicesStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const route = useRoute();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const router = useRouter();

const meters = ref<EnergyLogicalMeter[]>([]);
const reviewItems = ref<EnergyLogicalMeterMeaningReviewItem[]>([]);
const history = ref<EnergyLogicalMeterMeaning[]>([]);
const kinds = ref<KindEntry[]>([]);
const preview = ref<EnergyPreviewLogicalMeterMeaningChangeResponse | null>(null);
const filter = ref<MeterFilter>('review');
const search = ref('');
const selectedMeterId = ref<number | null>(null);
const loading = ref(false);
const previewing = ref(false);
const applying = ref(false);
const historyLoading = ref(false);
const historyOpen = ref(false);
const loadingMore = ref(false);
const acknowledged = ref(false);
const loadError = ref('');
const formError = ref('');
const applyError = ref('');
const historyError = ref('');
const appliedMessage = ref('');
const nextReviewCursor = ref<{confidence: number; meterId: number} | null>(null);
const nextHistoryBeforeRevision = ref<number | null>(null);
const previewExpectedRevision = ref<number | null>(null);

const form = reactive({
    role: 'aux' as EnergyMeterRole,
    kindId: '',
    effectiveFrom: utcQuarterHour(new Date()),
    sourceReference: ''
});

const reviewByMeter = computed(
    () => new Map(reviewItems.value.map((item) => [item.meterId, item]))
);
const selectedMeter = computed(
    () => meters.value.find((meter) => meter.id === selectedMeterId.value) ?? null
);
const selectedReview = computed(() =>
    selectedMeterId.value == null
        ? null
        : (reviewByMeter.value.get(selectedMeterId.value) ?? null)
);
const selectedRevision = computed(
    () =>
        selectedReview.value?.current.revision ??
        selectedMeter.value?.meaningRevision ??
        1
);
const vocabulary = computed<MeterVocabulary>(() => ({
    utilityType: selectedMeter.value?.utilityType ?? null,
    kinds: kinds.value
}));
const roleOptions = computed(() =>
    selectedMeter.value
        ? energyRolesForUtility(selectedMeter.value.utilityType)
        : []
);
const endUseGroups = computed(() => kindGroups(kinds.value));
const meterRows = computed(() =>
    meterListRows(meters.value, {
        reviews: reviewByMeter.value,
        vocabulary: vocabulary.value,
        describeDevice: deviceLabels
    })
);
const listView = computed(() => ({
    filter: filter.value,
    search: search.value
}));
const visibleRows = computed(() =>
    visibleMeterRows(meterRows.value, listView.value)
);
const emptyState = computed(() => meterListEmptyState(listView.value));
const pointRows = computed(() =>
    meterPointRows(selectedMeter.value?.points ?? [], deviceLabels)
);
const revisionRows = computed(() =>
    meterRevisionRows(history.value, vocabulary.value)
);
const suggestion = computed(() => {
    const review = selectedReview.value;
    if (!review) return null;
    return {
        role: roleLabel(review.suggestion.role, vocabulary.value),
        kind: kindLabel(review.suggestion.kindId, vocabulary.value),
        confidence: confidencePercent(review.suggestion.confidence),
        evidence: review.suggestion.evidence
    };
});
const impact = computed(() =>
    preview.value ? meterImpactView(preview.value, vocabulary.value) : null
);
const selectedPointDevices = computed(() => {
    const ids = new Set(selectedMeter.value?.points.map((point) => point.deviceId));
    return [...ids].map((id) => deviceById(id));
});
const canUpdateSelected = computed(() => {
    if (!selectedMeter.value || selectedMeter.value.points.length === 0) return false;
    return selectedPointDevices.value.every(
        (device) =>
            device != null &&
            auth.canPerformComponent('devices', 'update', device.shellyID)
    );
});
const readOnlyReason = computed(() => {
    if (!selectedMeter.value) return '';
    if (selectedMeter.value.points.length === 0) {
        return 'This meter has no physical device scope, so it cannot be changed from this device-authorized view.';
    }
    if (selectedPointDevices.value.some((device) => device == null)) {
        return 'One or more meter devices could not be resolved. Refresh device evidence before changing meaning.';
    }
    return 'You need update permission for every device that contributes to this meter.';
});
const canPreview = computed(
    () =>
        canUpdateSelected.value &&
        form.sourceReference.trim() !== '' &&
        form.effectiveFrom !== '' &&
        !previewing.value
);

onMounted(() => void reload());

watch(selectedMeterId, (meterId) => {
    clearPreview();
    forgetLoadedHistory();
    const meter = selectedMeter.value;
    if (!meter || meterId == null) return;
    const suggested = reviewByMeter.value.get(meterId)?.suggestion;
    form.role = suggested?.role ?? meter.role;
    form.kindId = suggested?.kindId ?? meter.kindId ?? '';
    form.effectiveFrom = utcQuarterHour(new Date());
    form.sourceReference = '';
    void router.replace({
        query: {...route.query, meterId: String(meterId)}
    });
});

watch(
    () => [form.role, form.kindId, form.effectiveFrom, form.sourceReference],
    () => {
        if (preview.value) clearPreview();
    }
);

async function reload(): Promise<void> {
    loading.value = true;
    loadError.value = '';
    appliedMessage.value = '';
    try {
        const [foundMeters, queue, kindRows] = await Promise.all([
            listLogicalMeters(),
            listLogicalMeterMeaningReviewQueue({limit: 100}),
            listKinds('both'),
            deviceStore.fetchDevices()
        ]);
        meters.value = [...foundMeters].sort((left, right) =>
            left.name.localeCompare(right.name)
        );
        reviewItems.value = queue.items;
        nextReviewCursor.value = queue.nextCursor;
        kinds.value = kindRows;
        selectInitialMeter();
    } catch (error) {
        loadError.value = rpcErrorMessage(
            error,
            'Could not load meter topology and classification evidence'
        );
    } finally {
        loading.value = false;
    }
}

async function loadMoreReviews(): Promise<void> {
    if (!nextReviewCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    loadError.value = '';
    try {
        const page = await listLogicalMeterMeaningReviewQueue({
            limit: 100,
            cursor: nextReviewCursor.value
        });
        const byId = new Map(
            [...reviewItems.value, ...page.items].map((item) => [
                item.meterId,
                item
            ])
        );
        reviewItems.value = [...byId.values()];
        nextReviewCursor.value = page.nextCursor;
    } catch (error) {
        loadError.value = rpcErrorMessage(
            error,
            'Could not load the next meter review page'
        );
    } finally {
        loadingMore.value = false;
    }
}

function selectInitialMeter(): void {
    const requested = Number(route.query.meterId);
    const requestedExists = meters.value.some((meter) => meter.id === requested);
    if (requestedExists) {
        selectedMeterId.value = requested;
        filter.value = reviewByMeter.value.has(requested) ? 'review' : 'all';
        return;
    }
    const first = reviewItems.value[0]?.meterId ?? meters.value[0]?.id ?? null;
    selectedMeterId.value = first;
}

function selectMeter(meterId: number): void {
    selectedMeterId.value = meterId;
}

async function previewChange(): Promise<void> {
    if (!selectedMeter.value || !canPreview.value) return;
    formError.value = '';
    applyError.value = '';
    appliedMessage.value = '';
    const effectiveFrom = parseUtcDateTime(form.effectiveFrom);
    if (!effectiveFrom) {
        formError.value = 'Choose a valid UTC date and time.';
        return;
    }
    const expectedRevision = selectedRevision.value;
    previewing.value = true;
    try {
        preview.value = await previewLogicalMeterMeaningChange({
            meterId: selectedMeter.value.id,
            expectedRevision,
            effectiveFrom: effectiveFrom.toISOString(),
            role: form.role,
            kindId: form.kindId || null,
            sourceReference: form.sourceReference.trim()
        });
        previewExpectedRevision.value = expectedRevision;
        acknowledged.value = false;
    } catch (error) {
        formError.value = rpcErrorMessage(
            error,
            'Could not preview the classification change'
        );
    } finally {
        previewing.value = false;
    }
}

async function applyChange(): Promise<void> {
    if (
        !preview.value ||
        !selectedMeter.value ||
        !acknowledged.value ||
        previewExpectedRevision.value == null
    ) {
        return;
    }
    applying.value = true;
    applyError.value = '';
    try {
        const result = await applyLogicalMeterMeaningChange({
            previewId: preview.value.previewId,
            meterId: selectedMeter.value.id,
            expectedRevision: previewExpectedRevision.value
        });
        appliedMessage.value = `${selectedMeter.value.name} is revision ${result.revision} from ${formatDateTime(result.effectiveFrom)}.`;
        toast.success('Effective-dated meter classification applied');
        preview.value = null;
        previewExpectedRevision.value = null;
        acknowledged.value = false;
        await reload();
    } catch (error) {
        applyError.value = rpcErrorMessage(
            error,
            'Could not apply the persisted classification preview'
        );
    } finally {
        applying.value = false;
    }
}

// Opening the section again shows what was already read, without re-asking.
async function toggleHistory(): Promise<void> {
    historyOpen.value = !historyOpen.value;
    if (!historyOpen.value || history.value.length > 0) return;
    await readHistoryPage();
}

async function loadMoreHistory(): Promise<void> {
    if (nextHistoryBeforeRevision.value == null || historyLoading.value) return;
    await readHistoryPage(nextHistoryBeforeRevision.value);
}

async function readHistoryPage(beforeRevision?: number): Promise<void> {
    if (!selectedMeter.value) return;
    historyLoading.value = true;
    historyError.value = '';
    try {
        const result = await listLogicalMeterMeaningHistory({
            meterId: selectedMeter.value.id,
            limit: 100,
            ...(beforeRevision == null ? {} : {beforeRevision})
        });
        history.value = mergeRevisions(result.versions);
        nextHistoryBeforeRevision.value = result.nextBeforeRevision;
    } catch (error) {
        historyError.value = rpcErrorMessage(
            error,
            beforeRevision == null
                ? 'Could not load meaning history'
                : 'Could not load older meaning history'
        );
    } finally {
        historyLoading.value = false;
    }
}

function mergeRevisions(
    page: EnergyLogicalMeterMeaning[]
): EnergyLogicalMeterMeaning[] {
    const byRevision = new Map(
        [...history.value, ...page].map((version) => [version.revision, version])
    );
    return [...byRevision.values()].sort(
        (left, right) => right.revision - left.revision
    );
}

function forgetLoadedHistory(): void {
    historyOpen.value = false;
    history.value = [];
    nextHistoryBeforeRevision.value = null;
    historyError.value = '';
}

function clearPreview(): void {
    preview.value = null;
    previewExpectedRevision.value = null;
    acknowledged.value = false;
    applyError.value = '';
}

function deviceById(id: number): shelly_device_t | null {
    return (
        Object.values(deviceStore.devices).find((device) => device.id === id) ??
        null
    );
}

function deviceLabels(id: number): MeterDeviceLabels {
    const device = deviceById(id);
    return {
        name: String(device?.info?.name || device?.info?.model || `Device ${id}`),
        externalId: device?.shellyID ?? `ID ${id}`
    };
}
</script>
