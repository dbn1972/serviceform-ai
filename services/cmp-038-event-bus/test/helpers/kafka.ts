import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, mkdtempSync, openSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KAFKA_HOME = process.env['KAFKA_HOME'] ?? '/var/tmp/kafka/kafka_2.13-4.1.0';
const PORT = Number(process.env['SF_KAFKA_PORT'] ?? '19092');
const CONTROLLER_PORT = Number(process.env['SF_KAFKA_CONTROLLER_PORT'] ?? '19093');

let child: ChildProcess | undefined;
let logDir: string | undefined;

function waitPortClosed(port: number, host = '127.0.0.1', timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host, port }, () => {
        sock.end();
        if (Date.now() - start > timeoutMs) {
          reject(new Error('timeout waiting for port ' + port + ' to close'));
          return;
        }
        setTimeout(tryOnce, 300);
      });
      sock.on('error', () => {
        sock.destroy();
        resolve();
      });
    };
    tryOnce();
  });
}

function waitPort(port: number, host = '127.0.0.1', timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host, port }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error('timeout waiting for port ' + port));
          return;
        }
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

function listenerPids(port: number): number[] {
  try {
    const out = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\s+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 1);
  } catch {
    return [];
  }
}

function killPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

function killGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      // fall through to the direct child
    }
  }
  try {
    proc.kill(signal);
  } catch {
    // already gone
  }
}

async function freeLocalPorts(): Promise<void> {
  killPids([...listenerPids(PORT), ...listenerPids(CONTROLLER_PORT)], 'SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  killPids([...listenerPids(PORT), ...listenerPids(CONTROLLER_PORT)], 'SIGKILL');
  await waitPortClosed(PORT, '127.0.0.1', 15_000).catch(() => undefined);
}

function spawnBroker(props: string): ChildProcess {
  const heap = process.env['KAFKA_HEAP_OPTS'] ?? '-Xmx512m';
  // Prefer a writable LOG_DIR under the kraft scratch tree. If KAFKA_HOME is not
  // runner-owned (historical sudo extract), default $KAFKA_HOME/logs mkdir fails
  // and the JVM aborts before PLAINTEXT binds.
  const jvmLogDir = logDir ? join(logDir, 'jvm-logs') : undefined;
  if (jvmLogDir) mkdirSync(jvmLogDir, { recursive: true, mode: 0o700 });
  const out =
    process.env['SF_KAFKA_DEBUG'] === '1' && logDir
      ? join(logDir, 'broker.log')
      : jvmLogDir
        ? join(jvmLogDir, 'broker.stdout.log')
        : undefined;
  const fd = out ? openSync(out, 'a') : undefined;
  return spawn(join(KAFKA_HOME, 'bin', 'kafka-server-start.sh'), [props], {
    env: {
      ...process.env,
      KAFKA_HEAP_OPTS: heap,
      ...(jvmLogDir ? { LOG_DIR: jvmLogDir } : {}),
    },
    stdio: fd !== undefined ? ['ignore', fd, fd] : 'ignore',
    detached: true,
  });
}

export function kafkaBrokers(): string[] {
  const fromEnv = (process.env['SF_KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return ['127.0.0.1:' + PORT];
}

export function kafkaOwned(): boolean {
  return child !== undefined;
}

export async function ensureKafka(): Promise<string[]> {
  if (child) return kafkaBrokers();
  const fromEnv = (process.env['SF_KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) {
    const first = fromEnv[0] ?? '127.0.0.1:' + PORT;
    const [host, portStr] = first.split(':');
    await waitPort(Number(portStr ?? PORT), host || '127.0.0.1', 15_000);
    return fromEnv;
  }
  if (!existsSync(join(KAFKA_HOME, 'bin', 'kafka-server-start.sh'))) {
    throw new Error('Kafka 4.1.0 tarball not found at ' + KAFKA_HOME + ' (004-29 must execute)');
  }
  await freeLocalPorts();
  const scratchRoot = join(dirname(fileURLToPath(import.meta.url)), '../../test-results/kafka');
  mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  logDir = mkdtempSync(join(scratchRoot, 'kraft-'));
  const props = join(logDir, 'server.properties');
  writeFileSync(
    props,
    [
      'process.roles=broker,controller',
      'node.id=1',
      // Bind 127.0.0.1 explicitly: GHA runners may resolve localhost to ::1 first.
      'controller.quorum.bootstrap.servers=127.0.0.1:' + CONTROLLER_PORT,
      'listeners=PLAINTEXT://127.0.0.1:' + PORT + ',CONTROLLER://127.0.0.1:' + CONTROLLER_PORT,
      'inter.broker.listener.name=PLAINTEXT',
      'advertised.listeners=PLAINTEXT://127.0.0.1:' +
        PORT +
        ',CONTROLLER://127.0.0.1:' +
        CONTROLLER_PORT,
      'controller.listener.names=CONTROLLER',
      'listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
      'log.dirs=' + join(logDir, 'logs'),
      'num.network.threads=3',
      'num.io.threads=4',
      'num.partitions=1',
      'offsets.topic.replication.factor=1',
      'transaction.state.log.replication.factor=1',
      'transaction.state.log.min.isr=1',
      'group.initial.rebalance.delay.ms=0',
      'auto.create.topics.enable=false',
    ].join('\n') + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );
  const clusterId = await new Promise<string>((resolve, reject) => {
    const p = spawn(join(KAFKA_HOME, 'bin', 'kafka-storage.sh'), ['random-uuid'], {
      env: { ...process.env, KAFKA_HEAP_OPTS: '-Xmx64m' },
    });
    let out = '';
    p.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    p.on('exit', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error('random-uuid ' + code)),
    );
    p.on('error', reject);
  });
  const storage = spawn(
    join(KAFKA_HOME, 'bin', 'kafka-storage.sh'),
    ['format', '--standalone', '--ignore-formatted', '-t', clusterId, '-c', props],
    { env: { ...process.env, KAFKA_HEAP_OPTS: '-Xmx256m' } },
  );
  await new Promise<void>((resolve, reject) => {
    storage.on('exit', (code) =>
      code === 0 || code === 1
        ? resolve()
        : reject(new Error('kafka-storage format ' + String(code))),
    );
    storage.on('error', reject);
  });
  child = spawnBroker(props);
  await waitPort(PORT, '127.0.0.1', 90_000);
  process.env['SF_KAFKA_BROKERS'] = '127.0.0.1:' + PORT;
  return kafkaBrokers();
}

export async function stopKafka(): Promise<void> {
  if (child) {
    killGroup(child, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 2000));
    killGroup(child, 'SIGKILL');
    child = undefined;
  }
  killPids([...listenerPids(PORT), ...listenerPids(CONTROLLER_PORT)], 'SIGKILL');
  delete process.env['SF_KAFKA_BROKERS'];
  await waitPortClosed(PORT, '127.0.0.1', 20_000);
}

export async function startKafkaAgain(): Promise<void> {
  if (!logDir) throw new Error('kafka was not started by this helper');
  await waitPortClosed(PORT, '127.0.0.1', 15_000).catch(() => undefined);
  const props = join(logDir, 'server.properties');
  child = spawnBroker(props);
  await waitPort(PORT, '127.0.0.1', 90_000);
}
