import { mkdir, readFile, writeFile } from 'node:fs/promises';

const inputPath = process.env.OPENAPI_SOURCE ?? '/tmp/router-v2.json';
const outputPath = 'openapi/router-v2.json';
const selectedOperations = [
  ['/memory/ingest', 'post'],
  ['/memory/retrieval', 'post'],
  ['/memory/retrieval/hybrid', 'post'],
  ['/memory/ingest/jobs/{job_id}', 'get'],
];

const source = JSON.parse(await readFile(inputPath, 'utf8'));
const snapshot = {
  openapi: source.openapi,
  info: source.info,
  servers: source.servers,
  paths: {},
  components: {
    schemas: {},
    securitySchemes: {
      ApiKeyAuth: source.components.securitySchemes.ApiKeyAuth,
    },
  },
};

for (const [path, method] of selectedOperations) {
  const operation = source.paths?.[path]?.[method];

  if (!operation) {
    throw new Error(`Router OpenAPI is missing ${method.toUpperCase()} ${path}`);
  }

  snapshot.paths[path] = { [method]: operation };
}

const componentReferences = new Set();
const collectReferences = (value) => {
  if (Array.isArray(value)) {
    value.forEach(collectReferences);
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string' && child.startsWith('#/components/schemas/')) {
      componentReferences.add(child.slice('#/components/schemas/'.length));
    } else {
      collectReferences(child);
    }
  }
};

collectReferences(snapshot.paths);

for (const name of componentReferences) {
  const schema = source.components.schemas[name];

  if (!schema) {
    throw new Error(`Router OpenAPI is missing schema ${name}`);
  }
  if (name.startsWith('Admin')) {
    throw new Error(`Refusing to include administrator schema ${name}`);
  }

  snapshot.components.schemas[name] = schema;
  collectReferences(schema);
}

await mkdir('openapi', { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
