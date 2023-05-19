import Transport from "./Transport";

import log4js from "log4js";
const logger = log4js.getLogger();

export default class LocalNetworkTransport extends Transport {
    #deviceIp: string;

    constructor(deviceIp: string) {
        super();
        this.#deviceIp = deviceIp;
    }

    protected _sendRPC(params: string): void {
        fetch(`http://${this.#deviceIp}/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: params
        })
        .then(res => res.json()).then(message => {
            this.parseMessage(JSON.stringify(message))
        })
        .catch(error => logger.error("Failed to send rpc to ip=[%s]", this.#deviceIp, error.message))

    }
    public destroy(): void {
        // do nothing
    }

}