<template>
    <Teleport to="body">
        <Transition name="detail-overlay" @after-leave="$emit('after-leave')">
            <div v-if="visible" ref="backdropRef" class="do-backdrop" :class="{ open: visible }" tabindex="-1" @click.self="close" @keydown="handleKeydown">
                <div class="do-panel" :data-type="dataType" role="dialog" aria-modal="true" :aria-labelledby="titleId">
                    <slot :close="close" :title-id="titleId" />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {nextTick, onUnmounted, ref, toRef, watch} from 'vue';
import {useFocusTrap} from '@/composables/useFocusTrap';

// Generic host for the detail overlay: backdrop, glass panel, focus trap,
// scroll lock, transitions. The body is slotted so the same shell serves the
// entity detail (DetailOverlay) and the widget detail (WidgetDetailBody).

const props = defineProps<{
    visible: boolean;
    /** Sets the panel's data-type so card-detail.css picks the matching
     *  --ar accent (entity type or 'ui_widget'). */
    dataType?: string;
}>();

const emit = defineEmits<{
    close: [];
    'after-leave': [];
}>();

const backdropRef = ref<HTMLElement | null>(null);
const titleId = `do-title-${Math.random().toString(36).slice(2, 9)}`;
const {handleKeydown} = useFocusTrap(backdropRef, toRef(props, 'visible'), () =>
    close()
);

// Body lock is owned by useFocusTrap → helpers/modalStack.
// Here we only freeze the page-level scroll container so the panel sits over
// a fixed snapshot of the page rather than a live-scrolling list.
let scrollOwnerPrevOverflow: string | null = null;

function lockScrollOwner() {
    const owner = document.querySelector(
        '[data-scroll-owner="page"]'
    ) as HTMLElement | null;
    if (!owner) return;
    scrollOwnerPrevOverflow = owner.style.overflow;
    owner.style.overflow = 'hidden';
}

function unlockScrollOwner() {
    const owner = document.querySelector(
        '[data-scroll-owner="page"]'
    ) as HTMLElement | null;
    if (!owner || scrollOwnerPrevOverflow === null) return;
    owner.style.overflow = scrollOwnerPrevOverflow;
    scrollOwnerPrevOverflow = null;
}

// Focus the backdrop for keyboard events and lock scroll while open.
watch(
    () => props.visible,
    (v) => {
        if (v) {
            lockScrollOwner();
            nextTick(() => backdropRef.value?.focus());
        } else {
            unlockScrollOwner();
        }
    }
);

function close() {
    emit('close');
}

onUnmounted(() => {
    unlockScrollOwner();
});
</script>
