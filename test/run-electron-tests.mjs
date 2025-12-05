#!/usr/bin/env node

/**
 * Runner that executes each Electron test in a separate isolated instance.
 */

import {spawn, execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFile = path.join(__dirname, 'electron.ts');
const electronPath = path.resolve(__dirname, '../node_modules/.bin/electron');
const runnerScript = path.join(__dirname, 'electron-runner.mjs');

// Define tests to run
const tests = [
	'test1AppReady',
	'test2EncryptDecrypt',
	'test3Persistence',
	'test4SchemaValidation',
];

let totalPassed = 0;
let totalFailed = 0;

async function runTest(testName) {
	return new Promise(resolve => {
		const testProcess = spawn(
			electronPath,
			[
				'--no-sandbox',
				runnerScript,
			],
			{
				stdio: 'pipe',
				env: {
					...process.env,
					NODE_OPTIONS: '--import tsx/esm',
					TEST_FILE: testFile,
					TEST_NAME: testName,
				},
			},
		);

		let output = '';
		testProcess.stdout.on('data', data => {
			output += data.toString();
		});

		testProcess.stderr.on('data', data => {
			output += data.toString();
		});

		testProcess.on('exit', code => {
			// Cleanup Electron processes
			try {
				execSync(`pkill -9 -f "Electron.*${testFile}"`, {stdio: 'ignore'});
			} catch {
				// Ignore
			}

			console.log(output);

			if (code === 0) {
				totalPassed++;
				resolve(true);
			} else {
				totalFailed++;
				resolve(false);
			}
		});

		testProcess.on('error', error => {
			console.error(`Failed to start test ${testName}:`, error);
			totalFailed++;
			resolve(false);
		});
	});
}

console.log('Running tests in isolated Electron instances...\n');

for (const testName of tests) {
	// eslint-disable-next-line no-await-in-loop
	await runTest(testName);
}

console.log(`\nTests: ${totalPassed} passed, ${totalFailed} failed, ${tests.length} total`);
process.exit(totalFailed > 0 ? 1 : 0);
