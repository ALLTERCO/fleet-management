// Single SoT for Zitadel event/target names FM depends on.

export const ZITADEL_USER_EVENTS = {
    humanAdded: 'user.human.added',
    humanRemoved: 'user.removed',
    machineAdded: 'user.machine.added',
    patAdded: 'user.pat.added',
    patRemoved: 'user.pat.removed',
    grantAdded: 'user.grant.added',
    grantChanged: 'user.grant.changed',
    grantRemoved: 'user.grant.removed',
    grantCascadeRemoved: 'user.grant.cascade.removed',
    passwordChanged: 'user.human.password.changed',
    passwordCheckSucceeded: 'user.human.password.check.succeeded',
    passwordCheckFailed: 'user.human.password.check.failed'
} as const;

export const ZITADEL_ORG_EVENTS = {
    added: 'org.added',
    removed: 'org.removed',
    domainAdded: 'org.domain.added',
    domainVerified: 'org.domain.verified',
    domainPrimarySet: 'org.domain.primary.set',
    memberAdded: 'org.member.added',
    memberRemoved: 'org.member.removed'
} as const;

export const ZITADEL_PROJECT_EVENTS = {
    added: 'project.added',
    removed: 'project.removed',
    applicationAdded: 'project.application.added',
    oidcConfigAdded: 'project.application.config.oidc.added',
    oidcConfigChanged: 'project.application.config.oidc.changed',
    roleAdded: 'project.role.added'
} as const;

export const ZITADEL_SESSION_EVENTS = {
    oidcSessionAdded: 'oidc_session.added',
    oidcAccessTokenAdded: 'oidc_session.access_token.added',
    sessionAdded: 'session.added'
} as const;

// Action V2 target name suffixes (applied to ZITADEL_PROJECT_NAME).
export const ZITADEL_TARGET_SUFFIXES = {
    userRemoved: '-user-removed',
    grantRemoved: '-grant-removed'
} as const;

export const ZITADEL_ACTION_BINDINGS = [
    {
        event: ZITADEL_USER_EVENTS.humanRemoved,
        target: 'userRemoved'
    },
    {
        event: ZITADEL_USER_EVENTS.grantChanged,
        target: 'grantRemoved'
    },
    {
        event: ZITADEL_USER_EVENTS.grantRemoved,
        target: 'grantRemoved'
    },
    {
        event: ZITADEL_USER_EVENTS.grantCascadeRemoved,
        target: 'grantRemoved'
    }
] as const;
