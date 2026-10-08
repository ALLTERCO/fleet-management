// Curated custom-device namespace over the generated Fleet contract.
//
// A virtual device is a record plus its bindings: the record says what the
// thing is, each binding says which real component feeds one of its roles.
// Writes carry `expectedRevision`, so read before you write or lose the race.
//
// BLU devices live in `bluetooth-devices` — the `virtualdevice.bluetooth.*`
// half of this namespace is theirs, not this file's.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type VirtualDeviceMethod = Extract<HostMethod, `virtualdevice.${string}`>;

export type FleetVirtualDeviceDomain = ReturnType<
    typeof createVirtualDeviceDomain
>;

export function createVirtualDeviceDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<VirtualDeviceMethod>(access);

    return {
        get: (params: HostParams<'virtualdevice.get'>) =>
            call('virtualdevice.get', params),
        list: (params: HostParams<'virtualdevice.list'> = {}) =>
            call('virtualdevice.list', params),
        create: (params: HostParams<'virtualdevice.create'>) =>
            call('virtualdevice.create', params),
        update: (params: HostParams<'virtualdevice.update'>) =>
            call('virtualdevice.update', params),
        /** Tombstones by default; `retention: 'purge'` hard-deletes the row. */
        delete: (params: HostParams<'virtualdevice.delete'>) =>
            call('virtualdevice.delete', params),

        /** The bindings of one device. Predates the `binding` group below and
         *  templates call it, so it stays a function under this name. */
        bindings: (params: HostParams<'virtualdevice.binding.list'>) =>
            call('virtualdevice.binding.list', params),

        extraction: {
            preview: (params: HostParams<'virtualdevice.extraction.preview'>) =>
                call('virtualdevice.extraction.preview', params),
            create: (params: HostParams<'virtualdevice.extraction.create'>) =>
                call('virtualdevice.extraction.create', params),
            replacementPreview: (
                params: HostParams<'virtualdevice.extraction.replacementpreview'>
            ) => call('virtualdevice.extraction.replacementpreview', params)
        },

        /** The shape a device promises: its roles, and what each one means. */
        profile: {
            list: (params: HostParams<'virtualdevice.profile.list'> = {}) =>
                call('virtualdevice.profile.list', params),
            create: (params: HostParams<'virtualdevice.profile.create'>) =>
                call('virtualdevice.profile.create', params),
            update: (params: HostParams<'virtualdevice.profile.update'>) =>
                call('virtualdevice.profile.update', params),
            /** Checks the roles before they are stored, not after. */
            validate: (params: HostParams<'virtualdevice.profile.validate'>) =>
                call('virtualdevice.profile.validate', params),
            matchSources: (
                params: HostParams<'virtualdevice.profile.matchsources'> = {}
            ) => call('virtualdevice.profile.matchsources', params),
            suggestFromDevice: (
                params: HostParams<'virtualdevice.profile.suggestfromdevice'>
            ) => call('virtualdevice.profile.suggestfromdevice', params)
        },

        /** One role, one real component. Singular to match the RPC. */
        binding: {
            list: (params: HostParams<'virtualdevice.binding.list'>) =>
                call('virtualdevice.binding.list', params),
            /** What is available to bind. Ask before offering a choice. */
            listSources: (
                params: HostParams<'virtualdevice.binding.listsources'> = {}
            ) => call('virtualdevice.binding.listsources', params),
            validateDraft: (
                params: HostParams<'virtualdevice.binding.validatedraft'>
            ) => call('virtualdevice.binding.validatedraft', params),
            create: (params: HostParams<'virtualdevice.binding.create'>) =>
                call('virtualdevice.binding.create', params),
            /** Swaps the source and keeps the role's history continuous. */
            replace: (params: HostParams<'virtualdevice.binding.replace'>) =>
                call('virtualdevice.binding.replace', params),
            retire: (params: HostParams<'virtualdevice.binding.retire'>) =>
                call('virtualdevice.binding.retire', params),
            replacementReport: (
                params: HostParams<'virtualdevice.binding.replacementreport'>
            ) => call('virtualdevice.binding.replacementreport', params)
        },

        /** Device and bindings together, before either exists. */
        draft: {
            preview: (params: HostParams<'virtualdevice.draft.preview'>) =>
                call('virtualdevice.draft.preview', params)
        },

        command: {
            invoke: (params: HostParams<'virtualdevice.command.invoke'>) =>
                call('virtualdevice.command.invoke', params)
        },

        history: {
            readRole: (params: HostParams<'virtualdevice.history.readrole'>) =>
                call('virtualdevice.history.readrole', params),
            readProvenance: (
                params: HostParams<'virtualdevice.history.readprovenance'>
            ) => call('virtualdevice.history.readprovenance', params),
            backfill: (params: HostParams<'virtualdevice.history.backfill'>) =>
                call('virtualdevice.history.backfill', params)
        },

        /** Whole bundles of profiles and devices, moved between installs.
         *  `plan` shows what `apply` would change — run it first. */
        manifest: {
            validate: (params: HostParams<'virtualdevice.manifest.validate'>) =>
                call('virtualdevice.manifest.validate', params),
            export: (
                params: HostParams<'virtualdevice.manifest.export'> = {}
            ) => call('virtualdevice.manifest.export', params),
            plan: (params: HostParams<'virtualdevice.manifest.plan'>) =>
                call('virtualdevice.manifest.plan', params),
            apply: (params: HostParams<'virtualdevice.manifest.apply'>) =>
                call('virtualdevice.manifest.apply', params)
        },

        /** Upload goes to the ticket's URL, not through RPC. */
        image: {
            createUploadTicket: (
                params: HostParams<'virtualdevice.image.createuploadticket'>
            ) => call('virtualdevice.image.createuploadticket', params)
        }
    };
}
