export enum API_TYPES {
  DEFAULT = "default",
  CHAT = "chat",
}

export enum RUN_MODE {
  BATCH = "batch",
  STREAM = "stream",
}

// Which mode the service runs in. Kept as a constant for now (may move to env later).
export const ACTIVE_RUN_MODE: RUN_MODE = RUN_MODE.BATCH;

// Stream mode: a new batch starts on every fixed, wall-clock-aligned window.
export const STREAM_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Stream mode: the identifier each scheduled batch runs against (a topic name for now).
export const STREAM_TOPIC = "";

export const METADATA_API_1_PREFIX = "ex";
export const METADATA_API_2_PREFIX = "ab";
export const METADATA_API_2_FIELDS = ["contentData", "isDeleted"];

export const ALLOWED_IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

export const TIME_WINDOW_MINUTES = 2;
export const CARGO_CHAT_PREFIX = "em";
export const EXCEL_FOLDER_NAME = "excels";
export const FILES_FOLDER_NAME = "files sent";
export const EXCEL_COLUMNS = {
  DATE: "תאריך",
  TIME: "שעה",
  USER: "שם משתמש",
  DISPLAY_NAME: "שם תצוגה",
  CONTENT: "תוכן",
  FILENAME: "שם קובץ",
};
