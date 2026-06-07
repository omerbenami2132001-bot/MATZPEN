// S3 singleton: getFile, getJson, putWebp.

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { Agent } from 'node:https';
import { config } from './config.js';
import { TransientError, isTransientS3Error, errorMessage } from './errors.js';

const rethrowS3Error = (error: unknown, bucket: string, key: string, operation: string): never => {
  if (isTransientS3Error(error)) {
    throw new TransientError(`S3 ${operation} ${bucket}/${key} failed`, { cause: errorMessage(error) });
  }
  throw error instanceof Error ? error : new Error(String(error));
};

// region case-sensitive; forcePathStyle required; fresh creds per call; self-signed CA.
class S3 {
  private readonly client = new S3Client({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    credentials: config.s3Credentials,
    forcePathStyle: true,
    maxAttempts: config.s3MaxAttempts,
    requestHandler: new NodeHttpHandler({
      httpsAgent: new Agent({ keepAlive: true, rejectUnauthorized: false }),
    }),
  });

  async getFile(bucket: string, key: string): Promise<string> {
    try {
      const { Body } = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!Body) {
        throw new Error(`S3 GetObject returned no body for ${bucket}/${key}`);
      }
      return await Body.transformToString('utf-8');
    } catch (error) {
      return rethrowS3Error(error, bucket, key, 'GetObject');
    }
  }

  async getJson(bucket: string, key: string) {
    const body = await this.getFile(bucket, key);
    try {
      return JSON.parse(body) as unknown;
    } catch (error) {
      throw new Error('S3 payload is not valid JSON: ' + errorMessage(error));
    }
  }

  async putWebp(buffer: Buffer, bucket: string, key: string, contentType = 'image/webp') {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, ACL: config.s3Acl,
      }));
    } catch (error) {
      return rethrowS3Error(error, bucket, key, 'PutObject');
    }
  }
}

export const s3 = new S3();
