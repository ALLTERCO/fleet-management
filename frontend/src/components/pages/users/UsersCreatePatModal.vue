<template>
    <Modal :visible="visible" wide @close="$emit('close')">
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
                    label="Key name"
                    optional
                    hint="A label so you can tell this key apart later."
                >
                    <Input v-model="nameModel" placeholder="e.g. CI runner" />
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
