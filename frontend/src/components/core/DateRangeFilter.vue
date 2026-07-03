<template>
    <div class="drf">
        <label v-if="label" class="drf__label">{{ label }}</label>
        <VueDatePicker
            v-model="dateRange"
            range
            :enable-time-picker="enableTime"
            :preset-dates="presets"
            :clearable="clearable"
            dark
            :auto-apply="false"
            class="drf__picker"
        >
            <template #trigger>
                <Button type="blue-hollow" class="drf__trigger">
                    <i class="fas fa-calendar drf__trigger-icon" />
                    <span class="drf__trigger-label">{{ triggerLabel }}</span>
                </Button>
            </template>
        </VueDatePicker>
    </div>
</template>

<script setup lang="ts">
import {VueDatePicker} from '@vuepic/vue-datepicker';
import {computed} from 'vue';
import '@vuepic/vue-datepicker/dist/main.css';
import Button from '@/components/core/Button.vue';

const props = withDefaults(
    defineProps<{
        /** v-model: ISO-string tuple [from, to]. Empty strings when unset. */
        modelValue: {from: string; to: string};
        /** Inline label rendered above the picker. */
        label?: string;
        /** Placeholder text when no range is selected. */
        placeholder?: string;
        /** Show time pickers inside the calendar (hour/minute precision). */
        enableTime?: boolean;
        /** Allow clearing the range (back to empty). */
        clearable?: boolean;
    }>(),
    {
        label: 'Date range',
        placeholder: 'Select date and time range',
        enableTime: true,
        clearable: false
    }
);

const emit = defineEmits<{
    'update:modelValue': [value: {from: string; to: string}];
}>();

// Bridge ISO strings ↔ VueDatePicker's [Date, Date] tuple.
const dateRange = computed<[Date, Date] | null>({
    get() {
        if (!props.modelValue.from || !props.modelValue.to) return null;
        return [
            new Date(props.modelValue.from),
            new Date(props.modelValue.to)
        ];
    },
    set(val) {
        if (val?.[0] && val[1]) {
            emit('update:modelValue', {
                from: val[0].toISOString(),
                to: val[1].toISOString()
            });
        } else {
            emit('update:modelValue', {from: '', to: ''});
        }
    }
});

// Trigger button label — compact, drops redundant parts (year if same as
// current year, year on the right side if same as left).
const triggerLabel = computed(() => {
    if (!props.modelValue.from || !props.modelValue.to) return props.placeholder;
    const from = new Date(props.modelValue.from);
    const to = new Date(props.modelValue.to);
    const now = new Date();
    const sameYear = from.getFullYear() === to.getFullYear();
    const currentYear = sameYear && from.getFullYear() === now.getFullYear();

    const dateOpts = (includeYear: boolean): Intl.DateTimeFormatOptions => ({
        month: 'short',
        day: 'numeric',
        year: includeYear ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit'
    });

    // Left side never drops year if it's not the current year.
    const left = from.toLocaleString(undefined, dateOpts(!currentYear));
    // Right side drops year only when both sides share the same year.
    const right = to.toLocaleString(undefined, dateOpts(!sameYear));
    return `${left} — ${right}`;
});

// Standard preset ranges. Reuse across every page that filters timestamped data.
const presets = computed(() => {
    const now = new Date();
    const minus = (ms: number) => new Date(now.getTime() - ms);
    return [
        {label: 'Last hour', value: [minus(60 * 60 * 1000), now]},
        {label: 'Last 24 hours', value: [minus(24 * 60 * 60 * 1000), now]},
        {label: 'Last 7 days', value: [minus(7 * 24 * 60 * 60 * 1000), now]},
        {label: 'Last 30 days', value: [minus(30 * 24 * 60 * 60 * 1000), now]},
        {label: 'Last 90 days', value: [minus(90 * 24 * 60 * 60 * 1000), now]}
    ];
});
</script>

<style scoped>
.drf {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.drf__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

/* VueDatePicker theming — token map + heavier overrides on internal markup. */
.drf__picker:deep() {
    /* Token-mapped CSS variables the picker exposes. */
    --dp-background-color: var(--glass-3-bg);
    --dp-text-color: var(--color-text-primary);
    --dp-hover-color: var(--color-surface-3);
    --dp-hover-text-color: var(--color-text-primary);
    --dp-hover-icon-color: var(--color-text-primary);
    --dp-primary-color: var(--color-primary);
    --dp-primary-text-color: var(--color-text-primary);
    --dp-primary-disabled-color: var(--color-primary-subtle);
    --dp-secondary-color: var(--color-text-tertiary);
    --dp-border-color: var(--color-border-medium);
    --dp-border-color-hover: var(--color-border-strong);
    --dp-border-color-focus: var(--color-primary);
    --dp-disabled-color: var(--color-surface-3);
    --dp-disabled-color-text: var(--color-text-disabled);
    --dp-success-color: var(--color-success);
    --dp-error-color: var(--color-danger);
    --dp-icon-color: var(--color-text-tertiary);
    --dp-menu-min-width: 360px;
    --dp-action-buttons-padding: var(--gap-sm);
    --dp-row-margin: var(--space-1);
    --dp-cell-padding: var(--space-2);
    --dp-cell-size: 36px;
    --dp-cell-border-radius: var(--radius-sm);
    --dp-button-height: 36px;
    --dp-month-year-row-height: 40px;
    --dp-month-year-row-button-size: 32px;
    --dp-time-inc-dec-button-size: 32px;
    --dp-input-padding: var(--gap-xs) var(--gap-sm);
    --dp-input-icon-padding: 36px;
    --dp-border-radius: var(--radius-md);
    --dp-font-family: var(--font-sans);
    --dp-font-size: var(--type-body);
    --dp-preview-font-size: var(--type-caption);
    --dp-time-font-size: var(--type-body);
}

/* Custom button trigger (replaces the default dp__input). Uses our <Button>
 * component — gap between icon and text comes from .core-btn's flex/gap. */
.drf__trigger {
    width: 100%;
    justify-content: flex-start;
    /* Allow the button to grow taller on narrow screens so the date range
     * wraps onto two lines instead of getting clipped. */
    min-height: var(--touch-target-min);
    height: auto;
    padding: var(--gap-xs) var(--gap-sm);
}
.drf__trigger-icon {
    color: var(--color-primary-text);
    font-size: var(--type-body);
    flex-shrink: 0;
}
.drf__trigger-label {
    flex: 1;
    text-align: left;
    /* Wrap the date range onto multiple lines if the button is narrow,
     * with ellipsis as a final fallback. */
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
    white-space: normal;
    line-height: 1.3;
}

/* Popup menu — frosted glass, brand shadow, our radius. */
.drf__picker:deep(.dp__menu),
.drf__picker:deep(.dp__outer_menu_wrap) {
    background: var(--glass-3-bg);
    backdrop-filter: blur(var(--glass-3-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--card-shadow-hover);
    border-radius: var(--radius-xl);
}

.drf__picker:deep(.dp__menu_inner) {
    padding: var(--gap-sm);
}

/* Calendar cells — better breathing room, brand-blue hover, brand selection. */
.drf__picker:deep(.dp__calendar_item) {
    padding: var(--space-0-5);
}
.drf__picker:deep(.dp__cell_inner) {
    color: var(--color-text-secondary);
    transition: background var(--duration-fast), color var(--duration-fast);
}
.drf__picker:deep(.dp__cell_inner:hover) {
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-text-primary);
}
.drf__picker:deep(.dp__active_date),
.drf__picker:deep(.dp__date_hover_start:hover),
.drf__picker:deep(.dp__date_hover_end:hover) {
    background: var(--color-primary);
    color: var(--color-text-primary);
    box-shadow: 0 0 12px color-mix(in srgb, var(--color-primary) 50%, transparent);
}
.drf__picker:deep(.dp__range_start),
.drf__picker:deep(.dp__range_end) {
    background: var(--color-primary);
    color: var(--color-text-primary);
}
.drf__picker:deep(.dp__range_between) {
    background: color-mix(in srgb, var(--color-primary) 22%, transparent);
    color: var(--color-text-primary);
}
.drf__picker:deep(.dp__today) {
    border-color: var(--color-primary);
}

/* Month/year selector header — bigger, more breathing room. */
.drf__picker:deep(.dp__month_year_wrap) {
    gap: var(--gap-xs);
}
.drf__picker:deep(.dp__month_year_select) {
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    border-radius: var(--radius-sm);
    padding: var(--space-1-5) var(--gap-xs);
}
.drf__picker:deep(.dp__month_year_select:hover) {
    background: var(--color-surface-3);
}
.drf__picker:deep(.dp__inner_nav) {
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
}
.drf__picker:deep(.dp__inner_nav:hover) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}

/* Calendar header (Mo Tu We …) — quieter typography. */
.drf__picker:deep(.dp__calendar_header_item) {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

/* Preset rail — pills that match our design language, not stock buttons. */
.drf__picker:deep(.dp__preset_dates) {
    border-right: 1px solid var(--color-border-medium);
    padding: var(--gap-xs);
    min-width: 140px;
}
.drf__picker:deep(.dp__btn) {
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    padding: var(--space-1-5) var(--gap-sm);
    font-size: var(--type-caption);
    font-family: var(--font-sans);
    transition: all var(--duration-fast);
    margin-bottom: var(--space-1);
    width: 100%;
}
.drf__picker:deep(.dp__btn:hover) {
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
}

/* Time picker is left to VueDatePicker entirely — colors come from the
 * --dp-* variables at the top of this block. Overriding the time picker's
 * internal classes broke the up/down arrow clicks. */

/* Action row at bottom (Cancel / Select). */
.drf__picker:deep(.dp__action_buttons) {
    gap: var(--gap-xs);
}
.drf__picker:deep(.dp__action_select),
.drf__picker:deep(.dp__action_cancel) {
    border-radius: var(--btn-radius);
    font-weight: var(--font-semibold);
    padding: var(--space-1-5) var(--gap-sm);
}
.drf__picker:deep(.dp__action_select) {
    background: var(--color-primary);
    color: var(--color-text-primary);
}
.drf__picker:deep(.dp__action_cancel) {
    background: transparent;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-medium);
}
</style>
