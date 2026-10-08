// Letting a device in. Mint a token, hand a person the URL, watch it arrive.
//
// The raw method already existed and templates could already call it. What was
// missing is the SHAPE: `deviceingress.enrollmenttoken.create` returns an
// untyped object, so every template had to guess what a token looks like. One
// guessed `{token}` — the field is `tokenOnce` — and rather than fail, it
// rendered a fake token a person could copy into a real device.
//
// So this domain adds no capability. It names what exists and pins the reply,
// which is the only part that was ever missing.
//
// `tokenOnce` is the whole reason for the name: the backend shows the secret
// once and never again. A template that drops it has to mint another.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type EnrollmentMethod = Extract<HostMethod, `deviceingress.${string}`>;

/** What a device needs to connect, returned once and never repeated. */
export type EnrollmentTicket = {
    /** The address to give the device. Already carries the token. */
    url: string;
    /** The secret itself. Shown once — the backend cannot show it again. */
    tokenOnce: string;
    /** ISO timestamp. After this the token is refused. */
    expiresAt: string;
};

/** A way a device may connect, as this install supports it. */
export type EnrollmentProfile = {
    id: string;
    name: string;
    securityModel: string;
    transport: string;
    riskLevel: string;
};

export type FleetEnrollmentDomain = ReturnType<typeof createEnrollmentDomain>;

export function createEnrollmentDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<EnrollmentMethod>(access);

    return {
        /**
         * Which connection kinds this install supports.
         *
         * Ask before offering a choice: the list differs per deployment, and
         * offering one that is not installed fails at the device, in someone's
         * hands, on site.
         */
        async profiles(): Promise<EnrollmentProfile[]> {
            const res = (await call('deviceingress.profile.list', {})) as {
                items?: EnrollmentProfile[];
            };
            return res.items ?? [];
        },

        /**
         * Mints one. The reply carries the secret exactly once.
         *
         * `validityMinutes` is required and capped at a day by the backend —
         * a token that outlives the visit is a key left under the mat.
         */
        createToken(
            params: HostParams<'deviceingress.enrollmenttoken.create'>
        ): Promise<EnrollmentTicket> {
            return call(
                'deviceingress.enrollmenttoken.create',
                params
            ) as Promise<EnrollmentTicket>;
        },

        /** Outstanding tokens. Never includes a secret; only Create shows that. */
        tokens: () => call('deviceingress.enrollmenttoken.list', {}),

        /** Kills one before it expires, for a visit that ended early. */
        revoke: (params: HostParams<'deviceingress.enrollmenttoken.revoke'>) =>
            call('deviceingress.enrollmenttoken.revoke', params),

        /**
         * What this deployment actually accepts. Ask before offering a choice:
         * certificate is always false for Shelly WS.
         */
        authMethods: () => call('deviceingress.authmethods', {}),

        /** The lasting record of a thing let in. Tokens expire; this stays. */
        identities: {
            create: (params: HostParams<'deviceingress.identity.create'>) =>
                call('deviceingress.identity.create', params),
            get: (params: HostParams<'deviceingress.identity.get'>) =>
                call('deviceingress.identity.get', params),
            /** Display name and expected id only — the security model is fixed. */
            update: (params: HostParams<'deviceingress.identity.update'>) =>
                call('deviceingress.identity.update', params),
            /** Closes live sockets too, so the device drops off now, not later. */
            disable: (params: HostParams<'deviceingress.identity.disable'>) =>
                call('deviceingress.identity.disable', params),
            list: (params: HostParams<'deviceingress.identity.list'> = {}) =>
                call('deviceingress.identity.list', params)
        },

        /**
         * What an identity proves itself with. Rotation is two steps on purpose:
         * the device must connect on the new credential before the old one dies,
         * or a device nobody can reach is left holding a dead key.
         */
        credentials: {
            createToken: (
                params: HostParams<'deviceingress.credential.createtoken'>
            ) => call('deviceingress.credential.createtoken', params),
            rotate: (params: HostParams<'deviceingress.credential.rotate'>) =>
                call('deviceingress.credential.rotate', params),
            finalizeRotation: (
                params: HostParams<'deviceingress.credential.finalizerotation'>
            ) => call('deviceingress.credential.finalizerotation', params),
            cancelRotation: (
                params: HostParams<'deviceingress.credential.cancelrotation'>
            ) => call('deviceingress.credential.cancelrotation', params),
            revoke: (params: HostParams<'deviceingress.credential.revoke'>) =>
                call('deviceingress.credential.revoke', params)
        },

        /** Who connected, and who is connected right now. */
        connections: {
            list: (params: HostParams<'deviceingress.connection.list'> = {}) =>
                call('deviceingress.connection.list', params),
            get: (params: HostParams<'deviceingress.connection.get'>) =>
                call('deviceingress.connection.get', params),
            /** The device will retry unless its identity is disabled first. */
            disconnect: (
                params: HostParams<'deviceingress.connection.disconnect'>
            ) => call('deviceingress.connection.disconnect', params)
        },

        /** Refused attempts. `fixable` is the pile worth putting in front of
         *  someone; `blocked` is the pile that is refused on purpose. */
        rejections: {
            list: (params: HostParams<'deviceingress.rejection.list'> = {}) =>
                call('deviceingress.rejection.list', params),
            resolve: (params: HostParams<'deviceingress.rejection.resolve'>) =>
                call('deviceingress.rejection.resolve', params)
        },

        /**
         * Provisioning a device on site: plan it, fetch the bundle, report back.
         * The bundle carries `tokenOnce` as well, and is short-lived — plan and
         * fetch belong to the same visit.
         */
        setup: {
            plan: (params: HostParams<'deviceingress.setup.plan'>) =>
                call('deviceingress.setup.plan', params),
            bundle: (params: HostParams<'deviceingress.setup.bundle'>) =>
                call('deviceingress.setup.bundle', params),
            /** Report the outcome — an unreported session looks stuck forever. */
            reportApply: (
                params: HostParams<'deviceingress.setup.reportapply'>
            ) => call('deviceingress.setup.reportapply', params)
        }
    };
}
