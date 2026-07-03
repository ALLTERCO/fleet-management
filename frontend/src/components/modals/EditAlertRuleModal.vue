<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <ModalHeader
                :title="headerTitle"
                :description="headerDescription"
            />
        </template>

        <template #default>
            <form
                class="earm__form"
                autocomplete="off"
                @submit.prevent="handleSave"
            >
                <div v-if="kindsLoading" class="earm__skeleton">
                    <div v-for="n in 6" :key="n" class="earm__skeleton-tile" />
                </div>

                <template v-else>
                    <!-- Three simple steps: What → Where → Who -->
                    <Steps
                        class="earm__steps"
                        :steps="visibleStepIds.length"
                        :current="displayStep"
                        @click="goToDisplayStep"
                    >
                        <template #stepTitle="{id}">
                            <span
                                class="earm__step-title"
                                :class="{
                                    'earm__step-title--inactive':
                                        displayStep !== id
                                }"
                            >
                                <i
                                    :class="[
                                        'fas',
                                        STEP_META[visibleStepIds[id - 1] - 1].icon
                                    ]"
                                />
                                {{
                                    STEP_META[visibleStepIds[id - 1] - 1].label
                                }}
                            </span>
                        </template>
                    </Steps>

                    <!-- Duplicate banner — non-blocking, router-linked -->
                    <!-- Only warn on the final step, once scope is set. -->
                    <RouterLink
                        v-if="duplicate && step === 3"
                        :to="`/alerts/rules/${duplicate.id}`"
                        class="earm__dup-banner"
                        role="status"
                    >
                        <i class="fas fa-triangle-exclamation earm__dup-icon" />
                        <div class="earm__dup-body">
                            <div class="earm__dup-headline">
                                A rule like this already exists
                            </div>
                            <div class="earm__dup-name">
                                {{ duplicate.name }}
                            </div>
                        </div>
                        <span class="earm__dup-cta">
                            Open rule <i class="fas fa-arrow-right" />
                        </span>
                    </RouterLink>

                    <!-- Chosen alert — replaces the picker once we move on -->
                    <div v-if="formKind && step > 1" class="earm__chosen">
                        <span
                            class="earm__chosen-icon"
                            :class="`earm__chosen-icon--${severityVariant}`"
                        >
                            <i :class="kindIcon" aria-hidden="true" />
                        </span>
                        <div class="earm__chosen-text">
                            <span class="earm__chosen-name">{{ chosenName }}</span>
                            <span class="earm__chosen-kind">{{ kindLabel }}</span>
                        </div>
                        <AlertSeverityBadge
                            v-if="formSeverityModel"
                            :severity="formSeverityModel"
                        />
                        <button
                            v-if="canSwitchKind"
                            type="button"
                            class="earm__chosen-change"
                            @click="resetKind"
                        >
                            Change
                        </button>
                    </div>

                    <!-- Step 1: What — pick a ready-made alert (or custom) -->
                    <section v-show="step === 1" class="earm__step">
                        <!-- Show the picker unless a custom kind still needs its
                             condition set (then the form below shows instead). -->
                        <div v-if="showPicker" class="earm__picker">
                            <!-- Search + action stay put; only the cards swap. -->
                            <div class="earm__pickbar">
                                <div class="earm__search">
                                    <Input
                                        v-model="pickerQuery"
                                        type="search"
                                        :placeholder="showCustom ? 'Search alert types' : 'Search templates'"
                                    />
                                </div>
                                <Button
                                    v-if="!showCustom"
                                    type="green"
                                    size="sm"
                                    @click="enterCustom"
                                >
                                    Build your own
                                </Button>
                                <Button
                                    v-else
                                    type="blue-hollow"
                                    size="sm"
                                    @click="exitCustom"
                                >
                                    <i class="fas fa-arrow-left" /> Back to templates
                                </Button>
                            </div>

                            <BuiltinTemplateGallery
                                v-if="!showCustom"
                                :query="pickerQuery"
                                @pick="applyTemplate"
                            />
                            <AlertKindPicker
                                v-else
                                :query="pickerQuery"
                                @pick="selectKindByKey"
                            />
                        </div>

                        <!-- A chosen alert gets its condition and simple
                             one-target scope set here. -->
                        <div
                            v-else-if="currentKindDescriptor"
                            class="earm__tab"
                        >
                            <header class="earm__section-hdr">
                                <h3 class="earm__section-title">
                                    When it should fire
                                </h3>
                                <p class="earm__section-desc">
                                    {{ kindDescription }}
                                </p>
                            </header>

                            <!-- Friendly quick-picks fill the raw component/field. -->
                            <RulePresetChips
                                v-if="formKind"
                                :kind="formKind"
                                @pick="applyPreset"
                            />

                            <div
                                v-if="showComponentPathPicker"
                                class="earm__path-picker"
                            >
                                <header class="earm__path-head">
                                    <span class="earm__label">Component field</span>
                                    <span
                                        v-if="componentPathsLoading"
                                        class="earm__hint"
                                    >
                                        Loading…
                                    </span>
                                </header>
                                <div
                                    v-if="componentPathChoices.length"
                                    class="earm__path-grid"
                                >
                                    <button
                                        v-for="path in componentPathChoices"
                                        :key="`${path.kind}:${path.component}:${path.field}`"
                                        type="button"
                                        class="earm__path-choice"
                                        :class="{
                                            'earm__path-choice--active':
                                                isSelectedComponentPath(path)
                                        }"
                                        @click="applyComponentPath(path)"
                                    >
                                        <span class="earm__path-label">
                                            {{ path.label || path.component }}
                                        </span>
                                        <span class="earm__path-meta">
                                            {{ path.component }}.{{ path.field }}
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <!-- Friendly button picker for BLU remotes: writes
                                 the device_event predicate. Self-hides until a
                                 gateway with buttons is in scope. -->
                            <BluButtonPicker
                                v-if="formKind === 'device_event'"
                                v-model="formConfig"
                                :entities="scopedEntities"
                            />

                            <div
                                v-if="showFoldedScopePicker"
                                class="earm__tab"
                            >
                                <header class="earm__section-hdr">
                                    <div class="earm__section-title-row">
                                        <h3 class="earm__section-title">
                                            Watch one device or sensor
                                        </h3>
                                        <Button
                                            type="blue-hollow"
                                            size="sm"
                                            @click="chooseManyScope"
                                        >
                                            Groups or many
                                        </Button>
                                    </div>
                                    <p class="earm__section-desc">
                                        Pick one target here to go straight to
                                        Notify.
                                    </p>
                                </header>
                                <ScopeSelector
                                    v-model="formScope"
                                    :supported-scope-types="foldedScopeTypes"
                                    single
                                />
                            </div>

                            <!-- Raw schema form — power users / fine-tuning. -->
                            <details v-if="hasConfigSchema" class="earm__advanced">
                                <summary class="earm__advanced-summary">
                                    <i class="fas fa-sliders earm__advanced-icon" />
                                    <span>Set the exact condition</span>
                                    <i class="fas fa-chevron-down earm__advanced-caret" />
                                </summary>
                                <div class="earm__advanced-body">
                                    <SchemaForm
                                        v-model="formConfig"
                                        :schema="currentKindDescriptor.configSchema"
                                    />
                                </div>
                            </details>

                            <!-- Reads-as sentence + inline test build trust. -->
                            <RuleReadsAs :kind="formKind!" :config="formConfig" />
                            <RulePreviewTest
                                :kind="formKind!"
                                :severity="formSeverityModel || undefined"
                                :scope="formScope"
                                :config="formConfig"
                            />
                        </div>
                    </section>

                    <!-- Step 2: Where — the device cards -->
                    <section v-show="step === 2" class="earm__step">
                        <header class="earm__section-hdr">
                            <h3 class="earm__section-title">Where it applies</h3>
                            <p class="earm__section-desc">
                                Pick the devices, groups, locations, or tags. Leave
                                empty to watch everything.
                            </p>
                        </header>
                        <ScopeSelector
                            v-if="currentKindDescriptor"
                            v-model="formScope"
                            :supported-scope-types="currentKindDescriptor.supportedScopeTypes"
                        />
                    </section>

                    <!-- Step 3: Notify — name, recipients, and Advanced -->
                    <section v-show="step === 3" class="earm__step">
                        <!-- Enabled is primary, not buried in Advanced. -->
                        <div class="earm__enabled-row">
                            <Switch v-model="formEnabled" label="Enabled" />
                            <span class="earm__switch-label">
                                {{ formEnabled ? 'Enabled — this rule can fire' : 'Disabled — saved but won\'t fire' }}
                            </span>
                        </div>

                        <div class="earm__row2">
                            <div class="earm__field earm__field--grow">
                                <label class="earm__label" :for="nameInputId">
                                    Name
                                    <span class="earm__required" aria-hidden="true">*</span>
                                </label>
                                <Input
                                    :id="nameInputId"
                                    v-model="formName"
                                    placeholder="e.g. Battery low on winter stores"
                                    @blur="syncNameError"
                                />
                                <p v-if="nameError" class="earm__error" role="alert">
                                    <i class="fas fa-circle-exclamation" />
                                    {{ nameError }}
                                </p>
                            </div>
                            <div class="earm__field">
                                <label class="earm__label">Importance</label>
                                <SeverityFloorPicker v-model="formSeverityModel" />
                            </div>
                            <div v-if="templateSummaries.length" class="earm__field">
                                <label class="earm__label">Template</label>
                                <TemplatePicker
                                    v-model="formTemplateId"
                                    :templates="templateSummaries"
                                />
                            </div>
                        </div>

                        <div class="earm__tab">
                            <header class="earm__section-hdr">
                                <h3 class="earm__section-title">Who to notify</h3>
                            </header>
                            <ChannelPicker v-model="formDestinationChannelIds" />
                        </div>

                        <!-- Advanced — everything optional, collapsed by default -->
                        <details class="earm__advanced">
                            <summary class="earm__advanced-summary">
                                <i class="fas fa-sliders earm__advanced-icon" />
                                <span>Advanced options</span>
                                <i class="fas fa-chevron-down earm__advanced-caret" />
                            </summary>
                            <div class="earm__advanced-body">
                                <!-- Toggles and rate-limits share one compact row. -->
                                <div class="earm__settings-row">
                                    <div class="earm__switch-item">
                                        <Switch v-model="formAutoResolve" label="Auto-resolve" />
                                        <span class="earm__switch-label">Auto-resolve</span>
                                    </div>
                                    <div class="earm__inline-field">
                                        <span class="earm__label">Don't repeat within</span>
                                        <DurationField v-model="formDedupe" />
                                    </div>
                                    <div class="earm__inline-field">
                                        <span class="earm__label">Wait between</span>
                                        <DurationField v-model="formCooldown" />
                                    </div>
                                    <div
                                        v-if="formKind === 'component_state'"
                                        class="earm__inline-field"
                                    >
                                        <span class="earm__label">Fires after</span>
                                        <Input
                                            v-model="formForMinutes"
                                            type="number"
                                            :min="1"
                                            :max="1440"
                                            class="earm__digest-input"
                                        />
                                        <span class="earm__label">minutes</span>
                                    </div>
                                </div>

                                <!-- Groups are optional — channels above cover
                                     the common case. -->
                                <header class="earm__section-hdr earm__section-hdr--spaced">
                                    <h3 class="earm__section-title">Destination groups</h3>
                                    <p class="earm__section-desc">
                                        Optional. Notify a saved group of
                                        recipients as well as the channels above.
                                    </p>
                                </header>
                                <DestinationGroupPicker
                                    v-model="formDestinationGroupIds"
                                />

                                <header class="earm__section-hdr earm__section-hdr--spaced">
                                    <h3 class="earm__section-title">Delivery</h3>
                                </header>
                                <div class="earm__settings-row">
                                    <ViewToggle
                                        v-model="formDeliveryMode"
                                        :options="DELIVERY_OPTIONS"
                                    />
                                    <div
                                        v-if="formDeliveryMode === 'digest'"
                                        class="earm__inline-field"
                                    >
                                        <span class="earm__label">Batch every</span>
                                        <Input
                                            v-model="formDigestWindow"
                                            type="number"
                                            :min="1"
                                            class="earm__digest-input"
                                        />
                                        <span class="earm__label">minutes</span>
                                    </div>
                                </div>

                                <div class="earm__wording">
                                    <p
                                        v-if="formTemplateId != null"
                                        class="earm__section-desc"
                                    >
                                        Wording comes from the selected template.
                                        Clear it above to write your own.
                                    </p>

                                    <!-- Headline + message share a row + one preview. -->
                                    <template v-else>
                                        <div class="earm__grid">
                                            <div class="earm__field">
                                                <label class="earm__label">Headline</label>
                                                <TemplateEditor
                                                    v-model="formSummary"
                                                    placeholder="{subject.name} — {rule.name}"
                                                    :rows="3"
                                                    no-preview
                                                    :rule-kind="formKind ?? undefined"
                                                    :rule-name="formName"
                                                />
                                            </div>
                                            <div class="earm__field">
                                                <label class="earm__label">Message</label>
                                                <TemplateEditor
                                                    v-model="formMessage"
                                                    placeholder="Falls back to the built-in message"
                                                    :rows="3"
                                                    no-preview
                                                    :rule-kind="formKind ?? undefined"
                                                    :rule-name="formName"
                                                />
                                            </div>
                                        </div>

                                        <div
                                            v-if="chosenTemplateChannels.length > 1"
                                            class="earm__switch-item"
                                        >
                                            <Switch
                                                v-model="formRichMessage"
                                                label="Customize per channel"
                                            />
                                            <span class="earm__switch-label">
                                                Customize per channel
                                            </span>
                                        </div>

                                        <div
                                            v-if="formRichMessage"
                                            class="earm__field"
                                        >
                                            <label class="earm__label">Channel bodies</label>
                                            <MultiChannelTemplateEditor
                                                v-model="formRichBodies"
                                                v-model:channel="formRichChannel"
                                                :channels="chosenTemplateChannels"
                                            />
                                            <p
                                                v-if="richMessageError"
                                                class="earm__error"
                                                role="alert"
                                            >
                                                <i class="fas fa-circle-exclamation" />
                                                {{ richMessageError }}
                                            </p>
                                        </div>

                                        <RuleMessagePreview
                                            :channels="chosenChannels"
                                            :summary="formSummary"
                                            :message="formMessage"
                                            :rule-kind="formKind ?? undefined"
                                            :rule-name="formName"
                                        />
                                    </template>

                                    <div class="earm__field">
                                        <label class="earm__label" :for="runbookInputId">
                                            Runbook link
                                        </label>
                                        <Input
                                            :id="runbookInputId"
                                            v-model="formRunbookUrl"
                                            type="url"
                                            :maxlength="2000"
                                            placeholder="https://runbooks.example.com/…"
                                        />
                                        <p class="earm__hint">
                                            Optional link to your team's response steps.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </section>
                </template>
            </form>
        </template>

        <template #footer>
            <ModalFooter>
                <template v-if="justSaved" #meta>
                    <span class="earm__flash">
                        <i class="fas fa-circle-check" />
                        {{ props.mode === 'create' ? 'Rule created' : 'Changes saved' }}
                    </span>
                </template>
                <template #secondary>
                    <Button v-if="step > 1" type="blue-hollow" @click="goBack">
                        <i class="fas fa-arrow-left" /> Back
                    </Button>
                    <Button v-else type="blue-hollow" @click="close">Cancel</Button>
                </template>
                <template #primary>
                    <Button
                        v-if="step < 3"
                        type="blue"
                        :disabled="!canAdvance"
                        @click="goNext"
                    >
                        Next <i class="fas fa-arrow-right" />
                    </Button>
                    <Button
                        v-else
                        type="blue"
                        :loading="saving"
                        :disabled="!canSave"
                        :requires-write="true"
                        @click="handleSave"
                    >
                        <i v-if="justSaved" class="fas fa-circle-check" />
                        {{ primaryLabel }}
                    </Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import type {
    AlertComponentPath,
    AlertRule,
    AlertRuleKind,
    AlertRuleKindDescriptor,
    AlertScopeType,
    AlertSeverity,
    ScopeSelector as ScopeSelectorType
} from '@api/alert';
import {computed, onBeforeUnmount, ref, useId, watch} from 'vue';
import {RouterLink} from 'vue-router';
import AlertKindPicker from '@/components/core/AlertKindPicker.vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import BluButtonPicker from '@/components/core/BluButtonPicker.vue';
import BuiltinTemplateGallery from '@/components/core/BuiltinTemplateGallery.vue';
import Button from '@/components/core/Button.vue';
import DestinationGroupPicker from '@/components/core/DestinationGroupPicker.vue';
import DurationField from '@/components/core/DurationField.vue';
import ChannelPicker from '@/components/core/ChannelPicker.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import MultiChannelTemplateEditor, {
    type MultiChannelTemplate,
    type TemplateChannel
} from '@/components/core/MultiChannelTemplateEditor.vue';
import RuleMessagePreview from '@/components/core/RuleMessagePreview.vue';
import RulePresetChips from '@/components/core/RulePresetChips.vue';
import RulePreviewTest from '@/components/core/RulePreviewTest.vue';
import RuleReadsAs from '@/components/core/RuleReadsAs.vue';
import SchemaForm from '@/components/core/SchemaForm.vue';
import ScopeSelector from '@/components/core/ScopeSelector.vue';
import SeverityFloorPicker from '@/components/core/SeverityFloorPicker.vue';
import Steps from '@/components/core/Steps.vue';
import Switch from '@/components/core/Switch.vue';
import TemplateEditor from '@/components/core/TemplateEditor.vue';
import TemplatePicker from '@/components/core/TemplatePicker.vue';
import ViewToggle, {
    type ViewToggleOption
} from '@/components/core/ViewToggle.vue';
import {useOptimisticSave} from '@/composables/useOptimisticSave';
import {useRequiredNameField} from '@/composables/useRequiredNameField';
import {UI_CONFIG} from '@/config/ui';
import {bluSensorStateConfig} from '@/helpers/componentStateTargets';
import {channelsForChannels} from '@/helpers/endpointChannels';
import {describeRuleKind} from '@/helpers/ruleKinds';
import {
    type AlertRuleTemplate,
    type MessageTemplate,
    useAlertsStore
} from '@/stores/alerts';
import {useEntityStore} from '@/stores/entities';
import {useChannelsStore} from '@/stores/channels';
import Modal from './Modal.vue';

// Three plain steps. Index + 1 maps to the `step` ref.
const STEP_META = [
    {label: 'When', icon: 'fa-bolt'},
    {label: 'Applies to', icon: 'fa-location-dot'},
    {label: 'Notify', icon: 'fa-bell'}
] as const;

const DELIVERY_OPTIONS: ViewToggleOption<'instant' | 'digest'>[] = [
    {value: 'instant', label: 'Right away'},
    {value: 'digest', label: 'Batch'}
];

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: AlertRule | null;
}>();

const emit = defineEmits<{saved: [AlertRule]}>();

const store = useAlertsStore();
const channelsStore = useChannelsStore();
const entityStore = useEntityStore();

const nameInputId = useId();

const kindsLoading = ref(true);

const {saving, justSaved, runOptimisticSave} =
    useOptimisticSave<AlertRule>({
        onSuccess: (saved) => {
            emit('saved', saved);
            close();
        }
    });

const formKind = ref<AlertRuleKind | null>(null);
const formName = ref('');
const formEnabled = ref(true);
const formAutoResolve = ref(false);
const formSeverityModel = ref<AlertSeverity | ''>('info');
const formScope = ref<ScopeSelectorType>({});
const formDestinationChannelIds = ref<number[]>([]);
const formDestinationGroupIds = ref<number[]>([]);
const formDedupe = ref(0);
const formCooldown = ref(0);
const formDeliveryMode = ref<'instant' | 'digest'>('instant');
const formDigestWindow = ref('');
const formSummary = ref('');
const formMessage = ref('');
const formRichMessage = ref(false);
const formRichBodies = ref<MultiChannelTemplate>(emptyRichBodies());
const formRichChannel = ref<TemplateChannel>('fallback');
const formRunbookUrl = ref('');
const formTemplateId = ref<number | null>(null);
const formConfig = ref<Record<string, unknown>>({});
const formForMinutes = ref('');
const componentPaths = ref<AlertComponentPath[]>([]);
const componentPathsLoading = ref(false);

// bthomedevice entities on the scoped gateways — feeds the BLU button picker.
const scopedEntities = computed(() => {
    const ids = new Set(formScope.value.deviceIds ?? []);
    if (ids.size === 0) return [];
    return Object.values(entityStore.entities).filter((e) => ids.has(e.source));
});

// Channels the chosen channels notify — drives the channel-aware preview.
const chosenChannels = computed(() =>
    channelsForChannels(
        Object.values(channelsStore.channels),
        formDestinationChannelIds.value
    )
);

const chosenTemplateChannels = computed<TemplateChannel[]>(() => {
    const kinds = new Set<TemplateChannel>(['fallback']);
    for (const c of chosenChannels.value) {
        if (c.bodyKind !== 'fallback') kinds.add(c.bodyKind);
    }
    return (['email', 'slack', 'teams', 'fallback'] as TemplateChannel[]).filter(
        (k) => kinds.has(k)
    );
});

// Saved templates the rule can point at, summarised for the picker.
const templateSummaries = computed(() =>
    Object.values(store.templates).map((t) => ({
        id: t.id,
        name: t.name,
        channels: Object.keys(t.bodies)
    }))
);

// Digest window is stored and edited directly in minutes — no seconds
// round-trip, so a typed value can never be silently rounded.

const runbookInputId = useId();

const {
    error: nameError,
    isValid: isNameValid,
    sync: syncNameError,
    reset: resetNameError
} = useRequiredNameField(formName);

const duplicate = ref<{id: number; name: string} | null>(null);

function emptyRichBodies(): MultiChannelTemplate {
    return {
        email: {subject: '', html: ''},
        slack: {blocks: ''},
        teams: {card: ''},
        fallback: {text: ''}
    };
}

// Step 1 swaps between the template gallery and the custom-kind picker.
// One search box drives both, so the query lives here.
const showCustom = ref(false);
const pickerQuery = ref('');

function enterCustom() {
    showCustom.value = true;
    pickerQuery.value = '';
}

function exitCustom() {
    showCustom.value = false;
    pickerQuery.value = '';
}

// ── Step navigation ────────────────────────────────────────────────────
const step = ref(1);
const manyScopeMode = ref(false);

const visibleStepIds = computed<number[]>(() =>
    showAppliesToStep.value ? [1, 2, 3] : [1, 3]
);

const displayStep = computed(() => {
    const idx = visibleStepIds.value.indexOf(step.value);
    return idx >= 0 ? idx + 1 : 1;
});

const canAdvance = computed(() =>
    step.value === 1 ? !!formKind.value && canLeaveWhenStep.value : true
);

function isSingleScope(scope: ScopeSelectorType): boolean {
    const singleTargets =
        (scope.deviceIds?.length ?? 0) + (scope.componentIds?.length ?? 0);
    const multiTargets =
        (scope.groupIds?.length ?? 0) +
        (scope.locationIds?.length ?? 0) +
        (scope.tagIds?.length ?? 0);
    return singleTargets === 1 && multiTargets === 0;
}

function hasMultiScope(scope: ScopeSelectorType): boolean {
    const singleTargets =
        (scope.deviceIds?.length ?? 0) + (scope.componentIds?.length ?? 0);
    const multiTargets =
        (scope.groupIds?.length ?? 0) +
        (scope.locationIds?.length ?? 0) +
        (scope.tagIds?.length ?? 0);
    return singleTargets > 1 || multiTargets > 0;
}

const hasFoldedSingleScope = computed(() => isSingleScope(formScope.value));

const showAppliesToStep = computed(() => {
    if (!formKind.value) return true;
    if (manyScopeMode.value || hasMultiScope(formScope.value)) return true;
    return !showFoldedScopePicker.value;
});

const canLeaveWhenStep = computed(() => {
    if (showAppliesToStep.value) return true;
    if (!showFoldedScopePicker.value) return true;
    return hasFoldedSingleScope.value;
});

function goToStep(n: number) {
    if (!formKind.value && n > 1) return;
    if (!visibleStepIds.value.includes(n)) return;
    if (n > step.value && !canAdvance.value) return;
    step.value = n;
}

function goToDisplayStep(displayId: number) {
    const realStep = visibleStepIds.value[displayId - 1];
    if (realStep) goToStep(realStep);
}

function goNext() {
    if (step.value >= 3 || !canAdvance.value) return;
    step.value = step.value === 1 && !showAppliesToStep.value ? 3 : step.value + 1;
}

function goBack() {
    if (step.value <= 1) return;
    step.value = step.value === 3 && !showAppliesToStep.value ? 1 : step.value - 1;
}

function chooseManyScope() {
    manyScopeMode.value = true;
    step.value = 2;
}

let dupTimer: ReturnType<typeof setTimeout> | undefined;
watch(
    [
        formKind,
        formSeverityModel,
        formScope,
        formConfig,
        formDedupe,
        formCooldown
    ],
    () => {
        clearTimeout(dupTimer);
        if (!formKind.value || !formSeverityModel.value) {
            duplicate.value = null;
            return;
        }
        dupTimer = setTimeout(async () => {
            duplicate.value = await store.checkDuplicate({
                kind: formKind.value as AlertRuleKind,
                severity: formSeverityModel.value as AlertSeverity,
                scope: formScope.value,
                config: formConfig.value,
                dedupeWindowSec: formDedupe.value,
                cooldownSec: formCooldown.value,
                ...(props.mode === 'edit' && props.initial
                    ? {excludeId: props.initial.id}
                    : {})
            });
        }, UI_CONFIG.duplicateCheckDebounceMs);
    },
    {deep: true}
);

// WHY: if the component unmounts during the debounce window, the pending
// duplicate-check would hit the network pointlessly and set state on a
// dead component.
onBeforeUnmount(() => {
    clearTimeout(dupTimer);
});

// Picking a BLU sensor targets it through the backend's logical "component:<id>"
// path. Point the component_state condition at the chosen sensor so the rule
// actually fires on it.
watch(
    () => formScope.value.componentIds,
    (ids) => {
        if (formKind.value !== 'component_state') return;
        const bluId = (ids ?? []).find(
            (id) => entityStore.entities[id]?.type === 'bthomesensor'
        );
        if (!bluId) return;
        const open =
            typeof formConfig.value.equals === 'boolean'
                ? formConfig.value.equals
                : true;
        formConfig.value = bluSensorStateConfig(bluId, open);
    }
);

function applyTemplate(t: AlertRuleTemplate) {
    formKind.value = t.kind;
    formSeverityModel.value = t.severity;
    formScope.value = {...t.scope};
    manyScopeMode.value = hasMultiScope(t.scope);
    formConfig.value = {...t.config};
    formForMinutes.value =
        typeof t.config.forSec === 'number'
            ? String(Math.ceil(t.config.forSec / 60))
            : '';
    formDedupe.value = t.dedupeWindowSec;
    formCooldown.value = t.cooldownSec;
    formSummary.value = t.summaryTemplate ?? '';
    formMessage.value = t.messageTemplate ?? '';
    formRichMessage.value = false;
    formRichBodies.value = emptyRichBodies();
    formRunbookUrl.value = '';
    formAutoResolve.value = t.autoResolve;
    if (!formName.value.trim()) formName.value = t.label;
    step.value = isSingleScope(formScope.value) ? 3 : 1;
}

const currentKindDescriptor = computed<AlertRuleKindDescriptor | null>(() => {
    if (!formKind.value) return null;
    return store.kinds.find((k) => k.key === formKind.value) ?? null;
});

const kindLabel = computed(
    () => currentKindDescriptor.value?.label ?? formKind.value ?? ''
);

const hasConfigSchema = computed(() => {
    const schema = currentKindDescriptor.value?.configSchema as
        | {properties?: Record<string, unknown>}
        | undefined;
    return !!schema?.properties && Object.keys(schema.properties).length > 0;
});

const showPicker = computed(() => !formKind.value);

const canSwitchKind = computed(() => props.mode === 'create');

// The chosen alert, summarised once the picker is behind us.
const kindIcon = computed(() =>
    formKind.value ? describeRuleKind(formKind.value).icon : ''
);

const SEVERITY_VARIANT: Record<AlertSeverity, 'danger' | 'warning' | 'info'> = {
    info: 'info',
    warning: 'warning',
    critical: 'danger'
};
const severityVariant = computed(() =>
    formSeverityModel.value
        ? SEVERITY_VARIANT[formSeverityModel.value as AlertSeverity]
        : 'info'
);

const chosenName = computed(() => formName.value.trim() || kindLabel.value);

const headerTitle = computed(() => {
    if (props.mode === 'edit' && props.initial) {
        return `Edit "${props.initial.name}"`;
    }
    // The kind shows in the chip beside the title — don't repeat it here.
    return 'New alert';
});

const headerDescription = computed(() => {
    if (props.mode === 'edit') {
        return 'Update the alert and save.';
    }
    if (!formKind.value) {
        return 'Pick a template or build your own.';
    }
    return '';
});

// Plain-English description of the chosen kind, for the condition header.
const kindDescription = computed(() =>
    formKind.value ? describeRuleKind(formKind.value).description : ''
);

// Merge a quick-pick preset's config into the current condition.
function applyPreset(config: Record<string, unknown>) {
    formConfig.value = {...formConfig.value, ...config};
}

const showComponentPathPicker = computed(
    () =>
        formKind.value === 'component_threshold' ||
        formKind.value === 'component_state'
);

const foldedScopeTypes = computed<AlertScopeType[]>(() => {
    const supported = currentKindDescriptor.value?.supportedScopeTypes ?? [];
    return (['device', 'component'] as AlertScopeType[]).filter((type) =>
        supported.includes(type)
    );
});

const showFoldedScopePicker = computed(
    () => foldedScopeTypes.value.length > 0
);

const componentPathChoices = computed(() => {
    const wanted =
        formKind.value === 'component_threshold'
            ? 'metric'
            : formKind.value === 'component_state'
              ? 'state'
              : null;
    if (!wanted) return [];
    return componentPaths.value
        .filter((path) => path.kind === wanted)
        .slice(0, 32);
});

function isSelectedComponentPath(path: AlertComponentPath): boolean {
    return (
        formConfig.value.component === path.component &&
        formConfig.value.field === path.field
    );
}

function defaultEquals(path: AlertComponentPath): string | number | boolean {
    if (path.values?.includes(true)) return true;
    return path.values?.[0] ?? true;
}

function applyComponentPath(path: AlertComponentPath) {
    if (path.kind === 'metric') {
        formConfig.value = {
            ...formConfig.value,
            component: path.component,
            field: path.field,
            operator: formConfig.value.operator ?? 'gt',
            threshold: formConfig.value.threshold ?? 0
        };
        return;
    }
    formConfig.value = {
        ...formConfig.value,
        component: path.component,
        field: path.field,
        equals: defaultEquals(path)
    };
}

function selectKindByKey(key: AlertRuleKind) {
    formKind.value = key;
    manyScopeMode.value = false;
    // Auto-fill severity from the kind's backend default; the user can override.
    const auto = currentKindDescriptor.value?.defaultSeverity;
    if (auto) formSeverityModel.value = auto;
    // Stay on When if either the condition or the simple target lives there.
    step.value = hasConfigSchema.value || showFoldedScopePicker.value ? 1 : 2;
}

function resetKind() {
    if (!canSwitchKind.value) return;
    formKind.value = null;
    showCustom.value = false;
    manyScopeMode.value = false;
    formScope.value = {};
    formConfig.value = {};
    duplicate.value = null;
    step.value = 1;
}

function resetForm() {
    const t = props.initial;
    showCustom.value = false;
    formKind.value = t?.kind ?? null;
    manyScopeMode.value = t?.scope ? hasMultiScope(t.scope) : false;
    formName.value = t?.name ?? '';
    formEnabled.value = t?.enabled ?? true;
    formAutoResolve.value = t?.autoResolve ?? false;
    formSeverityModel.value = (t?.severity ?? 'info') as AlertSeverity;
    formScope.value = t?.scope ? {...t.scope} : {};
    formDestinationChannelIds.value = [...(t?.destinationChannelIds ?? [])];
    formDestinationGroupIds.value = [...(t?.destinationGroupIds ?? [])];
    formDedupe.value = t?.dedupeWindowSec ?? 0;
    formCooldown.value = t?.cooldownSec ?? 0;
    formDeliveryMode.value = t?.deliveryMode === 'digest' ? 'digest' : 'instant';
    formDigestWindow.value =
        t?.digestWindowMinutes != null ? String(t.digestWindowMinutes) : '';
    formSummary.value = t?.summaryTemplate ?? '';
    formMessage.value = t?.messageTemplate ?? '';
    formRichMessage.value = false;
    formRichBodies.value = emptyRichBodies();
    formRichChannel.value = 'fallback';
    formRunbookUrl.value = t?.runbookUrl ?? '';
    formTemplateId.value = t?.templateId ?? null;
    formConfig.value = t ? {...t.config} : {};
    formForMinutes.value =
        typeof t?.config.forSec === 'number'
            ? String(Math.ceil(t.config.forSec / 60))
            : '';
    resetNameError();
    step.value = 1;
}

watch(
    () => visible.value,
    async (open) => {
        if (!open) return;
        kindsLoading.value = true;
        try {
            await store.fetchKinds();
        } finally {
            kindsLoading.value = false;
        }
        void store.fetchTemplates();
        componentPathsLoading.value = true;
        try {
            componentPaths.value = await store.listComponentPaths();
        } finally {
            componentPathsLoading.value = false;
        }
        resetForm();
    },
    {immediate: true}
);

function normalizeSec(n: number): number | null {
    return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseForSec(): number | null | undefined {
    if (formKind.value !== 'component_state') return undefined;
    const raw = formForMinutes.value.trim();
    if (!raw) return undefined;
    const minutes = Number(raw);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null;
    return minutes * 60;
}

watch(formRichMessage, (enabled) => {
    if (!enabled) return;
    if (!formRichBodies.value.fallback.text.trim()) {
        formRichBodies.value = {
            ...formRichBodies.value,
            fallback: {text: formMessage.value.trim() || '{{alert.message}}'}
        };
    }
});

function buildRichBodies(): MessageTemplate['bodies'] {
    const b = formRichBodies.value;
    const allowed = new Set(chosenTemplateChannels.value);
    const bodies: MessageTemplate['bodies'] = {};
    if (allowed.has('email') && (b.email.subject.trim() || b.email.html.trim())) {
        bodies.email = {
            subject: b.email.subject,
            html: b.email.html,
            text: ''
        };
    }
    if (allowed.has('slack') && b.slack.blocks.trim()) {
        bodies.slack = {blocks: b.slack.blocks};
    }
    if (allowed.has('teams') && b.teams.card.trim()) {
        bodies.teams = {card: b.teams.card};
    }
    return bodies;
}

const richMessageError = computed(() => {
    if (!formRichMessage.value || formTemplateId.value != null) return '';
    if (!formRichBodies.value.fallback.text.trim()) {
        return 'Add text fallback for channels without a rich body.';
    }
    return '';
});

// Backend requires at least one recipient — a channel or a group.
const hasRecipient = computed(
    () =>
        formDestinationChannelIds.value.length > 0 ||
        formDestinationGroupIds.value.length > 0
);

const canSave = computed(
    () =>
        !saving.value &&
        !!formKind.value &&
        isNameValid.value &&
        hasRecipient.value &&
        parseForSec() !== null &&
        !richMessageError.value
);

const primaryLabel = computed(() => {
    if (justSaved.value) {
        return props.mode === 'create' ? 'Created' : 'Saved';
    }
    if (saving.value) {
        return props.mode === 'create' ? 'Creating…' : 'Saving…';
    }
    return props.mode === 'create' ? 'Create alert' : 'Save changes';
});

// ── Save ───────────────────────────────────────────────────────────────
function close() {
    visible.value = false;
}

async function handleSave() {
    syncNameError();
    if (saving.value) return;
    if (!formKind.value) return;
    if (!isNameValid.value) return;
    if (!parsedTimings.value) return;
    if (parseForSec() === null) return;
    if (!formSeverityModel.value) return;
    if (richMessageError.value) return;
    await runOptimisticSave(persistRule);
}

// Validated numeric timings — one pure answer, null when the input
// string isn't a clean non-negative integer.
const parsedTimings = computed<{
    dedupeWindowSec: number;
    cooldownSec: number;
} | null>(() => {
    const dedupeWindowSec = normalizeSec(formDedupe.value);
    const cooldownSec = normalizeSec(formCooldown.value);
    if (dedupeWindowSec == null || cooldownSec == null) return null;
    return {dedupeWindowSec, cooldownSec};
});

async function persistRule(): Promise<AlertRule | null> {
    const payload = await buildPayload();
    if (!payload) return Promise.resolve(null);
    if (props.mode === 'create') {
        return store.createRule({kind: formKind.value!, ...payload});
    }
    if (!props.initial) return Promise.resolve(null);
    return store.updateRule(props.initial.id, payload);
}

async function ensureRichTemplate(): Promise<number | null | undefined> {
    if (!formRichMessage.value) return formTemplateId.value ?? undefined;
    if (formTemplateId.value != null) return formTemplateId.value;
    const bodies = buildRichBodies();
    if (Object.keys(bodies).length === 0) return undefined;
    const fallbackText = formRichBodies.value.fallback.text.trim();
    if (!fallbackText) return null;
    const name = `${formName.value.trim() || 'Alert'} message`;
    const template = await store.createTemplate({
        name,
        description: 'Created from the alert rule builder.',
        bodies,
        fallbackText
    });
    return template?.id ?? null;
}

function buildConfigPayload(): Record<string, unknown> {
    const config = {...formConfig.value};
    const forSec = parseForSec();
    if (forSec === undefined) {
        delete config.forSec;
    } else if (forSec !== null) {
        config.forSec = forSec;
    }
    return config;
}

async function buildPayload() {
    if (!parsedTimings.value || !formSeverityModel.value) return null;
    const richTemplateId = await ensureRichTemplate();
    if (richTemplateId === null) return null;
    const fallbackOnlyMessage =
        formRichMessage.value && richTemplateId === undefined
            ? formRichBodies.value.fallback.text.trim()
            : formMessage.value.trim();
    const digestWindowParsed = formDigestWindow.value.trim()
        ? Number(formDigestWindow.value)
        : null;
    const digestWindowMinutes =
        formDeliveryMode.value === 'digest' &&
        digestWindowParsed != null &&
        Number.isInteger(digestWindowParsed) &&
        digestWindowParsed >= 1
            ? digestWindowParsed
            : null;
    return {
        name: formName.value.trim(),
        enabled: formEnabled.value,
        severity: formSeverityModel.value as AlertSeverity,
        scope: formScope.value,
        destinationChannelIds: formDestinationChannelIds.value,
        destinationGroupIds: formDestinationGroupIds.value,
        dedupeWindowSec: parsedTimings.value.dedupeWindowSec,
        cooldownSec: parsedTimings.value.cooldownSec,
        summaryTemplate: formSummary.value.trim() || null,
        messageTemplate: richTemplateId ? null : fallbackOnlyMessage || null,
        runbookUrl: formRunbookUrl.value.trim() || null,
        templateId: richTemplateId ?? formTemplateId.value,
        autoResolve: formAutoResolve.value,
        config: buildConfigPayload(),
        deliveryMode: formDeliveryMode.value,
        digestWindowMinutes
    };
}
</script>

<style scoped>
/* ─── Skeleton while kinds load ─────────────────────────────────────── */

.earm__form {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
    padding: 0;
    margin: 0;
    border: 0;
    min-width: 0;
}

.earm__skeleton {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
}

.earm__skeleton-tile {
    height: 5rem;
    border-radius: var(--radius-md);
    background: linear-gradient(
        90deg,
        var(--color-surface-1) 0%,
        var(--color-surface-3) 50%,
        var(--color-surface-1) 100%
    );
    background-size: 200% 100%;
    animation: earm-shimmer 1.4s ease-in-out infinite;
}

@keyframes earm-shimmer {
    0% {
        background-position: -200% 0;
    }
    100% {
        background-position: 200% 0;
    }
}

/* ─── Stepper ───────────────────────────────────────────────────────── */

.earm__steps {
    margin-bottom: var(--space-2);
}

.earm__step-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.earm__step-title--inactive {
    color: var(--color-text-tertiary);
}

.earm__step {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

/* ─── Duplicate banner ──────────────────────────────────────────────── */

.earm__dup-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--form-section-gap);
    padding: var(--space-3) var(--space-4);
    background: var(--color-warning-subtle);
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-md);
    color: var(--color-warning-text);
    text-decoration: none;
    transition:
        transform var(--motion-press),
        box-shadow var(--motion-state);
}

.earm__dup-banner:hover {
    box-shadow: var(--shadow-brand-ring);
}

.earm__dup-icon {
    font-size: var(--icon-size-md);
    flex-shrink: 0;
}

.earm__dup-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}

.earm__dup-headline {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.earm__dup-name {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.earm__dup-cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    flex-shrink: 0;
}

/* ─── Alert picker (step 1) ─────────────────────────────────────────── */

.earm__picker {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

/* Persistent search + action row above the cards. */
.earm__pickbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.earm__search {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 24rem;
}
/* keep the search input filling its (capped) wrapper */
.earm__pickbar .earm__search :deep(input) {
    width: 100%;
}
.earm__pickbar :deep(button) {
    white-space: nowrap;
}

/* Chosen-alert summary shown on the later steps — compact, not full width. */
.earm__chosen {
    align-self: flex-start;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.earm__chosen-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-md);
    font-size: var(--icon-size-md);
}

.earm__chosen-icon--danger {
    color: rgb(var(--color-danger-rgb));
    background: rgba(var(--color-danger-rgb), 0.12);
}

.earm__chosen-icon--warning {
    color: rgb(var(--color-warning-rgb));
    background: rgba(var(--color-warning-rgb), 0.12);
}

.earm__chosen-icon--info {
    color: rgb(var(--color-info-rgb));
    background: rgba(var(--color-info-rgb), 0.12);
}

.earm__chosen-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.earm__chosen-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.earm__chosen-kind {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.earm__chosen-change {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-primary-text);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.earm__chosen-change:hover {
    text-decoration: underline;
}

.earm__ready {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.earm__ready-icon {
    color: var(--color-success-text);
}

.earm__path-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.earm__path-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.earm__path-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--space-2);
}

.earm__path-choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    min-width: 0;
    min-height: 4rem;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
}

.earm__path-choice:hover,
.earm__path-choice--active {
    border-color: var(--color-primary);
    background: var(--color-surface-2);
}

.earm__path-label,
.earm__path-meta {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.earm__path-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.earm__path-meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

/* ─── Advanced disclosure ───────────────────────────────────────────── */

.earm__advanced {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}

.earm__advanced-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    list-style: none;
}

.earm__advanced-summary::-webkit-details-marker {
    display: none;
}

.earm__advanced-summary:hover {
    color: var(--color-text-primary);
    background-color: var(--color-surface-3);
}

.earm__advanced-icon {
    color: var(--color-text-tertiary);
}

.earm__advanced-caret {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: 0.8em;
    transition: transform var(--motion-state);
}

.earm__advanced[open] .earm__advanced-caret {
    transform: rotate(180deg);
}

.earm__advanced[open] .earm__advanced-summary {
    border-bottom: 1px solid var(--color-border-subtle);
}

.earm__advanced-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
}

/* ─── Toggles + rate-limits on one row ──────────────────────────────── */

.earm__settings-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
}

.earm__switch-item,
.earm__inline-field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* Enabled is a first-class control at the top of the Notify step. */
.earm__enabled-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.earm__digest-input {
    width: var(--space-16);
}

.earm__switch-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

/* ─── Wording block ─────────────────────────────────────────────────── */

.earm__wording {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-1);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
}
/* ─── Section headers + fields ──────────────────────────────────────── */

.earm__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.earm__section-hdr--spaced {
    margin-top: var(--space-1);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
}

.earm__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.earm__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 60ch;
}

.earm__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
}


.earm__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

/* One row: name leads, importance + template sit beside it as narrow fields. */
.earm__row2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-start;
}
.earm__row2 > .earm__field {
    flex: 0 1 220px; /* importance + template — narrow, they hold a short picker */
}
.earm__row2 > .earm__field--grow {
    flex: 1 1 260px; /* name takes the remaining width */
}

@media (max-width: 640px) {
    .earm__row2 > .earm__field,
    .earm__row2 > .earm__field--grow {
        flex-basis: 100%;
    }
}

.earm__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.earm__required {
    color: var(--color-danger-text);
    margin-left: var(--space-0-5);
}

.earm__error {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-danger-text);
    line-height: 1.4;
}

.earm__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}

.earm__flash {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-success-text);
    font-weight: var(--font-semibold);
    animation: earm-flash-in var(--duration-normal) var(--ease-out);
}

@keyframes earm-flash-in {
    from {
        opacity: 0;
        transform: translateY(-2px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (max-width: 640px) {
    .earm__skeleton {
        grid-template-columns: 1fr;
    }
}
</style>
