import "./setupEnv";
import { describe, test, assert, assertEqual } from "./harness";
import { KafkaService } from "../services/connections/kafkaService";

function freshService(): KafkaService {
  (KafkaService as unknown as { instance?: KafkaService }).instance = undefined;
  return KafkaService.getInstance();
}

interface SentRecord {
  topic: string;
  messages: { value: string }[];
}

function injectMockProducer(svc: KafkaService): { sent: SentRecord[] } {
  const sent: SentRecord[] = [];
  const mockProducer = {
    send: async (record: SentRecord) => { sent.push(record); return []; },
    connect: async () => {},
    disconnect: async () => {},
  };
  (svc as unknown as { producer: unknown }).producer = mockProducer;
  (svc as unknown as { connected: boolean }).connected = true;
  return { sent };
}

describe("KafkaService.publish", () => {
  test("sends serialized message to configured topic when connected", async () => {
    const svc = freshService();
    const { sent } = injectMockProducer(svc);
    await svc.publish({ source: "test-adapter", path: "a/b.json", bucket: "test-bucket" }, "req-1");
    assertEqual(sent.length, 1, "one send");
    assertEqual(sent[0].topic, "test.topic", "topic");
    const payload = JSON.parse(sent[0].messages[0].value);
    assertEqual(payload.source, "test-adapter", "source in payload");
    assertEqual(payload.path, "a/b.json", "path in payload");
  });

  test("does not throw and does not send when not connected", async () => {
    const svc = freshService();
    let threw = false;
    try {
      await svc.publish({ source: "x" }, "req-1");
    } catch {
      threw = true;
    }
    assert(!threw, "publish must not throw when disconnected");
  });

  test("retries transient send failures then succeeds", async () => {
    const svc = freshService();
    let attempts = 0;
    const mockProducer = {
      send: async () => {
        attempts++;
        if (attempts < 2) throw new Error("broker hiccup");
        return [];
      },
      connect: async () => {},
      disconnect: async () => {},
    };
    (svc as unknown as { producer: unknown }).producer = mockProducer;
    (svc as unknown as { connected: boolean }).connected = true;

    await svc.publish({ source: "x" }, "req-1");
    assertEqual(attempts, 2, "retried once then succeeded");
  });

  test("disconnect flips connected flag", async () => {
    const svc = freshService();
    injectMockProducer(svc);
    await svc.disconnect();
    assertEqual((svc as unknown as { connected: boolean }).connected, false, "disconnected");
  });
});
