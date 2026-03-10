import nodemailer from 'nodemailer';
import type Mailer from 'nodemailer/lib/mailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import RpcError from '../../rpc/RpcError';
import Component from './Component';

type MailOptions = Parameters<InstanceType<typeof Mailer>['sendMail']>[0];
type CreateTransport = ReturnType<typeof nodemailer.createTransport>;

export interface MailComponentConfig {
    enable: boolean;
    transport?: SMTPTransport.Options;
}

function isSendMailParams(params: any) {
    return (
        params &&
        typeof params === 'object' &&
        typeof params.from === 'string' &&
        typeof params.to === 'string' &&
        typeof params.subject === 'string' &&
        typeof params.text === 'string' &&
        typeof params.html === 'string'
    );
}

export default class MailComponent extends Component<MailComponentConfig> {
    #transport?: CreateTransport;
    #verifyResponse: boolean | null;
    #verifyTs: number;
    #verifyError: Error | null;

    constructor() {
        super('mail');
        this.#verifyResponse = null;
        this.#verifyTs = 0;
        this.#verifyError = null;
    }

    @Component.Expose('Send')
    @Component.CheckParams(isSendMailParams)
    async sendMail(params: MailOptions) {
        if (!this.config.enable) {
            throw RpcError.MethodNotFound();
        }
        if (!this.#transport) {
            throw RpcError.Server('transport not set up');
        }

        const info = await this.#transport.sendMail(params);
        return info;
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
            this.#transport = nodemailer.createTransport(this.config.transport);
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
