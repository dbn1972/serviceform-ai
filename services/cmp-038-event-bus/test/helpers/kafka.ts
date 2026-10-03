import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const KAFKA_HOME = process.env['KAFKA_HOME'] ?? '/var/tmp/kafka/kafka_2.13-4.1.0';
const PORT = Number(process.env['SF_KAFKA_PORT'] ?? '19092');
const CONTROLLER_PORT = Number(process.env['SF_KAFKA_CONTROLLER_PORT'] ?? '19093');

let child: ChildProcess | undefined;
let logDir: string | undefined;

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
  logDir = join(tmpdir(), 'sf-kraft-t004-' + process.pid);
  rmSync(logDir, { recursive: true, force: true });
  mkdirSync(logDir, { recursive: true });
  const props = join(logDir, 'server.properties');
  writeFileSync(
    props,
    [
      'process.roles=broker,controller',
      'node.id=1',
      'controller.quorum.bootstrap.servers=localhost:' + CONTROLLER_PORT,
      'listeners=PLAINTEXT://:' + PORT + ',CONTROLLER://:' + CONTROLLER_PORT,
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
  child = spawn(join(KAFKA_HOME, 'bin', 'kafka-server-start.sh'), [props], {
    env: { ...process.env, KAFKA_HEAP_OPTS: '-Xmx384m' },
    stdio: 'ignore',
  });
  await waitPort(PORT, '127.0.0.1', 90_000);
  process.env['SF_KAFKA_BROKERS'] = '127.0.0.1:' + PORT;
  return kafkaBrokers();
}

export async function stopKafka(): Promise<void> {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2000));
  child.kill('SIGKILL');
  child = undefined;
}

export async function startKafkaAgain(): Promise<void> {
  if (!logDir) throw new Error('kafka was not started by this helper');
  const props = join(logDir, 'server.properties');
  child = spawn(join(KAFKA_HOME, 'bin', 'kafka-server-start.sh'), [props], {
    env: { ...process.env, KAFKA_HEAP_OPTS: '-Xmx384m' },
    stdio: 'ignore',
  });
  await waitPort(PORT, '127.0.0.1', 90_000);
}
