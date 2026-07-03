import type {RouteTab} from '@/types/page-template';

export const MONITORING_TABS: readonly RouteTab[] = [
    {label: 'Overview', path: '/monitoring/overview', icon: 'fas fa-heart-pulse'},
    {label: 'Runtime', path: '/monitoring/runtime', icon: 'fas fa-code-branch'},
    {label: 'Resources', path: '/monitoring/resources', icon: 'fas fa-microchip'},
    {label: 'Activity', path: '/monitoring/activity', icon: 'fas fa-wave-square'},
    {
        label: 'Investigate',
        path: '/monitoring/investigate',
        icon: 'fas fa-magnifying-glass-chart'
    }
];
