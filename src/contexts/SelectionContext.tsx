import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageTypes, OutputFormats } from "../types.d";
import type { CollectionMeta, ExportSelection, PluginMessage, StyleSelection, TailwindColorMode, TailwindOutput, TailwindUnit } from "../types.d";
import {
  initSelection,
  deselectAllSelection,
  toggleMode as toggleModeOp,
  toggleCollection as toggleCollectionOp,
  getCollectionCheckedState,
  hasAnySelection,
  reconcileSelection,
  type CheckedState,
} from "../utils/selectionState";
import { ALL_STYLES } from "../utils/styleSelection";
import { NO_PARSER_ID } from "../utils/descriptionParsers";
import { toggleCheckedFormat } from "../utils/formatSelection";
import { defaultBranchName } from "../utils/github/branchName";
import {
  PUSH_TARGETS_VERSION,
  parseStoredTargets,
  toPersistedTargets,
  type PersistedPushTarget,
  type PushTarget,
} from "../utils/github/pushTargets";

/** Prefix for the per-document export-selection key in figma.clientStorage. */
const SELECTION_STORAGE_PREFIX = "varvar:export-selection:";
/** Debounce before persisting selection changes to client storage. */
const PERSIST_DEBOUNCE_MS = 300;

interface PersistedSelection {
  selection: ExportSelection;
  styleSelection: StyleSelection;
  parserId: string;
  format: OutputFormats;
  /** Checked formats on the main page (multi-select); active = `format`. */
  formats?: OutputFormats[];
  useRowColumnPos: boolean;
  useDSCGFormat: boolean;
  tailwindOutput: TailwindOutput;
  tailwindPrefix: string;
  tailwindUnit: TailwindUnit;
  tailwindColorMode: TailwindColorMode;
  /**
   * Download filename (without extension) per file key: the format itself for
   * single-file formats, plus "tailwind:preset" for the Tailwind preset file.
   */
  filenameByFormat?: Partial<Record<string, string>>;
  /** Legacy single push path — read-only, only to migrate into pushTargets. */
  githubFilePath?: string;
  /** Multi-format push targets (versioned via pushTargetsVersion). */
  pushTargets?: PersistedPushTarget[];
  pushTargetsVersion?: number;
}

interface SelectionContextValue {
  /** Collection/mode tree sent by the plugin (empty until BASIC_INFO arrives). */
  collections: CollectionMeta[];
  /** Current selection. An empty map means "not initialised yet". */
  selection: ExportSelection;
  /** Which local style kinds to append to the export. */
  styleSelection: StyleSelection;
  /** Id of the selected description parser. */
  parserId: string;
  /** Whether anything at all is selected (false ⇒ the export would be empty). */
  hasSelection: boolean;
  /** True once the collection tree has loaded. */
  isReady: boolean;
  toggleMode: (collectionId: string, modeId: string) => void;
  toggleCollection: (collection: CollectionMeta) => void;
  getCheckedState: (collection: CollectionMeta) => CheckedState;
  selectAll: () => void;
  deselectAll: () => void;
  toggleStyleKind: (kind: keyof StyleSelection) => void;
  setParserId: (id: string) => void;
  /** Selected output format (persisted; drives the generic export view). */
  format: OutputFormats;
  setFormat: (format: OutputFormats) => void;
  /**
   * Checked formats on the main page (persisted, multi-select). The active
   * format (`format`) is the last checked one; unchecking everything is allowed
   * (the preview hides and the actions disable while the set is empty).
   * Single-format menu views (ExportJSON/CSV/CSS/JS) ignore this.
   */
  formats: OutputFormats[];
  setFormats: (formats: OutputFormats[]) => void;
  /** Check/uncheck a format, keeping `format` as the last checked one. */
  toggleFormat: (format: OutputFormats) => void;
  /** Format-specific export option toggles (persisted). */
  useRowColumnPos: boolean;
  setUseRowColumnPos: (value: boolean) => void;
  useDSCGFormat: boolean;
  setUseDSCGFormat: (value: boolean) => void;
  /** Tailwind-format options (persisted): which output and optional prefix. */
  tailwindOutput: TailwindOutput;
  setTailwindOutput: (value: TailwindOutput) => void;
  tailwindPrefix: string;
  setTailwindPrefix: (value: string) => void;
  /** Tailwind length unit (px/rem/em) and color mode, persisted. */
  tailwindUnit: TailwindUnit;
  setTailwindUnit: (value: TailwindUnit) => void;
  tailwindColorMode: TailwindColorMode;
  setTailwindColorMode: (value: TailwindColorMode) => void;
  /**
   * Download filename (without extension) per file key (persisted per
   * document; defaults in utils/filename). Multi-file formats have one entry
   * per file (Tailwind: "tailwind" for the stylesheet, "tailwind:preset" for
   * the preset). Downloads and preview labels use the active file's.
   */
  filenameByFormat: Partial<Record<string, string>>;
  setFilenameFor: (key: string, name: string) => void;
  /**
   * Multi-format push targets, persisted per document (branch names excluded —
   * they are reseeded per session).
   */
  pushTargets: PushTarget[];
  setPushTargets: (targets: PushTarget[]) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Provides the export selection (which collections/modes and whether to include
 * local styles) to every export view. Lives above the router so the selection
 * survives switching between formats, and persists per-document via the
 * plugin's client storage.
 */
export const SelectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [selection, setSelection] = useState<ExportSelection>({});
  const [styleSelection, setStyleSelection] = useState<StyleSelection>(ALL_STYLES);
  const [parserId, setParserId] = useState<string>(NO_PARSER_ID);
  const [format, setFormat] = useState<OutputFormats>(OutputFormats.JSON);
  const [formats, setFormats] = useState<OutputFormats[]>([OutputFormats.JSON]);
  const [useRowColumnPos, setUseRowColumnPos] = useState<boolean>(false);
  const [useDSCGFormat, setUseDSCGFormat] = useState<boolean>(false);
  const [tailwindOutput, setTailwindOutput] = useState<TailwindOutput>("css");
  const [tailwindPrefix, setTailwindPrefix] = useState<string>("");
  const [tailwindUnit, setTailwindUnit] = useState<TailwindUnit>("px");
  const [tailwindColorMode, setTailwindColorMode] = useState<TailwindColorMode>("var-fallback");
  const [filenameByFormat, setFilenameByFormat] = useState<Partial<Record<string, string>>>({});
  const [pushTargets, setPushTargets] = useState<PushTarget[]>([]);
  const [filename, setFilename] = useState<string>("");
  // `undefined` until client storage replies; then the raw stored string or null.
  const [storedRaw, setStoredRaw] = useState<string | null | undefined>(undefined);

  const storageRequestedRef = useRef(false);
  // Gate persistence until the stored value has been applied, so the provisional
  // "all selected" default never overwrites a saved selection.
  const hydratedRef = useRef(false);
  // The persisted collection/mode selection, parked here when storage replies
  // before the collection tree arrives (and simply never applied in documents
  // without collections).
  const pendingSelectionRef = useRef<ExportSelection | null>(null);

  const storageKey = filename ? `${SELECTION_STORAGE_PREFIX}${filename}` : null;

  // Capture the collection tree + filename from BASIC_INFO and the saved
  // selection from STORAGE_VALUE. Uses addEventListener so it coexists with
  // useExportData's `window.onmessage`.
  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const msg: PluginMessage | undefined = event.data?.pluginMessage;
      if (!msg) return;

      if (msg.type === MessageTypes.BASIC_INFO && msg.collections) {
        const incoming = msg.collections;
        setCollections(incoming);
        if (msg.filename) setFilename(msg.filename);
        setSelection((prev) =>
          Object.keys(prev).length === 0
            ? initSelection(incoming)
            : reconcileSelection(prev, incoming)
        );
        return;
      }

      if (
        msg.type === MessageTypes.STORAGE_VALUE &&
        msg.storageKey?.startsWith(SELECTION_STORAGE_PREFIX)
      ) {
        setStoredRaw(msg.storageValue ?? null);
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, []);

  // Ask the plugin for the saved selection once we know the document name.
  useEffect(() => {
    if (!storageKey || storageRequestedRef.current) return;
    storageRequestedRef.current = true;
    parent.postMessage(
      { pluginMessage: { type: MessageTypes.STORAGE_GET, storageKey } },
      "*"
    );
  }, [storageKey]);

  // Hydrate from the saved selection once the storage reply is available.
  // Options (format, tailwind, parser, ...) restore even in documents without
  // collections; only the collection/mode selection waits for the tree, since
  // reconciling it requires the collections that still exist.
  useEffect(() => {
    if (storedRaw !== undefined && !hydratedRef.current) {
      hydratedRef.current = true;
      if (storedRaw) {
        try {
          const parsed = JSON.parse(storedRaw) as Partial<PersistedSelection>;
          if (parsed && typeof parsed === "object") {
            if (parsed.selection) {
              pendingSelectionRef.current = parsed.selection;
            }
            if (parsed.styleSelection && typeof parsed.styleSelection === "object") {
              setStyleSelection({ ...ALL_STYLES, ...parsed.styleSelection });
            }
            if (typeof parsed.parserId === "string") {
              setParserId(parsed.parserId);
            }
            if (parsed.format) {
              setFormat(parsed.format);
            }
            // Checked formats (multi-select). Records saved before multi-select
            // have no field: the single active format is the checked one. An
            // explicit empty array is respected (the user unchecked everything).
            const hasFormatsField = Array.isArray(parsed.formats);
            const restoredFormats = hasFormatsField
              ? (parsed.formats as unknown[]).filter(
                  (f): f is OutputFormats =>
                    typeof f === "string" &&
                    (Object.values(OutputFormats) as string[]).includes(f),
                )
              : [];
            if (restoredFormats.length > 0) {
              setFormats(restoredFormats);
              if (!parsed.format || !restoredFormats.includes(parsed.format)) {
                setFormat(restoredFormats[restoredFormats.length - 1]);
              }
            } else if (!hasFormatsField) {
              setFormats([parsed.format ?? OutputFormats.JSON]);
            }
            if (typeof parsed.useRowColumnPos === "boolean") {
              setUseRowColumnPos(parsed.useRowColumnPos);
            }
            if (typeof parsed.useDSCGFormat === "boolean") {
              setUseDSCGFormat(parsed.useDSCGFormat);
            }
            if (parsed.tailwindOutput === "css" || parsed.tailwindOutput === "preset") {
              setTailwindOutput(parsed.tailwindOutput);
            }
            if (typeof parsed.tailwindPrefix === "string") {
              setTailwindPrefix(parsed.tailwindPrefix);
            }
            if (parsed.tailwindUnit === "px" || parsed.tailwindUnit === "rem" || parsed.tailwindUnit === "em") {
              setTailwindUnit(parsed.tailwindUnit);
            }
            if (parsed.tailwindColorMode === "var-fallback" || parsed.tailwindColorMode === "var" || parsed.tailwindColorMode === "concrete" || parsed.tailwindColorMode === "hex") {
              setTailwindColorMode(parsed.tailwindColorMode);
            }
            if (parsed.filenameByFormat && typeof parsed.filenameByFormat === "object") {
              const validKeys = [...(Object.values(OutputFormats) as string[]), "tailwind:preset"];
              const restoredNames: Partial<Record<string, string>> = {};
              for (const [key, value] of Object.entries(parsed.filenameByFormat)) {
                if (validKeys.includes(key) && typeof value === "string") {
                  restoredNames[key] = value;
                }
              }
              setFilenameByFormat(restoredNames);
            }
            // Push targets: restore the persisted set (fresh branch seed) or
            // migrate the legacy single githubFilePath into an initial target.
            const restoredTargets = parseStoredTargets(
              parsed,
              defaultBranchName(filename || "variables", Date.now().toString(36).slice(-4)),
            );
            if (restoredTargets) {
              setPushTargets(restoredTargets);
            }
          }
        } catch {
          // Ignore corrupt storage and keep the default selection.
        }
      }
    }

    // The collection/mode selection reconciles against the tree, so it can
    // only be applied once the collections have loaded (BASIC_INFO usually
    // arrives before the storage reply, but the reverse order is covered too).
    if (pendingSelectionRef.current && collections.length > 0) {
      const persisted = pendingSelectionRef.current;
      pendingSelectionRef.current = null;
      setSelection(reconcileSelection(persisted, collections));
    }
  }, [collections, storedRaw]);

  // Persist selection + styleSelection (debounced) after hydration.
  useEffect(() => {
    if (!hydratedRef.current || !storageKey) return;
    const handle = setTimeout(() => {
      const payload: PersistedSelection = {
        selection,
        styleSelection,
        parserId,
        format,
        formats,
        useRowColumnPos,
        useDSCGFormat,
        tailwindOutput,
        tailwindPrefix,
        tailwindUnit,
        tailwindColorMode,
        filenameByFormat,
        // Branch names are session-scoped: strip them from the persisted set
        // (they are reseeded on every load — see parseStoredTargets).
        pushTargets: toPersistedTargets(pushTargets),
        pushTargetsVersion: PUSH_TARGETS_VERSION,
      };
      parent.postMessage(
        {
          pluginMessage: {
            type: MessageTypes.STORAGE_SET,
            storageKey,
            storageValue: JSON.stringify(payload),
          },
        },
        "*"
      );
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [
    selection,
    styleSelection,
    parserId,
    format,
    formats,
    useRowColumnPos,
    useDSCGFormat,
    tailwindOutput,
    tailwindPrefix,
    tailwindUnit,
    tailwindColorMode,
    filenameByFormat,
    pushTargets,
    storageKey,
  ]);

  const toggleMode = useCallback((collectionId: string, modeId: string) => {
    setSelection((prev) => toggleModeOp(prev, collectionId, modeId));
  }, []);

  const toggleCollection = useCallback((collection: CollectionMeta) => {
    setSelection((prev) => toggleCollectionOp(prev, collection));
  }, []);

  const getCheckedState = useCallback(
    (collection: CollectionMeta) => getCollectionCheckedState(selection, collection),
    [selection]
  );

  const selectAll = useCallback(() => {
    setSelection(initSelection(collections));
  }, [collections]);

  const deselectAll = useCallback(() => {
    setSelection(deselectAllSelection(collections));
  }, [collections]);

  const toggleStyleKind = useCallback((kind: keyof StyleSelection) => {
    setStyleSelection((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }, []);

  const setFilenameFor = useCallback((key: string, name: string) => {
    setFilenameByFormat((prev) => ({ ...prev, [key]: name }));
  }, []);

  // Check/uncheck a format on the main page: checking makes it the active
  // format; unchecking everything is allowed (see formatSelection).
  const toggleFormat = useCallback(
    (target: OutputFormats) => {
      const next = toggleCheckedFormat(formats, target, format);
      setFormats(next.checked);
      if (next.active !== format) {
        setFormat(next.active);
      }
    },
    [formats, format],
  );

  const value = useMemo<SelectionContextValue>(
    () => ({
      collections,
      selection,
      styleSelection,
      parserId,
      hasSelection: hasAnySelection(selection),
      isReady: collections.length > 0,
      toggleMode,
      toggleCollection,
      getCheckedState,
      selectAll,
      deselectAll,
      toggleStyleKind,
      setParserId,
      format,
      setFormat,
      formats,
      setFormats,
      toggleFormat,
      useRowColumnPos,
      setUseRowColumnPos,
      useDSCGFormat,
      setUseDSCGFormat,
      tailwindOutput,
      setTailwindOutput,
      tailwindPrefix,
      setTailwindPrefix,
      tailwindUnit,
      setTailwindUnit,
      tailwindColorMode,
      setTailwindColorMode,
      filenameByFormat,
      setFilenameFor,
      pushTargets,
      setPushTargets,
    }),
    [
      collections,
      selection,
      styleSelection,
      parserId,
      format,
      formats,
      useRowColumnPos,
      useDSCGFormat,
      tailwindOutput,
      tailwindPrefix,
      tailwindUnit,
      tailwindColorMode,
      filenameByFormat,
      pushTargets,
      toggleMode,
      toggleCollection,
      getCheckedState,
      selectAll,
      deselectAll,
      toggleStyleKind,
      toggleFormat,
      setFilenameFor,
    ]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
};

/**
 * Accesses the export selection. Must be used within a {@link SelectionProvider}.
 */
export const useSelection = (): SelectionContextValue => {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return ctx;
};
