import {createHash} from 'node:crypto';
import nodemailer, {type Transporter} from 'nodemailer';
import type Mailer from 'nodemailer/lib/mailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import {
    getOrCreateTransporter,
    invalidateTransporter
} from '../delivery/transporterPool';

export type EmailMessage = Parameters<
    InstanceType<typeof Mailer>['sendMail']
>[0];
export type DirectEmailTransportOptions = SMTPTransport.Options;
export type DirectEmailTransport = Transporter;

export type PooledEmailTransportConfig = SMTPTransport.Options & {
    dkim?: unknown;
};

export function createDirectEmailTransport(
    options: DirectEmailTransportOptions
): DirectEmailTransport {
    return nodemailer.createTransport(options);
}

export async function verifyPooledEmailTransport(
    config: PooledEmailTransportConfig
): Promise<void> {
    const {transporter, key} = acquirePooledTransport(config);
    try {
        await transporter.verify();
    } catch (err) {
        invalidateOnTransportError(key, err);
        throw err;
    }
}

export interface PooledEmailSendResult {
    messageId?: string | null;
    /** Recipients the server accepted / rejected. A non-empty `rejected`
     *  with an empty `accepted` is a full bounce the SMTP adapter must
     *  surface instead of reporting success. */
    accepted: string[];
    rejected: string[];
    response?: string;
}

export async function sendPooledEmail(
    config: PooledEmailTransportConfig,
    message: EmailMessage
): Promise<PooledEmailSendResult> {
    const {transporter, key} = acquirePooledTransport(config);
    try {
        const info = (await transporter.sendMail(
            message
        )) as SMTPTransport.SentMessageInfo;
        return {
            messageId: info.messageId,
            accepted: toAddressList(info.accepted),
            rejected: toAddressList(info.rejected),
            response: info.response
        };
    } catch (err) {
        invalidateOnTransportError(key, err);
        throw err;
    }
}

// nodemailer reports accepted/rejected as string | {address} entries.
function toAddressList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) =>
            typeof entry === 'string'
                ? entry
                : entry && typeof entry === 'object' && 'address' in entry
                  ? String((entry as {address: unknown}).address)
                  : ''
        )
        .filter(Boolean);
}

function acquirePooledTransport(config: PooledEmailTransportConfig): {
    transporter: DirectEmailTransport;
    key: string;
} {
    const key = poolKey(config);
    const transporter = getOrCreateTransporter(key, () =>
        nodemailer.createTransport(config as SMTPTransport.Options)
    );
    return {transporter, key};
}

function poolKey(config: PooledEmailTransportConfig): string {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

function invalidateOnTransportError(key: string, err: unknown): void {
    if (isTransportError(err)) invalidateTransporter(key);
}

const TRANSPORT_ERR_CODES = new Set([
    'EAUTH',
    'ECONNECTION',
    'ECONNRESET',
    'ETIMEDOUT',
    'ESOCKET',
    'EDNS'
]);

function isTransportError(err: unknown): boolean {
    const code = (err as {code?: unknown})?.code;
    return typeof code === 'string' && TRANSPORT_ERR_CODES.has(code);
}
