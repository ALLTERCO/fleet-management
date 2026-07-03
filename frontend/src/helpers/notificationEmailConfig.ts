export interface EmailChannelConfigForm {
    mode: 'use_system_smtp' | 'custom_smtp';
    from: string;
    toAddresses: string;
    host: string;
    port: number;
    secure: boolean;
    authUser: string;
    authPass: string;
}

export function createEmailChannelConfigForm(): EmailChannelConfigForm {
    return {
        mode: 'custom_smtp',
        from: '',
        toAddresses: '',
        host: '',
        port: 587,
        secure: false,
        authUser: '',
        authPass: ''
    };
}

export function resetEmailChannelConfigForm(
    form: EmailChannelConfigForm
): void {
    Object.assign(form, createEmailChannelConfigForm());
}

export function buildEmailChannelConfig(
    form: EmailChannelConfigForm
): Record<string, unknown> {
    const config: Record<string, unknown> = {
        mode: form.mode,
        toAddresses: splitCsv(form.toAddresses)
    };
    if (form.mode === 'use_system_smtp') return config;
    config.from = form.from;
    const port = Number(form.port);
    if (form.host) config.host = form.host;
    if (Number.isFinite(port) && port > 0) config.port = port;
    config.secure = form.secure;
    if (form.authUser || form.authPass) {
        config.auth = {
            type: 'password',
            user: form.authUser,
            pass: form.authPass
        };
    }
    return config;
}

export function fillEmailChannelConfigForm(
    form: EmailChannelConfigForm,
    config: Record<string, unknown>
): void {
    form.mode =
        config.mode === 'custom_smtp' ? 'custom_smtp' : 'use_system_smtp';
    form.from = readConfigString(config.from);
    form.toAddresses = Array.isArray(config.toAddresses)
        ? config.toAddresses.join(', ')
        : '';
    form.host = readConfigString(config.host);
    form.port =
        typeof config.port === 'number' && config.port > 0 ? config.port : 587;
    form.secure = config.secure === true;
    const auth = readConfigObject(config.auth);
    form.authUser = readConfigString(auth.user);
    form.authPass = readConfigString(auth.pass);
}

function splitCsv(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function readConfigObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readConfigString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
