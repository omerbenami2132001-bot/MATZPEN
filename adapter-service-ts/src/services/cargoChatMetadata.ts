// CargoChatMetadata — שולף metadata מאקסל.
// prepare: סורק תיקיית excel, מוריד ופרסר xlsx, שומר ב-cache.
// process: מחפש ב-cache לפי שם קובץ + חלון זמן.
import * as XLSX from "xlsx";
import * as logger from "../utils/logger";
import { STEPS } from "../utils/logger";
import { metadataPipeline } from "../utils/normalizer";
import { withRetry } from "../utils/retry";
import {
  TIME_WINDOW_MINUTES, CARGO_CHAT_PREFIX,
  EXCEL_FOLDER_NAME, FILES_FOLDER_NAME, EXCEL_COLUMNS,
} from "../utils/constants";
import { ApiClient } from "./connections/httpClient";

interface ExcelRow {
  date: string;
  time: string;
  user: string;
  content: string;
  filename: string;
}

interface FileAttachment {
  user: string;
  datetime: Date;
}

interface ChatMessage {
  date: string;
  time: string;
  content: string;
}

export class CargoChatMetadata {
  private allRows: ExcelRow[] = [];
  private fileMap: Map<string, FileAttachment> = new Map();
  private filesFolderId: string | null = null;

  async prepare(folderId: string, requestId: string) {
    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: scanning for Excel folder", { folderId });

    const apiClient = ApiClient.getInstance();

    // סריקת תיקיית root → מציאת "excel" ו-"files sent"
    const rootResponse = await withRetry(
      () => apiClient.get(`/folders/${folderId}`),
      { retries: 3, delayMs: 1000, label: "scan root folder", requestId }
    );

    const rootChildren = (rootResponse.data as any).children || [];
    const excelFolder = rootChildren.find((child: any) => child.name === EXCEL_FOLDER_NAME && child.isFolder);
    const filesFolder = rootChildren.find((child: any) => child.name === FILES_FOLDER_NAME && child.isFolder);

    if (!excelFolder) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: Excel folder not found", { folderId });
      return;
    }

    if (filesFolder) {
      this.filesFolderId = String(filesFolder.id);
    }

    // סריקה רקורסיבית של תיקיית excel → מציאת כל xlsx
    const xlsxFiles = await this.findXlsxFiles(excelFolder.id, requestId);

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: found xlsx files", {
      count: xlsxFiles.length,
    });

    // הורדה ופרסור של כל xlsx
    for (const xlsxFile of xlsxFiles) {
      await this.downloadAndParseExcel(xlsxFile.id, xlsxFile.name, requestId);
    }

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: cache ready", {
      totalRows: this.allRows.length,
      filesWithAttachments: this.fileMap.size,
    });

    return this.filesFolderId || undefined;
  }

  private async findXlsxFiles(folderId: string, requestId: string): Promise<{ id: string; name: string }[]> {
    const apiClient = ApiClient.getInstance();
    const xlsxFiles: { id: string; name: string }[] = [];

    const response = await withRetry(
      () => apiClient.get(`/folders/${folderId}`),
      { retries: 3, delayMs: 1000, label: `scan excel folder ${folderId}`, requestId }
    );

    const children = (response.data as any).children || [];

    for (const child of children) {
      if (child.isFolder) {
        const nested = await this.findXlsxFiles(String(child.id), requestId);
        xlsxFiles.push(...nested);
      } else if (String(child.name).endsWith(".xlsx")) {
        xlsxFiles.push({ id: String(child.id), name: child.name });
      }
    }

    return xlsxFiles;
  }

  private async downloadAndParseExcel(fileId: string, fileName: string, requestId: string) {
    const apiClient = ApiClient.getInstance();

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: downloading Excel", { fileId, fileName });

    const response = await withRetry(
      () => apiClient.get(`/files/${fileId}/download`, { responseType: "arraybuffer" }),
      { retries: 3, delayMs: 1000, label: `download excel ${fileId}`, requestId }
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

    for (const row of rows) {
      const date = row[EXCEL_COLUMNS.DATE] || "";
      const time = row[EXCEL_COLUMNS.TIME] || "";
      const user = row[EXCEL_COLUMNS.USER] || "";
      const content = row[EXCEL_COLUMNS.CONTENT] || "";
      const filename = row[EXCEL_COLUMNS.FILENAME] || "";

      const excelRow: ExcelRow = { date, time, user, content, filename };
      this.allRows.push(excelRow);

      if (filename) {
        const datetime = this.parseDateTime(date, time);
        this.fileMap.set(filename, { user, datetime });
      }
    }

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: Excel parsed", {
      fileName, rows: rows.length,
    });
  }

  private parseDateTime(date: string, time: string) {
    return new Date(`${date}T${time}`);
  }

  private isWithinWindow(rowDate: string, rowTime: string, targetDatetime: Date) {
    const rowDatetime = this.parseDateTime(rowDate, rowTime);
    const diffMs = Math.abs(rowDatetime.getTime() - targetDatetime.getTime());
    const windowMs = TIME_WINDOW_MINUTES * 60 * 1000;
    return diffMs <= windowMs;
  }

  async process(fileId: string, requestId: string, fileInfo?: Record<string, unknown>) {
    const fileName = String(fileInfo?.name || "");

    if (!fileName) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: no filename, skipping", { fileId });
      return {};
    }

    const attachment = this.fileMap.get(fileName);

    if (!attachment) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: file not found in Excel", { fileName });
      return {};
    }

    const { user, datetime } = attachment;

    // חיפוש כל ההודעות מאותו user בחלון ±2 דקות
    const messages: ChatMessage[] = this.allRows
      .filter((row) =>
        row.user === user && this.isWithinWindow(row.date, row.time, datetime)
      )
      .map(({ date, time, content }) => ({ date, time, content }));

    const metadata = {
      user,
      file_date: datetime.toISOString(),
      message_count: messages.length,
      messages,
    };

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: metadata ready", {
      fileName, user, messageCount: messages.length,
    });

    return metadataPipeline(metadata, CARGO_CHAT_PREFIX, null);
  }

  getFilesFolderId() {
    return this.filesFolderId;
  }
}
