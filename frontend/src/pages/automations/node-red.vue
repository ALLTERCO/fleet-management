<template>
    <PageTemplate title="Automations" :tabs="automationsTabs" bare>
        <template v-if="NODE_RED_ENABLED" #toggles>
            <ViewToggle
                :model-value="view"
                :options="viewOptions"
                @update:model-value="showView"
            />
        </template>

        <div v-if="!NODE_RED_ENABLED" class="nr-disabled">
            <i class="fas fa-plug-circle-xmark nr-disabled__icon" />
            <h3>Node-RED is not enabled</h3>
            <p>
                This deployment was started without the Node-RED add-on.
                Re-deploy with <code>--with nodered</code> or set
                <code>FM_NODE_RED_ENABLED=true</code> to enable the
                visual flow editor.
            </p>
        </div>

        <div v-else-if="view === 'flows'" class="nr-flows">
            <NodeRedFlowList @open="openInEditor" />
        </div>

        <div v-else class="nr-editor">
            <p v-if="isSmallScreen" class="nr-small-note">
                <i class="fas fa-display" />
                The Node-RED editor works best on a large screen. On a phone,
                use the Flows view to switch flows on or off.
            </p>

            <div v-if="state === 'loading'" class="nr-state">
                <Spinner />
                <span>Opening Node-RED</span>
            </div>

            <div v-else-if="message" class="nr-state nr-state--problem" role="alert">
                <i :class="message.icon" class="nr-state__icon" />
                <h3>{{ message.title }}</h3>
                <p>{{ message.detail }}</p>
                <Button v-if="message.canRetry" type="blue" size="sm" @click="open">
                    Try again
                </Button>
            </div>

            <div v-else class="nr-frame-wrap">
                <div v-if="!frameLoaded" class="nr-state nr-state--overlay">
                    <Spinner />
                    <span>Loading the editor</span>
                </div>
                <!-- A hash-only src change does not switch flows; a new key reloads. -->
                <iframe
                    :key="editorUrl"
                    ref="frame"
                    class="nr-frame"
                    title="Node-RED editor"
                    :src="editorUrl"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    referrerpolicy="no-referrer"
                    @load="onFrameLoad"
                />
            </div>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    computed,
    inject,
    onBeforeUnmount,
    onMounted,
    ref,
    watch
} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import NodeRedFlowList from '@/components/automations/NodeRedFlowList.vue';
import Button from '@/components/core/Button.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Spinner from '@/components/core/Spinner.vue';
import ViewToggle from '@/components/core/ViewToggle.vue';
import {useMediaQuery} from '@/composables/useMediaQuery';
import {useNodeRedSession} from '@/composables/useNodeRedSession';
import {NODE_RED_ENABLED, NODE_RED_URL} from '@/constants';
import {
    editorFrameErrorCode,
    NODE_RED_ACCESS_MESSAGES,
    type NodeRedAccessMessage
} from '@/helpers/nodeRedAccess';
import {
    type NodeRedView,
    nodeRedEditorUrl,
    rememberNodeRedView,
    startingNodeRedView
} from '@/helpers/nodeRedViewPreference';
import type {RouteTab} from '@/types/page-template';

const automationsTabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'automationsTabs',
    [] as RouteTab[]
);
const route = useRoute();
const router = useRouter();
const {state, open, startKeepAlive, stopKeepAlive, reportEditorError} =
    useNodeRedSession();
const isSmallScreen = useMediaQuery('(max-width: 767px)');
const frameLoaded = ref(false);
const frame = ref<HTMLIFrameElement | null>(null);

const viewOptions = [
    {value: 'flows' as const, label: 'Flows', icon: 'fas fa-list'},
    {value: 'editor' as const, label: 'Editor', icon: 'fas fa-diagram-project'}
];

const view = computed<NodeRedView>(() =>
    startingNodeRedView(route.query.view)
);

const flowId = computed(() =>
    typeof route.query.flow === 'string' ? route.query.flow : null
);

const editorUrl = computed(() =>
    nodeRedEditorUrl({base: NODE_RED_URL, flowId: flowId.value})
);

const message = computed<NodeRedAccessMessage | null>(() =>
    state.value === 'loading' || state.value === 'ready'
        ? null
        : NODE_RED_ACCESS_MESSAGES[state.value]
);

watch([state, editorUrl], () => {
    frameLoaded.value = false;
});

onMounted(() => {
    if (!NODE_RED_ENABLED) return;
    void open();
    startKeepAlive();
});

onBeforeUnmount(stopKeepAlive);

// An ended session loads the proxy's JSON error into the frame; show it here.
function onFrameLoad(): void {
    frameLoaded.value = true;
    const doc = frame.value?.contentDocument;
    if (!doc) return;
    const code = editorFrameErrorCode({
        contentType: doc.contentType,
        text: doc.body?.textContent ?? ''
    });
    if (code) reportEditorError(code);
}

function showView(next: NodeRedView): void {
    rememberNodeRedView(next);
    void router.replace({query: {...route.query, view: next}});
}

function openInEditor(id: string | null): void {
    rememberNodeRedView('editor');
    const query: Record<string, string> = {view: 'editor'};
    if (id) query.flow = id;
    void router.replace({query});
}
</script>

<style scoped>
.nr-flows {
    padding: var(--space-4);
    overflow-y: auto;
    min-height: 0;
}

.nr-editor {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

.nr-small-note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.nr-frame-wrap {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
}

.nr-frame {
    flex: 1;
    width: 100%;
    border: 0;
    display: block;
    min-height: 0;
}

.nr-state {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-6);
    color: var(--color-text-secondary);
    text-align: center;
}

.nr-state--overlay {
    position: absolute;
    inset: 0;
    background: var(--color-surface-bg);
}

.nr-state--problem h3 {
    margin: 0;
    color: var(--color-text-primary);
}

.nr-state--problem p {
    margin: 0;
    max-width: 40ch;
}

.nr-state__icon {
    font-size: var(--type-heading);
    color: var(--color-text-tertiary);
}

.nr-disabled {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-12) var(--space-6);
    color: var(--color-text-primary);
    gap: var(--space-3);
}
.nr-disabled__icon {
    font-size: var(--type-heading);
    color: var(--color-text-tertiary);
}
.nr-disabled code {
    background: var(--color-surface-2);
    padding: var(--space-px) var(--space-1-5);
    border-radius: var(--radius-sm);
    font-family: monospace;
    font-size: 0.9em;
}
</style>
