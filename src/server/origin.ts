import { HttpError } from "./http";

export function resolvePublicOrigin(request: Request, configuredOrigin: string): string {
  const requestOrigin = new URL(request.url).origin;
  if (configuredOrigin === "auto") {
    const current = new URL(requestOrigin);
    if (current.protocol !== "https:" && current.hostname !== "localhost" && current.hostname !== "127.0.0.1") {
      throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Automatic authentication origin requires HTTPS");
    }
    return requestOrigin;
  }
  const configured = new URL(configuredOrigin);
  if (configured.protocol !== "https:" || configured.origin !== configuredOrigin) {
    throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Canonical authentication origin is invalid");
  }
  return configured.origin;
}
