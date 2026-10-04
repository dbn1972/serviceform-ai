import type {
  ModelProviderPort,
  ProviderEmbedOutput,
  ProviderInvokeOutput,
} from '../ports/provider.js';

export class ProviderTimeoutError extends Error {
  constructor() {
    super('provider call exceeded latency budget');
    this.name = 'ProviderTimeoutError';
  }
}

/** Bounded-latency provider call. The AbortSignal is passed through so adapters can cancel. */
export async function callWithBudget<T>(
  budgetMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, budgetMs);
  });
  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ProviderResult =
  { kind: 'invoke'; value: ProviderInvokeOutput } | { kind: 'embed'; value: ProviderEmbedOutput };

export async function callProvider(
  provider: ModelProviderPort,
  budgetMs: number,
  call:
    | { operation: 'INVOKE'; input: Omit<Parameters<ModelProviderPort['invoke']>[0], 'signal'> }
    | { operation: 'EMBED'; input: Omit<Parameters<ModelProviderPort['embed']>[0], 'signal'> },
): Promise<ProviderResult> {
  if (call.operation === 'INVOKE') {
    const value = await callWithBudget(budgetMs, (signal) =>
      provider.invoke({ ...call.input, signal }),
    );
    return { kind: 'invoke', value };
  }
  const value = await callWithBudget(budgetMs, (signal) =>
    provider.embed({ ...call.input, signal }),
  );
  return { kind: 'embed', value };
}
