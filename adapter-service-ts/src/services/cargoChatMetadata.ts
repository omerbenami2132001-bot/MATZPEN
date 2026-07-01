import * as XLSX from "xlsx";
import * as logger from "../utils/logger";
import { STEPS } from "../utils/logger";
import { metadataPipeline } from "../utils/normalizer";
import { withRetry } from "../utils/retry";
import {
  TIME_WINDOW_MINUTES, CARGO_CHAT_PREFIX,
  EXCEL_FOLDER_NAME, FILES_FOLDER_NAME, EXCEL_COLUMNS,
} from "../utils/constants";
import { cargoClient } from "./apiClients";
import { ExtractedMetadataConfig } from "../utils/extractedMetadataConfig";

interface ExcelRow {
  date: string;
  time: string;
  user: string;
  displayName: string;
  content: string;
  filename: string;
  excelName: string;
}

interface FileAttachment {
  user: string;
  datetime: Date;
  excelName: string;
}

interface ChatMessage {
  date: string;
  time: string;
  user: string;
  displayName: string;
  content: string;
}

export class CargoChatMetadata {
  private allRows: ExcelRow[] = [];
  private fileMap: Map<string, FileAttachment> = new Map();
  private filesFolderId: string | null = null;
  private groupExtractedMetadata: Record<string, ExtractedMetadataConfig>;

  constructor(groupExtractedMetadata: Record<string, ExtractedMetadataConfig>) {
    this.groupExtractedMetadata = groupExtractedMetadata;
  }

  async prepare(folderId: string, requestId: string) {
    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: scanning for Excel folder", { folderId });


    const rootResponse = await withRetry(
      () => cargoClient.get(`/folders/${folderId}`),
      { retries: 3, delayMs: 1000, label: "scan root folder", requestId }
    );

    const rootData = rootResponse.data as { children?: { id: string; name: string; isFolder: boolean }[] };
    const rootChildren = rootData.children || [];
    const excelFolder = rootChildren.find((child: any) => child.name === EXCEL_FOLDER_NAME && child.isFolder);
    const filesFolder = rootChildren.find((child: any) => child.name === FILES_FOLDER_NAME && child.isFolder);

    if (!excelFolder) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: Excel folder not found", { folderId });
      return;
    }

    if (filesFolder) {
      this.filesFolderId = String(filesFolder.id);
    }

    const xlsxFiles = await this.findXlsxFiles(excelFolder.id, requestId);

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: found xlsx files", {
      count: xlsxFiles.length,
    });

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
    const xlsxFiles: { id: string; name: string }[] = [];

    const response = await withRetry(
      () => cargoClient.get(`/folders/${folderId}`),
      { retries: 3, delayMs: 1000, label: `scan excel folder ${folderId}`, requestId }
    );

    const responseData = response.data as { children?: { id: string; name: string; isFolder: boolean }[] };
    const children = responseData.children || [];

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

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: downloading Excel", { fileId, fileName });

    const response = await withRetry(
      () => cargoClient.get(`/fsEntries/${fileId}/stream`, { responseType: "arraybuffer" }),
      { retries: 3, delayMs: 1000, label: `download excel ${fileId}`, requestId }
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { raw: false, defval: "" });


    for (const row of rows) {
      const date = row[EXCEL_COLUMNS.DATE] || "";
      const time = row[EXCEL_COLUMNS.TIME] || "";
      const user = row[EXCEL_COLUMNS.USER] || "";
      const displayName = row[EXCEL_COLUMNS.DISPLAY_NAME] || "";
      const content = row[EXCEL_COLUMNS.CONTENT] || "";
      const filename = (row[EXCEL_COLUMNS.FILENAME] || "").replace(/:/g, "-");

      const excelRow: ExcelRow = { date, time, user, displayName, content, filename, excelName: this.stripExtension(fileName) };
      this.allRows.push(excelRow);

      if (filename) {
        const datetime = this.parseDateTime(date, time);
        const nameWithoutExt = this.stripExtension(filename);
        this.fileMap.set(nameWithoutExt, { user, datetime, excelName: this.stripExtension(fileName) });
      }
    }

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: Excel parsed", {
      fileName, rows: rows.length,
    });
  }

  private parseDateTime(date: string, time: string) {
    return new Date(`${date}T${time}`);
  }

  private stripExtension(filename: string) {
    const lastDot = filename.lastIndexOf(".");
    return lastDot > 0 ? filename.substring(0, lastDot) : filename;
  }

  private isWithinWindow(rowDate: string, rowTime: string, targetDatetime: Date) {
    const rowDatetime = this.parseDateTime(rowDate, rowTime);
    const diffMs = Math.abs(rowDatetime.getTime() - targetDatetime.getTime());
    const windowMs = TIME_WINDOW_MINUTES * 60 * 1000;
    return diffMs <= windowMs;
  }

  private getExtractedMetadata = (messages: string[], chatGroupName: string) => {
    const config = this.groupExtractedMetadata[chatGroupName];
    if (!config) return {};
    const { extractors, postProcessors } = config;

    const regexResults = messages.reduce((extractedMetadataAccumluator, message) => {
      Object.entries(extractors).forEach(([extractedFieldName, extractorFunction]) => {
        const currentExtractedMetadata = extractorFunction(message);

        currentExtractedMetadata && extractedMetadataAccumluator[extractedFieldName].push(...currentExtractedMetadata);
      })

      return extractedMetadataAccumluator;
    }, Object.fromEntries(Object.keys(extractors).map((extractedFieldName) => [extractedFieldName, []])) as Record<string, any>);

    const postProcessResults = Object.fromEntries(
      Object.entries(regexResults).map(([key, value]) => [
        key, postProcessors[key] ? postProcessors[key](value) : value
      ])
    );

    return Object.fromEntries(
      Object.entries(postProcessResults).filter(([_key, value]) => value != null)
    );
  }

  async process(fileId: string, requestId: string, fileInfo?: Record<string, unknown>) {
    const fileName = String(fileInfo?.name || "");
    const fileNameWithoutExt = this.stripExtension(fileName);

    if (!fileNameWithoutExt) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: no filename, skipping", { fileId });
      return {};
    }

    const attachment = this.fileMap.get(fileNameWithoutExt);

    if (!attachment) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "CargoChatMetadata: file not found in Excel", { fileName: fileNameWithoutExt });
      return {};
    }

    const { user, datetime, excelName } = attachment;

    const messages: ChatMessage[] = this.allRows
      .filter((row) =>
        row.user === user &&
        row.content.trim() !== "" &&
        this.isWithinWindow(row.date, row.time, datetime)
      )
      .map(({ date, time, user, displayName, content }) => ({ date, time, user, displayName, content }));

    const metadata = {
      user,
      file_date: datetime.toISOString(),
      message_count: messages.length,
      messages,
      group_name: excelName,
      ...this.getExtractedMetadata(messages.map((msg) => msg.content), excelName),
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
