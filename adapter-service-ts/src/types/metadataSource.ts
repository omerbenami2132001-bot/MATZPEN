export interface MetadataSource {
  prepare?(folderId: string, requestId: string): Promise<string | void>;
  process(fileId: string, requestId: string, fileInfo?: Record<string, unknown>): Promise<Record<string, unknown>>;
}
