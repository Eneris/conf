#!/usr/bin/env node

/**
 * Electron runner - runs a single test function in isolation.
 */

import {app} from 'electron';
import process from 'node:process';

const testFile = process.env.TEST_FILE;
const testName = process.env.TEST_NAME;

if (!testFile || !testName) {
	console.error('TEST_FILE and TEST_NAME environment variables must be set');
	process.exit(1);
}

// Prevent Electron from showing in dock/taskbar
if (app.dock) {
	app.dock.hide();
}

app.on('ready', async () => {
	let hasError = false;

	try {
		// Import the test module
		const testModule = await import(testFile);

		// Wait for app to be ready
		await app.whenReady();

		// Run the specific test
		const testFn = testModule[testName];
		if (!testFn) {
			throw new Error(`Test "${testName}" not found in ${testFile}`);
		}

		await testFn();
		console.log(`✔ ${testName}`);
	} catch (error) {
		hasError = true;
		console.log(`✖ ${testName}`);
		console.error(`  Error: ${error.message}`);
	}

	// Force exit
	const exitCode = hasError ? 1 : 0;
	app.exit(exitCode);
	process.exit(exitCode);
});

app.on('window-all-closed', () => {
	// Don't quit automatically
});
