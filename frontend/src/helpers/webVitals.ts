import type {Metric} from 'web-vitals';
import {debug} from '@/tools/debug';

/**
 * Initializes Web Vitals tracking.
 * Logs metrics in development, and can be extended to report to backend.
 */
export function initWebVitals() {
    import('web-vitals').then(({onCLS, onLCP, onINP, onTTFB}) => {
        const report = (metric: Metric) => {
            debug(
                `[WebVitals] ${metric.name}: ${metric.value.toFixed(1)}`,
                metric.rating
            );
        };

        onCLS(report);
        onLCP(report);
        onINP(report);
        onTTFB(report);
    });
}
