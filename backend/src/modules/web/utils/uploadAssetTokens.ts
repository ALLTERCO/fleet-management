import crypto from 'node:crypto';
import {getJwtToken} from '../../../config/jwtSecret';
import type {UploadAssetKind} from './uploadAssetResolver';

interface UploadAssetTokenPayload {
    k: UploadAssetKind;
    p: string;
    exp: number;
}

function encode(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string | null {
    try {
        return Buffer.from(value, 'base64url').toString('utf8');
    } catch {
        return null;
    }
}

function mac(payload: string): string {
    return crypto
        .createHmac('sha256', getJwtToken())
        .update(payload)
        .digest('base64url');
}

function timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signUploadAssetPath(
    kind: UploadAssetKind,
    assetPath: string,
    ttlSec: number
): string {
    const payload: UploadAssetTokenPayload = {
        k: kind,
        p: assetPath,
        exp: Math.floor(Date.now() / 1000) + ttlSec
    };
    const encoded = encode(JSON.stringify(payload));
    return `${encoded}.${mac(encoded)}`;
}

export function verifyUploadAssetPath(
    kind: UploadAssetKind,
    assetPath: string,
    token: unknown
): boolean {
    if (typeof token !== 'string') return false;
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra !== undefined) return false;
    if (!timingSafeEqual(signature, mac(encoded))) return false;

    const raw = decode(encoded);
    if (!raw) return false;
    let payload: UploadAssetTokenPayload;
    try {
        payload = JSON.parse(raw) as UploadAssetTokenPayload;
    } catch {
        return false;
    }
    return (
        payload.k === kind &&
        payload.p === assetPath &&
        Number.isInteger(payload.exp) &&
        payload.exp >= Math.floor(Date.now() / 1000)
    );
}

export function appendUploadAssetToken(
    kind: UploadAssetKind,
    assetPath: string,
    ttlSec: number
): string {
    const token = signUploadAssetPath(kind, assetPath, ttlSec);
    return `${assetPath}?assetToken=${encodeURIComponent(token)}`;
}
