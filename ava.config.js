const config = {
	files: ['test/*'],
	extensions: {
		ts: 'module',
	},
	nodeArguments: [
		'--loader=ts-node/esm',
	],
	workerThreads: false,
};

export default config;
