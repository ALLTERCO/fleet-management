// Shared Twilio REST call. Both the SMS and Voice adapters POST a
// form-encoded body to /Accounts/<sid>/<resource> with Basic auth and the
// same ok/error handling — only the resource and form fields differ.

const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts';
const FETCH_TIMEOUT_MS = 30_000;

export interface TwilioPostResult {
    success: boolean;
    /** Message/Call SID on success. */
    sid?: string;
    retryable?: boolean;
    errorMessage?: string;
    httpStatus: number;
}

export async function twilioPost(opts: {
    accountSid: string;
    authToken: string;
    resource: 'Messages.json' | 'Calls.json';
    form: Record<string, string>;
}): Promise<TwilioPostResult> {
    const url = `${TWILIO_API}/${opts.accountSid}/${opts.resource}`;
    const auth =
        'Basic ' +
        Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: auth,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(opts.form).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {sid?: string};
        return {success: true, sid: data.sid, httpStatus: res.status};
    }
    const text = await res.text().catch(() => '');
    return {
        success: false,
        retryable: res.status >= 500 || res.status === 429,
        errorMessage: `twilio ${res.status}: ${text.slice(0, 200)}`,
        httpStatus: res.status
    };
}
