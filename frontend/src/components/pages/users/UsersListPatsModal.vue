<template>
    <!-- persistent while a rotated token is on screen: it is shown once. -->
    <Modal
        :visible="visible"
        wide
        :persistent="rotated.length > 0"
        @close="$emit('close')"
    >
        <template #title>Tokens — {{ targetIdentity }}</template>
        <template #default>
            <div v-if="unplacedRotated.length > 0" class="svc-pat-new-list">
                <UsersRotatedPatCard
                    v-for="r in unplacedRotated"
                    :key="r.tokenId"
                    :token="r.token"
                    :replaced-token-id="r.replacedTokenId"
                    :name="rotatedName(r)"
                    labelled
                />
            </div>
            <div v-if="loading" class="usr-form">
                <Skeleton variant="row" />
                <Skeleton variant="row" />
            </div>
            <p v-else-if="loadError" class="svc-pat-hint svc-pat-hint--error">
                {{ loadError }}
            </p>
            <div v-else class="svc-pat-sections">
                <div class="svc-pat-list">
                    <h4 class="svc-pat-section-title">
                        {{ SERVICE_USER_TOKEN_MODEL.zitadelListTitle }}
                    </h4>
                    <p class="svc-pat-hint">
                        {{ SERVICE_USER_TOKEN_MODEL.zitadelDescription }}
                    </p>
                    <p v-if="zitadelPats.length === 0" class="svc-pat-hint">
                        No Zitadel tokens found.
                    </p>
                    <div
                        v-if="canManage && zitadelPats.length > 0"
                        class="svc-pat-toolbar"
                    >
                        <Button
                            type="blue-hollow"
                            size="xs"
                            :disabled="busy || zitadelPats.length === 0"
                            @click="$emit('bulk-rotate')"
                        >
                            Rotate all
                        </Button>
                    </div>
                    <div
                        v-for="pat in zitadelPats"
                        :key="pat.id"
                        class="svc-pat-item svc-pat-item--stacked"
                    >
                        <div class="svc-pat-item__row">
                            <div class="svc-pat-item__info">
                                <span class="svc-pat-item__id">
                                    {{ pat.name || 'Unnamed token' }}
                                </span>
                                <code
                                    v-if="pat.keyHint"
                                    class="svc-pat-item__key"
                                >
                                    {{ pat.keyHint }}
                                </code>
                                <span
                                    v-if="pat.expirationDate"
                                    class="svc-pat-item__exp"
                                >
                                    Expires: {{ new Date(pat.expirationDate).toLocaleDateString() }}
                                </span>
                            </div>
                            <div v-if="canManage" class="svc-pat-item__actions">
                                <Button
                                    type="blue-hollow"
                                    size="xs"
                                    :disabled="busy"
                                    @click="$emit('rotate', pat.id)"
                                >
                                    Rotate
                                </Button>
                                <Button
                                    type="red"
                                    size="xs"
                                    :disabled="busy"
                                    @click="$emit('revoke-zitadel', pat.id)"
                                >
                                    Revoke
                                </Button>
                            </div>
                        </div>
                        <UsersRotatedPatCard
                            v-for="r in rotatedFor(pat)"
                            :key="r.tokenId"
                            :token="r.token"
                            :replaced-token-id="r.replacedTokenId"
                        />
                    </div>
                </div>
                <div class="svc-pat-list svc-pat-list--scoped">
                    <h4 class="svc-pat-section-title">
                        {{ SERVICE_USER_TOKEN_MODEL.scopedListTitle }}
                    </h4>
                    <p class="svc-pat-hint">
                        {{ SERVICE_USER_TOKEN_MODEL.scopedDescription }}
                    </p>
                    <p v-if="scopedPats.length === 0" class="svc-pat-hint">
                        No FM scoped tokens found.
                    </p>
                    <div
                        v-for="pat in scopedPats"
                        :key="pat.tokenId"
                        class="svc-pat-item"
                    >
                        <div class="svc-pat-item__info">
                            <span class="svc-pat-item__id">
                                {{ pat.tokenId.slice(0, 8) }}…
                            </span>
                            <span
                                v-if="pat.purpose"
                                class="svc-pat-item__purpose"
                            >
                                {{ pat.purpose }}
                            </span>
                            <span
                                v-if="pat.expiresAt"
                                class="svc-pat-item__exp"
                            >
                                Expires: {{ new Date(pat.expiresAt).toLocaleDateString() }}
                            </span>
                            <span
                                v-if="pat.lastUsedAt"
                                class="svc-pat-item__last"
                            >
                                Last used: {{ formatRelative(new Date(pat.lastUsedAt).getTime()) }}
                            </span>
                            <span v-else class="svc-pat-item__last">
                                Never used
                            </span>
                            <span class="svc-pat-item__scope">
                                Scope: {{ formatBoundaryScope(pat.boundaryScope) }}
                            </span>
                        </div>
                        <div v-if="canManage" class="svc-pat-item__actions">
                            <Button
                                type="red"
                                size="xs"
                                :disabled="busy"
                                @click="$emit('revoke-scoped', pat.tokenId)"
                            >
                                Revoke
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template v-if="rotated.length > 0" #footer>
            <div class="usr-form__footer">
                <Button type="blue-hollow" @click="$emit('close')">Done</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Modal from '@/components/modals/Modal.vue';
import UsersRotatedPatCard from '@/components/pages/users/UsersRotatedPatCard.vue';
import {formatRelative} from '@/helpers/format';
import {formatBoundaryScope} from '@/helpers/patScopeFormat';
import {SERVICE_USER_TOKEN_MODEL} from '@/helpers/serviceUserCredentialMode';
import {computed} from 'vue';

export interface ZitadelPatRow {
    id: string;
    expirationDate?: string;
    name?: string;
    keyHint?: string;
}

export interface ScopedPatRow {
    tokenId: string;
    purpose?: string;
    boundaryScope?: Record<string, unknown>;
    expiresAt?: string;
    lastUsedAt?: string | null;
}

export interface RotatedPat {
    tokenId: string;
    token: string;
    replacedTokenId: string;
}

const props = defineProps<{
    visible: boolean;
    loading: boolean;
    busy: boolean;
    canManage: boolean;
    targetIdentity: string;
    zitadelPats: ZitadelPatRow[];
    scopedPats: ScopedPatRow[];
    rotated: RotatedPat[];
    loadError?: string;
}>();

const listedIds = computed(
    () => new Set(props.zitadelPats.map((pat) => pat.id))
);

// A new key sits under its own list entry; under the replaced entry only
// while the new one is not listed yet (grace period or list not reloaded).
function rotatedFor(pat: ZitadelPatRow): RotatedPat[] {
    return props.rotated.filter(
        (r) =>
            r.tokenId === pat.id ||
            (r.replacedTokenId === pat.id && !listedIds.value.has(r.tokenId))
    );
}

// Keys with no list entry to sit under stay visible, also while the list
// loads or failed to load: they are shown only once.
const unplacedRotated = computed(() =>
    props.loading || props.loadError
        ? props.rotated
        : props.rotated.filter(
              (r) =>
                  !listedIds.value.has(r.tokenId) &&
                  !listedIds.value.has(r.replacedTokenId)
          )
);

function rotatedName(r: RotatedPat): string | undefined {
    return props.zitadelPats.find(
        (pat) => pat.id === r.tokenId || pat.id === r.replacedTokenId
    )?.name;
}

defineEmits<{
    close: [];
    'bulk-rotate': [];
    rotate: [id: string];
    'revoke-zitadel': [id: string];
    'revoke-scoped': [tokenId: string];
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
.svc-pat-hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.svc-pat-hint--error {
    color: var(--color-danger-text);
}
.svc-pat-sections {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.svc-pat-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-2);
}
.svc-pat-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.svc-pat-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
}
.svc-pat-item--stacked {
    flex-direction: column;
    align-items: stretch;
}
.svc-pat-item__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}
.svc-pat-new-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    margin-bottom: var(--gap-sm);
}
.svc-pat-item__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}
.svc-pat-item__id {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.svc-pat-item__exp {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
.svc-pat-item__actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-2);
}

@media (max-width: 640px) {
    .svc-pat-item,
    .svc-pat-item__row {
        align-items: flex-start;
        flex-direction: column;
    }
    .svc-pat-item--stacked {
        align-items: stretch;
    }
}
</style>
