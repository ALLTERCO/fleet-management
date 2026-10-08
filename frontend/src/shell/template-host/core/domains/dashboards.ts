// Dashboards, and the things on them.
//
// Thirty-nine methods, and the raw names hide the one distinction that matters:
// a dashboard is a container, and an item is a thing inside it. They have
// separate lifecycles — you reorder items within a dashboard, and you reorder
// dashboards within a list — and the flat names read almost identically
// (`dashboard.reorder` vs `dashboard.reorderitems`). Nesting them makes the
// mistake hard to type.
//
// Deliberately not here: import and export. They move a whole configuration
// between installs, which is an operator's job, not a screen's. Still
// reachable through rpc.call when someone truly means it.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type DashboardMethod = Extract<HostMethod, `dashboard.${string}`>;

export type FleetDashboardDomain = ReturnType<typeof createDashboardDomain>;

export function createDashboardDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<DashboardMethod>(access);

    return {
        list: (params: HostParams<'dashboard.list'> = {}) =>
            call('dashboard.list', params),
        get: (params: HostParams<'dashboard.get'>) =>
            call('dashboard.get', params),
        create: (params: HostParams<'dashboard.create'>) =>
            call('dashboard.create', params),
        update: (params: HostParams<'dashboard.update'>) =>
            call('dashboard.update', params),
        delete: (params: HostParams<'dashboard.delete'>) =>
            call('dashboard.delete', params),
        deleteMany: (params: HostParams<'dashboard.deletebulk'>) =>
            call('dashboard.deletebulk', params),
        clone: (params: HostParams<'dashboard.clone'>) =>
            call('dashboard.clone', params),
        /** Order of the dashboards themselves, not of what is on one. */
        reorder: (params: HostParams<'dashboard.reorder'>) =>
            call('dashboard.reorder', params),

        /** Which widgets and dashboard types this install can render. */
        uiConfig: () => call('dashboard.getuiconfig', {}),

        /** The one a user lands on. */
        default: {
            get: () => call('dashboard.getdefault', {}),
            set: (params: HostParams<'dashboard.setdefault'>) =>
                call('dashboard.setdefault', params),
            clear: (params: HostParams<'dashboard.cleardefault'> = {}) =>
                call('dashboard.cleardefault', params)
        },

        /** Per-user pins. Survives across devices, so it is not local state. */
        pins: {
            list: () => call('dashboard.listpinned', {}),
            pin: (params: HostParams<'dashboard.pin'>) =>
                call('dashboard.pin', params),
            unpin: (params: HostParams<'dashboard.unpin'>) =>
                call('dashboard.unpin', params),
            reorder: (params: HostParams<'dashboard.reorderpins'>) =>
                call('dashboard.reorderpins', params)
        },

        /** What sits on a dashboard. Nested so it cannot be confused with the
         *  dashboard's own lifecycle above. */
        items: {
            list: (params: HostParams<'dashboard.item.list'>) =>
                call('dashboard.item.list', params),
            add: (params: HostParams<'dashboard.item.add'>) =>
                call('dashboard.item.add', params),
            addMany: (params: HostParams<'dashboard.item.addbulk'>) =>
                call('dashboard.item.addbulk', params),
            update: (params: HostParams<'dashboard.item.update'>) =>
                call('dashboard.item.update', params),
            remove: (params: HostParams<'dashboard.item.remove'>) =>
                call('dashboard.item.remove', params),
            reorder: (params: HostParams<'dashboard.item.reorder'>) =>
                call('dashboard.item.reorder', params),
            /** Replaces the whole set in one write. */
            setAll: (params: HostParams<'dashboard.item.setall'>) =>
                call('dashboard.item.setall', params),

            /** The flat widget API the structured calls above replaced. Kept
             *  reachable for dashboards still written against it. */
            legacy: {
                add: (params: HostParams<'dashboard.additem'>) =>
                    call('dashboard.additem', params),
                remove: (params: HostParams<'dashboard.removeitem'>) =>
                    call('dashboard.removeitem', params),
                reorder: (params: HostParams<'dashboard.reorderitems'>) =>
                    call('dashboard.reorderitems', params),
                updateSize: (params: HostParams<'dashboard.updateitemsize'>) =>
                    call('dashboard.updateitemsize', params)
            }
        },

        /** Saved layouts a new dashboard is seeded from. Builtins are
         *  read-only; create and update only ever touch the org's own. */
        templates: {
            list: (params: HostParams<'dashboard.template.list'> = {}) =>
                call('dashboard.template.list', params),
            get: (params: HostParams<'dashboard.template.get'>) =>
                call('dashboard.template.get', params),
            /** What it would materialize against a scope, without creating. */
            preview: (params: HostParams<'dashboard.template.preview'>) =>
                call('dashboard.template.preview', params),
            create: (params: HostParams<'dashboard.template.create'>) =>
                call('dashboard.template.create', params),
            update: (params: HostParams<'dashboard.template.update'>) =>
                call('dashboard.template.update', params),
            delete: (params: HostParams<'dashboard.template.delete'>) =>
                call('dashboard.template.delete', params),
            /** Turns a dashboard someone already tuned into a template. */
            saveFromDashboard: (
                params: HostParams<'dashboard.template.savefromdashboard'>
            ) => call('dashboard.template.savefromdashboard', params)
        },

        /** Carbon factors, tariff windows, PV mode — what the widgets read. */
        settings: {
            get: (params: HostParams<'dashboard.getsettings'>) =>
                call('dashboard.getsettings', params),
            set: (params: HostParams<'dashboard.setsettings'>) =>
                call('dashboard.setsettings', params)
        },

        /** Activity on a dashboard: who changed it and when. */
        activity: (params: HostParams<'dashboard.activity.list'>) =>
            call('dashboard.activity.list', params)
    };
}
