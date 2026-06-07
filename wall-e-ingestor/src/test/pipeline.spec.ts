// Pipeline behavior tests. Stubs s3/db/kafka singleton methods directly (no DI).

import { s3 } from '../s3.js';
import { db } from '../db.js';
import { kafka } from '../kafka.js';
import { deriveObjectKey } from '../image.js';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../config.js';
import {
  EnvelopeSchema,
  NormalizedPayloadSchema,
  DownstreamMessageSchema,
} from '../schemas.js';
import { TransientError } from '../errors.js';
import { Pipeline } from '../pipeline.js';

// Real 1×1 PNG — sharp produces real WebP without stubbing.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const ENVELOPE_REQUEST_ID = '018f3a2b-0000-7000-8000-000000000001';
const ASSET_BUCKET = 'test-inbound-bucket';
const ASSET_PATH = 'payloads/test-payload.json';

function makeEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: 'telegram',
    path: ASSET_PATH,
    bucket: ASSET_BUCKET,
    message: 'test-message',
    request_id: ENVELOPE_REQUEST_ID,
    ...overrides,
  });
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    origin_id: 'origin-001',
    source: 'telegram',
    reality: 'reality-alpha',
    metadata: { cam: 'north' },
    base64: PNG_1X1_BASE64,
    ...overrides,
  };
}

// Synth UUID — deliberately ≠ ENVELOPE_REQUEST_ID.
const SYNTH_REQUEST_ID = '018f3a2b-dead-7000-8000-000000000099';

let origS3GetJson: typeof s3.getJson;
let origS3PutWebp: typeof s3.putWebp;
let origDbInsertAsset: typeof db.insertAsset;
let origKafkaPublish: typeof kafka.publish;

beforeAll(() => {
  origS3GetJson = s3.getJson.bind(s3);
  origS3PutWebp = s3.putWebp.bind(s3);
  origDbInsertAsset = db.insertAsset.bind(db);
  origKafkaPublish = kafka.publish.bind(kafka);
});

function restoreAll() {
  s3.getJson = origS3GetJson;
  s3.putWebp = origS3PutWebp;
  db.insertAsset = origDbInsertAsset;
  kafka.publish = origKafkaPublish;
}

describe('1. happy-path stage order', () => {
  it('calls s3.getJson → s3.putWebp → db.insertAsset → kafka.publish exactly once, in order', async () => {
    const calls: string[] = [];
    let capturedMessage: unknown;

    s3.getJson = async (_bucket, _key) => {
      calls.push('getJson');
      return makePayload();
    };
    s3.putWebp = async (_buf, _bucket, _key) => {
      calls.push('putWebp');
    };
    db.insertAsset = async (_row) => {
      calls.push('insertAsset');
    };
    kafka.publish = async (message, _requestId) => {
      calls.push('publish');
      capturedMessage = message;
    };

    const pipeline = new Pipeline();
    await pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID);

    expect(calls).toEqual(['getJson', 'putWebp', 'insertAsset', 'publish']);
    expect(calls.indexOf('putWebp') < calls.indexOf('insertAsset')).toBeTruthy();
    expect(capturedMessage).not.toBeUndefined();

    restoreAll();
  });

  it('emits "envelope processed" log (resolves normally)', async () => {
    const loggedMessages: string[] = [];
    const origLog = console.log;
    console.log = (line: string) => loggedMessages.push(line);

    s3.getJson = async () => makePayload();
    s3.putWebp = async () => {};
    db.insertAsset = async () => {};
    kafka.publish = async () => {};

    const pipeline = new Pipeline();
    await pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID);

    console.log = origLog;
    restoreAll();

    const processed = loggedMessages.some((l) => {
      try {
        const parsed = JSON.parse(l) as Record<string, unknown>;
        return parsed['message'] === 'envelope processed';
      } catch {
        return false;
      }
    });
    expect(processed).toBeTruthy();
  });
});

describe('2. transient vs permanent error', () => {
  it('s3.getJson throws TransientError → processMessage rejects (no offset commit)', async () => {
    s3.getJson = async () => { throw new TransientError('always transient'); };
    s3.putWebp = async () => {};
    db.insertAsset = async () => {};
    kafka.publish = async () => {};

    const pipeline = new Pipeline();
    await expect(
      pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID),
    ).rejects.toBeInstanceOf(TransientError);

    restoreAll();
  });

  it('s3.getJson throws plain Error (permanent) → processMessage resolves (commit, poison dropped)', async () => {
    s3.getJson = async () => { throw new Error('permanent s3 error'); };
    s3.putWebp = async () => {};
    db.insertAsset = async () => {};
    kafka.publish = async () => {};

    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID)).resolves.toBeUndefined();

    restoreAll();
  });
});

describe('3. permanent skip — bad inputs never call db.insertAsset or kafka.publish', () => {
  beforeEach(() => {
    db.insertAsset = async () => {
      throw new Error('db.insertAsset must NOT be called for permanent failures');
    };
    kafka.publish = async () => {
      throw new Error('kafka.publish must NOT be called for permanent failures');
    };
  });

  it('bad envelope JSON → resolves, never calls insertAsset/publish', async () => {
    const pipeline = new Pipeline();
    await expect(pipeline.processMessage('not-valid-json{{', SYNTH_REQUEST_ID)).resolves.toBeUndefined();
    restoreAll();
  });

  it('envelope Zod failure (missing required field) → resolves', async () => {
    const bad = JSON.stringify({ source: 'telegram', path: 'x', bucket: 'b', message: 'm' }); // missing request_id
    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(bad, SYNTH_REQUEST_ID)).resolves.toBeUndefined();
    restoreAll();
  });

  it('envelope Zod failure (extra field with .strict()) → resolves', async () => {
    const bad = JSON.stringify({
      source: 'telegram', path: 'x', bucket: 'b', message: 'm',
      request_id: ENVELOPE_REQUEST_ID, extra_field: 'oops',
    });
    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(bad, SYNTH_REQUEST_ID)).resolves.toBeUndefined();
    restoreAll();
  });

  it('payload Zod failure → resolves', async () => {
    s3.getJson = async () => ({ origin_id: 'x', source: 'telegram', reality: '', base64: PNG_1X1_BASE64, extra: 'bad' }); // extra field → .strict() rejects
    s3.putWebp = async () => {};

    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID)).resolves.toBeUndefined();
    restoreAll();
  });

  it('source mismatch (envelope.source !== payload.source) → resolves', async () => {
    s3.getJson = async () => makePayload({ source: 'cameras' }); // envelope has 'telegram'
    s3.putWebp = async () => {};

    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID)).resolves.toBeUndefined();
    restoreAll();
  });

  it('empty base64 → resolves (imageConverter.toWebp throws permanent, never calls insertAsset/publish)', async () => {
    s3.getJson = async () => makePayload({ base64: '====' });
    s3.putWebp = async () => {};

    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID)).resolves.toBeUndefined();
    restoreAll();
  });
});

describe('4. orphan — putWebp succeeds then insertAsset fails', () => {
  it('emits pixar_orphan_webp log with all required fields, resolves (no rethrow)', async () => {
    const loggedMessages: string[] = [];
    const origLog = console.log;
    console.log = (line: string) => loggedMessages.push(line);

    s3.getJson = async () => makePayload();
    s3.putWebp = async () => {};
    db.insertAsset = async () => {
      throw new Error('db permanent boom');
    };
    kafka.publish = async () => {
      throw new Error('kafka.publish must NOT be called in orphan path');
    };

    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID)).resolves.toBeUndefined();

    console.log = origLog;
    restoreAll();

    let orphanLog: Record<string, unknown> | null = null;
    for (const line of loggedMessages) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed['event'] === 'pixar_orphan_webp') {
          orphanLog = parsed;
          break;
        }
      } catch { /* skip non-JSON */ }
    }

    expect(orphanLog).not.toBeNull();
    expect(orphanLog!['event']).toBe('pixar_orphan_webp');
    expect(typeof orphanLog!['orphan_s3_bucket']).toBe('string');
    expect(typeof orphanLog!['orphan_s3_key']).toBe('string');
    expect(typeof orphanLog!['asset_id']).toBe('string');
    expect(typeof orphanLog!['source']).toBe('string');
    expect(orphanLog!['request_id']).toBe(ENVELOPE_REQUEST_ID);
    expect(orphanLog!['request_id']).not.toBe(SYNTH_REQUEST_ID);
    expect(typeof orphanLog!['original_db_error_class']).toBe('string');
    expect(typeof orphanLog!['original_db_error_message']).toBe('string');
  });

  it('orphan: request_id in log === envelope.request_id (not synth)', async () => {
    const loggedMessages: string[] = [];
    const origLog = console.log;
    console.log = (line: string) => loggedMessages.push(line);

    s3.getJson = async () => makePayload();
    s3.putWebp = async () => {};
    db.insertAsset = async () => { throw new TransientError('db always transient'); };
    kafka.publish = async () => {};

    const pipeline = new Pipeline();
    await expect(pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID)).resolves.toBeUndefined();

    console.log = origLog;
    restoreAll();

    let orphanLog: Record<string, unknown> | null = null;
    for (const line of loggedMessages) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed['event'] === 'pixar_orphan_webp') { orphanLog = parsed; break; }
      } catch { /* skip */ }
    }

    expect(orphanLog).not.toBeNull();
    expect(orphanLog!['request_id']).toBe(ENVELOPE_REQUEST_ID);
  });
});

describe('5. UUIDv7 lexicographic sortability', () => {
  it('100 minted ids are already sorted (lex == insertion order) and match v7 regex', () => {
    const UUIDv7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push(uuidv7());

    for (const id of ids) {
      expect(id).toMatch(UUIDv7_RE);
    }

    expect([...ids].sort()).toEqual(ids);
  });
});

describe('6. en-ZA key boundaries (Asia/Jerusalem TZ offsets)', () => {
  const ID = '0190a6b5-1234-7890-abcd-1234567890ab';

  it('2026-07-15T00:00:00Z → hour 03 (IDT = UTC+3)', () => {
    const key = deriveObjectKey('cellular_images_report', ID, new Date('2026-07-15T00:00:00Z'));
    expect(key).toBe(`cellular_images_report/2026/07/15/03/${ID}.webp`);
  });

  it('2026-01-15T00:00:00Z → hour 02 (IST = UTC+2)', () => {
    const key = deriveObjectKey('cellular_images_report', ID, new Date('2026-01-15T00:00:00Z'));
    expect(key).toBe(`cellular_images_report/2026/01/15/02/${ID}.webp`);
  });

  it('2026-07-15T22:30:00Z → next day 2026/07/16/01 (UTC 22:30 = IDT 01:30 next day)', () => {
    const key = deriveObjectKey('telegram', ID, new Date('2026-07-15T22:30:00Z'));
    expect(key).toBe(`telegram/2026/07/16/01/${ID}.webp`);
  });
});

describe('7. s3Credentials returns a fresh extensible object each call', () => {
  it('a !== b, both deep-equal {accessKeyId, secretAccessKey}, Object.isExtensible(a) === true', async () => {
    const p = config.s3Credentials;
    const a = await p();
    const b = await p();

    expect(a).not.toBe(b);
    expect('accessKeyId' in a).toBeTruthy();
    expect('secretAccessKey' in a).toBeTruthy();
    expect(a).toEqual(b);
    expect(Object.isExtensible(a)).toBe(true);
    expect(Object.isExtensible(b)).toBe(true);
  });
});

describe('8. .strict() contracts — extra fields are rejected', () => {
  it('EnvelopeSchema rejects an object with an extra field', () => {
    const valid = {
      source: 'telegram', path: 'x/y', bucket: 'bkt', message: 'msg',
      request_id: ENVELOPE_REQUEST_ID,
    };
    expect(() => EnvelopeSchema.parse(valid)).not.toThrow();
    expect(() => EnvelopeSchema.parse({ ...valid, surprise: 'extra' })).toThrow();
  });

  it('NormalizedPayloadSchema rejects an object with an extra field', () => {
    const valid = {
      origin_id: 'oid-1', source: 'telegram', reality: 'r', base64: PNG_1X1_BASE64,
    };
    expect(() => NormalizedPayloadSchema.parse(valid)).not.toThrow();
    expect(() => NormalizedPayloadSchema.parse({ ...valid, surprise: 'extra' })).toThrow();
  });

  it('DownstreamMessageSchema rejects an object with an extra field', () => {
    const valid = {
      id: ENVELOPE_REQUEST_ID, source: 'telegram', origin_id: 'oid-1',
      reality: '', metadata: {}, insertion_time: Date.now(),
      request_id: ENVELOPE_REQUEST_ID, schema_version: 1,
    };
    expect(() => DownstreamMessageSchema.parse(valid)).not.toThrow();
    expect(() => DownstreamMessageSchema.parse({ ...valid, surprise: 'extra' })).toThrow();
  });
});

describe('9. downstream message shape', () => {
  it('insertion_time is a unix-ms integer, schema_version === 1, uses "source" key, reality null → ""', async () => {
    let capturedMsg: Record<string, unknown> | null = null;

    s3.getJson = async () => makePayload({ reality: '' });
    s3.putWebp = async () => {};
    db.insertAsset = async () => {};
    kafka.publish = async (message, _requestId) => {
      capturedMsg = message as unknown as Record<string, unknown>;
    };

    const pipeline = new Pipeline();
    await pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID);

    restoreAll();

    expect(capturedMsg).not.toBeNull();
    expect(typeof capturedMsg!['insertion_time']).toBe('number');
    expect(Number.isInteger(capturedMsg!['insertion_time'])).toBeTruthy();
    expect(capturedMsg!['schema_version']).toBe(1);
    expect('source' in capturedMsg!).toBeTruthy();
    expect('source_name' in capturedMsg!).toBeFalsy();
  });

  it('reality empty-string in payload → reality "" in downstream message (not null, not "null")', async () => {
    let capturedMsg: Record<string, unknown> | null = null;

    s3.getJson = async () => makePayload({ reality: '' });
    s3.putWebp = async () => {};
    db.insertAsset = async () => {};
    kafka.publish = async (message, _requestId) => {
      capturedMsg = message as unknown as Record<string, unknown>;
    };

    const pipeline = new Pipeline();
    await pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID);

    restoreAll();

    expect(capturedMsg).not.toBeNull();
    expect(capturedMsg!['reality']).toBe('');
  });
});

describe('10. canonical request_id — synth id must not leak past stage 2', () => {
  it('published message.request_id === envelope.request_id even when consumer requestId differs', async () => {
    let publishedMsg: Record<string, unknown> | null = null;

    s3.getJson = async () => makePayload();
    s3.putWebp = async () => {};
    db.insertAsset = async () => {};
    kafka.publish = async (message, _requestId) => {
      publishedMsg = message as unknown as Record<string, unknown>;
    };

    const pipeline = new Pipeline();
    expect(SYNTH_REQUEST_ID).not.toBe(ENVELOPE_REQUEST_ID);
    await pipeline.processMessage(makeEnvelope(), SYNTH_REQUEST_ID);

    restoreAll();

    expect(publishedMsg).not.toBeNull();
    expect(publishedMsg!['request_id']).toBe(ENVELOPE_REQUEST_ID);
    expect(publishedMsg!['request_id']).not.toBe(SYNTH_REQUEST_ID);
  });
});

describe('11. db.insertAsset — SQL shape and jsonb serialization', () => {
  it("pool.query receives JSON.stringify(metadata) as param[5], SQL contains '$6::jsonb' and \"'in_progress'\"", async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];

    const origQuery = (db as unknown as { pool: { query: unknown } }).pool.query;
    (db as unknown as { pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> } }).pool.query =
      async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [] };
      };

    const testRow = {
      id: ENVELOPE_REQUEST_ID,
      source_name: 'telegram' as const,
      origin_id: 'oid-11',
      insertion_time: new Date(),
      reality: 'reality-x',
      metadata: { cam: 'south', count: 42 },
    };

    await db.insertAsset(testRow);
    (db as unknown as { pool: { query: unknown } }).pool.query = origQuery;

    expect(capturedParams[5]).toBe(JSON.stringify(testRow.metadata));
    expect(capturedSql.includes('$6::jsonb')).toBeTruthy();
    expect(capturedSql.includes("'in_progress'")).toBeTruthy();
  });
});
