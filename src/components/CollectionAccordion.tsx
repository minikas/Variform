import React, { useState } from "react";
import { Flex, Text, Button, Checkbox, Collapsible } from "figma-kit";
import type { CollectionMeta } from "../types.d";
import { useSelection } from "../contexts/SelectionContext";
import { useInspect } from "../contexts/InspectContext";
import { STYLE_KINDS, anyStyleSelected } from "../utils/styleSelection";
import { SectionAccordion } from "./SectionAccordion";
import { InspectButton } from "./InspectButton";

const mutedTextStyle: React.CSSProperties = {
  color: "var(--figma-color-text-secondary)",
};

// The figma-kit Collapsible.Trigger already provides display:flex,
// align-items:center, width:100%, the auto-rotating chevron and the base font.
// We only tweak it to fill the row, tighten the padding and add a pointer.
const triggerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  gap: "var(--space-1)",
  padding: "2px 0",
  cursor: "pointer",
  textAlign: "left",
};

/**
 * Accordion that lists every variable collection and its modes (themes), letting
 * the user pick exactly what to export. Everything is selected by default; the
 * selection drives the live preview through the SelectionContext.
 */
export const CollectionAccordion: React.FC = () => {
  const {
    collections,
    selection,
    styleSelection,
    hasSelection,
    isReady,
    toggleMode,
    toggleCollection,
    getCheckedState,
    selectAll,
    deselectAll,
    toggleStyleKind,
  } = useSelection();
  const { inspectCollection, inspectStyles } = useInspect();

  // Collections start collapsed; the user expands the ones they care about.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const toggleOpen = (collectionId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });
  };

  const allSelected = isReady && collections.every((c) => getCheckedState(c) === true);
  const showEmptyWarning =
    isReady && !hasSelection && !anyStyleSelected(styleSelection);

  // Summaries shown on the right of each section header while it is collapsed.
  const totalModes = collections.reduce((sum, c) => sum + c.modes.length, 0);
  const selectedModes = collections.reduce(
    (sum, c) => sum + (selection[c.id]?.length ?? 0),
    0,
  );
  const selectedStyleKinds = STYLE_KINDS.filter(({ key }) => styleSelection[key]).length;

  return (
    <Flex direction="column" gap="3">
      <SectionAccordion
        label="Collections"
        summary={isReady ? `${selectedModes}/${totalModes}` : undefined}
        action={
          isReady ? (
            <Button variant="text" onClick={allSelected ? deselectAll : selectAll}>
              {allSelected ? "Deselect all" : "Select all"}
            </Button>
          ) : undefined
        }
      >
        {!isReady && (
          <Text style={mutedTextStyle}>No variable collections found in this file.</Text>
        )}

        <Flex direction="column" gap="2">
          {collections.map((collection: CollectionMeta) => {
            const checkedState = getCheckedState(collection);
            const isOpen = openIds.has(collection.id);
            const selectedCount = (selection[collection.id] ?? []).length;

            return (
              <Collapsible.Root
                key={collection.id}
                open={isOpen}
                onOpenChange={() => toggleOpen(collection.id)}
              >
                <Flex align="center" gap="1">
                  <Checkbox.Root style={{ gridTemplateColumns: "var(--space-4)" }}>
                    <Checkbox.Input
                      checked={checkedState === true}
                      indeterminate={checkedState === "indeterminate"}
                      onChange={() => toggleCollection(collection)}
                    />
                  </Checkbox.Root>
                  <Collapsible.Trigger style={triggerStyle}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{collection.name}</span>{" "}
                      <span style={mutedTextStyle}>
                        ({selectedCount}/{collection.modes.length})
                      </span>
                    </span>
                  </Collapsible.Trigger>
                  <InspectButton
                    onClick={() => inspectCollection(collection.id)}
                    label={`Inspect ${collection.name}`}
                  />
                </Flex>

                <Collapsible.Content>
                  <Flex
                    direction="column"
                    gap="1"
                    style={{ paddingLeft: "var(--space-2)", paddingTop: "2px", paddingBottom: "6px" }}
                  >
                    {collection.modes.map((mode) => {
                      const checked = (selection[collection.id] ?? []).includes(mode.modeId);
                      return (
                        <Checkbox.Root key={mode.modeId}>
                          <Checkbox.Input
                            checked={checked}
                            onChange={() => toggleMode(collection.id, mode.modeId)}
                          />
                          <Checkbox.Label>{mode.name}</Checkbox.Label>
                        </Checkbox.Root>
                      );
                    })}
                  </Flex>
                </Collapsible.Content>
              </Collapsible.Root>
            );
          })}
        </Flex>
      </SectionAccordion>

      <SectionAccordion
        label="Local styles"
        summary={`${selectedStyleKinds}/${STYLE_KINDS.length}`}
        action={<InspectButton onClick={inspectStyles} label="Inspect local styles" />}
      >
        <Flex direction="column" gap="1">
          {STYLE_KINDS.map(({ key, label }) => (
            <Checkbox.Root key={key}>
              <Checkbox.Input
                checked={styleSelection[key]}
                onChange={() => toggleStyleKind(key)}
              />
              <Checkbox.Label>{label}</Checkbox.Label>
            </Checkbox.Root>
          ))}
        </Flex>
      </SectionAccordion>

      {showEmptyWarning && (
        <Text style={{ color: "var(--figma-color-text-danger)" }}>
          Nothing selected — the export will be empty.
        </Text>
      )}
    </Flex>
  );
};
