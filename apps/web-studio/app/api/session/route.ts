import { handleClearSession, handleCreateSession, handleReadSession } from '../../../lib/handlers';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  return handleReadSession(request, ['service_studio']);
}

export function POST(request: Request): Promise<Response> {
  return handleCreateSession(request, 'service_studio');
}

export function DELETE(): Response {
  return handleClearSession();
}
