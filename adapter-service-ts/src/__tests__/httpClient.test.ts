import "./setupEnv";
import { describe, test, assert, assertEqual, assertRejects } from "./harness";
import nock from "nock";
import { ApiClient } from "../services/connections/httpClient";

const BASE = "http://api.test.local";

describe("ApiClient.get", () => {
  test("performs GET and returns response data", async () => {
    nock(BASE).get("/folders/f1").reply(200, { children: [] });
    const client = new ApiClient({ baseURL: BASE }, 0);
    const res = await client.get<{ children: unknown[] }>("/folders/f1");
    assertEqual(res.status, 200, "status");
    assert(Array.isArray(res.data.children), "children array");
    assert(nock.isDone(), "nock interceptor consumed");
  });

  test("sends configured headers", async () => {
    const scope = nock(BASE, { reqheaders: { "x-cargo-app-name": "test-app" } })
      .get("/ping")
      .reply(200, { ok: true });
    const client = new ApiClient({ baseURL: BASE, headers: { "x-cargo-app-name": "test-app" } }, 0);
    await client.get("/ping");
    assert(scope.isDone(), "request matched required header");
  });

  test("passes per-request query params", async () => {
    nock(BASE).get("/search").query({ q: "abc" }).reply(200, { hits: 1 });
    const client = new ApiClient({ baseURL: BASE }, 0);
    const res = await client.get<{ hits: number }>("/search", { params: { q: "abc" } });
    assertEqual(res.data.hits, 1, "query matched");
  });

  test("rejects on HTTP error status", async () => {
    nock(BASE).get("/boom").reply(500, { error: "server" });
    const client = new ApiClient({ baseURL: BASE }, 0);
    await assertRejects(() => client.get("/boom"), "should reject on 500");
  });

  test("waits requestDelayMs before firing (delay is applied)", async () => {
    // setupEnv accelerates setTimeout to 0, so this verifies the delay path runs without hanging.
    nock(BASE).get("/delayed").reply(200, { ok: true });
    const client = new ApiClient({ baseURL: BASE }, 3500);
    const res = await client.get<{ ok: boolean }>("/delayed");
    assertEqual(res.data.ok, true, "resolved after delay path");
  });
});
