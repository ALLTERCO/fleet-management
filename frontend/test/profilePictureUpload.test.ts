import {describe, expect, it} from 'vitest';
import {
    profilePictureFormData,
    versionedProfilePictureUrl
} from '@/helpers/profilePictureUpload';

describe('profilePictureUpload', () => {
    it('cache-busts signed and unsigned profile picture URLs', () => {
        expect(
            versionedProfilePictureUrl('/uploads/profilePics/a.png', 7)
        ).toBe('/uploads/profilePics/a.png?v=7');
        expect(
            versionedProfilePictureUrl(
                '/uploads/profilePics/a.png?assetToken=t',
                7
            )
        ).toBe('/uploads/profilePics/a.png?assetToken=t&v=7');
    });

    it('builds upload form data with ticket and username', () => {
        const file = new File(['x'], 'avatar.png', {type: 'image/png'});
        const formData = profilePictureFormData({
            file,
            username: 'user@example.test',
            ticket: 'ticket-1'
        });

        expect(formData.get('image')).toBe(file);
        expect(formData.get('username')).toBe('user@example.test');
        expect(formData.get('ticket')).toBe('ticket-1');
    });

    it('preserves the relative path shape when cache-busting', () => {
        // Server returns /uploads/profilePics/foo.png?assetToken=… — the
        // versioned URL must keep `assetToken` before appending `v=`.
        const tokenized = '/uploads/profilePics/foo.png?assetToken=ABC';
        const versioned = versionedProfilePictureUrl(tokenized, 12345);
        expect(versioned).toBe(
            '/uploads/profilePics/foo.png?assetToken=ABC&v=12345'
        );
        // Ensure the assetToken survives.
        expect(versioned).toContain('assetToken=ABC');
    });
});
