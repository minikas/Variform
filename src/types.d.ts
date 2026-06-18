type NumericRange<
  START extends number,
  END extends number,
  ARR extends unknown[] = [],
  ACC extends number = never,
> = ARR["length"] extends END
  ? ACC | START | END
  : NumericRange<
      START,
      END,
      [...ARR, 1],
      ARR[START] extends undefined ? ACC : ACC | ARR["length"]
    >;

type Bit8 = NumericRange<0, 255>;
type Angle =
  | `${number}deg`
  | `${number}rad`
  | `${number}grad`
  | `${number}turn`
  | 0;
type Percentage = NumericRange<0, 100>;
type Opacity = NumericRange<0, 1>;

export interface RGB {
  r: Bit8;
  g: Bit8;
  b: Bit8;
}
export interface RGBA extends RGB {
  a: Opacity;
}
export interface HSL {
  h: Angle | number;
  s: Percentage;
  l: Percentage;
}
export interface HSLA extends HSL {
  a: Opacity;
}

type CssRGB = `rgb(${string})`;
type CssRGBA = `rgba(${string})`;
type CssHEX = `#${string}`;
type CssHSL = `hsl(${string})`;
type CssHSLA = `hsla(${string})`;
type CssVAR = `var(${string})`;
type CssGlobalValues = "inherit" | "initial" | "revert" | "unset";

export type CssColor =
  | "currentColor"
  | "transparent"
  | CssRGB
  | CssRGBA
  | CssHEX
  | CssHSL
  | CssHSLA
  | CssVAR
  | CssGlobalValues;

/**
 * Supported export formats for Figma variables
 */
export enum OutputFormats {
  CSV = "csv",
  JSON = "json", 
  CSS = "css",
  JS = "js",
  TS = "ts"
}

/**
 * Plugin command types for menu actions
 */
export enum PluginCommands {
  EXPORT_GENERIC = "export",
  EXPORT_JSON = "export-json",
  EXPORT_CSV = "export-csv", 
  EXPORT_CSS = "export-css",
  EXPORT_JS = "export-js"
}

/**
 * Message types for plugin communication
 */
export enum MessageTypes {
  // Info messages
  GET_BASIC_INFO = "INFO.GET_BASIC_INFO",
  BASIC_INFO = "INFO.BASIC_INFO",

  // Export messages
  EXPORT_SUCCESS = "EXPORT.SUCCESS",
  EXPORT_SUCCESS_RESULT = "EXPORT.SUCCESS.RESULT",
  EXPORT_ERROR = "EXPORT.ERROR",

  // Persistent storage messages (backed by figma.clientStorage)
  STORAGE_GET = "STORAGE.GET",
  STORAGE_SET = "STORAGE.SET",
  STORAGE_VALUE = "STORAGE.VALUE",

  // Inspect messages (show a side item's contents in a modal table)
  INSPECT_COLLECTION = "INSPECT.COLLECTION",
  INSPECT_STYLES = "INSPECT.STYLES",
  INSPECT_RESULT = "INSPECT.RESULT"
}

/**
 * Lightweight description of a Figma variable collection and its modes,
 * sent to the UI so it can render the export-selection accordion.
 */
export interface CollectionMeta {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
}

/**
 * Which collection/mode pairs to include in an export.
 *
 * Keyed by collection id → the selected mode ids for that collection.
 * A collection that is absent OR maps to an empty array is skipped entirely.
 * An `undefined` selection means "export everything" (back-compat with the
 * pre-selection behaviour).
 */
export type ExportSelection = Record<string, string[]>;

/**
 * Which kinds of local Figma styles to append to the export. Each kind is
 * toggled independently in the UI; an omitted selection means "all kinds".
 */
export interface StyleSelection {
  text: boolean;
  paint: boolean;
  effect: boolean;
  grid: boolean;
}

/**
 * A ready-to-render table describing the contents of a side item (a variable
 * collection or the local styles). Built by the plugin (which has the values)
 * and shown by the UI in the inspect modal.
 */
export interface InspectTable {
  title: string;
  columns: string[];
  rows: string[][];
}

/**
 * Plugin message interface for communication between UI and plugin code
 */
export interface PluginMessage {
  type: MessageTypes;
  command?: PluginCommands;
  format?: OutputFormats;
  useLinkedVarRowAndColPos?: boolean;
  useTailwindFormat?: boolean;
  useDSCGFormat?: boolean;
  count?: number;
  filename?: string;
  data?: string;
  error?: string;
  editorType?: string;
  // Export-selection payload: the collection/mode tree (plugin → UI) and the
  // user's selection plus the "include local styles" toggle (UI → plugin).
  collections?: CollectionMeta[];
  selection?: ExportSelection;
  styleSelection?: StyleSelection;
  // Id of the description parser to apply (see utils/descriptionParsers).
  parserId?: string;
  // Inspect payload: the collection id to inspect (UI → plugin) and the
  // resulting table (plugin → UI).
  inspectCollectionId?: string;
  inspect?: InspectTable;
  // Persistent storage payload (used by STORAGE_* messages)
  storageKey?: string;
  storageValue?: string | null;
  // Correlates a request with its response so a promise bridge can resolve the
  // matching reply (echoed back by the plugin on responses).
  requestId?: string;
}