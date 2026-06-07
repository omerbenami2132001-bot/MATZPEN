// On-demand local runner: one envelope through Pipeline.processMessage (no Kafka consumer).
//
// Usage (after `npm run build`):
//   npm run run:envelope -- --help
//
// Full dry-run (no broker, no S3/DB — stubs only):
//   npm run run:envelope -- -e fixtures/sample-envelope.json -p fixtures/sample-payload.json --stub-all
//
// Real S3 + DB, skip downstream publish only:
//   npm run run:envelope -- -e path/to/envelope.json --no-publish
//
// Requires a `.env` (copy from .env.example). dotenv loads via npm script.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { v7 as uuidv7 } from 'uuid';

import { s3 } from './s3.js';
import { db } from './db.js';
import { kafka } from './kafka.js';
import { logger } from './logger.js';
import { Pipeline } from './pipeline.js';
import type { DownstreamMessage } from './schemas.js';
import { TransientError } from './errors.js';

const HELP = `wall-e-ingestor — run one envelope through the pipeline (no Kafka consumer)

Options:
  -e, --envelope <file>   Envelope JSON file (required)
  -p, --payload <file>    Normalized payload JSON (required with --stub-s3)
  -r, --request-id <uuid> Inbound correlation id (default: random UUIDv7)
  --no-publish            Stub kafka.publish — log downstream message, do not produce
  --stub-s3               Stub s3.getJson / putWebp (use -p for payload body)
  --stub-db               Stub db.insertAsset — log row only
  --stub-all              Shorthand: --no-publish --stub-s3 --stub-db
  -h, --help              Show this help

Examples:
  npm run run:envelope -- -e fixtures/sample-envelope.json -p fixtures/sample-payload.json --stub-all
  npm run run:envelope -- -e fixtures/sample-envelope.json --no-publish
`;

const readJsonFile = (path: string): unknown => JSON.parse(readFileSync(path, 'utf-8'));

const { values: args } = parseArgs({
  options: {
    envelope: { type: 'string', short: 'e' },
    payload: { type: 'string', short: 'p' },
    'request-id': { type: 'string', short: 'r' },
    'no-publish': { type: 'boolean', default: false },
    'stub-s3': { type: 'boolean', default: false },
    'stub-db': { type: 'boolean', default: false },
    'stub-all': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const envelopePath = args.envelope;
if (!envelopePath) {
  console.error('Missing --envelope <file>\n');
  console.log(HELP);
  process.exit(1);
}

const stubAll = args['stub-all'] ?? false;
const noPublish = stubAll || (args['no-publish'] ?? false);
const stubS3 = stubAll || (args['stub-s3'] ?? false);
const stubDb = stubAll || (args['stub-db'] ?? false);

if (stubS3 && !args.payload) {
  console.error('--stub-s3 requires --payload <file> (normalized payload JSON on disk)');
  process.exit(1);
}

const inboundRequestId = args['request-id'] ?? uuidv7();
const envelopeJson = readFileSync(envelopePath, 'utf-8');

const origGetJson = s3.getJson.bind(s3);
const origPutWebp = s3.putWebp.bind(s3);
const origInsertAsset = db.insertAsset.bind(db);
const origPublish = kafka.publish.bind(kafka);

if (stubS3) {
  const payloadDocument = readJsonFile(args.payload!);
  s3.getJson = async (bucket, key) => {
    logger.info('run-envelope stub: s3.getJson', { bucket, key });
    return payloadDocument;
  };
  s3.putWebp = async (buffer, bucket, key) => {
    logger.info('run-envelope stub: s3.putWebp', { bucket, key, byte_length: buffer.length });
  };
}

if (stubDb) {
  db.insertAsset = async (row) => {
    logger.info('run-envelope stub: db.insertAsset', { row });
  };
}

if (noPublish) {
  kafka.publish = async (downstreamMessage: DownstreamMessage, requestId: string) => {
    logger.info('run-envelope stub: kafka.publish (skipped)', {
      request_id: requestId,
      downstream_message: downstreamMessage,
    });
  };
}

logger.info('run-envelope starting', {
  envelope_file: envelopePath,
  inbound_request_id: inboundRequestId,
  no_publish: noPublish,
  stub_s3: stubS3,
  stub_db: stubDb,
});

const pipeline = new Pipeline();
let exitCode = 0;

try {
  await pipeline.processMessage(envelopeJson, inboundRequestId);
  logger.info('run-envelope finished', { outcome: 'completed (see logs for envelope processed / failed / orphan)' });
} catch (error) {
  if (error instanceof TransientError) {
    logger.error('run-envelope finished', {
      outcome: 'transient_error',
      error_message: error.message,
    });
    exitCode = 2;
  } else {
    throw error;
  }
} finally {
  s3.getJson = origGetJson;
  s3.putWebp = origPutWebp;
  db.insertAsset = origInsertAsset;
  kafka.publish = origPublish;
  await db.closeDb();
}

process.exit(exitCode);
