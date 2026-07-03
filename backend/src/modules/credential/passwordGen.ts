// Random password + Shelly digest ha1 helper.

import {createHash, randomBytes} from 'node:crypto';
import {envInt, envStr} from '../../config/envReader';

const ALPHA_NUMERIC =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALPHA_NUMERIC_SYMBOLS = `${ALPHA_NUMERIC}!@#$%^&*()-_=+[]{};:,.<>?`;

function alphabet(): string {
    const which = envStr(
        'FM_CREDENTIAL_PASSWORD_ALPHABET',
        'alphanumeric_symbols'
    );
    return which === 'alphanumeric' ? ALPHA_NUMERIC : ALPHA_NUMERIC_SYMBOLS;
}

function passwordLength(): number {
    return envInt('FM_CREDENTIAL_PASSWORD_LENGTH', 32, 12);
}

export function generatePassword(): string {
    const a = alphabet();
    const len = passwordLength();
    // Rejection sampling: discard bytes that would introduce modulo bias
    // (256 % alphabetLength != 0). Alphabet lengths are 62 or 87 so the
    // discard rate is ~3% — negligible.
    const cutoff = Math.floor(256 / a.length) * a.length;
    let out = '';
    while (out.length < len) {
        const buf = randomBytes(len * 2);
        for (let i = 0; i < buf.length && out.length < len; i++) {
            if (buf[i] < cutoff) out += a[buf[i] % a.length];
        }
    }
    return out;
}

// Shelly digest ha1 = SHA256(username:realm:password)
export function computeHa1(
    username: string,
    realm: string,
    password: string
): string {
    return createHash('sha256')
        .update(`${username}:${realm}:${password}`, 'utf8')
        .digest('hex');
}
