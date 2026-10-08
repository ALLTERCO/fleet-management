// AI/MCP module — shared types.
//
// The identity an agent call runs as. It lives here rather than beside the
// operate flow because the approval store keys on it too, and a leaf type
// module is what keeps those two from importing each other.

/** Who the agent is acting as. Keys the audit trail and standing approvals. */
export interface OperateCaller {
    username: string;
    userId?: string;
    credentialId?: string;
    organizationId: string | null;
}
