 <template>
    <!-- Vertical mode (board list view) -->
    <div v-if="vertical"
        class="widget-card flex flex-row items-center gap-3 rounded-lg shadow-lg p-3 relative text-sm min-h-[76px] justify-start hover:cursor-pointer"
        :class="{ 'widget-card--selected': selected }" @click="onClick">

         <figure class="widget-avatar w-12 h-12 aspect-square border rounded-full flex-shrink-0">
            <slot name="image">
                <img class="rounded-full" src="/shelly_logo_black.jpg" alt="Shelly" />
            </slot>
        </figure>
        <div class="flex-grow text-left overflow-hidden min-w-0">
            <div class="font-semibold leading-snug">
                <slot name="name">
                    <span>Widget Name</span>
                </slot>
            </div>

            <template v-if="!stripped">
                <slot name="description" />
            </template>
        </div>
        <div v-if="!stripped" class="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">
            <input v-if="selectMode" type="checkbox" class="w-4 h-4" :value="selected" :checked="selected" />
            <slot v-else name="action" :vertical="true" />
        </div>
    </div>

    <!-- Grid mode (new device card design) -->
    <div v-else
        class="device-card"
        :class="[
            isOnline ? 'device-card--online' : 'device-card--offline',
            selected && 'device-card--selected'
        ]"
        @click="onClick">
        <!-- Accent line -->
        <div class="device-card__accent" :style="{ background: accentGradient }"></div>
        <!-- Head -->
        <div class="device-card__head">
            <span class="device-card__type" :style="{ color: typeColor }">
                <slot name="upper-corner">Device</slot>
            </span>
            <template v-if="!loading">
                <div v-if="isOnline" class="device-card__dot"></div>
                <span v-else class="device-card__pill-off">
                    <span class="device-card__pill-dot"></span> OFFLINE
                </span>
            </template>
        </div>
        <!-- Image -->
        <div class="device-card__img" :class="{ 'device-card__img--off': !isOnline && !loading }">
            <slot name="image">
                <img src="/shelly_logo_black.jpg" alt="Shelly" />
            </slot>
        </div>
        <!-- Name -->
        <div class="device-card__name" :class="{ 'device-card__name--off': !isOnline && !loading }">
            <div class="device-card__dev-name">
                <slot name="name">Widget Name</slot>
            </div>
            <div v-if="$slots.description && !loading" class="device-card__subtitle">
                <slot name="description" />
            </div>
        </div>
        <!-- Loading overlay -->
        <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-10">
            <Spinner />
        </div>
        <!-- Edit mode action -->
        <div v-if="editMode && !selectMode" class="absolute top-2 right-2 z-10">
            <slot name="action" :vertical="false" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, toRefs} from 'vue';
import Spinner from '@/components/core/Spinner.vue';

type props_t = {
    selected?: boolean;
    vertical?: boolean;
    selectMode?: boolean;
    stripped?: boolean;
    loading?: boolean;
    editMode?: boolean;
    online?: boolean;
    accentColor?: string;
};
const props = withDefaults(defineProps<props_t>(), {
    stripped: false,
    selected: false,
    loading: false,
    online: true,
    accentColor: '#3B82F6'
});

const emit = defineEmits<{
    select: [];
}>();

const {vertical, selected} = toRefs(props);

const isOnline = computed(() => props.online && !props.loading);

const OFFLINE_ACCENT = '#F04E5E';

const accentGradient = computed(() => {
    const color = isOnline.value ? props.accentColor : OFFLINE_ACCENT;
    return `linear-gradient(90deg, ${color}cc 0%, ${color}22 50%, transparent 100%)`;
});

const typeColor = computed(() => {
    if (!isOnline.value && !props.loading) return OFFLINE_ACCENT + 'bb';
    return props.accentColor + 'bb';
});

function onClick() {
    emit('select');
}
</script>

<style>
/* Card styles: global .widget-card system (design-tokens.css §16) — not scoped */
.widget-hint {
    color: var(--color-text-disabled);
}
</style>
