// Personas, scoped assignments, and organization role grants.
//
// Fleet remains the authorization owner. This domain only exposes the typed
// contract; templates never resolve permissions or scopes themselves.

import type {HostMethod, HostParams} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type PersonaMethod = Extract<HostMethod, `persona.${string}`>;
type AssignmentMethod = Extract<HostMethod, `assignment.${string}`>;
type PermissionMethod = Extract<HostMethod, `permission.${string}`>;

export type FleetAuthorizationDomain = ReturnType<
    typeof createAuthorizationDomain
>;

export function createAuthorizationDomain(access: FleetRpcAccess) {
    const persona = namespaceCaller<PersonaMethod>(access);
    const assignment = namespaceCaller<AssignmentMethod>(access);
    const permission = namespaceCaller<PermissionMethod>(access);

    return {
        personas: {
            list: (params: HostParams<'persona.list'> = {}) =>
                persona('persona.list', params)
        },
        assignments: {
            listForSubject: (
                params: HostParams<'assignment.listforsubject'>
            ) => assignment('assignment.listforsubject', params),
            listForPersona: (
                params: HostParams<'assignment.listforpersona'>
            ) => assignment('assignment.listforpersona', params),
            create: (params: HostParams<'assignment.create'>) =>
                assignment('assignment.create', params),
            delete: (params: HostParams<'assignment.delete'>) =>
                assignment('assignment.delete', params)
        },
        roles: {
            get: (params: HostParams<'permission.getroles'>) =>
                permission('permission.getroles', params),
            grant: (params: HostParams<'permission.grantroles'>) =>
                permission('permission.grantroles', params),
            revoke: (params: HostParams<'permission.revokeroles'>) =>
                permission('permission.revokeroles', params)
        }
    };
}
