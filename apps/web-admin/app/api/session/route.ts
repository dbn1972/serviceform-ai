import { handleClearSession, handleCreateSession, handleReadSession } from '../../../lib/handlers';

export const dynamic = 'force-dynamic';

const SURFACES = ['tenant_admin', 'platform_ops'] as const;

export function GET(request: Request): Response {
  return handleReadSession(request, [...SURFACES]);
}

export function POST(request: Request): Promise<Response> {
  return handleCreateSession(request, 'tenant_admin');
}

export function DELETE(): Response {
  return handleClearSession();
}
