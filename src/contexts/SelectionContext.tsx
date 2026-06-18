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
import type { CollectionMeta, ExportSelection, PluginMessage, StyleSelection } from "../types.d";
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

/** Prefix for the per-document export-selection key in figma.clientStorage. */
const SELECTION_STORAGE_PREFIX = "varvar:export-selection:";
/** Debounce before persisting selection changes to client storage. */
const PERSIST_DEBOUNCE_MS = 300;

interface PersistedSelection {
  selection: ExportSelection;
  styleSelection: StyleSelection;
  parserId: string;
  format: OutputFormats;
  useRowColumnPos: boolean;
  useTailwindFormat: boolean;
  useDSCGFormat: boolean;
  githubFilePath: string;
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
  /** Format-specific export option toggles (persisted). */
  useRowColumnPos: boolean;
  setUseRowColumnPos: (value: boolean) => void;
  useTailwindFormat: boolean;
  setUseTailwindFormat: (value: boolean) => void;
  useDSCGFormat: boolean;
  setUseDSCGFormat: (value: boolean) => void;
  /** GitHub push file path, persisted per document. */
  githubFilePath: string;
  setGithubFilePath: (path: string) => void;
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
  const [useRowColumnPos, setUseRowColumnPos] = useState<boolean>(false);
  const [useTailwindFormat, setUseTailwindFormat] = useState<boolean>(false);
  const [useDSCGFormat, setUseDSCGFormat] = useState<boolean>(false);
  const [githubFilePath, setGithubFilePath] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  // `undefined` until client storage replies; then the raw stored string or null.
  const [storedRaw, setStoredRaw] = useState<string | null | undefined>(undefined);

  const storageRequestedRef = useRef(false);
  // Gate persistence until the stored value has been applied, so the provisional
  // "all selected" default never overwrites a saved selection.
  const hydratedRef = useRef(false);

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

  // Hydrate from the saved selection once both the tree and the storage reply
  // are available, reconciling against the collections that still exist.
  useEffect(() => {
    if (collections.length === 0 || storedRaw === undefined || hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;
    if (!storedRaw) return;
    try {
      const parsed = JSON.parse(storedRaw) as Partial<PersistedSelection>;
      if (parsed && typeof parsed === "object") {
        if (parsed.selection) {
          setSelection(reconcileSelection(parsed.selection, collections));
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
        if (typeof parsed.useRowColumnPos === "boolean") {
          setUseRowColumnPos(parsed.useRowColumnPos);
        }
        if (typeof parsed.useTailwindFormat === "boolean") {
          setUseTailwindFormat(parsed.useTailwindFormat);
        }
        if (typeof parsed.useDSCGFormat === "boolean") {
          setUseDSCGFormat(parsed.useDSCGFormat);
        }
        if (typeof parsed.githubFilePath === "string") {
          setGithubFilePath(parsed.githubFilePath);
        }
      }
    } catch {
      // Ignore corrupt storage and keep the default selection.
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
        useRowColumnPos,
        useTailwindFormat,
        useDSCGFormat,
        githubFilePath,
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
    useRowColumnPos,
    useTailwindFormat,
    useDSCGFormat,
    githubFilePath,
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
      useRowColumnPos,
      setUseRowColumnPos,
      useTailwindFormat,
      setUseTailwindFormat,
      useDSCGFormat,
      setUseDSCGFormat,
      githubFilePath,
      setGithubFilePath,
    }),
    [
      collections,
      selection,
      styleSelection,
      parserId,
      format,
      useRowColumnPos,
      useTailwindFormat,
      useDSCGFormat,
      githubFilePath,
      toggleMode,
      toggleCollection,
      getCheckedState,
      selectAll,
      deselectAll,
      toggleStyleKind,
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
