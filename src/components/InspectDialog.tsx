import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { InspectTable } from "../types.d";
import { useInspect } from "../contexts/InspectContext";

// All colors carry a hardcoded fallback: the modal renders into document.body
// via a portal, where the figma-kit theme variables can be absent — without
// fallbacks the panel would be invisible over the scrim.
const BG = "var(--figma-color-bg, #2c2c2c)";
const TEXT = "var(--figma-color-text, #ffffff)";
const TEXT_SECONDARY = "var(--figma-color-text-secondary, rgba(255,255,255,0.7))";
const BORDER = "var(--figma-color-border, rgba(255,255,255,0.12))";
const FONT_SIZE = "var(--font-size-default, 11px)";

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483000,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "min(720px, 92vw)",
  maxHeight: "84vh",
  background: BG,
  color: TEXT,
  border: `1px solid ${BORDER}`,
  borderRadius: "8px",
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.5)",
  overflow: "hidden",
  fontFamily: "var(--font-family-default, Inter, ui-sans-serif, system-ui, sans-serif)",
  fontSize: FONT_SIZE,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 14px",
  borderBottom: `1px solid ${BORDER}`,
  flexShrink: 0,
};

const closeButtonStyle: React.CSSProperties = {
  appearance: "none",
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: TEXT,
  borderRadius: "6px",
  padding: "4px 10px",
  cursor: "pointer",
  font: "inherit",
};

// The scroll area sits flush against the header — no top padding — so the
// sticky <th> docks to the very top with nothing visible behind it.
const scrollAreaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
};

const messageStyle: React.CSSProperties = {
  padding: "12px 14px",
  color: TEXT_SECONDARY,
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  minWidth: "100%",
  color: TEXT,
  fontSize: FONT_SIZE,
};

const cellBase: React.CSSProperties = {
  padding: "4px 10px",
  borderBottom: `1px solid ${BORDER}`,
  textAlign: "left",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const thStyle: React.CSSProperties = {
  ...cellBase,
  color: TEXT_SECONDARY,
  fontWeight: 600,
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: BG,
};

const colorCellStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};

// A small checkerboard so translucent colors read correctly.
const swatchWrapStyle: React.CSSProperties = {
  display: "inline-block",
  width: "12px",
  height: "12px",
  borderRadius: "3px",
  border: `1px solid ${BORDER}`,
  flexShrink: 0,
  overflow: "hidden",
  backgroundColor: "#fff",
  backgroundImage:
    "linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)",
  backgroundSize: "6px 6px",
  backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0",
};

/** Whether a cell value is a CSS color or gradient we can preview as a swatch. */
const isColorLike = (value: string): boolean => {
  const v = value.trim();
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^(rgba?|hsla?)\(/.test(v) ||
    /gradient\(/i.test(v)
  );
};

const Cell: React.FC<{ value: string }> = ({ value }) =>
  isColorLike(value) ? (
    <span style={colorCellStyle}>
      <span style={swatchWrapStyle}>
        <span style={{ display: "block", width: "100%", height: "100%", background: value }} />
      </span>
      {value}
    </span>
  ) : (
    <>{value}</>
  );

const InspectTableView: React.FC<{ table: InspectTable }> = ({ table }) => (
  <div className="varvar-scroll-thin" style={scrollAreaStyle}>
    <table style={tableStyle}>
      <thead>
        <tr>
          {table.columns.map((column, index) => (
            <th key={index} style={thStyle}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} style={cellBase}>
                <Cell value={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * Modal that shows the contents of an inspected side item (a variable
 * collection or the local styles) as a table.
 *
 * Built as a self-contained portal with hardcoded color fallbacks rather than
 * figma-kit's Dialog / IconButton: those rendered invisibly (or crashed via a
 * Tooltip without provider) when mounted in a body-level portal.
 */
export const InspectDialog: React.FC = () => {
  const { open, loading, table, close } = useInspect();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div style={overlayStyle} onClick={close}>
      <div
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div style={headerStyle}>
          <strong>{table?.title ?? "Details"}</strong>
          <button type="button" style={closeButtonStyle} onClick={close}>
            Close
          </button>
        </div>
        {loading ? (
          <div style={messageStyle}>Loading…</div>
        ) : table && table.rows.length > 0 ? (
          <InspectTableView table={table} />
        ) : (
          <div style={messageStyle}>Nothing to show.</div>
        )}
      </div>
    </div>,
    document.body
  );
};
