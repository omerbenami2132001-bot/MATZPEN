export enum API_TYPES {
  DEFAULT = "default",
  CHAT = "chat",
}

export const METADATA_API_1_PREFIX = "ex";
export const METADATA_API_2_PREFIX = "ab";
export const METADATA_API_2_FIELDS = ["event.geometries"];

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
