/**
 * Architecture dependency rules (ci/ARCHITECTURE-GATES.md item 1; Constitution #23).
 * Component modules live in services/<cmp-id>-<name>/ from M01. They may depend on
 * packages/* and on another component only through packages/contracts.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-component-imports',
      comment:
        'Components integrate through contracts/events, never by importing each other (Constitution #23).',
      severity: 'error',
      from: { path: '^services/([^/]+)/' },
      to: { path: '^services/([^/]+)/', pathNot: '^services/$1/' },
    },
    {
      name: 'packages-do-not-import-apps-or-services',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|services)/' },
    },
    {
      name: 'apps-do-not-import-other-apps',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'web-apps-do-not-import-backend',
      comment: 'Browser surfaces talk to the API over HTTP contracts only.',
      severity: 'error',
      from: { path: '^apps/web-' },
      to: { path: '^(services/|apps/api/|packages/observability/)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|\\.next|dist|coverage|next-env\\.d\\.ts|apps/mobile)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    },
  },
};
