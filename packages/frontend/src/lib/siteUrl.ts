/** Public origin used for canonical URLs and social cards. */
const PRODUCTION_SITE_URL = "https://tickrbase.top";

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return PRODUCTION_SITE_URL;
  try {
    const url = new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : PRODUCTION_SITE_URL;
  } catch {
    return PRODUCTION_SITE_URL;
  }
}
