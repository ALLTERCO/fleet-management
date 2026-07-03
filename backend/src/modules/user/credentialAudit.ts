import {
    type AuthzAuditEntry,
    authzAuditWriter,
    type CredentialAuditInput,
    credentialAuditEntry
} from '../authz/audit';

interface CredentialAuditDeps {
    writeCredentialEvent(input: CredentialAuditInput): Promise<void>;
}

const defaultDeps: CredentialAuditDeps = {
    writeCredentialEvent: (input) =>
        authzAuditWriter.writeCredentialEvent(input)
};

export {type AuthzAuditEntry, credentialAuditEntry};

export async function writeCredentialAudit(
    input: CredentialAuditInput,
    deps: CredentialAuditDeps = defaultDeps
): Promise<void> {
    await deps.writeCredentialEvent(input);
}
