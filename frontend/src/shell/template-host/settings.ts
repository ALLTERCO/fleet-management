import {createHostDomain} from './domain';

export const settings = {
    branding: createHostDomain('branding'),
    identity: createHostDomain('identity'),
    loginText: createHostDomain('login_text'),
    messageText: createHostDomain('message_text'),
    privacy: createHostDomain('privacy'),
    domainPolicy: createHostDomain('domain_policy')
};
