<template>
    <div class="wcp-scrim" @click.self="$emit('close')">
        <div
            class="wcp"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wcp-title"
        >
            <header class="wcp-head">
                <h2 id="wcp-title" class="wcp-title">
                    <i :class="meta.icon" aria-hidden="true" />
                    {{ meta.name }}
                </h2>
                <button
                    type="button"
                    class="wcp-close"
                    aria-label="Close"
                    @click="$emit('close')"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
            </header>

            <div class="wcp-body">
                <section class="wcp-section">
                    <h3 class="wcp-section-title">Size</h3>
                    <SizePicker
                        :size="draftSize"
                        :allowed-sizes="allowedSizes"
                        @change="draftSize = $event"
                    />
                </section>

                <section class="wcp-section">
                    <h3 class="wcp-section-title">Settings</h3>
                    <AddWidgetCfgForm
                        :widget="widgetKind"
                        :chart-device-list="deviceList"
                        :chart-cfg="bundle.chartCfg"
                        :gauge-cfg="bundle.gaugeCfg"
                        :stats-cfg="bundle.statsCfg"
                        :top-cfg="bundle.topCfg"
                        :timeline-cfg="bundle.timelineCfg"
                        :heatmap-cfg="bundle.heatmapCfg"
                        :site-grid-cfg="bundle.siteGridCfg"
                        :maint-cfg="bundle.maintCfg"
                        :cross-bar-cfg="bundle.crossBarCfg"
                    />
                </section>

                <section class="wcp-section">
                    <h3 class="wcp-section-title">Preview</h3>
                    <div class="wcp-preview">
                        <CardPreview :entry="previewEntry" />
                    </div>
                    <p v-if="!built.ok" class="wcp-hint">
                        <i class="fas fa-circle-info" aria-hidden="true" />
                        {{ built.message }}
                    </p>
                </section>
            </div>

            <footer class="wcp-foot">
                <button type="button" class="btn-ghost" @click="$emit('close')">
                    Cancel
                </button>
                <button
                    type="button"
                    class="btn-primary"
                    :disabled="!built.ok"
                    @click="save"
                >
                    Save
                </button>
            </footer>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, ref} from 'vue';
import AddWidgetCfgForm from '@/components/modals/AddWidgetCfgForm.vue';
import {useWidgetDeviceList} from '@/composables/useWidgetDeviceList';
import {
    buildWidgetPayload,
    createWidgetCfgBundle,
    seedCfgBundleFromConfig
} from '@/helpers/widgetBuilders';
import {allowedSizesForWidget, type CardSize} from '@/helpers/widgetCatalog';
import {UI_WIDGET_META, WIDGET_SAMPLE_CONFIG} from '@/helpers/widgetSamples';
import type {DashboardEntry, UiWidgetId} from '@/types/dashboard-entry';
import SizePicker from '@/components/cards/SizePicker.vue';
import CardPreview from './CardPreview.vue';

const props = defineProps<{
    config: Record<string, any>;
    size: CardSize;
}>();

const emit = defineEmits<{
    close: [];
    save: [payload: {config: Record<string, unknown>; size: CardSize}];
}>();

const widgetKind = computed(() => props.config.id as UiWidgetId);
const meta = computed(
    () =>
        UI_WIDGET_META[widgetKind.value] ?? {
            icon: 'fas fa-shapes',
            name: 'Widget',
            description: ''
        }
);

// Seed the shared form bundle from the stored config once — the reverse of the
// builder, so a field the builder wrote reads back into the same form.
const bundle = reactive(createWidgetCfgBundle());
seedCfgBundleFromConfig(bundle, props.config);

const draftSize = ref<CardSize>(props.size);
const allowedSizes = computed(() => allowedSizesForWidget(widgetKind.value));
const deviceList = useWidgetDeviceList();

// One builder for add, edit and preview. An incomplete form declines; the
// preview then falls back to the sample so it always renders.
const built = computed(() => buildWidgetPayload(widgetKind.value, bundle));
const previewEntry = computed<DashboardEntry>(() => ({
    type: 'ui_widget',
    size: draftSize.value,
    data: built.value.ok
        ? built.value.data
        : (WIDGET_SAMPLE_CONFIG[widgetKind.value]?.() ?? {id: widgetKind.value})
}));

function save() {
    if (!built.value.ok) return;
    emit('save', {config: built.value.data, size: draftSize.value});
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.wcp-scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: var(--overlay-scrim);
    backdrop-filter: blur(var(--glass-3-blur));
}

@media (min-width: 640px) {
    .wcp-scrim {
        align-items: center;
    }
}

.wcp {
    width: 100%;
    max-width: 26rem;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: var(--glass-3-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}

@media (min-width: 640px) {
    .wcp {
        border-radius: var(--radius-xl);
    }
}

.wcp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
}

.wcp-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.wcp-title i {
    color: var(--color-text-tertiary);
}

.wcp-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
}

.wcp-close:hover {
    color: var(--color-text-primary);
    background: var(--glass-hover);
}

.wcp-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5);
    overflow-y: auto;
}

.wcp-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.wcp-section-title {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}

.wcp-preview {
    display: flex;
    justify-content: center;
    padding: var(--space-3);
    background: var(--color-surface-bg);
    border-radius: var(--radius-md);
}

.wcp-hint {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.wcp-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
}
</style>
