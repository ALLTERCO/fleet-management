export interface ServiceUserIdentityLabelInput {
    name?: string;
    userName?: string;
}

export const SERVICE_USER_CREDENTIAL_MODE = Object.freeze({
    interactiveSignInDisabled: true,
    signInLabel: 'Disabled',
    signInTitle: 'Interactive sign-in disabled',
    hint: 'Service users are machine identities. They use API tokens and cannot sign in to the browser UI.',
    patNote:
        'Tokens authorize API calls only; they do not enable browser sign-in.'
});

export const SERVICE_USER_TOKEN_MODEL = Object.freeze({
    modalTitle: 'Generate service-user token',
    zitadelTitle: 'Zitadel personal access token',
    zitadelListTitle: 'Zitadel personal access tokens',
    zitadelDescription:
        "Identity credential issued by Zitadel. It uses this service user's full effective FM access.",
    scopedTitle: 'FM scoped token',
    scopedListTitle: 'FM scoped tokens',
    scopedDescription:
        "FM-issued credential. It can only narrow this service user's effective access.",
    scopedToggleTitle: 'Create FM scoped token',
    scopedToggleHint:
        'Use this when automation should access only selected dashboards, devices, groups, locations, tags, or plugins.',
    fullAccessMode:
        'Create a Zitadel PAT when the automation should use the full effective access already assigned to this service user.'
});

export function serviceUserIdentityLabel(
    input: ServiceUserIdentityLabelInput | null | undefined
): string {
    if (!input) return 'service user';
    const name = input.name?.trim();
    const userName = input.userName?.trim();
    if (name && userName && name !== userName) return `${name} (${userName})`;
    return name || userName || 'service user';
}
