 <template>
    <!-- Vertical mode (board list view) -->
    <div v-if="vertical"
        class="widget-card flex flex-row items-center gap-3 rounded-lg shadow-none p-3 relative text-sm min-h-[76px] justify-start hover:cursor-pointer"
        :class="{ 'widget-card--selected': selected }" @click="onClick">

         <figure class="widget-avatar w-12 h-12 aspect-square border rounded-full flex-shrink-0">
            <slot name="image">
                <img class="rounded-full" src="/images/branding/shelly_logo_black.jpg" alt="Shelly" />
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
                <div class="device-card__status-tags">
                    <template v-if="sleeping">
                        <div class="device-card__dot device-card__dot--sleep" :title="lastSeenText">
                            <i class="fas fa-moon"></i>
                        </div>
                    </template>
                    <template v-else-if="isOnline">
                        <span v-if="props.battery != null" :class="batteryPillClass">
                            <i :class="batteryIcon"></i> {{ props.battery }}%
                        </span>
                        <div v-else class="device-card__dot"></div>
                    </template>
                    <span v-else class="device-card__pill-off">
                        <span class="device-card__pill-dot"></span> OFFLINE
                    </span>
                </div>
            </template>
        </div>
        <!-- Image -->
        <div class="device-card__img" :class="{ 'device-card__img--off': !isOnline && !loading }">
            <slot name="image">
                <img src="/images/branding/shelly_logo_black.jpg" alt="Shelly" />
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
        <!-- Footer (e.g. action buttons) -->
        <div v-if="$slots.footer && !loading" class="device-card__footer">
            <slot name="footer" />
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
import {chartColors} from '@/helpers/chartUtils';

type props_t = {
    selected?: boolean;
    vertical?: boolean;
    selectMode?: boolean;
    stripped?: boolean;
    loading?: boolean;
    editMode?: boolean;
    online?: boolean;
    sleeping?: boolean;
    accentColor?: string;
    lastSeen?: number;
    battery?: number | null;
};
const props = withDefaults(defineProps<props_t>(), {
    stripped: false,
    selected: false,
    loading: false,
    online: true,
    accentColor: ''
});

const emit = defineEmits<{
    select: [];
}>();

const {vertical, selected} = toRefs(props);

const isOnline = computed(() => props.online && !props.loading);

const accentGradient = computed(() => {
    const color = props.sleeping
        ? chartColors.accent
        : isOnline.value
          ? props.accentColor || chartColors.primary
          : chartColors.statusOff;
    return `linear-gradient(90deg, ${color}cc 0%, ${color}22 50%, transparent 100%)`;
});

const typeColor = computed(() => {
    if (props.sleeping) return `${chartColors.accent}bb`;
    if (!isOnline.value && !props.loading) return `${chartColors.statusOff}bb`;
    return `${props.accentColor || chartColors.primary}bb`;
});

const batteryPillClass = computed(() => {
    const b = props.battery ?? 100;
    if (b <= 25)
        return 'device-card__pill-battery device-card__pill-battery--red';
    if (b <= 50)
        return 'device-card__pill-battery device-card__pill-battery--orange';
    return 'device-card__pill-battery';
});

const batteryIcon = computed(() => {
    const b = props.battery ?? 100;
    if (b <= 10) return 'fas fa-battery-empty';
    if (b <= 25) return 'fas fa-battery-quarter';
    if (b <= 50) return 'fas fa-battery-half';
    if (b <= 75) return 'fas fa-battery-three-quarters';
    return 'fas fa-battery-full';
});

const lastSeenText = computed(() => {
    if (!props.lastSeen) return 'Sleeping';
    const diffS = Math.floor(Date.now() / 1000 - props.lastSeen);
    if (diffS < 60) return 'just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return `${Math.floor(diffS / 86400)}d ago`;
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
