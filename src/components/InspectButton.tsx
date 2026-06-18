import React from "react";

interface InspectButtonProps {
  onClick: () => void;
  /** Accessible label, e.g. "Inspect Colors". */
  label: string;
}

const buttonStyle: React.CSSProperties = {
  all: "unset",
  boxSizing: "border-box",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "20px",
  height: "20px",
  borderRadius: "4px",
  flexShrink: 0,
  color: "var(--figma-color-text-secondary, rgba(255,255,255,0.7))",
};

/**
 * Small eye icon button that opens the inspect modal for a side item.
 *
 * Plain <button> (not figma-kit's IconButton) so it renders reliably inside the
 * accordion rows; stops click propagation so it never toggles the accordion.
 */
export const InspectButton: React.FC<InspectButtonProps> = ({ onClick, label }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
    style={buttonStyle}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8S3.9 3.75 8 3.75 14.5 8 14.5 8 12.1 12.25 8 12.25 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  </button>
);
