import type { RequestContext } from '@serviceform/contracts';

export type RequestContextResolver = (headers: Record<string, unknown>) => RequestContext | null;
