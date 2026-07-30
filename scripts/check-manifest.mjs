import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failIfErrors, readJson, repositoryRoot, sha256 } from './verification-lib.mjs';

const require = createRequire(import.meta.url);
const errors = [];
const packagePath = resolve(repositoryRoot, 'package.json');
const packageLockPath = resolve(repositoryRoot, 'package-lock.json');
const actionsPath = resolve(repositoryRoot, 'contracts/actions.manifest.json');
const triggersPath = resolve(repositoryRoot, 'contracts/triggers.manifest.json');
const schemaPath = resolve(repositoryRoot, 'contracts/catalog-contract.schema.json');

function check(condition, message) {
	if (!condition) errors.push(message);
}

function sameJson(actual, expected, message) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		errors.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function unique(values, label) {
	const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
	check(
		duplicates.length === 0,
		`${label} contains duplicates: ${[...new Set(duplicates)].join(', ')}`,
	);
}

const [packageMetadata, packageLock, actions, triggers, schema] = await Promise.all([
	readJson(packagePath),
	readJson(packageLockPath),
	readJson(actionsPath),
	readJson(triggersPath),
	readJson(schemaPath),
]);

check(packageMetadata.name === 'n8n-nodes-sallaflow', 'Unexpected package name');
check(
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
		packageMetadata.version ?? '',
	),
	'Package version is not semantic versioning compatible',
);
check(
	typeof packageMetadata.description === 'string' &&
		packageMetadata.description.trim().length >= 20,
	'Package description is missing or too short',
);
check(packageMetadata.license === 'MIT', 'Package license must be MIT');
check(packageMetadata.private !== true, 'Public package must not be marked private');
check(
	packageMetadata.keywords?.includes('n8n-community-node-package'),
	'Package is missing the n8n community-node keyword',
);
unique(packageMetadata.keywords ?? [], 'Package keywords');
check(
	packageMetadata.repository?.type === 'git' &&
		packageMetadata.repository?.url === 'git+https://github.com/MoMorgan1/n8n-nodes-sallaflow.git',
	'Package repository URL does not identify the public node repository',
);
for (const [label, value] of [
	['homepage', packageMetadata.homepage],
	['issues URL', packageMetadata.bugs?.url],
	['author URL', packageMetadata.author?.url],
]) {
	try {
		const url = new URL(value);
		check(url.protocol === 'https:', `${label} must use HTTPS`);
	} catch {
		errors.push(`${label} is missing or invalid`);
	}
}
check(
	typeof packageMetadata.author?.name === 'string' && packageMetadata.author.name.trim() !== '',
	'Package author name is missing',
);
check(
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(packageMetadata.author?.email ?? ''),
	'Package support email is missing or invalid',
);
sameJson(
	[...(packageMetadata.files ?? [])].sort(),
	['CHANGELOG.md', 'LICENSE', 'README.md', 'dist'].sort(),
	'Package files allowlist differs from the reviewed release surface',
);
check(packageMetadata.n8n?.strict === true, 'n8n strict mode must be enabled');
check(packageMetadata.n8n?.n8nNodesApiVersion === 1, 'Unexpected n8n nodes API version');
check(
	packageMetadata.main === 'dist/nodes/SallaFlow/SallaFlow.node.js',
	'Unexpected package main entry',
);
check(
	(packageMetadata.n8n?.nodes ?? []).includes(packageMetadata.main),
	'Package main entry is not declared as an n8n node',
);
check(
	(packageMetadata.n8n?.nodes ?? []).length === 2,
	'Package must expose exactly the reviewed Action and Trigger nodes',
);
check(
	(packageMetadata.n8n?.credentials ?? []).length === 1,
	'Package must expose exactly the reviewed credential type',
);
unique(packageMetadata.n8n?.nodes ?? [], 'n8n node entries');
unique(packageMetadata.n8n?.credentials ?? [], 'n8n credential entries');
check(
	/^>=\d+\.\d+\.\d+$/.test(packageMetadata.engines?.node ?? ''),
	'Node.js engine must declare an explicit minimum patch version',
);
check(
	/^npm@\d+\.\d+\.\d+$/.test(packageMetadata.packageManager ?? ''),
	'packageManager must pin an exact npm version',
);
check(packageMetadata.publishConfig?.access === 'public', 'npm publication must be public');
check(packageMetadata.publishConfig?.provenance === true, 'npm provenance must be enabled');
check(
	packageMetadata.publishConfig?.registry === 'https://registry.npmjs.org/',
	'npm publish registry must be the public npm registry',
);
check(
	!packageMetadata.dependencies || Object.keys(packageMetadata.dependencies).length === 0,
	'Package must not contain runtime dependencies',
);
check(
	!packageMetadata.optionalDependencies ||
		Object.keys(packageMetadata.optionalDependencies).length === 0,
	'Package must not contain optional runtime dependencies',
);
sameJson(
	Object.keys(packageMetadata.peerDependencies ?? {}).sort(),
	['n8n-workflow'],
	'Package peer-dependency surface differs from the reviewed surface',
);
for (const [name, version] of Object.entries(packageMetadata.devDependencies ?? {})) {
	check(
		/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
		`Development dependency ${name} is not exactly pinned`,
	);
}
check(
	typeof packageMetadata.devDependencies?.['@n8n/node-cli'] === 'string',
	'Official @n8n/node-cli development tooling is missing',
);
for (const script of [
	'build',
	'build:check',
	'lint',
	'test',
	'test:coverage',
	'test:saved-workflows',
	'workflow:check-namespace',
	'workflow:migrate-namespace',
	'check:manifest',
	'check:source-dist',
	'check:compatibility',
	'check:security',
	'check:history',
	'pack:check',
	'prepublishOnly',
]) {
	check(
		typeof packageMetadata.scripts?.[script] === 'string',
		`Required script ${script} is missing`,
	);
}
check(packageMetadata.scripts?.build === 'n8n-node build', 'Build must use the official n8n CLI');
check(packageMetadata.scripts?.lint === 'n8n-node lint', 'Lint must use the official n8n CLI');
check(
	packageMetadata.scripts?.['workflow:check-namespace'] ===
		'node scripts/migrate-workflow-namespace.mjs --check',
	'Workflow namespace check must use the reviewed migration helper',
);
check(
	packageMetadata.scripts?.['workflow:migrate-namespace'] ===
		'node scripts/migrate-workflow-namespace.mjs',
	'Workflow namespace migration must use the reviewed migration helper',
);
check(
	packageMetadata.scripts?.prepublishOnly?.includes('n8n-node prerelease'),
	'Prepublish validation must run the official n8n prerelease check',
);

check(packageLock.lockfileVersion === 3, 'package-lock.json must use lockfile version 3');
check(packageLock.name === packageMetadata.name, 'Lockfile package name differs from package.json');
check(
	packageLock.version === packageMetadata.version,
	'Lockfile version differs from package.json',
);
const lockedRoot = packageLock.packages?.[''];
check(Boolean(lockedRoot), 'Lockfile has no root package entry');
if (lockedRoot) {
	for (const field of [
		'name',
		'version',
		'license',
		'engines',
		'peerDependencies',
		'devDependencies',
	]) {
		sameJson(
			lockedRoot[field],
			packageMetadata[field],
			`Lockfile root field ${field} differs from package.json`,
		);
	}
}
check(
	actions.schemaVersion === 1 && actions.runtimeGeneration === false,
	'Invalid Action manifest header',
);
check(
	triggers.schemaVersion === 1 && triggers.runtimeGeneration === false,
	'Invalid Trigger manifest header',
);
check(
	schema.properties?.schemaVersion?.const === 1,
	'Contract schema does not lock schemaVersion 1',
);
check(
	schema.properties?.runtimeGeneration?.const === false,
	'Contract schema does not lock validation-only manifests',
);

for (const entry of [
	...(packageMetadata.n8n?.nodes ?? []),
	...(packageMetadata.n8n?.credentials ?? []),
]) {
	const absolute = resolve(repositoryRoot, entry);
	check(
		absolute.startsWith(resolve(repositoryRoot, 'dist') + '/'),
		`n8n entry escapes dist: ${entry}`,
	);
	try {
		require.resolve(absolute);
	} catch {
		errors.push(`n8n entry does not exist or cannot be resolved: ${entry}`);
	}
}

let SallaFlow;
let SallaFlowTrigger;
try {
	({ SallaFlow } = require(resolve(repositoryRoot, 'dist/nodes/SallaFlow/SallaFlow.node.js')));
	({ SallaFlowTrigger } = require(
		resolve(repositoryRoot, 'dist/nodes/SallaFlowTrigger/SallaFlowTrigger.node.js'),
	));
} catch (error) {
	errors.push(`Built nodes could not be loaded: ${error.message}`);
}

if (SallaFlow && SallaFlowTrigger) {
	const action = new SallaFlow();
	const trigger = new SallaFlowTrigger();
	const resourceProperty = action.description.properties.find(
		(property) => property.name === 'resource',
	);
	const resources = (resourceProperty?.options ?? []).map(({ name, value, description }) => ({
		name,
		value,
		description,
	}));
	const operations = action.description.properties
		.filter(
			(property) =>
				property.name === 'operation' && property.displayOptions?.show?.resource?.length === 1,
		)
		.flatMap((property) =>
			property.options.map(({ name, value, action: actionLabel, description }) => ({
				resource: property.displayOptions.show.resource[0],
				name,
				value,
				action: actionLabel,
				description: description || null,
			})),
		)
		.sort((left, right) =>
			`${left.resource}.${left.value}`.localeCompare(`${right.resource}.${right.value}`),
		);
	const operationIds = operations.map(({ resource, value }) => `${resource}.${value}`);
	const manifestOperationIds = actions.operations.map(({ id }) => id).sort();

	check(action.description.name === actions.node.name, 'Action node name differs from manifest');
	check(
		action.description.version === actions.node.typeVersion,
		'Action type version differs from manifest',
	);
	check(
		resources.length === actions.node.resourceCount,
		'Action resource count differs from manifest',
	);
	check(
		operations.length === actions.node.operationCount,
		'Action operation count differs from manifest',
	);
	sameJson(
		resources.map(({ value }) => value),
		actions.resources,
		'Action resource identifiers differ from manifest',
	);
	sameJson(operationIds, manifestOperationIds, 'Action operation identifiers differ from manifest');
	check(
		sha256(JSON.stringify(resources)) === actions.descriptorHashes?.resourcesSha256,
		'Action resource descriptor hash differs from manifest',
	);
	check(
		sha256(JSON.stringify(operations)) === actions.descriptorHashes?.operationsSha256,
		'Action operation descriptor hash differs from manifest',
	);
	unique(actions.resources, 'Action resources');
	unique(manifestOperationIds, 'Action operations');

	const loaders = Object.keys(action.methods?.loadOptions ?? {}).sort();
	sameJson(
		loaders,
		[...actions.dynamicLoaders].sort(),
		'Dynamic loader names differ from manifest',
	);

	const eventOptions =
		trigger.description.properties.find((property) => property.name === 'event')?.options ?? [];
	const eventDescriptors = eventOptions.map(({ name, value, description }) => ({
		name,
		value,
		description: description || null,
	}));
	const selectableEvents = eventOptions.map(({ value }) => value);
	const declaredEvents = [
		...triggers.canonicalEvents,
		...Object.keys(triggers.legacyAliases ?? {}),
	];

	check(trigger.description.name === triggers.node.name, 'Trigger node name differs from manifest');
	check(
		trigger.description.version === triggers.node.typeVersion,
		'Trigger type version differs from manifest',
	);
	check(
		triggers.canonicalEvents.length === triggers.node.canonicalEventCount,
		'Canonical trigger count differs from manifest',
	);
	check(
		selectableEvents.length === triggers.node.selectableEventCount,
		'Selectable trigger count differs from manifest',
	);
	check(
		sha256(JSON.stringify(eventDescriptors)) === triggers.descriptorHash,
		'Trigger descriptor hash differs from manifest',
	);
	sameJson(
		[...selectableEvents].sort(),
		[...declaredEvents].sort(),
		'Trigger identifiers differ from manifest',
	);
	unique(selectableEvents, 'Trigger options');
	for (const [alias, canonical] of Object.entries(triggers.legacyAliases ?? {})) {
		check(alias !== canonical, `Trigger alias ${alias} maps to itself`);
		check(
			triggers.canonicalEvents.includes(canonical),
			`Trigger alias ${alias} maps to undeclared event ${canonical}`,
		);
	}
}

const validMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'DYNAMIC']);
for (const operation of actions.operations ?? []) {
	check(typeof operation.id === 'string' && operation.id.includes('.'), 'Malformed operation ID');
	check(
		Array.isArray(operation.requests) && operation.requests.length > 0,
		`${operation.id} has no requests`,
	);
	for (const request of operation.requests ?? []) {
		check(validMethods.has(request.method), `${operation.id} has invalid method ${request.method}`);
		check(
			typeof request.backend === 'string' && request.backend.startsWith('/api/v1/'),
			`${operation.id} has an invalid backend path`,
		);
		check(
			typeof request.upstream === 'string' && request.upstream.startsWith('/admin/v2/'),
			`${operation.id} has an invalid upstream path`,
		);
		check(!request.backend.includes('://'), `${operation.id} exposes a full backend URL`);
		check(!request.upstream.includes('://'), `${operation.id} exposes a full upstream URL`);
	}
}

const operationSet = new Set(actions.operations?.map(({ id }) => id));
for (const optionalRoute of actions.optionalRoutes ?? []) {
	check(
		operationSet.has(optionalRoute.operation),
		`Optional route refers to unknown operation ${optionalRoute.operation}`,
	);
}

if (typeof actions.scenarioContract === 'string') {
	const contractPath = resolve(dirname(actionsPath), actions.scenarioContract);
	try {
		require.resolve(contractPath);
	} catch {
		errors.push(`Scenario contract does not resolve: ${actions.scenarioContract}`);
	}
}

failIfErrors(errors, 'Manifest verification failed');
console.log(
	`Manifest verification passed: ${actions.node.resourceCount} resources, ` +
		`${actions.node.operationCount} operations, ${triggers.node.selectableEventCount} trigger choices.`,
);
