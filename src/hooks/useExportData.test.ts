import { describe, it, expect } from "vitest";
import { isStaleExportResult } from "./useExportData";
import { OutputFormats } from "../types.d";

describe("isStaleExportResult", () => {
  it("accepts the result that matches the pending requestId", () => {
    expect(
      isStaleExportResult("export:3", OutputFormats.JSON, "export:3", OutputFormats.JSON)
    ).toBe(false);
  });

  it("discards a late result from a superseded request, even for the same format", () => {
    // Two exports of the same format in flight; the older one resolves last.
    expect(
      isStaleExportResult("export:1", OutputFormats.JSON, "export:2", OutputFormats.JSON)
    ).toBe(true);
  });

  it("accepts the in-flight request regardless of format echo", () => {
    expect(
      isStaleExportResult("export:2", OutputFormats.CSS, "export:2", OutputFormats.CSS)
    ).toBe(false);
  });

  it("falls back to the format echo when the message carries no requestId", () => {
    // Slow JSON export resolving after the user switched to CSS: must not
    // write JSON data into the CSS preview.
    expect(
      isStaleExportResult(undefined, OutputFormats.JSON, null, OutputFormats.CSS)
    ).toBe(true);
  });

  it("accepts a result for the current format when no requestId is available", () => {
    expect(
      isStaleExportResult(undefined, OutputFormats.CSS, null, OutputFormats.CSS)
    ).toBe(false);
  });

  it("discards a requestId-less message for another format while a request is pending", () => {
    // No echoed requestId to correlate with, so the format echo decides.
    expect(
      isStaleExportResult(undefined, OutputFormats.JSON, "export:2", OutputFormats.CSS)
    ).toBe(true);
  });
});
