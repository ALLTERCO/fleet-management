import type {HostMethod, HostParams, HostResult} from './generated/contract';
import {callMethod} from './typed';

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

function callVirtual<TMethod extends VirtualDeviceMethod>(
    method: TMethod,
    params: VirtualDeviceParams<TMethod>
): Promise<VirtualDeviceResult<TMethod>> {
    return callMethod(method, params);
}

export const virtualDevices = {
    create(input: VirtualDeviceParams<'virtualdevice.create'>) {
        return callVirtual('virtualdevice.create', input);
    },
    get(input: VirtualDeviceParams<'virtualdevice.get'>) {
        return callVirtual('virtualdevice.get', input);
    },
    list(input: VirtualDeviceParams<'virtualdevice.list'> = {}) {
        return callVirtual('virtualdevice.list', input);
    },
    update(input: VirtualDeviceParams<'virtualdevice.update'>) {
        return callVirtual('virtualdevice.update', input);
    },
    delete(input: VirtualDeviceParams<'virtualdevice.delete'>) {
        return callVirtual('virtualdevice.delete', input);
    },
    createImageUploadTicket(
        input: VirtualDeviceParams<'virtualdevice.image.createuploadticket'>
    ) {
        return callVirtual('virtualdevice.image.createuploadticket', input);
    },
    extraction: {
        preview(
            input: VirtualDeviceParams<'virtualdevice.extraction.preview'>
        ) {
            return callVirtual('virtualdevice.extraction.preview', input);
        },
        create(input: VirtualDeviceParams<'virtualdevice.extraction.create'>) {
            return callVirtual('virtualdevice.extraction.create', input);
        },
        replacementPreview(
            input: VirtualDeviceParams<'virtualdevice.extraction.replacementpreview'>
        ) {
            return callVirtual(
                'virtualdevice.extraction.replacementpreview',
                input
            );
        }
    },
    profiles: {
        list(input: VirtualDeviceParams<'virtualdevice.profile.list'> = {}) {
            return callVirtual('virtualdevice.profile.list', input);
        },
        create(input: VirtualDeviceParams<'virtualdevice.profile.create'>) {
            return callVirtual('virtualdevice.profile.create', input);
        },
        update(input: VirtualDeviceParams<'virtualdevice.profile.update'>) {
            return callVirtual('virtualdevice.profile.update', input);
        },
        validate(input: VirtualDeviceParams<'virtualdevice.profile.validate'>) {
            return callVirtual('virtualdevice.profile.validate', input);
        },
        matchSources(
            input: VirtualDeviceParams<'virtualdevice.profile.matchsources'>
        ) {
            return callVirtual('virtualdevice.profile.matchsources', input);
        },
        suggestFromDevice(
            input: VirtualDeviceParams<'virtualdevice.profile.suggestfromdevice'>
        ) {
            return callVirtual(
                'virtualdevice.profile.suggestfromdevice',
                input
            );
        }
    },
    bindings: {
        list(input: VirtualDeviceParams<'virtualdevice.binding.list'>) {
            return callVirtual('virtualdevice.binding.list', input);
        },
        listSources(
            input: VirtualDeviceParams<'virtualdevice.binding.listsources'> = {}
        ) {
            return callVirtual('virtualdevice.binding.listsources', input);
        },
        validateDraft(
            input: VirtualDeviceParams<'virtualdevice.binding.validatedraft'>
        ) {
            return callVirtual('virtualdevice.binding.validatedraft', input);
        },
        create(input: VirtualDeviceParams<'virtualdevice.binding.create'>) {
            return callVirtual('virtualdevice.binding.create', input);
        },
        replace(input: VirtualDeviceParams<'virtualdevice.binding.replace'>) {
            return callVirtual('virtualdevice.binding.replace', input);
        },
        retire(input: VirtualDeviceParams<'virtualdevice.binding.retire'>) {
            return callVirtual('virtualdevice.binding.retire', input);
        },
        replacementReport(
            input: VirtualDeviceParams<'virtualdevice.binding.replacementreport'>
        ) {
            return callVirtual(
                'virtualdevice.binding.replacementreport',
                input
            );
        }
    },
    draft: {
        preview(input: VirtualDeviceParams<'virtualdevice.draft.preview'>) {
            return callVirtual('virtualdevice.draft.preview', input);
        }
    },
    command: {
        invoke(input: VirtualDeviceParams<'virtualdevice.command.invoke'>) {
            return callVirtual('virtualdevice.command.invoke', input);
        }
    },
    history: {
        readRole(input: VirtualDeviceParams<'virtualdevice.history.readrole'>) {
            return callVirtual('virtualdevice.history.readrole', input);
        },
        readProvenance(
            input: VirtualDeviceParams<'virtualdevice.history.readprovenance'>
        ) {
            return callVirtual('virtualdevice.history.readprovenance', input);
        },
        backfill(input: VirtualDeviceParams<'virtualdevice.history.backfill'>) {
            return callVirtual('virtualdevice.history.backfill', input);
        }
    },
    manifest: {
        validate(
            input: VirtualDeviceParams<'virtualdevice.manifest.validate'>
        ) {
            return callVirtual('virtualdevice.manifest.validate', input);
        },
        export(input: VirtualDeviceParams<'virtualdevice.manifest.export'>) {
            return callVirtual('virtualdevice.manifest.export', input);
        },
        plan(input: VirtualDeviceParams<'virtualdevice.manifest.plan'>) {
            return callVirtual('virtualdevice.manifest.plan', input);
        },
        apply(input: VirtualDeviceParams<'virtualdevice.manifest.apply'>) {
            return callVirtual('virtualdevice.manifest.apply', input);
        }
    }
};
