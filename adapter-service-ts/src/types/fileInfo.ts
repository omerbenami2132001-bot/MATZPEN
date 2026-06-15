export interface FileInfo {
  id: string;
  name: string;
  owner?: string;
  description?: string;
  created?: number;
  [key: string]: unknown;
}
