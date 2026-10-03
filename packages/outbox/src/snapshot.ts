import snapshot from './registry-snapshot.json' with { type: 'json' };
import type { TopicRegistryReader, TopicSpec } from './registry-port.js';

const topics: TopicSpec[] = snapshot.topics as TopicSpec[];
const byName = new Map(topics.map((t) => [t.topic_name, t]));

export function snapshotRegistry(): TopicRegistryReader {
  return {
    getTopic(name: string) {
      return byName.get(name);
    },
    allTopics() {
      return topics;
    },
    retentionFor(topic: string) {
      return byName.get(topic)?.outbox_retention;
    },
  };
}

export { topics as SNAPSHOT_TOPICS };
