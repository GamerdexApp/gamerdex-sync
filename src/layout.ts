export const ROOT_FOLDER = 'Gamerdex';
export const DATA_FILE = 'data.json';
export const META_FILE = 'meta.json';

const APP_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** An app id names a folder, so it is lowercase words joined by single dashes. */
export const isAppId = (value: string): boolean => APP_ID.test(value);

const folderOf = (appId: string): string => {
  if (!isAppId(appId)) throw new RangeError(`Invalid app id: ${appId}`);
  return `${ROOT_FOLDER}/${appId}`;
};

/** The path of the saved data of an app, such as `Gamerdex/whiteout-survival/data.json`. */
export const dataPath = (appId: string): string => `${folderOf(appId)}/${DATA_FILE}`;

/** The path of the bookkeeping file of an app, next to its saved data. */
export const metaPath = (appId: string): string => `${folderOf(appId)}/${META_FILE}`;
