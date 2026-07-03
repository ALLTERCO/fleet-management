<template>
    <div class="awm-sizes">
        <div
            v-for="ent in entities"
            :key="ent.id"
            class="awm-size-group"
        >
            <div class="awm-size-hdr">
                <i
                    :class="getEntityIcon(ent.type, ent.properties)"
                    class="awm-size-icon"
                />
                <span class="awm-size-name">{{ ent.name }}</span>
                <span class="awm-size-type">{{ ent.type }}</span>
            </div>
            <div class="awm-pv-row">
                <div
                    v-for="sz in WIDGET_SIZES"
                    :key="sz.value"
                    class="awm-pv"
                    :class="{
                        [`awm-pv--${sz.value}`]: true,
                        'awm-pv--sel':
                            (sizes[ent.id] ?? defaultSizeForEntityType(ent.type)) ===
                            sz.value
                    }"
                    @click="pickSize(ent.id, sz.value)"
                >
                    <div class="awm-pv-inner" inert>
                        <div
                            class="awm-pv-grid"
                            :style="previewGridStyle(sz.value)"
                        >
                            <component
                                :is="resolveCard(ent).component"
                                :entity="ent"
                                :size="sz.value"
                                v-bind="resolveCard(ent).extraProps ?? {}"
                            />
                        </div>
                    </div>
                    <div class="awm-pv-label">{{ sz.label }}</div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {Component} from 'vue';
import CardValue_Info from '@/components/cards/CardValue_Info.vue';
import CardValue_Sensor from '@/components/cards/CardValue_Sensor.vue';
import {resolveEntityCard} from '@/composables/useEntityCardResolver';
import {getBThomeVariant} from '@/config/bthome';
import {getEntityIcon} from '@/config/entity-registry';
import {
    defaultSizeForEntityType,
    WIDGET_SIZES
} from '@/helpers/widgetCatalog';
import type {entity_t} from '@/types';

const props = defineProps<{
    entities: entity_t[];
    sizes: Record<string, string>;
}>();

const emit = defineEmits<{
    'update:sizes': [sizes: Record<string, string>];
}>();

function pickSize(entityId: string, size: string): void {
    emit('update:sizes', {...props.sizes, [entityId]: size});
}

// Defer to the canonical resolver so the picker preview matches what the
// dashboard renders. BTHome bundles still need the variant prop derived
// from their objName so the right sensor face shows; everything else
// comes through the shared map.
function resolveCard(entity: entity_t): {
    component: Component;
    extraProps?: Record<string, unknown>;
} {
    if (entity.type === 'bthomesensor' || entity.type === 'bthomedevice') {
        const objName = (entity.properties as Record<string, unknown>)?.objName;
        return {
            component: CardValue_Sensor,
            extraProps: {
                variant: getBThomeVariant(
                    typeof objName === 'string' ? objName : undefined
                )
            }
        };
    }
    const mapping = resolveEntityCard(entity.type, entity);
    if (!mapping) return {component: CardValue_Info};
    const extraProps = mapping.variant ? {variant: mapping.variant} : undefined;
    return {component: mapping.component, extraProps};
}

function previewGridStyle(size: string): Record<string, string> {
    if (size === '1x1') {
        return {
            display: 'grid',
            gridTemplateColumns: '200px',
            gridTemplateRows: '200px'
        };
    }
    return {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 200px)',
        gridTemplateRows: size === '2x2' ? 'repeat(2, 200px)' : '200px',
        gap: '14px'
    };
}
</script>
