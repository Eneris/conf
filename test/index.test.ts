/* eslint-disable no-new, @typescript-eslint/no-empty-function, @typescript-eslint/naming-convention */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import {temporaryDirectory} from 'tempy';
import {deleteSync} from 'del';
import {pEvent} from 'p-event';
import delay from 'delay';
import anyTest, {type TestFn} from 'ava';
import Conf, {type Schema} from '../source/index.js';

const test = anyTest as TestFn<{
	config: Conf;
	configWithoutDotNotation: Conf;
	configWithSchema: Conf<{foo: unknown; bar: unknown}>;
	configWithDefaults: Conf;
}>;

const fixture = '🦄';
const fixtureNumber = 42;

test.beforeEach(t => {
	t.context.config = new Conf({cwd: temporaryDirectory()});
	t.context.configWithoutDotNotation = new Conf({cwd: temporaryDirectory(), accessPropertiesByDotNotation: false});
});

test('.get()', t => {
	t.is(t.context.config.get('foo'), undefined);
	t.is(t.context.config.get('foo', '🐴'), '🐴');
	t.context.config.set('foo', fixture);
	t.is(t.context.config.get('foo'), fixture);
});

test('.get() - `defaults` option', t => {
	const store = new Conf({
		cwd: temporaryDirectory(),
		defaults: {
			foo: 42,
			nested: {
				bar: 55,
			},
		},
	});

	t.is(store.get('foo'), 42);
	t.is(store.get('nested.bar'), 55);
});

test('.get() - `schema` option - default', t => {
	const store = new Conf({
		cwd: temporaryDirectory(),
		schema: {
			foo: {
				type: 'boolean',
				default: true,
			},
			nested: {
				type: 'object',
				properties: {
					bar: {
						type: 'number',
						default: 55,
					},
				},
			},
		},
	});

	t.is(store.get('foo'), true);
});

test('.set()', t => {
	t.context.config.set('foo', fixture);
	t.context.config.set('baz.boo', fixture);
	t.is(t.context.config.get('foo'), fixture);
	t.is(t.context.config.get('baz.boo'), fixture);
});

test('.set() - with object', t => {
	t.context.config.set({
		foo1: 'bar1',
		foo2: 'bar2',
		baz: {
			boo: 'foo',
			foo: {
				bar: 'baz',
			},
		},
	});
	t.is(t.context.config.get('foo1'), 'bar1');
	t.is(t.context.config.get('foo2'), 'bar2');
	t.deepEqual(t.context.config.get('baz'), {boo: 'foo', foo: {bar: 'baz'}});
	t.is(t.context.config.get('baz.boo'), 'foo');
	t.deepEqual(t.context.config.get('baz.foo'), {bar: 'baz'});
	t.is(t.context.config.get('baz.foo.bar'), 'baz');
});

test('.set() - with undefined', t => {
	t.throws(() => {
		t.context.config.set('foo', undefined);
	}, {message: 'Use `delete()` to clear values'});
});

test('.set() - with unsupported values', t => {
	t.throws(() => {
		t.context.config.set('a', () => {});
	}, {message: /not supported by JSON/});

	t.throws(() => {
		t.context.config.set('a', Symbol('a'));
	}, {message: /not supported by JSON/});

	t.throws(() => {
		t.context.config.set({
			a: undefined,
		});
	}, {message: /not supported by JSON/});

	t.throws(() => {
		t.context.config.set({
			a() {},
		});
	}, {message: /not supported by JSON/});

	t.throws(() => {
		t.context.config.set({
			a: Symbol('a'),
		});
	}, {message: /not supported by JSON/});
});

test('.set() - invalid key', t => {
	t.throws(() => {
		// For our tests to fail and TypeScript to compile, we'll ignore this TS error.
		// @ts-expect-error
		t.context.config.set(1, 'unicorn');
	}, {message: 'Expected `key` to be of type `string` or `object`, got number'});
});

test('.toggle()', t => {
	t.context.config.set('foo', false);
	t.context.config.set('baz.boo', false);
	t.is(t.context.config.toggle('foo'), true);
	t.is(t.context.config.toggle('baz.boo'), true);
	t.is(t.context.config.get('foo'), true);
	t.is(t.context.config.get('baz.boo'), true);

	t.context.config.set('foo', true);
	t.context.config.set('baz.boo', true);
	t.is(t.context.config.toggle('foo'), false);
	t.is(t.context.config.toggle('baz.boo'), false);
	t.is(t.context.config.get('foo'), false);
	t.is(t.context.config.get('baz.boo'), false);
});

test('.toggle() - empty', t => {
	t.context.config.delete('foo');
	t.context.config.delete('baz.boo');
	t.is(t.context.config.toggle('foo'), true);
	t.is(t.context.config.toggle('baz.boo'), true);
	t.is(t.context.config.get('foo'), true);
	t.is(t.context.config.get('baz.boo'), true);
});

test('.toggle() - invalid type', t => {
	t.throws(() => {
		t.context.config.set('foo', {a: 'not a boolean'});
		t.context.config.toggle('foo');
	}, {message: 'Expected type to be of type `boolean` or empty, got object'});

	t.throws(() => {
		t.context.config.set('baz.foo', {a: 'not a boolean'});
		t.context.config.toggle('baz.foo');
	}, {message: 'Expected type to be of type `boolean` or empty, got object'});

	t.throws(() => {
		t.context.config.set('foo', fixture);
		t.context.config.toggle('foo');
	}, {message: 'Expected type to be of type `boolean` or empty, got string'});

	t.throws(() => {
		t.context.config.set('baz.foo', fixture);
		t.context.config.toggle('baz.foo');
	}, {message: 'Expected type to be of type `boolean` or empty, got string'});

	t.throws(() => {
		t.context.config.set('foo', fixtureNumber);
		t.context.config.toggle('foo');
	}, {message: 'Expected type to be of type `boolean` or empty, got number'});

	t.throws(() => {
		t.context.config.set('baz.foo', fixtureNumber);
		t.context.config.toggle('baz.foo');
	}, {message: 'Expected type to be of type `boolean` or empty, got number'});
});

test('.mutate()', t => {
	const mutation = () => fixtureNumber;
	t.context.config.set('foo', fixture);
	t.context.config.set('baz.boo', fixture);
	t.context.config.mutate('foo', mutation);
	t.context.config.mutate('baz.boo', mutation);
	t.is(t.context.config.get('foo'), fixtureNumber);
	t.is(t.context.config.get('baz.boo'), fixtureNumber);
});

test('.mutate() - invalid mutation', t => {
	t.throws(() => {
		t.context.config.set('foo', fixture);
		// For our tests to fail and TypeScript to compile, we'll ignore this TS error.
		// @ts-expect-error
		t.context.config.mutate('foo', fixture);
	}, {message: 'Expected type of mutation to be of type `function`, is string'});
});

test('.append()', t => {
	t.context.config.set('foo', []);
	t.context.config.append('foo', fixture);
	t.deepEqual(t.context.config.get('foo'), [fixture]);
	t.context.config.append('foo', fixture);
	t.deepEqual(t.context.config.get('foo'), [fixture, fixture]);

	t.context.config.delete('foo');
	t.context.config.append('foo', fixture);
	t.deepEqual(t.context.config.get('foo'), [fixture]);

	t.context.config.set('foo', [fixture]);
	t.context.config.append('foo', [fixture]);
	t.deepEqual(t.context.config.get('foo'), [fixture, [fixture]]);

	t.context.config.set('baz.foo', []);
	t.context.config.append('baz.foo', fixture);
	t.deepEqual(t.context.config.get('baz.foo'), [fixture]);
	t.context.config.append('baz.foo', fixture);
	t.deepEqual(t.context.config.get('baz.foo'), [fixture, fixture]);

	t.context.config.delete('baz.foo');
	t.context.config.append('baz.foo', fixture);
	t.deepEqual(t.context.config.get('baz.foo'), [fixture]);
});

test('.append() - non-array', t => {
	t.throws(() => {
		t.context.config.set('foo', {foo: 'bar'});
		t.context.config.append('foo', fixture);
	}, {message: 'Expected target to be instance of `Array` but got `object`'});
});

test('.has()', t => {
	t.context.config.set('foo', fixture);
	t.context.config.set('baz.boo', fixture);
	t.true(t.context.config.has('foo'));
	t.true(t.context.config.has('baz.boo'));
	t.false(t.context.config.has('missing'));
});

test('.reset() - `defaults` option', t => {
	const store = new Conf({
		cwd: temporaryDirectory(),
		defaults: {
			foo: 42,
			bar: 99,
		},
	});

	store.set('foo', 77);
	store.set('bar', 0);
	store.reset('foo', 'bar');
	t.is(store.get('foo'), 42);
	t.is(store.get('bar'), 99);
});

test('.reset() - falsy `defaults` option', t => {
	const defaultsValue: {
		foo: number;
		bar: string;
		fox: boolean;
		bax: boolean;
	} = {
		foo: 0,
		bar: '',
		fox: false,
		bax: true,
	};
	const store = new Conf({
		cwd: temporaryDirectory(),
		defaults: defaultsValue,
	});

	store.set('foo', 5);
	store.set('bar', 'exist');
	store.set('fox', true);
	store.set('fox', false);

	store.reset('foo', 'bar', 'fox', 'bax');

	t.is(store.get('foo'), 0);
	t.is(store.get('bar'), '');
	t.is(store.get('fox'), false);
	t.is(store.get('bax'), true);
});

test('.reset() - `schema` option', t => {
	const store = new Conf({
		cwd: temporaryDirectory(),
		schema: {
			foo: {
				default: 42,
			},
			bar: {
				default: 99,
			},
		},
	});

	store.set('foo', 77);
	store.set('bar', 0);
	store.reset('foo', 'bar');
	t.is(store.get('foo'), 42);
	t.is(store.get('bar'), 99);
});

test('.delete()', t => {
	const {config} = t.context;
	config.set('foo', 'bar');
	config.set('baz.boo', true);
	config.set('baz.foo.bar', 'baz');
	config.delete('foo');
	t.is(config.get('foo'), undefined);
	config.delete('baz.boo');
	t.not(config.get('baz.boo'), true);
	config.delete('baz.foo');
	t.not(config.get('baz.foo'), {bar: 'baz'});
	config.set('foo.bar.baz', {awesome: 'icecream'});
	config.set('foo.bar.zoo', {awesome: 'redpanda'});
	config.delete('foo.bar.baz');
	t.is(config.get('foo.bar.zoo.awesome'), 'redpanda');
});

test('.clear()', t => {
	t.context.config.set('foo', 'bar');
	t.context.config.set('foo1', 'bar1');
	t.context.config.set('baz.boo', true);
	t.context.config.clear();
	t.is(t.context.config.size, 0);
});

test('.clear() - `defaults` option', t => {
	const store = new Conf({
		cwd: temporaryDirectory(),
		defaults: {
			foo: 42,
			bar: 99,
		},
	});

	store.set('foo', 2);
	store.clear();
	t.is(store.get('foo'), 42);
	t.is(store.get('bar'), 99);
});

test('.clear() - `schema` option', t => {
	const cwd = temporaryDirectory();
	const store = new Conf({
		cwd,
		schema: {
			foo: {
				default: 42,
			},
			bar: {
				default: 99,
			},
		},
	});

	store.set('foo', 2);
	store.clear();
	t.is(store.get('foo'), 42);
	t.is(store.get('bar'), 99);

	const store2 = new Conf({
		cwd,
		schema: {
			foo: {
				default: 42,
			},
			bar: {
				default: 99,
			},
		},
	});

	t.is(store2.get('foo'), 42);
	t.is(store2.get('bar'), 99);
});

test('.clear() - basic clear', t => {
	const store = new Conf({
		cwd: temporaryDirectory(),
	});

	store.set('foo', 2);
	store.clear();
	t.is(store.get('foo'), undefined);
});

test('.size', t => {
	t.context.config.set('foo', 'bar');
	t.is(t.context.config.size, 1);
});

test('.store', t => {
	t.context.config.set('foo', 'bar');
	t.context.config.set('baz.boo', true);
	t.deepEqual(t.context.config.store, {
		foo: 'bar',
		baz: {
			boo: true,
		},
	});
});

test('`defaults` option', t => {
	const config = new Conf({
		cwd: temporaryDirectory(),
		defaults: {
			foo: 'bar',
		},
	});

	t.is(config.get('foo'), 'bar');
});

test('`configName` option', t => {
	const configName = 'alt-config';
	const config = new Conf<{foo: string | undefined}>({
		cwd: temporaryDirectory(),
		configName,
	});
	t.is(config.get('foo'), undefined);
	config.set('foo', fixture);
	t.is(config.get('foo'), fixture);
	t.is(path.basename(config.path, '.json'), configName);
	t.true(fs.existsSync(config.path));
});

test('no `suffix` option', t => {
	const config = new Conf({projectName: Date.now().toString()});
	t.true(config.path.includes('-nodejs'));
	config.clear();
});

test('with `suffix` option set to empty string', t => {
	const projectSuffix = '';
	const projectName = 'conf-temp1-project';
	const config = new Conf({projectSuffix, projectName});
	const configPathSegments = config.path.split(path.sep);
	const configRootIndex = configPathSegments.indexOf(projectName);
	t.true(configRootIndex !== -1 && configRootIndex < configPathSegments.length);
});

test('with `projectSuffix` option set to non-empty string', t => {
	const projectSuffix = 'new-projectSuffix';
	const projectName = 'conf-temp2-project';
	const config = new Conf({projectSuffix, projectName});
	const configPathSegments = config.path.split(path.sep);
	const expectedRootName = `${projectName}-${projectSuffix}`;
	const configRootIndex = configPathSegments.indexOf(expectedRootName);
	t.true(configRootIndex !== -1 && configRootIndex < configPathSegments.length);
});

test('`fileExtension` option', t => {
	const fileExtension = 'alt-ext';
	const config = new Conf({
		cwd: temporaryDirectory(),
		fileExtension,
	});
	t.is(config.get('foo'), undefined);
	config.set('foo', fixture);
	t.is(config.get('foo'), fixture);
	t.is(path.extname(config.path), `.${fileExtension}`);
});

test('`fileExtension` option = empty string', t => {
	const configName = 'unicorn';
	const config = new Conf({
		cwd: temporaryDirectory(),
		fileExtension: '',
		configName,
	});
	t.is(path.basename(config.path), configName);
});

test('`serialize` and `deserialize` options', t => {
	const deserialized = {foo: fixture};

	const serialize = (value: unknown) => {
		t.pass();
		return JSON.stringify(value);
	};

	const deserialize = (value: string) => {
		t.pass();
		return JSON.parse(value); // eslint-disable-line @typescript-eslint/no-unsafe-return
	};

	const config = new Conf({
		cwd: temporaryDirectory(),
		serialize,
		deserialize,
	});

	t.deepEqual(config.store, {} as any);

	config.store = deserialized;

	t.deepEqual(config.store, deserialized);
});

test('`projectName` option', t => {
	const projectName = 'conf-fixture-project-name';
	const config = new Conf({projectName});
	t.is(config.get('foo'), undefined);
	config.set('foo', fixture);
	t.is(config.get('foo'), fixture);
	t.true(config.path.includes(projectName));
	deleteSync(config.path, {force: true});
});

test('ensure `.store` is always an object', t => {
	const cwd = temporaryDirectory();
	const config = new Conf({cwd});

	deleteSync(cwd, {force: true});

	t.notThrows(() => {
		config.get('foo');
	});
});

test('instance is iterable', t => {
	t.context.config.set({
		foo: fixture,
		bar: fixture,
	});
	t.deepEqual(
		[...t.context.config],
		[['foo', fixture], ['bar', fixture]],
	);
});

test('`cwd` option overrides `projectName` option', t => {
	const cwd = temporaryDirectory();

	t.notThrows(() => {
		const config: Conf = new Conf({cwd, projectName: ''});
		t.true(config.path.startsWith(cwd));
		t.is(config.get('foo'), undefined);
		config.set('foo', fixture);
		t.is(config.get('foo'), fixture);
		deleteSync(config.path, {force: true});
	});
});

test('onDidChange()', t => {
	const {config} = t.context;

	t.plan(8);

	const checkFoo = (newValue: unknown, oldValue: unknown): void => {
		t.is(newValue, '🐴');
		t.is(oldValue, fixture);
	};

	const checkBaz = (newValue: unknown, oldValue: unknown): void => {
		t.is(newValue, '🐴');
		t.is(oldValue, fixture);
	};

	config.set('foo', fixture);
	let unsubscribe = config.onDidChange('foo', checkFoo);
	config.set('foo', '🐴');
	unsubscribe();
	config.set('foo', fixture);

	config.set('baz.boo', fixture);
	unsubscribe = config.onDidChange('baz.boo', checkBaz);
	config.set('baz.boo', '🐴');
	unsubscribe();
	config.set('baz.boo', fixture);

	const checkUndefined = (newValue: unknown, oldValue: unknown): void => {
		t.is(oldValue, fixture);
		t.is(newValue, undefined);
	};

	const checkSet = (newValue: unknown, oldValue: unknown): void => {
		t.is(oldValue, undefined);
		t.is(newValue, '🐴');
	};

	unsubscribe = config.onDidChange('foo', checkUndefined);
	config.delete('foo');
	unsubscribe();
	unsubscribe = config.onDidChange('foo', checkSet);
	config.set('foo', '🐴');
	unsubscribe();
	config.set('foo', fixture);
});

test('onDidAnyChange()', t => {
	const {config} = t.context;

	t.plan(8);

	const checkFoo = (newValue: unknown, oldValue: unknown): void => {
		t.deepEqual(newValue, {foo: '🐴'});
		t.deepEqual(oldValue, {foo: fixture});
	};

	const checkBaz = (newValue: unknown, oldValue: unknown): void => {
		t.deepEqual(newValue, {
			foo: fixture,
			baz: {boo: '🐴'},
		});
		t.deepEqual(oldValue, {
			foo: fixture,
			baz: {boo: fixture},
		});
	};

	config.set('foo', fixture);
	let unsubscribe = config.onDidAnyChange(checkFoo);
	config.set('foo', '🐴');
	unsubscribe();
	config.set('foo', fixture);

	config.set('baz.boo', fixture);
	unsubscribe = config.onDidAnyChange(checkBaz);
	config.set('baz.boo', '🐴');
	unsubscribe();
	config.set('baz.boo', fixture);

	const checkUndefined = (newValue: unknown, oldValue: unknown): void => {
		t.deepEqual(oldValue, {
			foo: '🦄',
			baz: {boo: '🦄'},
		});

		t.deepEqual(newValue, {
			baz: {boo: fixture},
		});
	};

	const checkSet = (newValue: unknown, oldValue: unknown): void => {
		t.deepEqual(oldValue, {
			baz: {boo: fixture},
		});

		t.deepEqual(newValue, {
			baz: {boo: '🦄'},
			foo: '🐴',
		});
	};

	unsubscribe = config.onDidAnyChange(checkUndefined);
	config.delete('foo');
	unsubscribe();
	unsubscribe = config.onDidAnyChange(checkSet);
	config.set('foo', '🐴');
	unsubscribe();
	config.set('foo', fixture);
});

// See #32
test('doesn\'t write to disk upon instanciation if and only if the store didn\'t change', t => {
	let exists = fs.existsSync(t.context.config.path);
	t.is(exists, false);

	const config = new Conf({
		cwd: temporaryDirectory(),
		defaults: {
			foo: 'bar',
		},
	});
	exists = fs.existsSync(config.path);
	t.is(exists, true);
});

test('`clearInvalidConfig` option - invalid data', t => {
	t.throws(() => {
		const cwd = temporaryDirectory();

		fs.writeFileSync(path.join(cwd, 'config.json'), '🦄');

		new Conf({cwd, clearInvalidConfig: false});
	}, {instanceOf: SyntaxError});
});

test('`clearInvalidConfig` option - valid data', t => {
	const config = new Conf({cwd: temporaryDirectory(), clearInvalidConfig: false});
	config.set('foo', 'bar');
	t.deepEqual(config.store, {foo: 'bar'});
});

test('schema - should be an object', t => {
	const schema: any = 'object';
	t.throws(() => {
		new Conf({cwd: temporaryDirectory(), schema}); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
	}, {message: 'The `schema` option must be an object.'});
});

test('schema - valid set', t => {
	const schema: Schema<{foo: {bar: number; foobar: number}}> = {
		foo: {
			type: 'object',
			properties: {
				bar: {
					type: 'number',
				},
				foobar: {
					type: 'number',
					maximum: 100,
				},
			},
		},
	};
	const config = new Conf({cwd: temporaryDirectory(), schema});
	t.notThrows(() => {
		config.set('foo', {bar: 1, foobar: 2});
	});
});

test('schema - one violation', t => {
	const config = new Conf({
		cwd: temporaryDirectory(),
		schema: {
			foo: {
				type: 'string',
			},
		},
	});
	t.throws(() => {
		config.set('foo', 1);
	}, {message: 'Config schema violation: `foo` must be string'});
});

test('schema - multiple violations', t => {
	const schema: Schema<{foo: {bar: number; foobar: number}}> = {
		foo: {
			type: 'object',
			properties: {
				bar: {
					type: 'number',
				},
				foobar: {
					type: 'number',
					maximum: 100,
				},
			},
		},
	};
	const config = new Conf({cwd: temporaryDirectory(), schema});
	t.throws(() => {
		config.set('foo', {bar: '1', foobar: 101});
	}, {message: 'Config schema violation: `foo/bar` must be number; `foo/foobar` must be <= 100'});
});

test('schema - complex schema', t => {
	const schema: Schema<{foo: string; bar: number[]}> = {
		foo: {
			type: 'string',
			maxLength: 3,
			pattern: '[def]+',
		},
		bar: {
			type: 'array',
			uniqueItems: true,
			maxItems: 3,
			items: {
				type: 'integer',
			},
		},
	};

	const config = new Conf({cwd: temporaryDirectory(), schema});

	t.throws(() => {
		config.set('foo', 'abca');
	}, {message: 'Config schema violation: `foo` must NOT have more than 3 characters; `foo` must match pattern "[def]+"'});

	t.throws(() => {
		config.set('bar', [1, 1, 2, 'a']);
	}, {message: 'Config schema violation: `bar` must NOT have more than 3 items; `bar/3` must be integer; `bar` must NOT have duplicate items (items ## 1 and 0 are identical)'});
});

test('schema - supports formats', t => {
	const config = new Conf({
		cwd: temporaryDirectory(),
		schema: {
			foo: {
				type: 'string',
				format: 'uri',
			},
		},
	});
	t.throws(() => {
		config.set('foo', 'bar');
	}, {message: 'Config schema violation: `foo` must match format "uri"'});
});

test('schema - invalid write to config file', t => {
	const schema: Schema<{foo: string}> = {
		foo: {
			type: 'string',
		},
	};

	const cwd = temporaryDirectory();

	fs.writeFileSync(path.join(cwd, 'config.json'), JSON.stringify({foo: 1}));

	t.throws(() => {
		const config = new Conf({cwd, schema});
		config.get('foo');
	}, {message: 'Config schema violation: `foo` must be string'});
});

test('schema - default', t => {
	const schema: Schema<{foo: string}> = {
		foo: {
			type: 'string',
			default: 'bar',
		},
	};
	const config = new Conf({
		cwd: temporaryDirectory(),
		schema,
	});

	const foo: string = config.get('foo', '');
	t.is(foo, 'bar');
});

test('schema - Conf defaults overwrites schema default', t => {
	const schema: Schema<{foo: string}> = {
		foo: {
			type: 'string',
			default: 'bar',
		},
	};
	const config = new Conf({
		cwd: temporaryDirectory(),
		defaults: {
			foo: 'foo',
		},
		schema,
	});
	t.is(config.get('foo'), 'foo');
});

test('schema - validate Conf default', t => {
	const schema: Schema<{foo: string}> = {
		foo: {
			type: 'string',
		},
	};
	t.throws(() => {
		new Conf({
			cwd: temporaryDirectory(),
			defaults: {
				// For our tests to fail and typescript to compile, we'll ignore this ts error.
				// This error is not bad and means the package is well typed.
				// @ts-expect-error
				foo: 1,
			},
			schema,
		});
	}, {message: 'Config schema violation: `foo` must be string'});
});

test('.get() - without dot notation', t => {
	t.is(t.context.configWithoutDotNotation.get('foo'), undefined);
	t.is(t.context.configWithoutDotNotation.get('foo', '🐴'), '🐴');
	t.context.configWithoutDotNotation.set('foo', fixture);
	t.is(t.context.configWithoutDotNotation.get('foo'), fixture);
});

test('.set() - without dot notation', t => {
	t.context.configWithoutDotNotation.set('foo', fixture);
	t.context.configWithoutDotNotation.set('baz.boo', fixture);
	t.is(t.context.configWithoutDotNotation.get('foo'), fixture);
	t.is(t.context.configWithoutDotNotation.get('baz.boo'), fixture);
});

test('.set() - with object - without dot notation', t => {
	t.context.configWithoutDotNotation.set({
		foo1: 'bar1',
		foo2: 'bar2',
		baz: {
			boo: 'foo',
			foo: {
				bar: 'baz',
			},
		},
	});
	t.is(t.context.configWithoutDotNotation.get('foo1'), 'bar1');
	t.is(t.context.configWithoutDotNotation.get('foo2'), 'bar2');
	t.deepEqual(t.context.configWithoutDotNotation.get('baz'), {boo: 'foo', foo: {bar: 'baz'}});
	t.is(t.context.configWithoutDotNotation.get('baz.boo'), undefined);
	t.is(t.context.configWithoutDotNotation.get('baz.foo.bar'), undefined);
});

test('.has() - without dot notation', t => {
	t.context.configWithoutDotNotation.set('foo', fixture);
	t.context.configWithoutDotNotation.set('baz.boo', fixture);
	t.true(t.context.configWithoutDotNotation.has('foo'));
	t.true(t.context.configWithoutDotNotation.has('baz.boo'));
	t.false(t.context.configWithoutDotNotation.has('missing'));
});

test('.delete() - without dot notation', t => {
	const {configWithoutDotNotation} = t.context;
	configWithoutDotNotation.set('foo', 'bar');
	configWithoutDotNotation.set('baz.boo', true);
	configWithoutDotNotation.set('baz.foo.bar', 'baz');
	configWithoutDotNotation.delete('foo');
	t.is(configWithoutDotNotation.get('foo'), undefined);
	configWithoutDotNotation.delete('baz.boo');
	t.not(configWithoutDotNotation.get('baz.boo'), true);
	configWithoutDotNotation.delete('baz.foo');
	t.not(configWithoutDotNotation.get('baz.foo'), {bar: 'baz'});
	configWithoutDotNotation.set('foo.bar.baz', {awesome: 'icecream'});
	configWithoutDotNotation.set('foo.bar.zoo', {awesome: 'redpanda'});
	configWithoutDotNotation.delete('foo.bar.baz');
	t.deepEqual(configWithoutDotNotation.get('foo.bar.zoo'), {awesome: 'redpanda'});
});

test('`watch` option watches for config file changes by another process', async t => {
	const cwd = temporaryDirectory();
	const config1 = new Conf({cwd, watch: true});
	config1.set('foo', '👾');

	t.plan(4);

	const checkFoo = (newValue: unknown, oldValue: unknown): void => {
		t.is(newValue, '🐴');
		t.is(oldValue, '👾');
	};

	const config2 = new Conf({cwd});

	t.is(config2.get('foo'), '👾');
	t.is(config1.path, config2.path);
	config1.onDidChange('foo', checkFoo);

	(async () => {
		await delay(50);
		config2.set('foo', '🐴');
	})();

	const {events: _events} = config1;

	await pEvent(_events, 'change');
});

test('`watch` option watches for config file changes by file write', async t => {
	const cwd = temporaryDirectory();
	const config = new Conf({cwd, watch: true});
	config.set('foo', '🐴');

	t.plan(2);

	const checkFoo = (newValue: unknown, oldValue: unknown): void => {
		t.is(newValue, '🦄');
		t.is(oldValue, '🐴');
	};

	config.onDidChange('foo', checkFoo);

	const delayOS = process.platform === 'win32' ? 50 : 5000;

	(async () => {
		await delay(delayOS);

		fs.writeFileSync(path.join(cwd, 'config.json'), JSON.stringify({foo: '🦄'}));
	})();

	const {events} = config || {};

	await pEvent(events, 'change');
});

test('migrations - should save the project version as the initial migrated version', t => {
	const cwd = temporaryDirectory();

	const config = new Conf({cwd, projectVersion: '0.0.2', migrations: {}});

	t.is(config.get('__internal__.migrations.version'), '0.0.2');
});

test('migrations - should save the project version when a migration occurs', t => {
	const cwd = temporaryDirectory();

	const migrations = {
		'0.0.3'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
	};

	const config = new Conf({cwd, projectVersion: '0.0.2', migrations});

	t.is(config.get('__internal__.migrations.version'), '0.0.2');

	const config2 = new Conf({cwd, projectVersion: '0.0.4', migrations});

	t.is(config2.get('__internal__.migrations.version'), '0.0.4');
	t.is(config2.get('foo'), 'cool stuff');
});

test('migrations - should NOT run the migration when the version doesn\'t change', t => {
	const cwd = temporaryDirectory();

	const migrations = {
		'1.0.0'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
	};

	const config = new Conf({cwd, projectVersion: '0.0.2', migrations});
	t.is(config.get('__internal__.migrations.version'), '0.0.2');
	t.false(config.has('foo'));

	const config2 = new Conf({cwd, projectVersion: '0.0.2', migrations});

	t.is(config2.get('__internal__.migrations.version'), '0.0.2');
	t.false(config2.has('foo'));
});

test('migrations - should run the migration when the version changes', t => {
	const cwd = temporaryDirectory();

	const migrations = {
		'1.0.0'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
	};

	const config = new Conf({cwd, projectVersion: '0.0.2', migrations});
	t.is(config.get('__internal__.migrations.version'), '0.0.2');
	t.false(config.has('foo'));

	const config2 = new Conf({cwd, projectVersion: '1.1.0', migrations});

	t.is(config2.get('__internal__.migrations.version'), '1.1.0');
	t.true(config2.has('foo'));
	t.is(config2.get('foo'), 'cool stuff');
});

test('migrations - should run the migration when the version uses semver comparisons', t => {
	const cwd = temporaryDirectory();
	const migrations = {
		'>=1.0'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
	};

	const config = new Conf({cwd, projectVersion: '1.0.2', migrations});
	t.is(config.get('__internal__.migrations.version'), '1.0.2');
	t.is(config.get('foo'), 'cool stuff');
});

test('migrations - should run the migration when the version uses multiple semver comparisons', t => {
	const cwd = temporaryDirectory();
	const migrations = {
		'>=1.0'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
		'>2.0.0'(store: Conf) {
			store.set('foo', 'modern cool stuff');
		},
	};

	const config = new Conf({cwd, projectVersion: '1.0.2', migrations});
	t.is(config.get('__internal__.migrations.version'), '1.0.2');
	t.is(config.get('foo'), 'cool stuff');

	const config2 = new Conf({cwd, projectVersion: '2.0.1', migrations});
	t.is(config2.get('__internal__.migrations.version'), '2.0.1');
	t.is(config2.get('foo'), 'modern cool stuff');
});

test('migrations - should run all valid migrations when the version uses multiple semver comparisons', t => {
	const cwd = temporaryDirectory();
	const migrations = {
		'>=1.0'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
		'>2.0.0'(store: Conf) {
			store.set('woof', 'oof');
			store.set('medium', 'yes');
		},
		'<3.0.0'(store: Conf) {
			store.set('woof', 'woof');
			store.set('heart', '❤');
		},
	};

	const config = new Conf({cwd, projectVersion: '2.4.0', migrations});
	t.is(config.get('__internal__.migrations.version'), '2.4.0');
	t.is(config.get('foo'), 'cool stuff');
	t.is(config.get('medium'), 'yes');
	t.is(config.get('woof'), 'woof');
	t.is(config.get('heart'), '❤');
});

test('migrations - should cleanup migrations with non-numeric values', t => {
	const cwd = temporaryDirectory();
	const migrations = {
		'1.0.1-alpha'(store: Conf) {
			store.set('foo', 'cool stuff');
		},
		'>2.0.0-beta'(store: Conf) {
			store.set('woof', 'oof');
			store.set('medium', 'yes');
		},
		'<3.0.0'(store: Conf) {
			store.set('woof', 'woof');
			store.set('heart', '❤');
		},
	};

	const config = new Conf({cwd, projectVersion: '2.4.0', migrations});
	t.is(config.get('__internal__.migrations.version'), '2.4.0');
	t.is(config.get('foo'), 'cool stuff');
	t.is(config.get('medium'), 'yes');
	t.is(config.get('woof'), 'woof');
	t.is(config.get('heart'), '❤');
});

test('migrations - should NOT throw an error when project version is unspecified but there are no migrations', t => {
	const cwd = temporaryDirectory();

	t.notThrows(() => {
		const config = new Conf({cwd});
		config.clear();
	});
});

test('migrations - should not create the previous migration key if the migrations aren\'t needed', t => {
	const cwd = temporaryDirectory();

	const config = new Conf({cwd});
	t.false(config.has('__internal__.migrations.version'));
});

test('migrations error handling - should rollback changes if a migration failed', t => {
	const cwd = temporaryDirectory();

	const failingMigrations = {
		'1.0.0'(store: Conf) {
			store.set('foo', 'initial update');
		},
		'1.0.1'(store: Conf) {
			store.set('foo', 'updated before crash');

			throw new Error('throw the migration and rollback');

			// eslint-disable-next-line no-unreachable
			store.set('foo', 'can you reach here?');
		},
	};

	const passingMigrations = {
		'1.0.0'(store: Conf) {
			store.set('foo', 'initial update');
		},
	};

	let config = new Conf({cwd, projectVersion: '1.0.0', migrations: passingMigrations});

	t.throws(() => {
		config = new Conf({cwd, projectVersion: '1.0.2', migrations: failingMigrations});
	}, {message: /throw the migration and rollback/});

	t.is(config.get('__internal__.migrations.version'), '1.0.0');
	t.true(config.has('foo'));
	t.is(config.get('foo'), 'initial update');
});

test('__internal__ keys - should not be accessible by the user', t => {
	const cwd = temporaryDirectory();

	const config = new Conf({cwd});

	t.throws(() => {
		config.set('__internal__.you-shall', 'not-pass');
	}, {message: /Please don't use the __internal__ key/});
});

test('__internal__ keys - should not be accessible by the user even without dot notation', t => {
	const cwd = temporaryDirectory();

	const config = new Conf({cwd, accessPropertiesByDotNotation: false});

	t.throws(() => {
		config.set({
			__internal__: {
				'you-shall': 'not-pass',
			},
		});
	}, {message: /Please don't use the __internal__ key/});
});

test('__internal__ keys - should only match specific "__internal__" entry', t => {
	const cwd = temporaryDirectory();

	const config = new Conf({cwd});

	t.notThrows(() => {
		config.set('__internal__foo.you-shall', 'not-pass');
	});
});

test('beforeEachMigration - should be called before every migration', t => {
	const config = new Conf({
		cwd: temporaryDirectory(),
		projectVersion: '2.0.0',
		beforeEachMigration(store, context) {
			store.set(`beforeEachMigration ${context.fromVersion} → ${context.toVersion}`, true);
		},
		migrations: {
			'1.0.0'() {},
			'1.0.1'() {},
			'2.0.1'() {},
		},
	});

	t.true(config.get('beforeEachMigration 0.0.0 → 1.0.0'));
	t.true(config.get('beforeEachMigration 1.0.0 → 1.0.1'));
	t.false(config.has('beforeEachMigration 1.0.1 → 2.0.1'));
});

test('migration', async t => {
	const migrationHandler = (data: typeof config) => {
		data.set('counter', data.get('counter', 0) + 1);
	};

	const cwd = temporaryDirectory();

	const options = {
		cwd,
		configName: 'test',
		projectName: 'test',
		defaults: {
			counter: 0,
		},
	};

	new Conf({
		...options,
		projectVersion: '0.0.0',
	});

	const config = new Conf({
		...options,
		projectVersion: '1.0.1',
		migrations: {
			'0.9.9'(store) {
				console.log('Migrating from 0.x.x to 0.9.9');
				migrationHandler(store);
				// Migrated
				return store;
			},
			'1.0.0'(store) {
				console.log('Migrating from 0.9.9 to 1.0.0');
				migrationHandler(store);
				// Migrated
				return store;
			},
		},
	});

	// Add an assertion to verify the config was created successfully
	t.truthy(config);
	t.is(config.get('counter'), 2);
});

test('schema - validate rootSchema', t => {
	t.throws(() => {
		const config = new Conf({
			cwd: temporaryDirectory(),
			rootSchema: {
				additionalProperties: false,
			},
		});
		config.set('foo', 'bar');
	}, {message: 'Config schema violation: `` must NOT have additional properties'});
});

test('AJV - validate AJV options', t => {
	const config = new Conf({
		cwd: temporaryDirectory(),
		ajvOptions: {
			removeAdditional: true,
		},
		rootSchema: {
			additionalProperties: false,
		},
	});
	config.set('foo', 'bar');
	t.is(config.get('foo'), undefined);
});

test('Rapid save test', async t => {
	const cwd = temporaryDirectory();
	const config = new Conf({cwd, changeTimeout: 100});

	const iterations = 100;

	let saves = 0;
	const unsubscribe = config.onDidAnyChange(() => {
		saves += 1;
	});

	for (let i = 0; i < iterations; i++) {
		config.set('counter', i);
	}

	// Add an assertion to verify the config was created successfully
	t.truthy(config);
	t.is(config.get('counter'), iterations - 1);
	t.is(saves, 1);

	unsubscribe();
});

test('Rapid save test - async', async t => {
	const cwd = temporaryDirectory();
	const config = new Conf({cwd, changeTimeout: 100});
	const iterations = 100;

	let counter = 0;
	let saves = 0;

	const unsubscribe = config.onDidAnyChange(() => {
		saves += 1;
	});

	for (let i = 0; i < iterations; i++) {
		counter = i;
		config.set('counter', counter);
	}

	performance.mark('delay');

	await delay(0);

	config.set('counter', ++counter);

	const measurement = performance.measure('delay');

	await delay(200);

	// Add an assertion to verify the config was created successfully
	t.truthy(config);
	t.is(config.get('counter'), counter);
	t.is(saves, measurement.duration > 100 ? 3 : 2);

	unsubscribe();
});
