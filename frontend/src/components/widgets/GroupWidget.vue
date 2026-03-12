<template>
    <Widget>
        <template #upper-corner>
            <i class="mr-1 fas fa-cubes"></i>
            Group
        </template>

        <!-- TOP RIGHT CORNER -->
        <template #upper-right-corner>
            <div v-if="hasMetadata" class="relative" ref="infoRootRef">
                <button
                    ref="infoBtnRef"
                    aria-label="Show metadata"
                    class="w-8 h-8 rounded-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] flex items-center justify-center"
                    title="Metadata"
                    @mouseenter="onEnter"
                    @mouseleave="onLeave"
                    @click.stop="togglePinned"
                >
                    <i class="fas fa-info text-white text-xs" aria-hidden="true"></i>
                </button>

                <!-- Teleport popover to body to avoid overflow-hidden clipping -->
                <teleport to="body">
                    <div
                        v-if="showPopover"
                        class="fixed rounded-lg shadow-lg border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-3 min-w-[220px] w-[280px] max-w-[90vw]"
                        style="z-index: var(--z-tooltip)"
                        :style="popoverStyle"
                        @mouseenter="onEnter"
                        @mouseleave="onLeave"
                        @click.stop
                    >
                        <div
                            class="flex flex-row items-center justify-between mb-2"
                        >
                            <span class="font-semibold text-sm text-white"
                                >Metadata</span
                            >
                        </div>

                        <div
                            class="text-xs text-[var(--color-text-primary)] font-mono whitespace-pre-wrap break-words max-h-56 overflow-auto leading-5"
                        >
                            <div v-for="([k, v], idx) in entries" :key="idx">
                                <span class="text-[var(--color-text-secondary)]">{{ k }}</span
                                ><span class="text-[var(--color-text-tertiary)]">: </span
                                ><span class="text-[var(--color-text-primary)]">{{ v }}</span>
                            </div>
                        </div>
                    </div>
                </teleport>
            </div>
        </template>

        <template #image>
            <img
                class="rounded-full hover:cursor-pointer"
                src="/shelly_logo_black.jpg"
                alt="Shelly"
            />
        </template>

        <template #name>
            <span class="text-ellipsis line-clamp-2"> {{ name }}</span>
        </template>

        <template #description>
            <span class="text-[var(--color-text-tertiary)]">
                {{
                    members.length +
                    " device" +
                    (members.length == 1 ? "" : "s")
                }}
            </span>
        </template>

        <template #action>
            <Button v-if="editMode" type="red" @click="emit('delete')"
                >Delete</Button
            >
            <slot v-else name="widget-action" />
        </template>
    </Widget>
</template>

<script lang="ts" setup>
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    toRef,
    watch
} from 'vue';
import Button from '../core/Button.vue';
import Widget from './WidgetsTemplates/VanilaWidget.vue';

type props_t = {
    name: string;
    members: string[];
    metadata?: Record<string, any>;
    editMode?: boolean;
};

const props = defineProps<props_t>();

const editMode = toRef(props, 'editMode');
const emit = defineEmits<{
    delete: [];
}>();

const hovering = ref(false);
const pinned = ref(false);

const infoRootRef = ref<HTMLElement | null>(null);
const infoBtnRef = ref<HTMLElement | null>(null);

const popoverStyle = ref<Record<string, string>>({
    left: '0px',
    top: '0px',
    transform: 'translateY(-100%)'
});

const entries = computed(() => {
    const meta = props.metadata ?? {};
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
    return Object.entries(meta)
        .filter(([k]) => String(k).trim().length > 0)
        .map(([k, v]) => [String(k), v == null ? '' : String(v)] as const);
});

const hasMetadata = computed(() => entries.value.length > 0);
const showPopover = computed(
    () => hasMetadata.value && (hovering.value || pinned.value)
);

function onEnter() {
    hovering.value = true;
}
function onLeave() {
    hovering.value = false;
}

function togglePinned() {
    pinned.value = !pinned.value;
}

function updatePopoverPosition() {
    const btn = infoBtnRef.value;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const width = 280; // matches w-[280px]
    const margin = 8;

    // right-align to button, clamp inside viewport
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    // place ABOVE the button
    const top = rect.top - margin;

    popoverStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
        transform: 'translateY(-100%)'
    };
}

function onDocumentClick(e: MouseEvent) {
    if (!pinned.value) return;
    const root = infoRootRef.value;
    const target = e.target as Node | null;
    if (!root || !target) return;

    if (!root.contains(target)) {
        pinned.value = false;
    }
}

let windowChangeRaf = 0;
function onWindowChange() {
    if (!showPopover.value) return;
    if (windowChangeRaf) return;
    windowChangeRaf = requestAnimationFrame(() => {
        windowChangeRaf = 0;
        if (showPopover.value) updatePopoverPosition();
    });
}

watch(
    () => showPopover.value,
    async (open) => {
        if (open) {
            await nextTick();
            updatePopoverPosition();
        }
    }
);

onMounted(() => {
    document.addEventListener('click', onDocumentClick);
    window.addEventListener('scroll', onWindowChange, true);
    window.addEventListener('resize', onWindowChange);
});

onBeforeUnmount(() => {
    if (windowChangeRaf) cancelAnimationFrame(windowChangeRaf);
    document.removeEventListener('click', onDocumentClick);
    window.removeEventListener('scroll', onWindowChange, true);
    window.removeEventListener('resize', onWindowChange);
});
</script>
