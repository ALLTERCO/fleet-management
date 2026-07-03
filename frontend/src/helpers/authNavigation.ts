type LoginRedirectHandler = () => Promise<void>;

let loginRedirectHandler: LoginRedirectHandler | undefined;

export function setLoginRedirectHandler(handler: LoginRedirectHandler): void {
    loginRedirectHandler = handler;
}

export async function redirectToLogin(): Promise<void> {
    await loginRedirectHandler?.();
}
