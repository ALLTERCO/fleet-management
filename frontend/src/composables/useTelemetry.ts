import {trackClick, trackInteraction} from '@/tools/observability';
import {useRoute} from 'vue-router/auto';

/**
 * Composable for tracking user interactions.
 * Events are stored in the observability ring buffer (Tier 2+).
 *
 * @param category Default category for events (e.g. 'firmware', 'backups')
 */
export function useTelemetry(category: string) {
    function track(action: string, label?: string) {
        trackInteraction(category, action, label);
    }

    /** Track a click event with position data for heatmap analysis */
    function trackClickEvent(event: MouseEvent) {
        const route = useRoute();
        trackClick(event, route.path);
    }

    return {track, trackClickEvent};
}
