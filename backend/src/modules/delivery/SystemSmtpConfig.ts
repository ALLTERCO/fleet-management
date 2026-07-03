import {
    envBoolRequired,
    envIntRequired,
    envOptionalStr,
    envStrRequired
} from '../../config/envReader';

export interface SystemSmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    from: string;
    fromName?: string;
    auth?: {
        type: 'password';
        user: string;
        pass: string;
    };
}

export function resolveSystemNotificationSmtpConfig(): SystemSmtpConfig {
    const auth = resolveSystemSmtpAuth();
    return {
        host: envStrRequired('FM_NOTIFICATION_SMTP_HOST'),
        port: envIntRequired('FM_NOTIFICATION_SMTP_PORT'),
        secure: envBoolRequired('FM_NOTIFICATION_SMTP_SECURE'),
        from: envStrRequired('FM_NOTIFICATION_SMTP_FROM'),
        fromName: envOptionalStr('FM_NOTIFICATION_SMTP_FROM_NAME'),
        ...(auth ? {auth} : {})
    };
}

function resolveSystemSmtpAuth(): SystemSmtpConfig['auth'] {
    const user = envOptionalStr('FM_NOTIFICATION_SMTP_USER');
    const pass = envOptionalStr('FM_NOTIFICATION_SMTP_PASSWORD');
    if (!user && !pass) return undefined;
    if (!user || !pass) {
        throw new Error(
            'FM_NOTIFICATION_SMTP_USER and FM_NOTIFICATION_SMTP_PASSWORD must be set together'
        );
    }
    return {type: 'password', user, pass};
}
