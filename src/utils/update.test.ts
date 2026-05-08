import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OFFICIAL_LATEST_RELEASE_URL,
  compareVersions,
  extractVersion,
  fetchOfficialLatestRelease
} from "./update";

describe("extractVersion", () => {
  it("extracts a semantic version from release labels", () => {
    expect(extractVersion("v1.2.3")).toBe("1.2.3");
    expect(extractVersion("release-2.0.1")).toBe("2.0.1");
  });

  it("falls back to the trimmed input when no version pattern exists", () => {
    expect(extractVersion("  beta  ")).toBe("beta");
  });
});

describe("compareVersions", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("treats missing trailing parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("fetchOfficialLatestRelease", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the official latest.json and resolves relative download URLs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        version: "1.4.0",
        date: "2026-05-08",
        downloadUrl: "/download/LyciaPlayer_Latest_x64_Setup.exe",
        changelogUrl: "/changelog.html",
        changelog: ["新增官网更新通道"]
      }))
    );

    await expect(fetchOfficialLatestRelease()).resolves.toEqual({
      version: "1.4.0",
      url: "https://lycia.prettyboy.fun/download/LyciaPlayer_Latest_x64_Setup.exe",
      downloadUrl: "https://lycia.prettyboy.fun/download/LyciaPlayer_Latest_x64_Setup.exe",
      changelogUrl: "https://lycia.prettyboy.fun/changelog.html",
      publishedAt: "2026-05-08",
      notes: "新增官网更新通道",
      source: "official"
    });
    expect(fetchMock).toHaveBeenCalledWith(OFFICIAL_LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("rejects invalid official release metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        date: "2026-05-08",
        downloadUrl: "/download/LyciaPlayer_Latest_x64_Setup.exe"
      }))
    );

    await expect(fetchOfficialLatestRelease()).rejects.toThrow("Official latest release version is missing");
  });
});
