// Bundles the API with its @serviceform/* workspace packages (shipped as TypeScript source);
// third-party packages stay external and are installed from the lockfile at deploy time.
// Fails if the bundle needs a third-party package that this app does not declare, so the
// deployable's package.json is always its complete runtime dependency list.
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const packageName = (spec) =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

const result = await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  metafile: true,
  plugins: [
    {
      name: 'externalise-third-party',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@serviceform/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});

const external = new Set();
for (const out of Object.values(result.metafile.outputs)) {
  for (const imp of out.imports)
    if (imp.external && !builtins.has(imp.path)) external.add(packageName(imp.path));
}
const missing = [...external].filter((name) => !declared.has(name)).sort();
if (missing.length > 0) {
  console.error(`apps/api bundle needs undeclared runtime dependencies: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`dist/server.js built; ${external.size} external runtime packages, all declared`);
