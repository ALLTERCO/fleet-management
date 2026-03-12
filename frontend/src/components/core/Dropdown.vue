<template>
    <div
        ref="dropdownWrapper"
        :class="inlineLabel ? 'flex items-center gap-3' : ''"
    >
        <label
            v-if="label"
            :for="id"
            class="dropdown-label text-sm font-semibold"
            :class="
                inlineLabel ? 'pt-0 pb-0 whitespace-nowrap' : 'block pt-2 pb-2'
            "
        >
            {{ label }}
        </label>

        <!-- Anchor container: menu positions relative to THIS, not the label -->
        <div class="relative inline-block w-full sm:w-44">
            <button
                :id="id"
                data-dropdown-toggle="dropdown"
                class="dropdown-trigger w-full font-medium rounded-lg text-sm px-2.5 py-2 text-center inline-flex items-center border relative transition-all duration-50 disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
                role="combobox"
                :aria-expanded="expanded"
                :aria-controls="`${id}-listbox`"
                :disabled="disabled"
                :class="{
                    'rounded-b-none': expanded,
                }"
                @click="toggleDropdown"
                @keydown="handleTriggerKeydown"
            >
                <span :key="icon">
                    <span v-if="icon" class="icon mr-1">
                        <i :class="['fad', icon]"></i>
                    </span>
                    <span>{{ selected }}</span>
                </span>

                <span
                    :key="String(expanded)"
                    class="absolute right-2 icon is-small"
                >
                    <i
                        class="fad"
                        :class="{
                            'fa-angle-down': !expanded,
                            'fa-angle-up': expanded,
                        }"
                        aria-hidden="true"
                    ></i>
                </span>
            </button>

            <!-- Dropdown menu -->
            <div
                ref="dropdownMenu"
                class="dropdown-menu divide-y rounded-lg rounded-t-none shadow w-full absolute z-50 max-h-[16rem] overflow-auto min-h-fit left-0 top-full -mt-px"
                :class="{ hidden: !expanded }"
            >
                <div v-if="searchable" class="px-2 py-1">
                    <input
                        v-model="searchQuery"
                        type="text"
                        class="dropdown-search w-full rounded-lg p-2"
                        placeholder="Search..."
                    />
                </div>

                <ul
                    :id="`${id}-listbox`"
                    role="listbox"
                    class="dropdown-list text-sm z-50"
                    :aria-labelledby="id"
                    :style="{ maxHeight: dropdownMaxHeight + 'px' }"
                >
                    <li
                        v-for="(option, i) of filteredOptions"
                        :key="option"
                        role="option"
                        :aria-selected="selected === option"
                        class="dropdown-item px-4 py-2 hover:cursor-pointer min-h-[var(--touch-target-min)] flex items-center"
                        :class="{ 'dropdown-item--focused': focusedIndex === i }"
                        @click="optionSelected(option, icons?.[i as number])"
                    >
                        <span v-if="icons?.[i as number]" class="icon mr-1">
                            <i :class="['fad', icons[i as number]]"></i>
                        </span>
                        <span>{{ option }}</span>
                    </li>
                </ul>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup generic="T extends string | number | boolean">
import {
    computed,
    onBeforeUnmount,
    onMounted,
    type Ref,
    ref,
    toRefs,
    useId,
    watch
} from 'vue';

const id = useId();

const props = withDefaults(
    defineProps<{
        options: T[];
        icons?: Array<string>;
        default?: T;
        label?: string;
        searchable?: boolean;
        toDefault?: boolean;
        disabled?: boolean;

        /**
         * When true, render label inline with button (useful for toolbars/headers)
         * Default false to keep existing layouts unchanged.
         */
        inlineLabel?: boolean;
    }>(),
    {
        disabled: false,
        inlineLabel: false
    }
);

const emit = defineEmits<{
    selected: [option: T, index: number];
    resetFilters: [];
}>();

const {options, toDefault, disabled} = toRefs(props);
const selected = ref(props.default || options.value[0]) as Ref<T>;
const icon = ref(props.icons?.[0] || '');
const expanded = ref(false);
const focusedIndex = ref(-1);
const dropdownWrapper = ref<HTMLElement | null>(null);
const searchQuery = ref('');

const cachedViewportHeight = ref(window.innerHeight);
function onViewportResize() {
    cachedViewportHeight.value = window.innerHeight;
}
const dropdownMaxHeight = computed(() => cachedViewportHeight.value * 0.6);

const filteredOptions = computed(() => {
    if (!searchQuery.value) {
        return options.value;
    }
    return options.value.filter((option: T) =>
        option
            .toString()
            .toLowerCase()
            .includes(searchQuery.value.toLowerCase())
    );
});

watch(toDefault, (toDefaultVal) => {
    if (toDefaultVal) {
        resetDropdown();
    }
});

watch(
    () => props.default,
    (newDef) => {
        if (newDef != null && options.value.includes(newDef as T)) {
            selected.value = newDef as T;
        }
    }
);

function optionSelected(option: T, picon?: string) {
    selected.value = option;
    if (picon) {
        icon.value = picon;
    }
    expanded.value = false;
    emit('selected', option, options.value.indexOf(option));
}

function handleTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!expanded.value) {
            expanded.value = true;
            focusedIndex.value = 0;
            return;
        }
        const opts = filteredOptions.value;
        if (e.key === 'ArrowDown') {
            focusedIndex.value = Math.min(
                focusedIndex.value + 1,
                opts.length - 1
            );
        } else {
            focusedIndex.value = Math.max(focusedIndex.value - 1, 0);
        }
    } else if (e.key === 'Enter' && expanded.value && focusedIndex.value >= 0) {
        e.preventDefault();
        const opt = filteredOptions.value[focusedIndex.value];
        if (opt != null) optionSelected(opt, props.icons?.[focusedIndex.value]);
    } else if (e.key === 'Escape' && expanded.value) {
        e.preventDefault();
        expanded.value = false;
        focusedIndex.value = -1;
    }
}

function toggleDropdown() {
    if (disabled.value) return;
    expanded.value = !expanded.value;
    if (expanded.value) focusedIndex.value = 0;
    else focusedIndex.value = -1;
}

function closeDropdown(event: MouseEvent) {
    if (
        expanded.value &&
        dropdownWrapper.value &&
        !dropdownWrapper.value.contains(event.target as Node)
    ) {
        expanded.value = false;
    }
}

function resetDropdown() {
    selected.value = props.default || options.value[0]; // Set to first option
    icon.value = props.icons?.[0] || '';
    expanded.value = false;
}

onMounted(() => {
    document.addEventListener('click', closeDropdown);
    window.addEventListener('resize', onViewportResize);
});

onBeforeUnmount(() => {
    document.removeEventListener('click', closeDropdown);
    window.removeEventListener('resize', onViewportResize);
});

// Listen for resetFilters event to reset the dropdown
function resetFilters() {
    resetDropdown();
}

watch(options, (newOptions, oldOptions) => {
    if (oldOptions.length === 0 && newOptions.length > 0) {
        selected.value = newOptions[0];
    }
});
</script>

<style scoped>
.dropdown-label {
    color: var(--color-text-primary);
}
.dropdown-trigger {
    color: var(--color-text-secondary);
    background-color: var(--color-surface-1);
    border-color: var(--color-border-strong);
}
.dropdown-trigger:hover:not(:disabled) {
    background-color: var(--color-primary-subtle);
}
.dropdown-trigger:focus {
    box-shadow: 0 0 0 2px var(--color-border-focus);
}
.dropdown-trigger:disabled:hover {
    background-color: var(--color-surface-1);
}
.dropdown-menu {
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
.dropdown-search {
    background-color: var(--glass-input);
    color: var(--color-text-secondary);
    border: 1px solid var(--glass-border);
}
.dropdown-list {
    color: var(--color-text-secondary);
}
.dropdown-item:hover,
.dropdown-item--focused {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}
</style>
