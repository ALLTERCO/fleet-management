<template>
    <!-- Candidates load on first focus, not on mount: a template step can hold
         a dozen roles and each one is its own listSources call. -->
    <div class="scp" @focusin="ensureLoaded">
        <PickRow
            v-if="selected"
            :interactive="false"
            selected
            dense
            flat
            :data-source="`${selected.deviceExternalId}|${selected.componentKey}`"
        >
            {{ deviceNameById(selected.deviceExternalId) }}
            <template #meta>
                <span class="mono-id">{{ selected.componentKey }}</span>
            </template>
            <template #trail>
                <button
                    type="button"
                    class="icon-ghost-btn scp__clear"
                    aria-label="Clear binding"
                    @click="onClear"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
            </template>
        </PickRow>

        <FilterPill
            v-else
            v-model="query"
            placeholder="Search devices or components"
            @update:model-value="onInput"
        />

        <WizardState v-if="loading" tone="loading">
            Loading candidates…
        </WizardState>
        <WizardState v-else-if="error" tone="error">{{ error }}</WizardState>

        <!-- Nothing matched the role. Offer the wider list as a choice rather
             than swapping it in silently. -->
        <WizardState v-else-if="!selected && noRoleMatch && !showUnmatched" tone="empty">
            No component on your devices matches this part.
            <template #action>
                <Button type="blue-hollow" size="sm" @click="showUnmatched = true">
                    Show all anyway
                </Button>
            </template>
        </WizardState>

        <ul v-else-if="!selected && candidates.length" class="stack-list">
            <li
                v-for="row in candidateViews"
                :key="`${row.candidate.deviceExternalId}|${row.candidate.componentKey}`"
            >
                <PickRow
                    dense
                    flat
                    :data-candidate="`${row.candidate.deviceExternalId}|${row.candidate.componentKey}`"
                    @click="onPick(row.candidate)"
                >
                    <template #lead>
                        <i
                            v-if="row.logo.kind === 'icon'"
                            :class="row.logo.faClass"
                            :style="deviceGlyphStyle(row.logo)"
                            :aria-label="row.name"
                        />
                        <img v-else :src="row.logo.src" :alt="row.name" loading="lazy" />
                    </template>
                    {{ row.name }}
                    <template #meta>
                        <span class="mono-id">
                            {{ row.candidate.componentKey }} ·
                            {{ row.candidate.componentType }}
                        </span>
                    </template>
                    <template v-if="showUnmatched || row.candidate.writable" #trail>
                        <span v-if="showUnmatched" class="meta-pill meta-pill--warning">
                            Unusual for this part
                        </span>
                        <span v-else class="meta-pill meta-pill--info">Writable</span>
                    </template>
                </PickRow>
            </li>
        </ul>

        <Button
            v-if="!selected && hasMore"
            type="blue-hollow"
            size="sm"
            :loading="loadingMore"
            @click="loadMore"
        >
            Load more components
        </Button>

        <WizardState
            v-else-if="!selected && !candidates.length && query"
            tone="empty"
        >
            No matches.
        </WizardState>
    </div>
</template>

<script setup lang="ts">
import {
    type SourceComponentCandidate,
    type SourceComponentRef,
    virtualDevices
} from '@host/virtualDevices';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FilterPill from '@/components/core/FilterPill.vue';
import PickRow from '@/components/core/wizard/PickRow.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import {useDeviceIdentity} from '@/composables/useDeviceIdentity';
import {type DeviceLogo, deviceGlyphStyle} from '@/helpers/deviceLogo';
import {actionableError} from '@/helpers/rpcError';

const props = defineProps<{
    roleKey: string;
    /** Lets the server read what the role expects and narrow the candidates. */
    profileId?: string;
    selected: SourceComponentRef | null;
}>();

const emit = defineEmits<{
    select: [SourceComponentRef];
    clear: [];
}>();

const {deviceLogoById, deviceNameById} = useDeviceIdentity();

const query = ref('');
const candidates = ref<SourceComponentCandidate[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
// The server filters every candidate and then slices, so `total` is the whole
// fleet's answer and `fetched` is how much of it has been pulled down.
const total = ref(0);
const fetched = ref(0);
const loadingMore = ref(false);
const hasMore = computed(() => fetched.value < total.value);
// True when the role filter rejected everything the backend returned.
const noRoleMatch = ref(false);
// Set only by the user, never by the component, so a wrong bind is a choice.
const showUnmatched = ref(false);
let loaded = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

interface CandidateView {
    candidate: SourceComponentCandidate;
    logo: DeviceLogo;
    name: string;
}

// Identity via the shared grid pipeline, not the raw backend fields.
const candidateViews = computed<CandidateView[]>(() =>
    candidates.value.map((candidate) => ({
        candidate,
        logo: deviceLogoById(candidate.deviceExternalId),
        name: deviceNameById(candidate.deviceExternalId, candidate.deviceName)
    }))
);

const PAGE_SIZE = 50;

async function load(q?: string, append = false): Promise<void> {
    if (append) loadingMore.value = true;
    else loading.value = true;
    error.value = null;
    try {
        const res = await virtualDevices.bindings.listSources({
            roleKey: props.roleKey,
            // Asking without the role is how "show all anyway" widens the net.
            profileId: showUnmatched.value ? undefined : props.profileId,
            query: q?.trim() || undefined,
            limit: PAGE_SIZE,
            offset: append ? fetched.value : 0
        });
        const next = res.items;
        candidates.value = append ? [...candidates.value, ...next] : next;
        total.value = res.total ?? res.items.length;
        fetched.value = append
            ? fetched.value + res.items.length
            : res.items.length;
        // Falling back to the unfiltered list on its own let a "Temperature"
        // role offer a relay, with no signal that the filter had given up.
        // Only a fleet fully seen can honestly say nothing matches.
        noRoleMatch.value = candidates.value.length === 0 && !hasMore.value;
        loaded = true;
    } catch (err) {
        error.value = actionableError(
            err,
            'Could not load components to connect. Retry in a moment.'
        );
        if (!append) candidates.value = [];
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

function loadMore(): void {
    void load(query.value, true);
}

function ensureLoaded(): void {
    if (!loaded && !loading.value) load();
}

function onInput(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => load(query.value), 250);
}

function onPick(candidate: SourceComponentCandidate): void {
    const source: SourceComponentRef = {
        deviceExternalId: candidate.deviceExternalId,
        componentKey: candidate.componentKey
    };
    if (candidate.dynamicCategory) {
        source.dynamicCategory = candidate.dynamicCategory;
    }
    emit('select', source);
}

function onClear(): void {
    query.value = '';
    emit('clear');
}

// Re-read with the wider net once the user asks for it.
watch(showUnmatched, (show) => {
    if (show) void load(query.value);
});

watch(
    () => props.selected,
    (val) => {
        if (val === null) {
            loaded = false;
            candidates.value = [];
            total.value = 0;
            fetched.value = 0;
            noRoleMatch.value = false;
            showUnmatched.value = false;
        }
    }
);
</script>

<style scoped>
.scp {
    display: grid;
    gap: var(--gap-xs);
}


/* Clearing a binding is a removal, so it reddens rather than brightens. */
.scp__clear:hover {
    color: var(--color-danger-text);
}

/* Bounded so a 50-candidate answer scrolls inside the role instead of
   pushing every other role off the step. */


/* After .scp__pill: same specificity, so source order decides. */
</style>
