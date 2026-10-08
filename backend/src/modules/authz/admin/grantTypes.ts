// Leaf types for grant requests, importable from the user module without the writer's dependencies.
import type CommandSender from '../../../model/CommandSender';
import type {
    AssignmentGrantMetadata,
    AssignmentScope,
    AssignmentSubjectType
} from '../../../types/api/assignment';

export interface AttachablePersona {
    key: string;
    is_system_managed: boolean;
}

export interface AssignmentGrantRequest {
    tenantId: string;
    actorId: string;
    grantor: CommandSender;
    subjectType: AssignmentSubjectType;
    subjectId: string;
    personaId: string;
    scope: AssignmentScope;
    metadata?: AssignmentGrantMetadata;
    // Resolved from Zitadel metadata when omitted; never taken from the wire.
    subjectIsServiceUser?: boolean;
}
