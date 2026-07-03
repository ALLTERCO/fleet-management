import {describe, expect, it, vi} from 'vitest';

const {sendRPC} = vi.hoisted(() => ({sendRPC: vi.fn()}));
vi.mock('@/tools/websocket', () => ({sendRPC}));

import {AssetUploadError, listAssets, uploadAsset} from '@/api/assetRpc';

describe('assetRpc', () => {
    it('listAssets forwards options to asset.List', async () => {
        sendRPC.mockResolvedValueOnce({items: [], nextCursor: null});
        await listAssets({context: 'device', limit: 50});
        expect(sendRPC).toHaveBeenCalledWith('FLEET_MANAGER', 'asset.List', {
            context: 'device',
            limit: 50
        });
    });

    it('uploadAsset throws AssetUploadError on non-2xx with parsed JSON error', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({error: 'File too big'}), {
                status: 413,
                headers: {'content-type': 'application/json'}
            })
        ) as never;
        try {
            await uploadAsset(
                new File([new Uint8Array([1, 2, 3])], 'x.png'),
                null
            );
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(AssetUploadError);
            expect((err as AssetUploadError).status).toBe(413);
            expect((err as AssetUploadError).detail).toBe('File too big');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('uploadAsset falls back to status text when body is empty', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValueOnce(
            new Response('', {
                status: 500,
                statusText: 'Internal Server Error'
            })
        ) as never;
        try {
            await uploadAsset(new File([new Uint8Array([1])], 'x.png'), null);
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(AssetUploadError);
            expect((err as AssetUploadError).status).toBe(500);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('uploadAsset includes context in multipart body when provided', async () => {
        const realFetch = globalThis.fetch;
        let captured: FormData | null = null;
        globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
            captured = init?.body as FormData;
            return new Response(
                JSON.stringify({
                    id: 'a1',
                    url: '/api/assets/a1',
                    sha256: 'x',
                    contentType: 'image/png',
                    sizeBytes: 1,
                    label: null,
                    uploadedBy: null,
                    context: 'device',
                    created: ''
                }),
                {status: 200, headers: {'content-type': 'application/json'}}
            );
        }) as never;
        try {
            await uploadAsset(
                new File([new Uint8Array([1])], 'x.png'),
                'My icon',
                'device'
            );
            expect(captured).not.toBeNull();
            expect(captured?.get('label')).toBe('My icon');
            expect(captured?.get('context')).toBe('device');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('uploadAsset includes scoped ticket fields when provided', async () => {
        const realFetch = globalThis.fetch;
        let captured: FormData | null = null;
        globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
            captured = init?.body as FormData;
            return new Response(
                JSON.stringify({
                    id: 'a1',
                    url: '/api/assets/a1',
                    sha256: 'x',
                    contentType: 'image/png',
                    sizeBytes: 1,
                    label: null,
                    uploadedBy: null,
                    context: 'device',
                    created: ''
                }),
                {status: 200, headers: {'content-type': 'application/json'}}
            );
        }) as never;
        try {
            await uploadAsset(
                new File([new Uint8Array([1])], 'x.png'),
                null,
                'device',
                {
                    uploadTicket: 'ticket-1',
                    resourceKind: 'bluetooth-device',
                    resourceId: 'blu_001'
                }
            );
            expect(captured).not.toBeNull();
            expect(captured?.get('ticket')).toBe('ticket-1');
            expect(captured?.get('resourceKind')).toBe('bluetooth-device');
            expect(captured?.get('resourceId')).toBe('blu_001');
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});
