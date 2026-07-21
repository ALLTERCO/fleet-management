<template>
    <div v-if="!userId" class="amp-empty">
        Pick a user to inspect their authentication factors.
    </div>
    <div v-else class="amp-results">
        <div v-if="loading" class="amp-loading">
            <Spinner size="sm" /> Loading…
        </div>
        <template v-else-if="info">
            <section class="amp-section">
                <h3 class="amp-h">Methods enrolled</h3>
                <ul v-if="info.methodTypes.length" class="amp-list">
                    <li
                        v-for="m in info.methodTypes"
                        :key="m"
                        class="amp-tag"
                    >
                        {{ m }}
                    </li>
                </ul>
                <p v-else class="amp-empty-line">None enrolled.</p>
            </section>

            <section class="amp-section">
                <h3 class="amp-h">Passkeys</h3>
                <ul v-if="info.passkeys.length" class="amp-list">
                    <li
                        v-for="p in info.passkeys"
                        :key="p.id"
                        class="amp-tag"
                    >
                        {{ p.name ?? p.id }}
                        <span class="amp-mute">({{ p.state ?? '?' }})</span>
                    </li>
                </ul>
                <p v-else class="amp-empty-line">None.</p>
            </section>

            <section class="amp-section">
                <h3 class="amp-h">External IDP links</h3>
                <ul v-if="info.idpLinks.length" class="amp-list">
                    <li
                        v-for="(l, i) in info.idpLinks"
                        :key="`${l.idpId}-${i}`"
                        class="amp-tag"
                    >
                        {{ l.userName ?? l.userId }}
                        <span class="amp-mute">via {{ l.idpId }}</span>
                    </li>
                </ul>
                <p v-else class="amp-empty-line">None.</p>
            </section>
        </template>
        <p v-if="error" class="amp-error">
            <i class="fas fa-exclamation-triangle" /> {{ error }}
        </p>
    </div>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {sendRPC} from '@/tools/websocket';

interface AuthMethods {
    methodTypes: string[];
    passkeys: Array<{id: string; name?: string; state?: string}>;
    idpLinks: Array<{idpId: string; userId: string; userName?: string}>;
}

const props = defineProps<{userId: string | null}>();

const info = ref<AuthMethods | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function refresh(): Promise<void> {
    info.value = null;
    error.value = null;
    if (!props.userId) return;
    loading.value = true;
    try {
        info.value = await sendRPC<AuthMethods>(
            'FLEET_MANAGER',
            'User.GetAuthMethods',
            {userId: props.userId}
        );
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

watch(() => props.userId, refresh, {immediate: true});
</script>

<style scoped>
.amp-empty {
    color: var(--color-text-tertiary);
    font-style: italic;
}
.amp-results {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.amp-loading {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-text-tertiary);
}
.amp-section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.amp-h {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.amp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
}
.amp-tag {
    padding: 1px var(--gap-sm);
    border: 1px solid var(--color-primary-text);
    border-radius: var(--radius-sm);
    color: var(--color-primary-text);
    font-size: var(--type-caption);
}
.amp-mute {
    color: var(--color-text-quaternary);
    margin-left: var(--gap-xs);
}
.amp-empty-line {
    color: var(--color-text-quaternary);
    font-style: italic;
    margin: 0;
}
.amp-error {
    color: var(--color-danger-text);
}
</style>
