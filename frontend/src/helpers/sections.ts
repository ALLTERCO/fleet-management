// Single source of truth for which sidebar section a route belongs to. The
// header shows the section name (stable while you tab between its nested
// pages) and the sidebar keeps that section selected. Most sections live under
// one path prefix; the Devices section also owns Waiting Room, which is a tab
// under it rather than its own sidebar entry.

import {
    ALERTS_PATH,
    AUTOMATIONS_PATH,
    DASHBOARDS_PATH,
    DEVICES_PATH,
    MONITORING_PATH,
    OPERATIONS_PATH,
    ORGANIZE_PATH,
    WAITING_ROOM_PATH
} from '@/constants';

export interface AppSection {
    /** Display name shown in the page header. */
    title: string;
    /** Primary sidebar link for the section. */
    link: string;
    /** Every route prefix that belongs to the section. */
    paths: string[];
}

// Some link constants point at a landing page (e.g. /organize/locations), so
// match on the top-level segment that the whole section shares.
function sectionRoot(path: string): string {
    const seg = path.split('/')[1];
    return seg ? `/${seg}` : path;
}

export const APP_SECTIONS: AppSection[] = [
    {title: 'Dashboards', link: DASHBOARDS_PATH, paths: [sectionRoot(DASHBOARDS_PATH)]},
    {
        title: 'Devices',
        link: DEVICES_PATH,
        paths: [sectionRoot(DEVICES_PATH), sectionRoot(WAITING_ROOM_PATH)]
    },
    {title: 'Organize', link: ORGANIZE_PATH, paths: [sectionRoot(ORGANIZE_PATH)]},
    {title: 'Alerts', link: ALERTS_PATH, paths: [sectionRoot(ALERTS_PATH)]},
    {title: 'Automations', link: AUTOMATIONS_PATH, paths: [sectionRoot(AUTOMATIONS_PATH)]},
    {title: 'Operations', link: OPERATIONS_PATH, paths: [sectionRoot(OPERATIONS_PATH)]},
    {title: 'Monitoring', link: MONITORING_PATH, paths: [sectionRoot(MONITORING_PATH)]}
];

function routeInSection(routePath: string, section: AppSection): boolean {
    return section.paths.some(
        (p) => routePath === p || routePath.startsWith(`${p}/`)
    );
}

export function sectionForPath(routePath: string): AppSection | undefined {
    return APP_SECTIONS.find((s) => routeInSection(routePath, s));
}
