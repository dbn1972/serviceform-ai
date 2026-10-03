import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface StubOpa {
  url: string;
  calls: number;
  close: () => Promise<void>;
}

export function startStubOpa(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<StubOpa> {
  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const state = { calls: 0 };
      const orig = handler;
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        state.calls += 1;
        void orig(req, res);
      });
      resolve({
        url: `http://127.0.0.1:${port}`,
        get calls() {
          return state.calls;
        },
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

export function jsonAllow(res: ServerResponse, extra: Record<string, unknown> = {}): void {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      result: { allow: true, reason_code: 'ALLOW', policy_revision: 'w1-cmp048', ...extra },
    }),
  );
}

export function jsonDeny(res: ServerResponse, reason = 'ROLE_NOT_PERMITTED'): void {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({ result: { allow: false, reason_code: reason, policy_revision: 'w1-cmp048' } }),
  );
}
