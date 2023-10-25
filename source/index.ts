/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-redundant-type-constituents */
import process from 'node:process';
import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import {getProperty, hasProperty, setProperty, deleteProperty} from 'dot-prop';
import envPaths from 'env-paths';
import {writeFileSync as atomicWriteFileSync} from 'atomically';
import AjvModule, {type ValidateFunction as AjvValidateFunction} from 'ajv';
import ajvFormatsModule from 'ajv-formats';
import debounceFn from 'debounce-fn';
import semver from 'semver';
import {type JSONSchema} from 'json-schema-typed';
import {
	type Deserialize,
	type Migrations,
	type OnDidChangeCallback,
	type Options,
	type Serialize,
	type Clone,
	type Unsubscribe,
	type OnDidAnyChangeCallback,
	type BeforeEachMigrationCallback,
} from './types.js';

// FIXME: https://github.com/ajv-validator/ajv/issues/2047
const Ajv = AjvModule.default;
const ajvFormats = ajvFormatsModule.default;

const createPlainObject = <T = Record<string, unknown>>(): T => Object.create(null);

const isExist = <T = unknown>(data: T): boolean => data !== undefined && data !== null;

const checkValueType = (key: string, value: unknown): void => {
	const nonJsonTypes = new Set([
		'undefined',
		'symbol',
		'function',
	]);

	const type = typeof value;

	if (nonJsonTypes.has(type)) {
		throw new TypeError(`Setting a value of type \`${type}\` for key \`${key}\` is not allowed as it's not supported by JSON`);
	}
};

const INTERNAL_KEY = '__internal__';
const MIGRATION_KEY = `${INTERNAL_KEY}.migrations.version`;

export default class Conf<T extends Record<string, any> = Record<string, unknown>> implements Iterable<[keyof T, T[keyof T]]> {
	readonly path: string;
	readonly events: EventEmitter;
	readonly #validator?: AjvValidateFunction;
	readonly #options: Readonly<Partial<Options<T>>>;
	readonly #defaultValues: Partial<T> = {};

	#writeTimer?: NodeJS.Timeout;
	#cache: T = null as unknown as T;
	#firstWrite = true;

	constructor(partialOptions: Readonly<Partial<Options<T>>> = {}) {
		const options: Partial<Options<T>> = {
			configName: 'config',
			fileExtension: 'json',
			projectSuffix: 'nodejs',
			clearInvalidConfig: false,
			accessPropertiesByDotNotation: true,
			configFileMode: 0o666,
			writeTimeout: 0,
			...partialOptions,
		};

		if (!options.cwd) {
			if (!options.projectName) {
				throw new Error('Please specify the `projectName` option.');
			}

			options.cwd = envPaths(options.projectName, {suffix: options.projectSuffix}).config;
		}

		this.#options = options;

		if (options.schema) {
			if (typeof options.schema !== 'object') {
				throw new TypeError('The `schema` option must be an object.');
			}

			const ajv = new Ajv({
				allErrors: true,
				useDefaults: true,
			});

			ajvFormats(ajv);

			const schema: JSONSchema = {
				type: 'object',
				properties: options.schema,
			};

			this.#validator = ajv.compile(schema);

			for (const [key, value] of Object.entries(options.schema) as any) { // TODO: Remove the `as any`.
				if (value?.default !== undefined) {
					this.#defaultValues[key as keyof T] = value.default; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
				}
			}
		}

		if (options.defaults) {
			this.#defaultValues = {
				...this.#defaultValues,
				...options.defaults,
			};
		}

		if (options.serialize) {
			this._serialize = options.serialize;
		}

		if (options.deserialize) {
			this._deserialize = options.deserialize;
		}

		this.events = new EventEmitter();

		const fileExtension = options.fileExtension ? `.${options.fileExtension}` : '';
		this.path = path.resolve(options.cwd, `${options.configName ?? 'config'}${fileExtension}`);

		const fileStore = this.store;
		const store = Object.assign(createPlainObject(), options.defaults, fileStore);

		this._validate(store);

		try {
			assert.deepEqual(fileStore, store);
		} catch {
			this.store = store;
		}

		if (options.watch) {
			this._watch();
		}

		if (options.migrations) {
			if (!options.projectVersion) {
				throw new Error('Please specify the `projectVersion` option.');
			}

			this._migrate(options.migrations, options.projectVersion, options.beforeEachMigration);
		}
	}

	/**
	Get an item.

	@param key - The key of the item to get.
	@param defaultValue - The default value if the item does not exist.
	*/
	get<Key extends keyof T>(key: Key): T[Key];
	get<Key extends keyof T>(key: Key, defaultValue: Required<T>[Key]): Required<T>[Key];
	// This overload is used for dot-notation access.
	// We exclude `keyof T` as an incorrect type for the default value should not fall through to this overload.
	get<Key extends string, Value = unknown>(key: Exclude<Key, keyof T>, defaultValue?: Value): Value;
	get(key: string, defaultValue?: unknown): unknown {
		if (this.#options.accessPropertiesByDotNotation) {
			return this._get(key, defaultValue);
		}

		const {store} = this;
		return key in store ? store[key] : defaultValue;
	}

	/**
	Set an item or multiple items at once.

	@param {key|object} - You can use [dot-notation](https://github.com/sindresorhus/dot-prop) in a key to access nested properties. Or a hashmap of items to set at once.
	@param value - Must be JSON serializable. Trying to set the type `undefined`, `function`, or `symbol` will result in a `TypeError`.
	*/
	set<Key extends keyof T>(key: Key, value?: T[Key]): void;
	set(key: string, value: unknown): void;
	set(object: Partial<T>): void;
	set<Key extends keyof T>(key: Partial<T> | Key | string, value?: T[Key] | unknown): void {
		if (typeof key !== 'string' && typeof key !== 'object') {
			throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof key}`);
		}

		if (typeof key !== 'object' && value === undefined) {
			throw new TypeError('Use `delete()` to clear values');
		}

		if (this._containsReservedKey(key)) {
			throw new TypeError(`Please don't use the ${INTERNAL_KEY} key, as it's used to manage this module internal operations.`);
		}

		const {store} = this;

		const set = (key: string, value?: T[Key] | T | unknown): void => {
			checkValueType(key, value);
			if (this.#options.accessPropertiesByDotNotation) {
				setProperty(store, key, value);
			} else {
				store[key as Key] = value as T[Key];
			}
		};

		if (typeof key === 'object') {
			const object = key;
			for (const [key, value] of Object.entries(object)) {
				set(key, value);
			}
		} else {
			set(key, value);
		}

		this.store = store;
	}

	/**
	Append value into the array.

	@param {key} - You can use [dot-notation](https://github.com/sindresorhus/dot-prop) in a key to access nested properties.
	@param value - Must be JSON serializable. Trying to set the type `undefined`, `function`, or `symbol` will result in a `TypeError`.
	*/
	append<Key extends keyof T>(key: Key, newItem?: Array<T[Key]>): void;
	append(key: string, newItem: unknown): void;
	append<Key extends keyof T>(key: Partial<T> | Key | string, newItem?: Array<T[Key]> | unknown): void {
		if (typeof key !== 'string' && typeof key !== 'object') {
			throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof key}`);
		}

		if (this._containsReservedKey(key)) {
			throw new TypeError(`Please don't use the ${INTERNAL_KEY} key, as it's used to manage this module internal operations.`);
		}

		const currentItems = this.has(key as string) ? this.get(key as string) : [];

		if (!Array.isArray(currentItems)) {
			throw new TypeError(`Expected target to be instance of \`Array\` but got \`${typeof currentItems}\``);
		}

		// Not using .push on purpose not to mutate old array directly. It could mess with events
		this.set(key as string, [...currentItems, newItem]);
	}

	/**
	Check if an item exists.

	@param key - The key of the item to check.
	*/
	has<Key extends keyof T>(key: Key | string): boolean {
		if (this.#options.accessPropertiesByDotNotation) {
			return hasProperty(this.store, key as string);
		}

		return (key as string) in this.store;
	}

	/**
	Toggle a boolean item.

	@param key - The key of the item to toggle.
	@returns the new value after successful toggle
	*/
	toggle<Key extends keyof T>(key: Key | string): boolean {
		const currentValue = this.has(key) ? this.get(key) : false;

		if (typeof currentValue !== 'boolean') {
			throw new TypeError(`Expected type to be of type \`boolean\` or empty, got ${typeof currentValue}`);
		}

		const newValue = !currentValue;

		this.set(key as string, newValue);

		return newValue;
	}

	/**
	Calls supplied mutation on the item and replaces it with its result.

	@param key - The key of the item to mutate.
	@param mutation - Function which returns new derived value
	@returns new value
	*/
	mutate<Key extends keyof T>(key: Key | string, mutation: (currentValue: T[Key]) => T[Key]): T[Key] {
		if (typeof mutation !== 'function') {
			throw new TypeError(`Expected type of mutation to be of type \`function\`, is ${typeof mutation}`);
		}

		this.set(key, mutation(this.get(key) as T[Key]));

		return this.get<Key>(key as Key);
	}

	/**
	Merges the current data with new and returns its result.

	@param key - The key of the item to mutate.
	@param dataUpdates - Objects contining partial data to override with
	@returns new value
	*/
	merge<Key extends keyof T>(key: Key | string, dataUpdates: Partial<T[Key]>): T[Key] {
		return this.mutate(key, oldData => ({
			...oldData,
			...dataUpdates,
		}));
	}

	/**
	Reset items to their default values, as defined by the `defaults` or `schema` option.

	@see `clear()` to reset all items.

	@param keys - The keys of the items to reset.
	*/
	reset<Key extends keyof T>(...keys: Key[]): void {
		for (const key of keys) {
			if (isExist(this.#defaultValues[key])) {
				this.set(key, this.#defaultValues[key]);
			}
		}
	}

	/**
	Delete an item.

	@param key - The key of the item to delete.
	*/
	delete<Key extends keyof T>(key: Key): void;
	delete(key: string): void {
		const {store} = this;

		if (this.#options.accessPropertiesByDotNotation) {
			deleteProperty(store, key);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete store[key];
		}

		this.store = store;
	}

	/**
	Delete all items.

	This resets known items to their default values, if defined by the `defaults` or `schema` option.
	*/
	clear(): void {
		this.store = createPlainObject();

		for (const key of Object.keys(this.#defaultValues)) {
			this.reset(key);
		}
	}

	/**
	Watches the given `key`, calling `callback` on any changes.

	@param key - The key wo watch.
	@param callback - A callback function that is called on any changes. When a `key` is first set `oldValue` will be `undefined`, and when a key is deleted `newValue` will be `undefined`.
	@returns A function, that when called, will unsubscribe.
	*/
	onDidChange<Key extends keyof T>(
		key: Key,
		callback: OnDidChangeCallback<T[Key]>,
	): Unsubscribe {
		if (typeof key !== 'string') {
			throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof key}`);
		}

		if (typeof callback !== 'function') {
			throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof callback}`);
		}

		return this._handleChange(() => this.get(key) as T[Key], callback);
	}

	/**
	Watches the whole config object, calling `callback` on any changes.

	@param callback - A callback function that is called on any changes. When a `key` is first set `oldValue` will be `undefined`, and when a key is deleted `newValue` will be `undefined`.
	@returns A function, that when called, will unsubscribe.
	*/
	onDidAnyChange(
		callback: OnDidAnyChangeCallback<T>,
	): Unsubscribe {
		if (typeof callback !== 'function') {
			throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof callback}`);
		}

		return this._handleChange(() => this.store, callback);
	}

	get size(): number {
		return Object.keys(this.store).length;
	}

	get store(): T {
		if (!this.#cache) {
			this.#cache = this._read();
		}

		return this._clone(this.#cache);
	}

	set store(value: T) {
		this._validate(value);
		this._write(value);

		this.events.emit('change');
	}

	* [Symbol.iterator](): IterableIterator<[keyof T, T[keyof T]]> {
		for (const [key, value] of Object.entries(this.store)) {
			yield [key, value];
		}
	}

	private _read(): T {
		try {
			const data = fs.readFileSync(this.path);
			const dataString = this._decryptData(data);
			const deserializedData = this._deserialize(dataString);
			this._validate(deserializedData);
			return Object.assign(createPlainObject(), deserializedData);
		} catch (error: unknown) {
			if ((error as any)?.code === 'ENOENT') {
				this._ensureDirectory();
				return createPlainObject();
			}

			if (this.#options.clearInvalidConfig && (error as Error).name === 'SyntaxError') {
				return createPlainObject();
			}

			throw error;
		}
	}

	private _encryptData(data: string): Buffer {
		if (!this.#options.encryption) {
			return Buffer.from(data);
		}

		return this.#options.encryption.encrypt(data)
	}

	private _decryptData(data: Buffer): string {
		if (!this.#options.encryption) {
			return data.toString();
		}

		return this.#options.encryption.decrypt(data);
	}

	private _handleChange<Key extends keyof T>(
		getter: () => T | undefined,
		callback: OnDidAnyChangeCallback<T[Key]>
	): Unsubscribe;

	private _handleChange<Key extends keyof T>(
		getter: () => T[Key] | undefined,
		callback: OnDidChangeCallback<T[Key]>
	): Unsubscribe;

	private _handleChange<Key extends keyof T>(
		getter: () => T | T[Key] | undefined,
		callback: OnDidAnyChangeCallback<T | T[Key]> | OnDidChangeCallback<T | T[Key]>,
	): Unsubscribe {
		let currentValue = getter();

		const onChange = (): void => {
			const oldValue = currentValue;
			const newValue = getter();

			if (newValue === oldValue) {
				return;
			}

			currentValue = newValue;
			callback.call(this, newValue, oldValue);
		};

		this.events.on('change', onChange);
		return () => this.events.removeListener('change', onChange);
	}

	private readonly _deserialize: Deserialize<T> = value => JSON.parse(value);

	private readonly _serialize: Serialize<T> = value => JSON.stringify(value);

	private readonly _clone: Clone<T> = value => {
		if (typeof value === 'object') {
			return this._deserialize(this._serialize(value));
		}

		return value;
	};

	private _validate(data: T | unknown): void {
		if (!this.#validator) {
			return;
		}

		const valid = this.#validator(data);
		if (valid || !this.#validator.errors) {
			return;
		}

		const errors = this.#validator.errors
			.map(({instancePath, message = ''}) => `\`${instancePath.slice(1)}\` ${message}`);

		throw new Error('Config schema violation: ' + errors.join('; '));
	}

	private _ensureDirectory(): void {
		// Ensure the directory exists as it could have been deleted in the meantime.
		fs.mkdirSync(path.dirname(this.path), {recursive: true});
	}

	private _write(value: T): void {
		this._cancelWrite();

		// Pass thru JSON to ensure deep clone
		this.#cache = value;

		if (this.#firstWrite || !this.#options.writeTimeout) {
			this._forceWrite();
			this.#firstWrite = false;
		} else {
			this.#writeTimer = setTimeout(() => {
				this._forceWrite();
				// This.#writeTimer = null;
			}, this.#options?.writeTimeout);
		}
	}

	private _cancelWrite() {
		if (this.#writeTimer) {
			clearTimeout(this.#writeTimer);
			// This.#writeTimer = null;
		}
	}

	private _forceWrite(): void {
		this._cancelWrite();

		this._ensureDirectory();

		let data: string | Buffer = this._serialize(this.#cache);

		if (this.#options.encryption) {
			data = this._encryptData(data)
		}

		// Temporary workaround for Conf being packaged in a Ubuntu Snap app.
		// See https://github.com/sindresorhus/conf/pull/82
		if (process.env.SNAP) {
			fs.writeFileSync(this.path, data, {mode: this.#options.configFileMode});
		} else {
			try {
				atomicWriteFileSync(this.path, data, {mode: this.#options.configFileMode});
			} catch (error: unknown) {
				// Fix for https://github.com/sindresorhus/electron-store/issues/106
				// Sometimes on Windows, we will get an EXDEV error when atomic writing
				// (even though to the same directory), so we fall back to non atomic write
				if ((error as any)?.code === 'EXDEV') {
					fs.writeFileSync(this.path, data, {mode: this.#options.configFileMode});
					return;
				}

				throw error;
			}
		}
	}

	private _watch(): void {
		this._ensureDirectory();

		if (!fs.existsSync(this.path)) {
			this._write(createPlainObject<T>());
		}

		if (process.platform === 'win32') {
			fs.watch(this.path, {persistent: false}, debounceFn(() => {
			// On Linux and Windows, writing to the config file emits a `rename` event, so we skip checking the event type.
				this.#cache = this._read();
				this.events.emit('change');
			}, {wait: 100}));
		} else {
			fs.watchFile(this.path, {persistent: false}, debounceFn(() => {
				this.#cache = this._read();
				this.events.emit('change');
			}, {wait: 5000}));
		}
	}

	private _migrate(migrations: Migrations<T>, versionToMigrate: string, beforeEachMigration?: BeforeEachMigrationCallback<T>): void {
		let previousMigratedVersion = this._get(MIGRATION_KEY, '0.0.0');

		const newerVersions = Object.keys(migrations)
			.filter(candidateVersion => this._shouldPerformMigration(candidateVersion, previousMigratedVersion, versionToMigrate));

		let storeBackup = this._clone(this.store);

		for (const version of newerVersions) {
			try {
				if (beforeEachMigration) {
					beforeEachMigration(this, {
						fromVersion: previousMigratedVersion,
						toVersion: version,
						finalVersion: versionToMigrate,
						versions: newerVersions,
					});
				}

				const migration = migrations[version];
				migration?.(this);

				this._set(MIGRATION_KEY, version);

				previousMigratedVersion = version;
				storeBackup = this._clone(this.store);
			} catch (error: unknown) {
				this.store = storeBackup;

				throw new Error(
					`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${error as string}`,
				);
			}
		}

		if (this._isVersionInRangeFormat(previousMigratedVersion) || !semver.eq(previousMigratedVersion, versionToMigrate)) {
			this._set(MIGRATION_KEY, versionToMigrate);
		}
	}

	private _containsReservedKey(key: string | Partial<T>): boolean {
		if (typeof key === 'object') {
			const firsKey = Object.keys(key)[0];

			if (firsKey === INTERNAL_KEY) {
				return true;
			}
		}

		if (typeof key !== 'string') {
			return false;
		}

		if (this.#options.accessPropertiesByDotNotation) {
			if (key.startsWith(`${INTERNAL_KEY}.`)) {
				return true;
			}

			return false;
		}

		return false;
	}

	private _isVersionInRangeFormat(version: string): boolean {
		return semver.clean(version) === null;
	}

	private _shouldPerformMigration(candidateVersion: string, previousMigratedVersion: string, versionToMigrate: string): boolean {
		if (this._isVersionInRangeFormat(candidateVersion)) {
			if (previousMigratedVersion !== '0.0.0' && semver.satisfies(previousMigratedVersion, candidateVersion)) {
				return false;
			}

			return semver.satisfies(versionToMigrate, candidateVersion);
		}

		if (semver.lte(candidateVersion, previousMigratedVersion)) {
			return false;
		}

		if (semver.gt(candidateVersion, versionToMigrate)) {
			return false;
		}

		return true;
	}

	private _get<Key extends keyof T>(key: Key): T[Key] | undefined;
	private _get<Key extends keyof T, Default = unknown>(key: Key, defaultValue: Default): T[Key] | Default;
	private _get<Key extends keyof T, Default = unknown>(key: Key | string, defaultValue?: Default): Default | undefined {
		return getProperty(this.store, key as string, defaultValue as T[Key]);
	}

	private _set(key: string, value: unknown): void {
		const {store} = this;
		setProperty(store, key, value);

		this.store = store;
	}
}

export type {Options, Schema} from './types.js';
