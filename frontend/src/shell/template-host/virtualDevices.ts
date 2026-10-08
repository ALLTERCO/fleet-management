// The older names for the virtual-device surface, pointing at the one
// implementation.
//
// This file used to be a second, hand-written copy of the core domain: nine
// methods with two bodies each, one used by Fleet Manager and one by
// templates, drifting apart with every fix. The behaviour now lives only in
// core/domains/virtual-devices. `bindings` stays an object here because that
// is what every caller expects; in core the same group is `binding`, singular,
// matching the RPC.

import {hostRpcAccess} from './api';
import {createVirtualDeviceDomain} from './core/domains/virtual-devices';

const domain = createVirtualDeviceDomain(hostRpcAccess);

export const virtualDevices = {
    get: domain.get,
    list: domain.list,
    create: domain.create,
    update: domain.update,
    delete: domain.delete,
    extraction: domain.extraction,
    draft: domain.draft,
    command: domain.command,
    history: domain.history,
    manifest: domain.manifest,
    profiles: domain.profile,
    bindings: domain.binding,
    createImageUploadTicket: domain.image.createUploadTicket
};

// Types stay here: they are the published names, derived from the
// contract, and unrelated to which file owns the behaviour.
import type {HostMethod, HostParams, HostResult} from './generated/contract';

export type VirtualDeviceMethod = Extract<
    HostMethod,
    `virtualdevice.${string}`
>;

export type VirtualDeviceParams<TMethod extends VirtualDeviceMethod> =
    HostParams<TMethod>;

export type VirtualDeviceResult<TMethod extends VirtualDeviceMethod> =
    HostResult<TMethod>;
export type VirtualDeviceProfile =
    HostResult<'virtualdevice.profile.list'>['items'][number];
export type SourceComponentCandidate =
    HostResult<'virtualdevice.binding.listsources'>['items'][number];
export type SourceComponentRef =
    HostParams<'virtualdevice.binding.create'>['source'];
export type ExtractionPreview = HostResult<'virtualdevice.extraction.preview'>;
export type VirtualDeviceKind = HostParams<'virtualdevice.create'>['kind'];
export type VirtualDeviceVisual = NonNullable<
    HostParams<'virtualdevice.create'>['visual']
>;
export type CreateVirtualDeviceRequest = HostParams<'virtualdevice.create'>;
export type VirtualDeviceDto = HostResult<'virtualdevice.create'>;
export type BindingDraftItem =
    HostParams<'virtualdevice.draft.preview'>['bindings'][number];
export type DraftPreviewResponse = HostResult<'virtualdevice.draft.preview'>;
export type ValidationResult =
    HostResult<'virtualdevice.binding.validatedraft'>;
export type RoleVisual = NonNullable<BindingDraftItem['visual']>;
export type HistoryMode =
    HostResult<'virtualdevice.binding.list'>['items'][number]['mode'];
export type ProfileSuggestCandidate =
    HostResult<'virtualdevice.profile.suggestfromdevice'>['candidates'][number];
