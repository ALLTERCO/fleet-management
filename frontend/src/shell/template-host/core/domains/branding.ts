// Logos, icons, fonts and mail templates for the organization.
//
// A template receives the ACTIVE branding through `customization` — that stays
// the one read path, so nothing here duplicates it. This domain is the admin
// side: changing what everyone then sees.
//
// `preview` before `activate` on purpose. Branding is the most visible thing
// in the product, and getting it wrong is seen by every user at once.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type BrandingMethod = Extract<HostMethod, `branding.${string}`>;

export type FleetBrandingDomain = ReturnType<typeof createBrandingDomain>;

export function createBrandingDomain(access: FleetRpcAccess) {
    const branding = namespaceCaller<BrandingMethod>(access);

    return {
        /** What a change would look like, before anyone else sees it. */
        preview: (params: HostParams<'branding.getpreview'>) =>
            branding('branding.getpreview', params),
        /** Makes the staged branding live for everyone. */
        activate: (params: HostParams<'branding.activate'>) =>
            branding('branding.activate', params),
        /** Back to the product default. */
        reset: (params: HostParams<'branding.reset'>) =>
            branding('branding.reset', params),
        defaults: (params: HostParams<'branding.getdefault'>) =>
            branding('branding.getdefault', params),
        /** What this deployment allows a tenant to change. */
        policy: (params: HostParams<'branding.getpolicy'>) =>
            branding('branding.getpolicy', params),
        /** Colours and theme for the login screen — the one surface a user
         *  sees before they are anyone. */
        setPolicy: (params: HostParams<'branding.setpolicy'>) =>
            branding('branding.setpolicy', params),
        assets: {
            setLogo: (params: HostParams<'branding.setlogo'>) =>
                branding('branding.setlogo', params),
            deleteLogo: (params: HostParams<'branding.deletelogo'>) =>
                branding('branding.deletelogo', params),
            setIcon: (params: HostParams<'branding.seticon'>) =>
                branding('branding.seticon', params),
            deleteIcon: (params: HostParams<'branding.deleteicon'>) =>
                branding('branding.deleteicon', params),
            setFont: (params: HostParams<'branding.setfont'>) =>
                branding('branding.setfont', params),
            deleteFont: (params: HostParams<'branding.deletefont'>) =>
                branding('branding.deletefont', params)
        },
        mailTemplate: {
            get: (params: HostParams<'branding.getmailtemplate'>) =>
                branding('branding.getmailtemplate', params),
            /** Takes effect on the next mail sent — there is no preview step
             *  here, so `get` and `reset` are the way back. */
            set: (params: HostParams<'branding.setmailtemplate'>) =>
                branding('branding.setmailtemplate', params),
            reset: (params: HostParams<'branding.resetmailtemplate'>) =>
                branding('branding.resetmailtemplate', params)
        }
    };
}

/** The reading half of branding: what it is now, and what it is by default. */
export type HostBrandingRead = {
    /** Colours and theme the organization shows today. */
    policy(
        params: HostParams<'branding.getpolicy'>
    ): Promise<HostResult<'branding.getpolicy'>>;
    /** The product's own defaults, to compare the live policy against. */
    defaults(
        params?: HostParams<'branding.getdefault'>
    ): Promise<HostResult<'branding.getdefault'>>;
    mailTemplate: {
        /** The mail scaffold as mail is sent with it today. */
        get(
            params: HostParams<'branding.getmailtemplate'>
        ): Promise<HostResult<'branding.getmailtemplate'>>;
    };
};

// `preview` is left out: it reads a draft only `activate` can publish.
/** Narrows the admin domain to its reads, for a template that only shows it. */
export function createBrandingReadView(
    domain: FleetBrandingDomain
): HostBrandingRead {
    return {
        policy: (params) => domain.policy(params),
        defaults: (params = {}) => domain.defaults(params),
        mailTemplate: {get: (params) => domain.mailTemplate.get(params)}
    };
}
