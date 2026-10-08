<template>
    <div class="vpp">
        <p class="vpp__lede">
            Each part is a component on one of your real devices. Swapping one
            keeps this device and its history; only the source changes.
        </p>

        <PickRowSkeleton v-if="loading" :rows="2" label="Loading parts" />

        <WizardState v-else-if="loadError" tone="error">
            {{ loadError }}
            <template #action>
                <Button type="blue-hollow" size="sm" @click="load">Retry</Button>
            </template>
        </WizardState>

        <WizardState v-else-if="!roles.length" tone="empty">
            This device has no parts to change.
        </WizardState>

        <ul v-else class="stack-list">
            <li v-for="role in roles" :key="role.roleKey">
                <PickRow :interactive="false" :data-role="role.roleKey">
                    <template #lead>
                        <i class="fas fa-plug" aria-hidden="true" />
                    </template>
                    {{ role.label }}
                    <template #meta>
                        <span v-if="role.source">
                            {{ role.source.deviceName }} ·
                            <span class="mono-id">
                                {{ role.source.componentKey }}
                            </span>
                        </span>
                        <span v-else class="vpp__unbound">
                            Not connected{{ role.required ? ' · required' : '' }}
                        </span>
                    </template>
                    <template #trail>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :disabled="busyRole !== null"
                            @click="beginReplace(role)"
                        >
                            Replace
                        </Button>
                        <Button
                            v-if="role.source"
                            type="red"
                            size="sm"
                            :loading="busyRole === role.roleKey && !replacing"
                            :disabled="busyRole !== null"
                            @click="remove(role)"
                        >
                            Remove
                        </Button>
                    </template>
                </PickRow>

                <div v-if="replacingRole?.roleKey === role.roleKey" class="vpp__picker">
                    <SourceComponentPicker
                        :role-key="role.roleKey"
                        :profile-id="profileId ?? undefined"
                        :selected="null"
                        @select="onPick"
                        @clear="cancelReplace"
                    />
                    <Button type="blue-hollow" size="sm" @click="cancelReplace">
                        Cancel
                    </Button>
                </div>

                <WizardState
                    v-if="notices[role.roleKey]"
                    :tone="notices[role.roleKey].tone"
                    class="vpp__notice"
                >
                    {{ notices[role.roleKey].text }}
                </WizardState>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import type {SourceComponentRef} from '@host/virtualDevices';
import {virtualDevices} from '@host/virtualDevices';
import {ref} from 'vue';
import Button from '@/components/core/Button.vue';
import PickRow from '@/components/core/wizard/PickRow.vue';
import PickRowSkeleton from '@/components/core/wizard/PickRowSkeleton.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import SourceComponentPicker from '@/components/devices/add/SourceComponentPicker.vue';
import {actionableError} from '@/helpers/rpcError';

interface RoleRow {
    id: string;
    roleKey: string;
    label: string;
    required: boolean;
    source: {
        deviceExternalId: string;
        deviceName: string;
        componentKey: string;
    } | null;
}

interface Notice {
    tone: 'error' | 'info';
    text: string;
}

const props = defineProps<{externalId: string}>();

const roles = ref<RoleRow[]>([]);
const profileId = ref<string | null>(null);
// Every write carries the revision this panel read, so a panel left open in
// another tab cannot silently overwrite a newer change.
const revision = ref(0);
const loading = ref(false);
const loadError = ref('');
const busyRole = ref<string | null>(null);
const replacing = ref(false);
const replacingRole = ref<RoleRow | null>(null);
const notices = ref<Record<string, Notice>>({});

async function load(): Promise<void> {
    loading.value = true;
    loadError.value = '';
    try {
        const device = await virtualDevices.get({externalId: props.externalId});
        revision.value = device.revision;
        profileId.value = device.profileId ?? null;
        const page = await virtualDevices.bindings.list({
            externalId: props.externalId
        });
        roles.value = (page.items ?? []) as unknown as RoleRow[];
    } catch (err) {
        loadError.value = actionableError(
            err,
            'Could not read this device’s parts. Retry in a moment.'
        );
        roles.value = [];
    } finally {
        loading.value = false;
    }
}

function beginReplace(role: RoleRow): void {
    replacingRole.value = role;
    clearNotice(role.roleKey);
}

function cancelReplace(): void {
    replacingRole.value = null;
}

async function onPick(source: SourceComponentRef): Promise<void> {
    const role = replacingRole.value;
    if (!role) return;
    busyRole.value = role.roleKey;
    replacing.value = true;
    clearNotice(role.roleKey);
    try {
        await virtualDevices.bindings.replace({
            externalId: props.externalId,
            roleKey: role.roleKey,
            source,
            expectedRevision: revision.value,
            // One key per attempt, so a transport-level retry of this exact
            // request cannot apply the swap twice.
            idempotencyKey: crypto.randomUUID()
        });
        replacingRole.value = null;
        await load();
    } catch (err) {
        setNotice(
            role.roleKey,
            'error',
            actionableError(
                err,
                'Could not swap this part. Reload the page and try again.'
            )
        );
    } finally {
        busyRole.value = null;
        replacing.value = false;
    }
}

async function remove(role: RoleRow): Promise<void> {
    busyRole.value = role.roleKey;
    clearNotice(role.roleKey);
    try {
        await virtualDevices.bindings.retire({
            externalId: props.externalId,
            bindingId: role.id,
            expectedRevision: revision.value
        });
        if (role.required) {
            setNotice(
                role.roleKey,
                'info',
                `${role.label} is required, so this device reads as degraded until something is connected.`
            );
        }
        await load();
    } catch (err) {
        setNotice(
            role.roleKey,
            'error',
            actionableError(
                err,
                'Could not remove this part. Reload the page and try again.'
            )
        );
    } finally {
        busyRole.value = null;
    }
}

function setNotice(roleKey: string, tone: Notice['tone'], text: string): void {
    notices.value = {...notices.value, [roleKey]: {tone, text}};
}

function clearNotice(roleKey: string): void {
    if (!notices.value[roleKey]) return;
    const {[roleKey]: _drop, ...rest} = notices.value;
    notices.value = rest;
}

defineExpose({onPick});

void load();
</script>

<style scoped>
.vpp {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}

.vpp__lede {
    margin: 0;
    max-width: var(--wizard-lede-width);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-snug);
}

.vpp__unbound {
    color: var(--color-warning-text);
}

/* The picker belongs to the row above it, so it sits indented under it. */
.vpp__picker {
    display: grid;
    gap: var(--gap-xs);
    justify-items: start;
    padding: var(--gap-xs) 0 var(--gap-xs) var(--gap-md);
}

.vpp__notice {
    margin-top: var(--gap-xs);
}
</style>
