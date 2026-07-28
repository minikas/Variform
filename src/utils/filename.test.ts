import { describe, it, expect } from "vitest";
import { OutputFormats } from "../types.d";
import { defaultFilename, filenameKey } from "./filename";

describe("filenameKey", () => {
  it("is the format itself for single-file formats", () => {
    expect(filenameKey(OutputFormats.JSON)).toBe("json");
    expect(filenameKey(OutputFormats.FLUTTER)).toBe("flutter");
  });

  it("splits Tailwind into stylesheet and preset files", () => {
    expect(filenameKey(OutputFormats.TAILWIND, "css")).toBe("tailwind");
    expect(filenameKey(OutputFormats.TAILWIND, "preset")).toBe("tailwind:preset");
    expect(filenameKey(OutputFormats.TAILWIND)).toBe("tailwind");
  });
});

describe("defaultFilename", () => {
  it("names the Tailwind files per convention", () => {
    expect(defaultFilename("tailwind")).toBe("globals");
    expect(defaultFilename("tailwind:preset")).toBe("presets.tailwind");
  });

  it("falls back to tokens for every other format", () => {
    expect(defaultFilename("json")).toBe("tokens");
    expect(defaultFilename("flutter")).toBe("tokens");
  });
});
