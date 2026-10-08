<template>
    <!-- persistent once the token is on screen: it is shown exactly once. -->
    <Modal
        :visible="visible"
        wide
        :persistent="!!result"
        @close="$emit('close')"
    >
        <template #title>{{ SERVICE_USER_TOKEN_MODEL.modalTitle }}</template>
        <template #default>
            <div class="usr-form">
                <template v-if="!result">
                <p class="svc-pat-hint">
                    Generate a token for <b>{{ targetIdentity }}</b>.
                    The token will only be shown once.
                    {{ SERVICE_USER_CREDENTIAL_MODE.patNote }}
                </p>
                <div class="svc-token-model">
                    <strong>{{ activeMode.title }}</strong>
                    <span>{{ activeMode.description }}</span>
                </div>
                <FormField
                    v-if="!scopedModel"
                    label="Key name"
                    hint="A label so you can tell this key apart later."
                >
                    <Input
                        v-model="nameModel"
                        required
                        placeholder="e.g. CI runner"
                    />
                </FormField>
                <FormField label="Expiration (days)">
                    <Input
                        v-model="expirationModel"
                        type="number"
                        placeholder="365"
                    />
                </FormField>
                <Checkbox
                    v-model="scopedModel"
                    :label="SERVICE_USER_TOKEN_MODEL.scopedToggleTitle"
                    :hint="SERVICE_USER_TOKEN_MODEL.scopedToggleHint"
                />
                <template v-if="scopedModel">
                    <FormField label="Purpose (audit label)">
                        <Input
                            v-model="purposeModel"
                            placeholder="e.g. CI scraper for Grafana"
                        />
                    </FormField>
                    <FormField
                        label="MCP access (AI agent)"
                        hint="What an MCP agent may do with this key. None = not for MCP."
                    >
                        <select
                            v-model="mcpLevelModel"
                            class="usr-select"
                            aria-label="MCP access level"
                        >
                            <option value="">None</option>
                            <option value="read">Read — look only</option>
                            <option value="write">
                                Write — read + normal changes
                            </option>
                            <option value="full">Full — everything</option>
                        </select>
                    </FormField>
                    <Checkbox
                        v-model="scopeAllModel"
                        label="Scope: inherit all (boundary = no narrowing)"
                    />
                    <template v-if="!scopeAllModel">
                        <BoundaryScopePicker v-model="scopePickedModel" />
                        <p class="svc-pat-hint svc-pat-preview">
                            Boundary covers
                            <b>{{ scopePickedModel.device_ids?.length ?? 0 }}</b> devices ·
                            <b>{{ scopePickedModel.location_ids?.length ?? 0 }}</b> locations ·
                            <b>{{ scopePickedModel.device_group_ids?.length ?? 0 }}</b> groups ·
                            <b>{{ scopePickedModel.device_tags?.length ?? 0 }}</b> tags ·
                            <b>{{ scopePickedModel.dashboard_ids?.length ?? 0 }}</b> dashboards ·
                            <b>{{ scopePickedModel.plugin_keys?.length ?? 0 }}</b> plugins
                        </p>
                    </template>
                    <div
                        v-if="preview"
                        class="svc-pat-preview-result"
                        :class="
                            preview.usable
                                ? 'svc-pat-preview-result--ok'
                                : 'svc-pat-preview-result--warn'
                        "
                    >
                        <strong>
                            {{ preview.usable ? 'Preview: usable' : 'Preview: no effective access' }}
                        </strong>
                        <span>
                            {{ preview.effectiveStatementCount }} effective rule{{ preview.effectiveStatementCount === 1 ? '' : 's' }}
                            <template v-if="preview.noAccessReason">
                                · {{ preview.noAccessReason }}
                            </template>
                        </span>
                    </div>
                </template>
                </template>
                <div v-if="result" class="svc-pat-result">
                    <SecretReveal
                        :token="result.token"
                        copy-label="Copy Token"
                        @copy="$emit('copy')"
                    />
                    <div class="svc-pat-result__meta">
                        <span v-if="result.name">{{ result.name }} · </span>
                        ID: {{ result.tokenId }}
                        <span v-if="result.expirationDate">
                            · Expires: {{ new Date(result.expirationDate).toLocaleDateString() }}
                        </span>
                    </div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="usr-form__footer">
                <Button v-if="!result" type="blue-hollow" @click="$emit('close')">
                    Cancel
                </Button>
                <Button
                    v-if="!result"
                    type="green"
                    :loading="creating"
                    @click="$emit('submit')"
                >
                    Generate
                </Button>
                <Button v-else type="blue-hollow" @click="$emit('done')">
                    Done
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import BoundaryScopePicker from '@/components/core/BoundaryScopePicker.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import SecretReveal from '@/components/core/SecretReveal.vue';
import Modal from '@/components/modals/Modal.vue';
import type {PickedScopedPatBoundary} from '@/helpers/scopedPatCreate';
import {
    SERVICE_USER_CREDENTIAL_MODE,
    SERVICE_USER_TOKEN_MODEL
} from '@/helpers/serviceUserCredentialMode';

export interface PatModeDescriptor {
    title: string;
    description: string;
}

export interface ScopedPatPreview {
    usable: boolean;
    effectiveStatementCount: number;
    noAccessReason: string | null;
}

export interface CreatedPat {
    tokenId: string;
    token: string;
    expirationDate?: string;
    name?: string;
    keyHint?: string;
}

defineProps<{
    visible: boolean;
    creating: boolean;
    targetIdentity: string;
    activeMode: PatModeDescriptor;
    preview: ScopedPatPreview | null;
    result: CreatedPat | null;
}>();

const nameModel = defineModel<string>('name', {default: ''});
const expirationModel = defineModel<string>('expiration', {required: true});
const scopedModel = defineModel<boolean>('scoped', {required: true});
const scopeAllModel = defineModel<boolean>('scopeAll', {required: true});
const purposeModel = defineModel<string>('purpose', {required: true});
const mcpLevelModel = defineModel<string>('mcpLevel', {default: ''});
const scopePickedModel = defineModel<PickedScopedPatBoundary>('scopePicked', {
    required: true
});

defineEmits<{
    close: [];
    submit: [];
    copy: [];
    done: [];
}>();
</script>

<style scoped>
/* Scoped here, not in the parent page: a parent's scoped styles never reach a
   child component's inner elements. */
.usr-form {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.usr-select {
    width: 100%;
    padding: var(--gap-xs) var(--gap-sm);
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    transition: border-color var(--motion-state);
}
/* A 1px border-colour change is not a focus indicator on its own. */
.usr-select:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.svc-pat-hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.svc-token-model {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
}
.svc-token-model strong {
    color: var(--color-text-primary);
}
.svc-token-model span {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.svc-pat-preview-result {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    padding: var(--gap-xs);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
}
.svc-pat-preview-result--ok {
    border-color: var(--color-success-text);
    color: var(--color-success-text);
}
.svc-pat-preview-result--warn {
    border-color: var(--color-warning-text);
    color: var(--color-warning-text);
}
.svc-pat-result {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    margin-top: var(--gap-sm);
}
.svc-pat-result__meta {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    font-family: var(--font-mono);
}
</style>
