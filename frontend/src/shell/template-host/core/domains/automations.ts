// Automations: the things that act without anyone watching.
//
// An automation runs unattended on real hardware, so the two verbs that matter
// most are the ones for stopping it. `setEnabled(false)` stops one and keeps
// it, which is what you want at 3am when something misbehaves and nobody yet
// knows why. `delete` is final — Fleet Manager keeps no copy.
//
// `listEngines` comes first on purpose: which engine an install runs is not
// fixed, and offering to create on one that is not installed fails after the
// user has filled in the form.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type AutomationMethod = Extract<HostMethod, `automation.${string}`>;

export type FleetAutomationDomain = ReturnType<typeof createAutomationDomain>;

export function createAutomationDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<AutomationMethod>(access);

    return {
        /** What can run automations here, and what each engine can do. */
        engines: () => call('automation.listengines', {}),

        list: (params: HostParams<'automation.list'> = {}) =>
            call('automation.list', params),

        /** One automation as when/who/what. `editable:false` means it was
         *  built by hand and only its own editor can change it safely. */
        get: (params: HostParams<'automation.get'>) =>
            call('automation.get', params),

        /** Starts running as soon as it deploys. */
        create: (params: HostParams<'automation.create'>) =>
            call('automation.create', params),

        /** Anything omitted keeps what it had. */
        update: (params: HostParams<'automation.update'>) =>
            call('automation.update', params),

        /** Stop one without losing it. Reversible, and the right first move. */
        setEnabled: (params: HostParams<'automation.setenabled'>) =>
            call('automation.setenabled', params),

        /** Final. Prefer setEnabled(false) unless it is genuinely finished. */
        delete: (params: HostParams<'automation.delete'>) =>
            call('automation.delete', params)
    };
}
