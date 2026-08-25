import { describe, expect, it } from "vitest";

import { exportCapabilities } from "./capabilities";

describe("export capabilities", () => {
  it("keeps GitHub push disabled until encryption and the repo token are both configured", () => {
    expect(exportCapabilities({})).toEqual({
      encryptedDownload: false,
      githubExport: false,
    });
    expect(exportCapabilities({ EXPORT_ENCRYPTION_KEY: "1".repeat(64) })).toEqual({
      encryptedDownload: true,
      githubExport: false,
    });
    expect(exportCapabilities({ GITHUB_EXPORT_TOKEN: "token" })).toEqual({
      encryptedDownload: false,
      githubExport: false,
    });
    expect(exportCapabilities({
      EXPORT_ENCRYPTION_KEY: "1".repeat(64),
      GITHUB_EXPORT_TOKEN: "token",
    })).toEqual({
      encryptedDownload: true,
      githubExport: true,
    });
  });

  it("does not advertise an invalid encryption key", () => {
    expect(exportCapabilities({
      EXPORT_ENCRYPTION_KEY: "not-a-256-bit-hex-key",
      GITHUB_EXPORT_TOKEN: "token",
    })).toEqual({
      encryptedDownload: false,
      githubExport: false,
    });
  });
});
