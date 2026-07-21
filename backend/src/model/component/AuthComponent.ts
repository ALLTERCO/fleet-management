import {mintScopedToken} from '../../modules/auth/scopedTokenRepo';
import {
    classifyByCode,
    recordOutcome,
    withOutcomeCounter
} from '../../modules/rpcOutcomeCounter';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {DescribeOutput} from '../../types/api/_describe';
import {
    AUTH_DESCRIBE,
    AUTH_MINT_SCOPED_TOKEN_PARAMS_SCHEMA,
    type AuthMintScopedTokenParams,
    type AuthMintScopedTokenResult
} from '../../types/api/auth';
import {DOMAIN_ERRORS} from '../../types/api/errors';
import type CommandSender from '../CommandSender';
import Component from './Component';

interface Config {
    viewer_visible: boolean;
}

const DEFAULT_TTL_SEC = 300;
const MAX_TTL_SEC = 1800;

const MINT_METRIC = 'auth_mint_scoped_token_total';
const UNAUTHORIZED_CODE = -32000;
const INVALID_PARAMS_CODE = -32602;

function rejectIfBoundedPat(sender: CommandSender): void {
    if (!sender.hasCredentialBoundary()) return;
    recordOutcome(MINT_METRIC, 'bounded_pat_rejected');
    throw RpcError.Unauthorized();
}

function rejectIfUnauthenticated(sender: CommandSender): string {
    const actorId = sender.getUserId();
    if (!actorId) throw RpcError.Unauthorized();
    return actorId;
}

// Map only known RpcError shapes; anything else (PG outage, network) lands
// as 'error' so oncall is not misled by an 'unauthorized' label.
const MINT_OUTCOME_BY_CODE: Record<number, string> = {
    [UNAUTHORIZED_CODE]: 'unauthorized',
    [DOMAIN_ERRORS.OrgScopeRequired.code]: 'unauthorized',
    [INVALID_PARAMS_CODE]: 'invalid_params'
};

const classifyMint = classifyByCode(MINT_OUTCOME_BY_CODE);

export default class AuthComponent extends Component<Config> {
    constructor() {
        super('auth', {viewer_visible: false});
    }

    protected override getDefaultConfig(): Config {
        return {viewer_visible: false};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return AUTH_DESCRIBE;
    }

    // requireOrganizationId() throws Unauthorized when the caller has no orgId;
    // the issued token then inherits the caller's existing rights at consume-time.
    @Component.Expose('MintScopedToken')
    @Component.NoPermissions
    async mintScopedToken(
        params: unknown,
        sender: CommandSender
    ): Promise<AuthMintScopedTokenResult> {
        const p = validateOrThrow<AuthMintScopedTokenParams>(
            params,
            AUTH_MINT_SCOPED_TOKEN_PARAMS_SCHEMA
        );
        // Pre-check increments its own outcome before the helper sees the throw,
        // because every other failure path here is indistinguishable as
        // RpcError.Unauthorized.
        rejectIfBoundedPat(sender);
        return withOutcomeCounter({
            metric: MINT_METRIC,
            classify: classifyMint,
            run: () => this.#mintAuthorized(p, sender)
        });
    }

    async #mintAuthorized(
        p: AuthMintScopedTokenParams,
        sender: CommandSender
    ): Promise<AuthMintScopedTokenResult> {
        const organizationId = requireOrganizationId(sender, p);
        const actorId = rejectIfUnauthenticated(sender);
        const ttlSec = Math.min(p.ttlSec ?? DEFAULT_TTL_SEC, MAX_TTL_SEC);
        return mintScopedToken({
            organizationId,
            issuedBy: actorId,
            purpose: p.purpose,
            ttlSeconds: ttlSec
        });
    }
}
