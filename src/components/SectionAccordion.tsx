import React, { useState } from "react";
import { Flex, Text, Collapsible } from "figma-kit";

interface SectionAccordionProps {
  /** Section heading shown to the left of the trigger row. */
  label: string;
  /** Shown on the right of the header row while the section is collapsed. */
  summary?: React.ReactNode;
  /** Whether the section starts expanded. Defaults to collapsed. */
  defaultOpen?: boolean;
  /** Optional control rendered to the right of the header while expanded. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

const labelStyle: React.CSSProperties = {
  color: "var(--figma-color-text-secondary)",
};

// figma-kit's Collapsible.Trigger already provides display:flex, align-items,
// width and the auto-rotating chevron. We only fill the row and tidy spacing.
const triggerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  gap: "var(--space-1)",
  padding: "2px 0",
  cursor: "pointer",
  textAlign: "left",
};

const rowStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-2)",
};

/**
 * A collapsible section with a header row. When collapsed it shows a summary of
 * the current selection on the right (space-between); when expanded it can show
 * an action control there instead. Used to keep the export sidebar compact.
 */
export const SectionAccordion: React.FC<SectionAccordionProps> = ({
  label,
  summary,
  defaultOpen = false,
  action,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Flex align="center" justify="between" gap="2">
        <Collapsible.Trigger style={triggerStyle}>
          <span style={rowStyle}>
            <Text style={labelStyle}>{label}</Text>
            {!open && summary != null ? (
              <Text style={labelStyle}>{summary}</Text>
            ) : null}
          </span>
        </Collapsible.Trigger>
        {open && action ? action : null}
      </Flex>

      <Collapsible.Content>
        <div style={{ paddingTop: "var(--space-2)" }}>{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};
