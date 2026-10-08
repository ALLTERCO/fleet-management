<template>
    <Modal :visible="visible" xlarge tall @close="close">
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
                    <!-- Three steps: Condition, Where, Who and when -->
                    <Steps
                        class="earm__steps"
                        :steps="visibleStepIds.length"
                        :current="displayStep"
                        :max-reachable="visibleStepIds.length + 1"
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

                    <!-- Duplicate banner, non-blocking. Shown once a kind is
                         chosen; the kind list has nothing to collide with. -->
                    <RouterLink
                        v-if="duplicate && formKind"
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
                    <div v-if="formKind" class="earm__chosen">
                        <span
                            class="earm__chosen-icon"
                            :class="`earm__chosen-icon--${severityVariant}`"
                        >
                            <i :class="kindIcon" aria-hidden="true" />
                        </span>
                        <div class="earm__chosen-text">
                            <span class="earm__chosen-name">{{ chosenName }}</span>
                            <!-- The auto-filled name is written from the kind,
                                 so the two read as the same words twice. Show
                                 the kind only once the name diverges. -->
                            <span
                                v-if="!nameEchoesKind"
                                class="earm__chosen-kind"
                            >{{ kindLabel }}</span>
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

                    <!-- Step 1: Condition. Pick the kind, then set its condition. -->
                    <section v-show="step === 1" class="earm__step">
                        <div v-if="showPicker" class="earm__picker">
                            <div class="earm__search">
                                <Input
                                    v-model="pickerQuery"
                                    type="search"
                                    placeholder="Search rule types"
                                />
                            </div>
                            <AlertKindPicker
                                :query="pickerQuery"
                                @pick="selectKindByKey"
                            />
                        </div>
                        <div v-else-if="currentKindDescriptor" class="earm__tab">
                            <!-- Friendly quick-picks fill the raw component/field. -->
                            <RulePresetChips
                                v-if="formKind"
                                :kind="formKind"
                                :condition="formConfig"
                                :available-components="availableComponentFamilies"
                                @pick="applyPreset"
                            />

                            <!-- Raw signal list. A quick-pick above already
                                 fills the condition, so this stays folded once
                                 something is chosen. -->
                            <details
                                v-if="showComponentPathPicker"
                                class="earm__path-picker"
                                :open="!chosenComponentPath"
                            >
                                <summary class="earm__path-head">
                                    <span class="earm__label">
                                        Pick the exact signal
                                    </span>
                                    <span
                                        v-if="componentPathsLoading"
                                        class="earm__hint"
                                    >
                                        Loading…
                                    </span>
                                    <span
                                        v-else-if="chosenComponentPath"
                                        class="earm__hint"
                                    >
                                        {{ chosenComponentPath }}
                                    </span>
                                    <span v-else class="earm__hint">
                                        from {{ componentPathSourceText }}
                                    </span>
                                    <i
                                        class="fas fa-chevron-down earm__path-caret"
                                        aria-hidden="true"
                                    />
                                </summary>
                                <input
                                    v-if="componentPathMatchCount || pathSearch"
                                    v-model="pathSearch"
                                    type="search"
                                    class="earm__path-search"
                                    placeholder="Search signals"
                                    aria-label="Search signals"
                                />
                                <div
                                    v-if="componentPathGroups.length"
                                    class="earm__path-groups"
                                >
                                    <div
                                        v-for="group in componentPathGroups"
                                        :key="group.key"
                                        class="earm__path-group"
                                    >
                                        <p
                                            v-if="group.label"
                                            class="earm__path-group-name"
                                        >
                                            {{ group.label }}
                                        </p>
                                        <div class="earm__path-grid">
                                            <button
                                                v-for="path in group.paths"
                                                :key="`${group.key}:${path.kind}:${path.component}:${path.field}`"
                                                type="button"
                                                class="earm__path-choice"
                                                :class="{
                                                    'earm__path-choice--active':
                                                        isSelectedComponentPath(path)
                                                }"
                                                :title="`${path.component}.${path.field}`"
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
                                </div>
                                <p v-else class="earm__hint">
                                    {{ componentPathEmptyText }}
                                </p>
                                <p v-if="hiddenPathCount" class="earm__hint">
                                    {{ hiddenPathCount }} more — narrow the search
                                    to see them.
                                </p>
                            </details>

                            <!-- Friendly button picker for BLU remotes: writes
                                 the device_event predicate. Self-hides until a
                                 gateway with buttons is in scope. -->
                            <BluButtonPicker
                                v-if="formKind === 'device_event'"
                                v-model="formConfig"
                                :entities="scopedEntities"
                            />

                            <SchemaForm
                                v-if="hasConfigSchema && !foldCondition"
                                v-model="formConfig"
                                :schema="currentKindDescriptor.configSchema"
                            />
                            <details v-else-if="hasConfigSchema" class="earm__advanced">
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
                        </div>

                    </section>
                    <!-- Step 2: Where it applies -->
                    <section v-show="step === 2" class="earm__step earm__step--setup">
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
                            :kind="formKind ?? undefined"
                            :kind-config="formConfig"
                        />
                    </section>

                    <!-- Step 3: Who and when. Name, recipients, hours, delivery. -->
                    <section v-show="step === 3" class="earm__step earm__step--setup">
                        <!-- Enabled is primary, not buried in Advanced. The
                             switch already reads "Enabled"; a sentence beside it
                             restating that spent three lines saying nothing. -->
                        <div class="earm__enabled-row">
                            <Switch v-model="formEnabled" label="Enabled" />
                            <span v-if="!formEnabled" class="earm__switch-label">
                                Saved, but won't fire
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
                                    @input="nameTouched = true"
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
                        </div>

                        <div class="earm__tab">
                            <header class="earm__section-hdr">
                                <h3 class="earm__section-title">Who to notify</h3>
                            </header>
                            <ChannelPicker v-model="formDestinationChannelIds" />
                        </div>

                        <!-- The whole rule in one line. It belongs here, where
                             scope and recipients are actually known; on step 1
                             it could only repeat the chosen alert above it. -->
                        <RuleReadsAs
                            v-if="formKind"
                            :kind="formKind"
                            :config="formConfig"
                            :scope-label="scopeSummary || undefined"
                            :channel-label="channelSummary || undefined"
                        />

                        <!-- Advanced — everything optional, collapsed by default -->
                        <details class="earm__advanced">
                            <summary class="earm__advanced-summary">
                                <i class="fas fa-sliders earm__advanced-icon" />
                                <span>Advanced options</span>
                                <i class="fas fa-chevron-down earm__advanced-caret" />
                            </summary>
                            <div class="earm__advanced-body">
                                <div v-if="templateSummaries.length" class="earm__field">
                                    <label class="earm__label">Template</label>
                                    <TemplatePicker
                                        v-model="formTemplateId"
                                        :templates="templateSummaries"
                                    />
                                </div>

                                <!-- Toggles and rate-limits share one compact row. -->
                                <div class="earm__settings-row">
                                    <div class="earm__switch-item">
                                        <Switch v-model="formAutoResolve" label="Auto-resolve" />
                                        <span class="earm__switch-label">Auto-resolve</span>
                                    </div>
                                    <div class="earm__switch-item">
                                        <Switch
                                            v-model="formTriggerOnce"
                                            label="Only tell me once"
                                        />
                                        <span class="earm__switch-label">
                                            Only tell me once
                                        </span>
                                    </div>
                                    <div class="earm__inline-field">
                                        <span class="earm__label">Don't repeat within</span>
                                        <DurationField v-model="formDedupe" />
                                    </div>
                                    <div class="earm__inline-field">
                                        <span class="earm__label">Wait between</span>
                                        <DurationField v-model="formCooldown" />
                                    </div>
                                </div>

                                <!-- Quiet outside these hours. Off by default,
                                     so existing rules are unchanged. -->
                                <header class="earm__section-hdr earm__section-hdr--spaced">
                                    <h3 class="earm__section-title">Active hours</h3>
                                    <p class="earm__section-desc">
                                        Optional. Outside these hours the rule
                                        stays quiet. It still clears alerts it
                                        already raised.
                                    </p>
                                </header>
                                <div class="earm__settings-row">
                                    <div class="earm__switch-item">
                                        <Switch
                                            v-model="formActiveWindowOn"
                                            label="Only at set times"
                                        />
                                        <span class="earm__switch-label">
                                            Only at set times
                                        </span>
                                    </div>
                                    <div
                                        v-if="formActiveWindowOn"
                                        class="earm__inline-field"
                                    >
                                        <span class="earm__label">From</span>
                                        <Input
                                            v-model="formActiveWindowStart"
                                            type="time"
                                            class="earm__time-input"
                                        />
                                        <span class="earm__label">to</span>
                                        <Input
                                            v-model="formActiveWindowEnd"
                                            type="time"
                                            class="earm__time-input"
                                        />
                                    </div>
                                </div>
                                <div v-if="formActiveWindowOn" class="earm__days">
                                    <button
                                        v-for="day in DAY_OPTIONS"
                                        :key="day.bit"
                                        type="button"
                                        class="earm__day"
                                        :class="{
                                            'earm__day--on': dayIsOn(day.bit)
                                        }"
                                        :aria-pressed="dayIsOn(day.bit)"
                                        @click="toggleDay(day.bit)"
                                    >
                                        {{ day.label }}
                                    </button>
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
                <template #meta>
                    <span v-if="justSaved" class="earm__flash">
                        <i class="fas fa-circle-check" />
                        {{ props.mode === 'create' ? 'Alert created' : 'Changes saved' }}
                    </span>
                    <RulePreviewTest
                        v-else-if="formKind && !showPicker"
                        :kind="formKind"
                        :severity="formSeverityModel || undefined"
                        :scope="formScope"
                        :config="formConfig"
                    />
                </template>
                <template #secondary>
                    <!-- Back keeps every answer; only Change on the chip
                         clears the kind. -->
                    <Button
                        v-if="step > 1"
                        type="blue-hollow"
                        @click="goToStep(step - 1)"
                    >
                        <i class="fas fa-arrow-left" /> Back
                    </Button>
                    <Button v-else type="blue-hollow" @click="close">Cancel</Button>
                </template>
                <template #primary>
                    <Button
                        v-if="props.mode === 'create' && step < 3"
                        type="blue"
                        :disabled="!canAdvance"
                        @click="goToStep(step + 1)"
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
    AlertRule,
    AlertRuleKind,
    AlertRuleKindDescriptor,
    AlertSeverity
} from '@api/alert';
import {computed, ref, useId, watch} from 'vue';
import {RouterLink} from 'vue-router';
import AlertKindPicker from '@/components/core/AlertKindPicker.vue';
import AlertSeverityBadge from '@/components/core/AlertSeverityBadge.vue';
import BluButtonPicker from '@/components/core/BluButtonPicker.vue';
import Button from '@/components/core/Button.vue';
import ChannelPicker from '@/components/core/ChannelPicker.vue';
import DestinationGroupPicker from '@/components/core/DestinationGroupPicker.vue';
import DurationField from '@/components/core/DurationField.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import MultiChannelTemplateEditor from '@/components/core/MultiChannelTemplateEditor.vue';
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
import {useAlertRuleDuplicateCheck} from '@/composables/useAlertRuleDuplicateCheck';
import {useAlertRuleForm} from '@/composables/useAlertRuleForm';
import {useComponentPathPicker} from '@/composables/useComponentPathPicker';
import {useOptimisticSave} from '@/composables/useOptimisticSave';
import {useRequiredNameField} from '@/composables/useRequiredNameField';
import {useRichMessageTemplates} from '@/composables/useRichMessageTemplates';
import {
    buildAlertRulePayload,
    parseTimings
} from '@/helpers/alertRulePayload';
import {
    describeChannels,
    describeScopeBreakdown
} from '@/helpers/alertRuleSummary';
import {bluSensorStateConfig} from '@/helpers/componentStateTargets';
import {channelsForChannels} from '@/helpers/endpointChannels';
import {describeRuleKind} from '@/helpers/ruleKinds';
import {describeRuleConfig} from '@/helpers/ruleSentence';
import {useAlertsStore} from '@/stores/alerts';
import {useChannelsStore} from '@/stores/channels';
import {useEntityStore} from '@/stores/entities';
import Modal from './Modal.vue';

// Two steps. A template answers the trigger, condition, severity and name, so
// only two decisions are left — which devices, and who to tell. Three steps for
// two decisions is what left the first screen with nothing to show.
const STEP_META = [
    {label: 'Condition', icon: 'fa-sliders'},
    {label: 'Where', icon: 'fa-location-dot'},
    {label: 'Who and when', icon: 'fa-bell'}
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

// The rule being edited. Its own module — loading a stored rule into the form
// is where the defaults and the copying live.
const {
    kind: formKind,
    name: formName,
    enabled: formEnabled,
    autoResolve: formAutoResolve,
    triggerOnce: formTriggerOnce,
    severity: formSeverityModel,
    scope: formScope,
    config: formConfig,
    destinationChannelIds: formDestinationChannelIds,
    destinationGroupIds: formDestinationGroupIds,
    dedupeWindowSec: formDedupe,
    cooldownSec: formCooldown,
    deliveryMode: formDeliveryMode,
    digestWindow: formDigestWindow,
    activeWindowOn: formActiveWindowOn,
    activeWindowStart: formActiveWindowStart,
    activeWindowEnd: formActiveWindowEnd,
    activeWindowDays: formActiveWindowDays,
    summaryTemplate: formSummary,
    messageTemplate: formMessage,
    runbookUrl: formRunbookUrl,
    templateId: formTemplateId,
    reset: resetRuleFields
} = useAlertRuleForm();

const nameInputId = useId();

const kindsLoading = ref(true);

const {saving, justSaved, runOptimisticSave} =
    useOptimisticSave<AlertRule>({
        onSuccess: (saved) => {
            emit('saved', saved);
            close();
        }
    });

// Auto-name from the condition and scope, the way the reads-as sentence
// describes it. Stops as soon as the user types their own, and never
// overwrites a saved rule's name.
const nameTouched = ref(false);

const suggestedName = computed(() => {
    if (!formKind.value) return '';
    const trigger = describeRuleConfig(formKind.value, formConfig.value);
    const where = scopeSummary.value;
    const label = trigger.charAt(0).toUpperCase() + trigger.slice(1);
    // No scope chosen yet — an empty summary left a dangling "on".
    return where ? `${label} on ${where}` : label;
});

watch(suggestedName, (next) => {
    if (nameTouched.value || props.mode === 'edit') return;
    formName.value = next;
});

// Fires, notifies, then switches itself off. The two rate-limits beside it are
// windows and always reopen; this is the one that does not.
// The sentence names what was actually chosen. Falling back to "these devices"
// and "your channels" told the reader nothing they had not just typed.
const scopeSummary = computed(() => describeScopeBreakdown(formScope.value));

const channelSummary = computed(() =>
    describeChannels({
        names: formDestinationChannelIds.value
            .map((id) => channelsStore.channels[id]?.name)
            .filter(Boolean) as string[],
        groupCount: formDestinationGroupIds.value.length
    })
);


// bit0=Mon, matching the backend daysMask and the tariff windows.
const DAY_OPTIONS = [
    {bit: 0, label: 'Mon'},
    {bit: 1, label: 'Tue'},
    {bit: 2, label: 'Wed'},
    {bit: 3, label: 'Thu'},
    {bit: 4, label: 'Fri'},
    {bit: 5, label: 'Sat'},
    {bit: 6, label: 'Sun'}
] as const;


const dayIsOn = (bit: number) => ((formActiveWindowDays.value >> bit) & 1) === 1;
function toggleDay(bit: number) {
    formActiveWindowDays.value ^= 1 << bit;
}

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

const {
    richMessage: formRichMessage,
    richBodies: formRichBodies,
    richChannel: formRichChannel,
    editableChannels: chosenTemplateChannels,
    templateSummaries,
    richMessageError,
    reset: resetRichMessage,
    ensureTemplateId: ensureRichTemplate
} = useRichMessageTemplates({
    chosenChannels: chosenChannels,
    plainMessage: () => formMessage.value,
    templateId: () => formTemplateId.value,
    ruleName: () => formName.value
});

// Digest window is stored and edited directly in minutes — no seconds
// round-trip, so a typed value can never be silently rounded.

const runbookInputId = useId();

const {
    error: nameError,
    isValid: isNameValid,
    sync: syncNameError,
    reset: resetNameError
} = useRequiredNameField(formName);


// Step 1 swaps between the template gallery and the custom-kind picker.
// One search box drives both, so the query lives here.
const pickerQuery = ref('');
// ── Step navigation ────────────────────────────────────────────────────
const step = ref(1);

// Condition, Where, Who and when. Every kind walks the same three.
const visibleStepIds = computed<number[]>(() => [1, 2, 3]);

const displayStep = computed(() => {
    const idx = visibleStepIds.value.indexOf(step.value);
    return idx >= 0 ? idx + 1 : 1;
});

const canAdvance = computed(() =>
    step.value === 1 ? !!formKind.value : true
);





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




const {duplicate, clear: clearDuplicate} = useAlertRuleDuplicateCheck({
    draft: () => ({
        kind: formKind.value,
        severity: formSeverityModel.value,
        scope: formScope.value,
        config: formConfig.value,
        dedupeWindowSec: formDedupe.value,
        cooldownSec: formCooldown.value
    }),
    excludeId: () =>
        props.mode === 'edit' && props.initial ? props.initial.id : null
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

const currentKindDescriptor = computed<AlertRuleKindDescriptor | null>(() => {
    if (!formKind.value) return null;
    return store.kinds.find((k) => k.key === formKind.value) ?? null;
});

const kindLabel = computed(
    () => currentKindDescriptor.value?.label ?? formKind.value ?? ''
);

// "Motion is detected" over "Motion Detected" is one fact twice.
const nameEchoesKind = computed(() => {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');
    return norm(chosenName.value) === norm(kindLabel.value);
});

const conditionFieldCount = computed(() => {
    const schema = currentKindDescriptor.value?.configSchema as
        | {properties?: Record<string, unknown>}
        | undefined;
    return Object.keys(schema?.properties ?? {}).length;
});

const hasConfigSchema = computed(() => conditionFieldCount.value > 0);

// Past this the condition is a form and earns a fold; below it, folding hides
// one or two inputs behind a box that costs more space than the inputs do.
const FOLD_CONDITION_ABOVE = 2;
const foldCondition = computed(
    () => conditionFieldCount.value > FOLD_CONDITION_ABOVE
);

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
        return 'Pick what to watch, then where and who to tell.';
    }
    return '';
});

// Plain-English description of the chosen kind, for the condition header.
// Merge a quick-pick preset's config into the current condition.
function applyPreset(config: Record<string, unknown>) {
    formConfig.value = {...formConfig.value, ...config};
}

// The signal catalog: what the scoped devices report, filtered to the shape
// this alert kind watches. Its own module — it is a device-component browser,
// not an alert concern.
const {
    applies: showComponentPathPicker,
    loading: componentPathsLoading,
    search: pathSearch,
    groups: componentPathGroups,
    matchCount: componentPathMatchCount,
    hiddenCount: hiddenPathCount,
    families: availableComponentFamilies,
    emptyText: componentPathEmptyText,
    sourceText: componentPathSourceText,
    chosenLabel: chosenComponentPath,
    isChosen: isSelectedComponentPath,
    choose: applyComponentPath,
    reload: reloadComponentPaths
} = useComponentPathPicker({
    deviceIds: () => formScope.value.deviceIds ?? [],
    ruleKind: formKind,
    condition: formConfig,
    active: visible
});

function selectKindByKey(key: AlertRuleKind) {
    formKind.value = key;
    // Auto-fill severity from the kind's backend default; the user can override.
    const auto = currentKindDescriptor.value?.defaultSeverity;
    if (auto) formSeverityModel.value = auto;
}

function resetKind() {
    if (!canSwitchKind.value) return;
    formKind.value = null;
    formScope.value = {};
    formConfig.value = {};
    clearDuplicate();
    step.value = 1;
}

function resetForm() {
    resetRuleFields(props.initial);
    resetRichMessage();
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
        await reloadComponentPaths();
        resetForm();
    },
    {immediate: true}
);

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
    if (!formSeverityModel.value) return;
    if (richMessageError.value) return;
    await runOptimisticSave(persistRule);
}

// Validated numeric timings — one pure answer, null when the input
// string isn't a clean non-negative integer.
const parsedTimings = computed(() =>
    parseTimings(formDedupe.value, formCooldown.value)
);

async function persistRule(): Promise<AlertRule | null> {
    const payload = await buildPayload();
    if (!payload) return Promise.resolve(null);
    if (props.mode === 'create') {
        return store.createRule({kind: formKind.value!, ...payload});
    }
    if (!props.initial) return Promise.resolve(null);
    return store.updateRule(props.initial.id, payload);
}

async function buildPayload() {
    // Ordered so an unusable draft cannot create a stored template on its way
    // to being refused.
    if (!parsedTimings.value || !formSeverityModel.value) return null;
    const richTemplateId = await ensureRichTemplate();
    if (richTemplateId === null) return null;
    const usesFallbackBody =
        formRichMessage.value && richTemplateId === undefined;
    return buildAlertRulePayload({
        name: formName.value,
        enabled: formEnabled.value,
        severity: formSeverityModel.value,
        scope: formScope.value,
        destinationChannelIds: formDestinationChannelIds.value,
        destinationGroupIds: formDestinationGroupIds.value,
        dedupeWindowSec: formDedupe.value,
        cooldownSec: formCooldown.value,
        summaryTemplate: formSummary.value,
        messageTemplate: usesFallbackBody
            ? formRichBodies.value.fallback.text
            : formMessage.value,
        runbookUrl: formRunbookUrl.value,
        templateId: richTemplateId ?? formTemplateId.value,
        autoResolve: formAutoResolve.value,
        triggerOnce: formTriggerOnce.value,
        config: formConfig.value,
        deliveryMode: formDeliveryMode.value,
        digestWindowRaw: formDigestWindow.value,
        activeWindow: formActiveWindowOn.value
            ? {
                  startTime: formActiveWindowStart.value,
                  endTime: formActiveWindowEnd.value,
                  daysMask: formActiveWindowDays.value
              }
            : null
    });
}
</script>

<style scoped>
/* ─── Active-hours day picker ───────────────────────────────────────── */

.earm__days {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.earm__day {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    transition: background var(--motion-hover), color var(--motion-hover);
}

.earm__day:hover {
    background: var(--color-surface-3);
}

.earm__day--on {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-on-primary);
}

.earm__time-input {
    width: 7rem;
}

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

.earm__search {
    max-width: 24rem;
}
.earm__search :deep(input) {
    width: 100%;
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
    cursor: pointer;
    list-style: none;
}

.earm__path-head::-webkit-details-marker {
    display: none;
}

.earm__path-caret {
    margin-left: auto;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast) var(--ease-out-expo);
}

.earm__path-picker[open] > .earm__path-head .earm__path-caret {
    transform: rotate(180deg);
}

.earm__path-search {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.earm__path-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: 18rem;
    overflow-y: auto;
}

.earm__path-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.earm__path-group-name {
    margin: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
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
