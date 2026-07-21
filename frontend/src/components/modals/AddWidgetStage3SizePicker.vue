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
                    v-for="sz in sizeOptionsFor(ent)"
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
import {
    BTHOME_OBJNAME_CARDS,
    resolveEntityCard
} from '@/composables/useEntityCardResolver';
import {getBThomeVariant} from '@/config/bthome-presentation';
import {getEntityIcon} from '@/config/entity-registry';
import {
    allowedSizesForEntity,
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

// Offer only the sizes this entity allows (battery tiles omit 2x2), from the
// same rule the live dashboard cycles through.
function sizeOptionsFor(entity: entity_t) {
    const allowed = allowedSizesForEntity(entity);
    return WIDGET_SIZES.filter((o) => allowed.includes(o.value));
}

// Defer to the canonical resolver so the picker preview matches what the
// dashboard renders. BTHome bundles still need the variant prop derived
// from their objName so the right sensor face shows; everything else
// comes through the shared map.
function resolveCard(entity: entity_t): {
    component: Component;
    extraProps?: Record<string, unknown>;
} {
    const objName = (entity.properties as Record<string, unknown>)?.objName;
    // BTHome sensors with a dedicated single-value card (battery, illuminance,
    // rotation) — same mapping the dashboard uses.
    if (entity.type === 'bthomesensor') {
        const card =
            BTHOME_OBJNAME_CARDS[typeof objName === 'string' ? objName : ''];
        if (card) return {component: card};
    }
    // Other BTHome sensors render via CardValue_Sensor with a variant. A
    // bthomedevice (sensor hub) falls through to the canonical resolver below,
    // so the preview matches the dashboard's card, not a generic sensor face.
    if (entity.type === 'bthomesensor') {
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
