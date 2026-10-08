// Where an alert goes, and whether it arrived.
//
// A fleet template that can raise an alert but not say where it should land is
// only half a product. These methods were always callable; what was missing is
// that a channel is a two-part thing — the destination and its health — and the
// raw names do not say which is which.
//
// `test` and `resetHealth` are here because the failure mode is silence: an
// endpoint that stopped accepting messages looks exactly like a fleet with
// nothing wrong. Testing before saving is the only way to tell.
//
// A channel is only the last hop. Everything either side of it — who an alert
// is routed to, which human is awake, what they read, and whether they asked
// not to be woken — was unreachable, so a template could offer one hard-coded
// recipient and nothing more. Those groups mirror the RPC namespaces exactly.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type ChannelMethod = Extract<HostMethod, `channel.${string}`>;
type NotificationMethod = Extract<HostMethod, `notification.${string}`>;

export type FleetNotificationDomain = ReturnType<
    typeof createNotificationDomain
>;

export function createNotificationDomain(access: FleetRpcAccess) {
    const channel = namespaceCaller<ChannelMethod>(access);
    const notify = namespaceCaller<NotificationMethod>(access);

    return {
        /** Destinations: email, webhook, Slack, whatever this install has. */
        channels: {
            list: (params: HostParams<'channel.list'> = {}) =>
                channel('channel.list', params),
            get: (params: HostParams<'channel.get'>) =>
                channel('channel.get', params),
            /** Which providers exist here. Ask before offering a choice. */
            providers: () => channel('channel.listproviders', {}),
            create: (params: HostParams<'channel.create'>) =>
                channel('channel.create', params),
            update: (params: HostParams<'channel.update'>) =>
                channel('channel.update', params),
            delete: (params: HostParams<'channel.delete'>) =>
                channel('channel.delete', params),
            /**
             * Sends a real message. The point is to fail here, in front of
             * someone, rather than at 3am when the alert that mattered went
             * nowhere and nothing said so.
             */
            test: (params: HostParams<'channel.test'>) =>
                channel('channel.test', params),
            /** Clears the failure counter after a destination is fixed. */
            resetHealth: (params: HostParams<'channel.resethealth'>) =>
                channel('channel.resethealth', params)
        },

        /** One name for a set of people and endpoints, so a rule addresses the
         *  group instead of a recipient list that drifts out of date. */
        destinations: {
            /** What an editor may offer — no nested groups or escalation yet. */
            getModel: () => notify('notification.destination.getmodel', {}),
            list: (params: HostParams<'notification.destination.list'> = {}) =>
                notify('notification.destination.list', params),
            get: (params: HostParams<'notification.destination.get'>) =>
                notify('notification.destination.get', params),
            create: (params: HostParams<'notification.destination.create'>) =>
                notify('notification.destination.create', params),
            update: (params: HostParams<'notification.destination.update'>) =>
                notify('notification.destination.update', params),
            /** Refused while a rule still points at it, rather than silently
             *  leaving that rule with nowhere to send. */
            delete: (params: HostParams<'notification.destination.delete'>) =>
                notify('notification.destination.delete', params),
            listMembers: (
                params: HostParams<'notification.destination.listmembers'>
            ) => notify('notification.destination.listmembers', params),
            addMembers: (
                params: HostParams<'notification.destination.addmembers'>
            ) => notify('notification.destination.addmembers', params),
            removeMembers: (
                params: HostParams<'notification.destination.removemembers'>
            ) => notify('notification.destination.removemembers', params)
        },

        /** Which policy an alert matches, decided before any channel is picked. */
        routing: {
            list: (params: HostParams<'notification.routing.list'> = {}) =>
                notify('notification.routing.list', params),
            /** Create and update are the same call; omit policyId to create. */
            set: (params: HostParams<'notification.routing.set'>) =>
                notify('notification.routing.set', params),
            delete: (params: HostParams<'notification.routing.delete'>) =>
                notify('notification.routing.delete', params),
            /** Shows who would be paged without paging them. */
            evaluate: (params: HostParams<'notification.routing.evaluate'>) =>
                notify('notification.routing.evaluate', params)
        },

        /** Who is awake right now. A rota is only useful if you can ask it
         *  about a moment in time, which is what `resolve` does. */
        onCall: {
            list: (params: HostParams<'notification.oncall.list'> = {}) =>
                notify('notification.oncall.list', params),
            /** Create and update are the same call; omit scheduleId to create. */
            set: (params: HostParams<'notification.oncall.set'>) =>
                notify('notification.oncall.set', params),
            delete: (params: HostParams<'notification.oncall.delete'>) =>
                notify('notification.oncall.delete', params),
            resolve: (params: HostParams<'notification.oncall.resolve'>) =>
                notify('notification.oncall.resolve', params)
        },

        /** The signed-in user's quiet hours and severity filters. Without
         *  these, opting out means leaving the fleet entirely. */
        preferences: {
            list: (params: HostParams<'notification.preference.list'> = {}) =>
                notify('notification.preference.list', params),
            set: (params: HostParams<'notification.preference.set'>) =>
                notify('notification.preference.set', params)
        },

        /** Reusable bodies a rule or channel points at, so wording is changed
         *  in one place rather than copied into every rule. */
        templates: {
            list: (params: HostParams<'notification.template.list'> = {}) =>
                notify('notification.template.list', params),
            get: (params: HostParams<'notification.template.get'>) =>
                notify('notification.template.get', params),
            create: (params: HostParams<'notification.template.create'>) =>
                notify('notification.template.create', params),
            update: (params: HostParams<'notification.template.update'>) =>
                notify('notification.template.update', params),
            delete: (params: HostParams<'notification.template.delete'>) =>
                notify('notification.template.delete', params)
        },

        /** Email-only bodies. Kept apart from `templates` because the backend
         *  keeps them apart: these carry attachments, those carry blocks. */
        emailTemplates: {
            list: (
                params: HostParams<'notification.emailtemplate.list'> = {}
            ) => notify('notification.emailtemplate.list', params),
            get: (params: HostParams<'notification.emailtemplate.get'>) =>
                notify('notification.emailtemplate.get', params),
            create: (params: HostParams<'notification.emailtemplate.create'>) =>
                notify('notification.emailtemplate.create', params),
            update: (params: HostParams<'notification.emailtemplate.update'>) =>
                notify('notification.emailtemplate.update', params),
            delete: (params: HostParams<'notification.emailtemplate.delete'>) =>
                notify('notification.emailtemplate.delete', params)
        },

        /** Images an email body embeds. The bytes travel over HTTP, not RPC. */
        emailAssets: {
            list: (params: HostParams<'notification.emailasset.list'> = {}) =>
                notify('notification.emailasset.list', params),
            get: (params: HostParams<'notification.emailasset.get'>) =>
                notify('notification.emailasset.get', params),
            /** Short-lived ticket that authorizes the upload POST. */
            createUploadTicket: () =>
                notify('notification.emailasset.createuploadticket', {}),
            /** Anything still referencing the assetId will fail to send. */
            delete: (params: HostParams<'notification.emailasset.delete'>) =>
                notify('notification.emailasset.delete', params)
        },

        /** Renders against a real alert and reports missingTokens — the way a
         *  template finds out it wrote a token that never resolves. */
        renderTemplate: (params: HostParams<'notification.rendertemplate'>) =>
            notify('notification.rendertemplate', params),

        /** The whole email as it would be sent. The html is safe to iframe. */
        renderEmailPreview: (
            params: HostParams<'notification.renderemailpreview'> = {}
        ) => notify('notification.renderemailpreview', params),

        /** A whole notification setup, moved between installs or brought in
         *  from Grafana or Alertmanager. Everything here is dry-run but one. */
        bundle: {
            validate: (params: HostParams<'notification.bundle.validate'>) =>
                notify('notification.bundle.validate', params),
            planImport: (
                params: HostParams<'notification.bundle.planimport'>
            ) => notify('notification.bundle.planimport', params),
            /** The one that writes. Plan first; secrets are never carried. */
            applyImport: (
                params: HostParams<'notification.bundle.applyimport'>
            ) => notify('notification.bundle.applyimport', params),
            export: (params: HostParams<'notification.bundle.export'> = {}) =>
                notify('notification.bundle.export', params),
            importGrafana: (
                params: HostParams<'notification.bundle.importgrafana'>
            ) => notify('notification.bundle.importgrafana', params),
            importAlertmanager: (
                params: HostParams<'notification.bundle.importalertmanager'>
            ) => notify('notification.bundle.importalertmanager', params),
            exportGrafana: (
                params: HostParams<'notification.bundle.exportgrafana'>
            ) => notify('notification.bundle.exportgrafana', params),
            exportAlertmanager: (
                params: HostParams<'notification.bundle.exportalertmanager'>
            ) => notify('notification.bundle.exportalertmanager', params)
        },

        /** What was actually sent, and what happened to it. */
        history: {
            list: (params: HostParams<'notification.history.list'> = {}) =>
                notify('notification.history.list', params),
            /** The attempt trail — the only place a provider's refusal shows. */
            get: (params: HostParams<'notification.history.get'>) =>
                notify('notification.history.get', params),
            /** Re-sends one that failed, after the destination is fixed. */
            requeue: (params: HostParams<'notification.history.requeue'>) =>
                notify('notification.history.requeue', params)
        },

        /** The signed-in user's inbox. Readable AND clearable — an inbox that
         *  cannot be marked read grows until people stop looking at it. */
        inbox: {
            list: (params: HostParams<'notification.inbox.list'> = {}) =>
                notify('notification.inbox.list', params),
            get: (params: HostParams<'notification.inbox.get'>) =>
                notify('notification.inbox.get', params),
            markRead: (params: HostParams<'notification.inbox.markread'>) =>
                notify('notification.inbox.markread', params),
            markUnread: (params: HostParams<'notification.inbox.markunread'>) =>
                notify('notification.inbox.markunread', params),
            markAllRead: (
                params: HostParams<'notification.inbox.markallread'> = {}
            ) => notify('notification.inbox.markallread', params)
        },

        /** Registers a push token for the caller. Idempotent per token+user,
         *  so a template may call it on every start. */
        subscribe: (params: HostParams<'notification.subscribe'>) =>
            notify('notification.subscribe', params),

        /** Every push token, across every user — an admin view, not the
         *  caller's own. */
        listTokens: (params: HostParams<'notification.listtokens'> = {}) =>
            notify('notification.listtokens', params),

        /** Consent for an OAuth mailbox. Returns a URL to open; the refresh
         *  token lands on the channel and never passes through here. */
        oauthStart: (params: HostParams<'notification.oauth.start'>) =>
            notify('notification.oauth.start', params)
    };
}
