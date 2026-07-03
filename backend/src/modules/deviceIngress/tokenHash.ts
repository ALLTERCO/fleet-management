import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {envBool, envOptionalStr, envStr} from '../../config/envReader';
import {tuning} from '../../config/tuning';

// Public, well-known value usable ONLY in dev/test; using it in non-dev would
// let an attacker forge token hashes, so non-dev fails loud instead.
const DEFAULT_TEST_PEPPER = 'device-ingress-test-pepper';

export interface RawIngressToken {
    token: string;
    prefix: string;
}

export function createRawIngressToken(): RawIngressToken {
    const bytes = tuning.deviceIngress.tokenBytes;
    const prefix = tuning.deviceIngress.tokenPrefix;
    const secret = randomBytes(bytes).toString('base64url');
    return {
        token: `${prefix}_${secret}`,
        prefix: tokenPrefix(`${prefix}_${secret}`)
    };
}

export function hashIngressToken(token: string): string {
    return createHash('sha256')
        .update(`${tokenPepper()}:${token}`, 'utf8')
        .digest('hex');
}

export function tokenPrefix(token: string): string {
    return token.length <= 9 ? token : token.slice(0, 9);
}

export function verifyTokenHash(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(hashIngressToken(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}

function tokenPepper(): string {
    const pepper = envOptionalStr('FM_DEVICE_INGRESS_TOKEN_PEPPER');
    if (pepper) return pepper;
    if (requiresConfiguredPepper()) {
        throw new Error(
            'FM_DEVICE_INGRESS_TOKEN_PEPPER is required outside dev/test'
        );
    }
    return DEFAULT_TEST_PEPPER;
}

// Public fallback allowed only in dev/test; the production tuning flag is an
// added hard requirement. Evaluated at call time so tests can toggle the env.
function requiresConfiguredPepper(): boolean {
    if (tuning.deviceIngress.tokenPepperRequired) return true;
    return !isDevOrTest();
}

// Read at call time (NOT tuning.db.underNodeTest, which freezes at load) so a
// test can toggle NODE_TEST_CONTEXT to exercise the non-dev fail-loud path.
function isDevOrTest(): boolean {
    return (
        envBool('FM_DEV_MODE', false) ||
        envStr('NODE_TEST_CONTEXT', '').length > 0
    );
}
