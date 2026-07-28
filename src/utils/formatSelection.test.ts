import { describe, it, expect } from "vitest";
import { OutputFormats } from "../types.d";
import { toggleCheckedFormat } from "./formatSelection";

describe("toggleCheckedFormat", () => {
  it("checks a new format and makes it active", () => {
    expect(
      toggleCheckedFormat([OutputFormats.JSON], OutputFormats.TAILWIND, OutputFormats.JSON),
    ).toEqual({
      checked: [OutputFormats.JSON, OutputFormats.TAILWIND],
      active: OutputFormats.TAILWIND,
    });
  });

  it("unchecks a non-active format, keeping the active one", () => {
    expect(
      toggleCheckedFormat(
        [OutputFormats.JSON, OutputFormats.TAILWIND],
        OutputFormats.JSON,
        OutputFormats.TAILWIND,
      ),
    ).toEqual({
      checked: [OutputFormats.TAILWIND],
      active: OutputFormats.TAILWIND,
    });
  });

  it("moves the active format to the last remaining when unchecked", () => {
    expect(
      toggleCheckedFormat(
        [OutputFormats.JSON, OutputFormats.FLUTTER, OutputFormats.TAILWIND],
        OutputFormats.TAILWIND,
        OutputFormats.TAILWIND,
      ),
    ).toEqual({
      checked: [OutputFormats.JSON, OutputFormats.FLUTTER],
      active: OutputFormats.FLUTTER,
    });
  });

  it("allows unchecking everything, keeping the last active value", () => {
    expect(
      toggleCheckedFormat([OutputFormats.JSON], OutputFormats.JSON, OutputFormats.JSON),
    ).toEqual({
      checked: [],
      active: OutputFormats.JSON,
    });
  });
});
