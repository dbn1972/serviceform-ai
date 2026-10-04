import { handlePlatformProxy } from '../../../../lib/handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

export function GET(request: Request, ctx: Ctx): Promise<Response> {
  return ctx.params.then((p) => handlePlatformProxy(request, p.path, ['service_studio']));
}

export function POST(request: Request, ctx: Ctx): Promise<Response> {
  return ctx.params.then((p) => handlePlatformProxy(request, p.path, ['service_studio']));
}

export function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  return ctx.params.then((p) => handlePlatformProxy(request, p.path, ['service_studio']));
}
