import "./setupEnv";
import { describe, test, assert, assertEqual, assertRejects } from "./harness";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { S3Service } from "../services/connections/s3Client";

const s3Mock = mockClient(S3Client);

function freshService(): S3Service {
  (S3Service as unknown as { instance?: S3Service }).instance = undefined;
  return S3Service.getInstance();
}

describe("S3Service.buildKey", () => {
  test("builds sourceName/YYYY/MM/DD/HH/base.json", () => {
    const svc = freshService();
    const date = new Date(Date.UTC(2024, 4, 27, 9, 30, 0));
    const key = svc.buildKey("photo.png", date);
    assertEqual(key, "test-adapter/2024/05/27/09/photo.json", "key");
  });

  test("strips only the last extension", () => {
    const svc = freshService();
    const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
    const key = svc.buildKey("a.b.png", date);
    assert(key.endsWith("/a.b.json"), `got ${key}`);
  });

  test("handles filename without extension", () => {
    const svc = freshService();
    const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
    const key = svc.buildKey("noext", date);
    assert(key.endsWith("/noext.json"), `got ${key}`);
  });
});

describe("S3Service.save", () => {
  test("sends PutObjectCommand with correct bucket, key, body", async () => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    const svc = freshService();
    const date = new Date(Date.UTC(2024, 4, 27, 9, 0, 0));
    const key = await svc.save({ origin_id: "abc", hello: "world" }, "doc.png", "req-1", date);

    assertEqual(key, "test-adapter/2024/05/27/09/doc.json", "returned key");
    const putCalls = s3Mock.calls().filter((c) => c.args[0] instanceof PutObjectCommand);
    assertEqual(putCalls.length, 1, "one PutObject call");
    const input = (putCalls[0].args[0] as PutObjectCommand).input as { Bucket?: string; Key?: string; Body?: string; ContentType?: string };
    assertEqual(input.Bucket, "test-bucket", "bucket");
    assertEqual(input.Key, "test-adapter/2024/05/27/09/doc.json", "key");
    assertEqual(input.ContentType, "application/json", "content type");
    const parsed = JSON.parse(input.Body as string);
    assertEqual(parsed.origin_id, "abc", "body serialized");
  });

  test("propagates S3 error after retries exhausted", async () => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 down"));
    const svc = freshService();
    await assertRejects(
      () => svc.save({ origin_id: "x" }, "f.png", "req-2", new Date(Date.UTC(2024, 0, 1, 0, 0, 0))),
      "should reject when S3 fails"
    );
  });

  test("connect sends HeadBucketCommand", async () => {
    s3Mock.reset();
    s3Mock.on(HeadBucketCommand).resolves({});
    const svc = freshService();
    await svc.connect();
    const headCalls = s3Mock.calls().filter((c) => c.args[0] instanceof HeadBucketCommand);
    assertEqual(headCalls.length, 1, "one HeadBucket call");
  });
});
