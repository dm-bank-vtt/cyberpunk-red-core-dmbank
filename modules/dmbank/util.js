export const NC_SCOPE = "cyberpunk-red-core-dmbank";

/** Is the Night City (DM Bank) theme active? */
export function isNightCity() {
  return document.documentElement.dataset.cprTheme === "nightcity";
}

/** Read one of the DM Bank client settings, tolerating unregistered keys. */
export function ncSetting(key) {
  try {
    return game.settings.get(NC_SCOPE, `nc.${key}`);
  } catch (err) {
    return undefined;
  }
}
