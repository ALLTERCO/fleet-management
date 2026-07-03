import {canUsePlatformAdmin} from '../../modules/authz/evaluator';
import {
    createDirectEmailTransport,
    type DirectEmailTransport,
    type DirectEmailTransportOptions,
    type EmailMessage
} from '../../modules/email/EmailProvider';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {MAIL_DESCRIBE, MAIL_SEND_PARAMS_SCHEMA} from '../../types/api/mail';
import Component from './Component';

export interface MailComponentConfig {
    enable: boolean;
    transport?: DirectEmailTransportOptions;
}

export default class MailComponent extends Component<MailComponentConfig> {
    #transport?: DirectEmailTransport;
    #verifyResponse: boolean | null;
    #verifyTs: number;
    #verifyError: Error | null;

    constructor() {
        super('mail');
        this.#verifyResponse = null;
        this.#verifyTs = 0;
        this.#verifyError = null;
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return MAIL_DESCRIBE;
    }

    // Mail.Send uses instance-wide SMTP identity — provider support only.
    // Tenants use the org-scoped Notifications namespace for app email.
    @Component.Expose('Send')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async sendMail(params: unknown) {
        const v = validateOrThrow<EmailMessage>(
            params,
            MAIL_SEND_PARAMS_SCHEMA
        );
        if (!this.config.enable) {
            throw RpcError.MethodNotFound();
        }
        if (!this.#transport) {
            throw RpcError.Unavailable('mail_transport', 'not configured');
        }
        return await this.#transport.sendMail(v);
    }

    override getStatus() {
        return {
            verify: this.#verifyResponse,
            verifyTs: this.#verifyTs,
            verifyError: this.#verifyError
        };
    }

    protected override configChanged() {
        if (this.config.transport) {
            this.#transport = createDirectEmailTransport(this.config.transport);
            this.#transport
                .verify()
                .then(() => {
                    this.#verifyTs = Date.now();
                    this.#verifyError = null;
                    this.#verifyResponse = true;
                })
                .catch((error: Error) => {
                    this.#verifyTs = Date.now();
                    this.#verifyError = error;
                    this.#verifyResponse = false;
                });
        }
    }

    protected override checkConfigKey(key: string, value: any) {
        switch (key) {
            case 'enable':
                return typeof value === 'boolean';

            case 'transport':
                return value && typeof value === 'object';
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override getDefaultConfig() {
        return {enable: false};
    }
}
