<template>
    <Modal :visible="visible" wide @close="$emit('close')">
        <template #title>Tokens — {{ targetIdentity }}</template>
        <template #default>
            <div v-if="loading" class="usr-form">
                <Skeleton variant="row" />
                <Skeleton variant="row" />
            </div>
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
                        class="svc-pat-item"
                    >
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
                </div>
                <div v-if="rotated.length > 0" class="svc-pat-rotated">
                    <p class="svc-pat-hint">
                        New tokens generated. Copy them now - they will not be
                        shown again.
                    </p>
                    <ul class="svc-pat-rotated__list">
                        <li
                            v-for="r in rotated"
                            :key="r.tokenId"
                            class="svc-pat-rotated__row"
                        >
                            <span class="svc-pat-rotated__replaced">
                                replaces {{ r.replacedTokenId }}
                            </span>
                            <code class="svc-pat-rotated__token">{{ r.token }}</code>
                        </li>
                    </ul>
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
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Modal from '@/components/modals/Modal.vue';
import {formatRelative} from '@/helpers/format';
import {formatBoundaryScope} from '@/helpers/patScopeFormat';
import {SERVICE_USER_TOKEN_MODEL} from '@/helpers/serviceUserCredentialMode';

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

defineProps<{
    visible: boolean;
    loading: boolean;
    busy: boolean;
    canManage: boolean;
    targetIdentity: string;
    zitadelPats: ZitadelPatRow[];
    scopedPats: ScopedPatRow[];
    rotated: RotatedPat[];
}>();

defineEmits<{
    close: [];
    'bulk-rotate': [];
    rotate: [id: string];
    'revoke-zitadel': [id: string];
    'revoke-scoped': [tokenId: string];
}>();
</script>
