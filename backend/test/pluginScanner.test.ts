import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

describe('plugin package.json validation', () => {
    // Test the isPluginInfo logic inline (it's private in DirectoryScanner)
    function isPluginInfo(info: any): boolean {
        return (
            typeof info === 'object' &&
            typeof info.name === 'string' &&
            typeof info.version === 'string' &&
            typeof info.description === 'string'
        );
    }

    it('accepts valid plugin info', () => {
        assert.ok(
            isPluginInfo({
                name: 'greetings',
                version: '1.0.0',
                description: 'A demo plugin'
            })
        );
    });

    it('rejects missing name', () => {
        assert.ok(!isPluginInfo({version: '1.0.0', description: 'test'}));
    });

    it('rejects missing version', () => {
        assert.ok(!isPluginInfo({name: 'test', description: 'test'}));
    });

    it('rejects missing description', () => {
        assert.ok(!isPluginInfo({name: 'test', version: '1.0.0'}));
    });

    it('rejects non-object', () => {
        assert.ok(!isPluginInfo(undefined));
        assert.ok(!isPluginInfo('string'));
        assert.ok(!isPluginInfo(42));
    });

    it('rejects numeric name', () => {
        assert.ok(
            !isPluginInfo({name: 123, version: '1.0.0', description: 'test'})
        );
    });
});

describe('plugin directory structure', () => {
    const PLUGINS_DIR = path.join(__dirname, '../../plugins');

    it('plugins directory exists', () => {
        assert.ok(fs.existsSync(PLUGINS_DIR));
    });

    it('greetings plugin has valid package.json', () => {
        const pkgPath = path.join(PLUGINS_DIR, 'greetings', 'package.json');
        assert.ok(fs.existsSync(pkgPath), 'greetings/package.json not found');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        assert.equal(typeof pkg.name, 'string');
        assert.equal(typeof pkg.version, 'string');
        assert.equal(typeof pkg.description, 'string');
    });

    it('metadata-demo plugin has valid package.json', () => {
        const pkgPath = path.join(PLUGINS_DIR, 'metadata-demo', 'package.json');
        assert.ok(
            fs.existsSync(pkgPath),
            'metadata-demo/package.json not found'
        );
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        assert.equal(typeof pkg.name, 'string');
        assert.equal(typeof pkg.version, 'string');
        assert.equal(typeof pkg.description, 'string');
    });
});
