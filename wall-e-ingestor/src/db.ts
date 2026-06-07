// Postgres pool singleton: insertAsset + closeDb.

import { Pool } from 'pg';
import { config } from './config.js';
import { TransientError, isTransientPgError, errorMessage } from './errors.js';
import type { AssetRow } from './schemas.js';

// Lazy connect. np/local = password auth; pp/prod = mTLS with self-signed CA.
class Db {
  private readonly pool: Pool;

  constructor() {
    const { url, tls } = config.dbConfig;
    this.pool = new Pool(
      tls.mode === 'mtls'
        ? {
            connectionString: url,
            ssl: { cert: tls.cert, key: tls.key, rejectUnauthorized: false },
          }
        : { connectionString: url },
    );
  }

  private static readonly INSERT_SQL =
    'INSERT INTO pixar.assets (id, source_name, origin_id, insertion_time, reality, metadata, status) ' +
    "VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'in_progress')";

  async insertAsset(row: AssetRow): Promise<void> {
    const { id, source_name, origin_id, insertion_time, reality, metadata } = row;
    try {
      await this.pool.query(Db.INSERT_SQL, [
        id,
        source_name,
        origin_id,
        insertion_time,
        reality,
        JSON.stringify(metadata), // node-pg requires stringify for jsonb
      ]);
    } catch (error) {
      if (isTransientPgError(error)) {
        throw new TransientError('pixar.assets insert failed', {
          asset_id: id,
          source_name,
          cause: errorMessage(error),
        });
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async closeDb(): Promise<void> {
    await this.pool.end();
  }
}

export const db = new Db();
