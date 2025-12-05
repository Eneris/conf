import assert from 'node:assert/strict';
import {app, safeStorage} from 'electron';
import Conf from '../source/index.js';
import {
	createTempDirectory,
	trackConf,
	runRegisteredCleanups,
	resetTrackedConfs,
} from './_utilities.js';

const fixture = '🦄';

// Helper to create encryption config for safeStorage
const createSafeStorageEncryption = () => ({
	encrypt: (data: string) => safeStorage.encryptString(data),
	decrypt: (data: Uint8Array) => safeStorage.decryptString(Buffer.from(data)),
});

// Exported test functions for isolated runs
export async function test1AppReady() {
	await app.whenReady();

	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('safeStorage encryption is not available on this platform');
	}

	assert.strictEqual(app.isReady(), true, 'Electron app should be ready');
	assert.strictEqual(safeStorage.isEncryptionAvailable(), true, 'safeStorage should be available');

	runRegisteredCleanups();
}

export async function test2EncryptDecrypt() {
	await app.whenReady();

	const cwd = createTempDirectory();

	const conf = trackConf(new Conf({
		cwd,
		encryption: createSafeStorageEncryption(),
	}));

	assert.strictEqual(conf.get('foo'), undefined);
	conf.set('foo', fixture);
	assert.strictEqual(conf.get('foo'), fixture);

	resetTrackedConfs();
	runRegisteredCleanups();
}

export async function test3Persistence() {
	await app.whenReady();

	const cwd = createTempDirectory();
	const encryption = createSafeStorageEncryption();

	const conf1 = trackConf(new Conf({
		cwd,
		encryption,
	}));

	conf1.set('persistent', 'value123');
	conf1.set('number', 42);

	const conf2 = trackConf(new Conf({
		cwd,
		encryption,
	}));

	assert.strictEqual(conf2.get('persistent'), 'value123');
	assert.strictEqual(conf2.get('number'), 42);

	resetTrackedConfs();
	runRegisteredCleanups();
}

export async function test4SchemaValidation() {
	await app.whenReady();

	const cwd = createTempDirectory();

	const conf = new Conf<{enabled: boolean; name: string}>({
		cwd,
		schema: {
			enabled: {
				type: 'boolean',
				default: false,
			},
			name: {
				type: 'string',
			},
		},
		encryption: createSafeStorageEncryption(),
	});

	assert.strictEqual(conf.get('enabled'), false);

	conf.set('enabled', true);
	conf.set('name', 'test-app');

	assert.strictEqual(conf.get('enabled'), true);
	assert.strictEqual(conf.get('name'), 'test-app');

	runRegisteredCleanups();
}
