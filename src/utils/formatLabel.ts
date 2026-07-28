import { OutputFormats } from "../types.d";

/** Human-readable label for an export format (badges, selectors). */
export function formatLabel(format: OutputFormats): string {
  switch (format) {
    case OutputFormats.JSON:
      return "JSON";
    case OutputFormats.JS:
      return "JavaScript";
    case OutputFormats.CSV:
      return "CSV";
    case OutputFormats.CSS:
      return "CSS";
    case OutputFormats.TAILWIND:
      return "Tailwind";
    case OutputFormats.TS:
      return "TypeScript";
    case OutputFormats.REACT_NATIVE:
      return "React Native";
    case OutputFormats.TAMAGUI:
      return "Tamagui";
    case OutputFormats.SCSS:
      return "SCSS";
    case OutputFormats.STYLE_DICTIONARY:
      return "Style Dictionary";
    case OutputFormats.SWIFT:
      return "iOS Swift";
    case OutputFormats.ANDROID:
      return "Android";
    case OutputFormats.FLUTTER:
      return "Flutter";
    default:
      return format;
  }
}
