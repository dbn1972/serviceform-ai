import { handlePlatformProxy } from '../../../../lib/handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };
const SURFACES = ['tenant_admin', 'platform_ops'] as const;

export function GET(request: Request, ctx: Ctx): Promise<Response> {
  return ctx.params.then((p) => handlePlatformProxy(request, p.path, [...SURFACES]));
}

export function POST(request: Request, ctx: Ctx): Promise<Response> {
  return ctx.params.then((p) => handlePlatformProxy(request, p.path, [...SURFACES]));
}

export function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  return ctx.params.then((p) => handlePlatformProxy(request, p.path, [...SURFACES]));
}
