export function getAppOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "";
}
