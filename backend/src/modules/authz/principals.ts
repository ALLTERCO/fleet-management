export type PrincipalKind = 'human_user' | 'service_user' | 'user_group';

export interface Principal {
    id: string;
    kind: PrincipalKind;
}

export function serviceUserPrincipal(userId: string): Principal {
    return {id: userId, kind: 'service_user'};
}

export function userGroupPrincipal(groupId: string): Principal {
    return {id: groupId, kind: 'user_group'};
}
