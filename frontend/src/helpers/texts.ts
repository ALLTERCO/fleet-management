export function getTestEmail(from: string, to: string) {
    const text =
        'If you have received this mail, this means that the mail plugin in your Fleet Manager is configured correctly and working';

    return {
        from: `"Fleet Manager" <${from}>`,
        to: to,
        subject: 'Hello from Fleet Manager ✔',
        text: text,
        html: `<b>Mail Component Working</b><br><span>${text}</span>`
    };
}
