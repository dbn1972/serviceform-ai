import { fileURLToPath } from 'node:url';
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
  type BundleOptions,
  type NativeConnectionOptions,
  type WorkflowBundle,
} from '@temporalio/worker';
import type { CanonicalActivities } from './activity-types.js';

/** Workflow module bundled for the sandbox: canonical model only, never BPMN. */
export const WORKFLOWS_PATH = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? './workflows.ts' : './workflows.js', import.meta.url),
);

/** NodeNext sources import `.js` specifiers; let the workflow bundler resolve them to `.ts`. */
const webpackConfigHook: NonNullable<BundleOptions['webpackConfigHook']> = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});

export async function bundleCanonicalWorkflows(): Promise<WorkflowBundle> {
  return bundleWorkflowCode({ workflowsPath: WORKFLOWS_PATH, webpackConfigHook });
}

export interface CanonicalWorkerOptions {
  connection: NativeConnection;
  namespace: string;
  taskQueue: string;
  activities: CanonicalActivities;
  /** Pre-built bundle (production builds); omitted means bundle WORKFLOWS_PATH at startup. */
  workflowBundle?: WorkflowBundle;
}

/** Worker for WORKFLOW_TYPE `serviceformCanonicalWorkflow` on the CMP-016 task queue. */
export async function createCanonicalWorker(options: CanonicalWorkerOptions): Promise<Worker> {
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    activities: options.activities,
    ...(options.workflowBundle
      ? { workflowBundle: options.workflowBundle }
      : { workflowsPath: WORKFLOWS_PATH, bundlerOptions: { webpackConfigHook } }),
  });
}

/** Opens the worker's own native connection; the caller owns `connection.close()`. */
export async function connectCanonicalWorker(
  options: Omit<CanonicalWorkerOptions, 'connection'> & {
    address: string;
    tls?: NativeConnectionOptions['tls'];
  },
): Promise<{ worker: Worker; connection: NativeConnection }> {
  const { address, tls, ...rest } = options;
  const connection = await NativeConnection.connect({
    address,
    ...(tls === undefined ? {} : { tls }),
  });
  try {
    return { worker: await createCanonicalWorker({ ...rest, connection }), connection };
  } catch (err) {
    await connection.close();
    throw err;
  }
}
