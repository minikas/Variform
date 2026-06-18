import React from "react";
import { Flex, Label, Select } from "figma-kit";
import { useSelection } from "../contexts/SelectionContext";
import {
  descriptionParsers,
  NO_PARSER_ID,
  NO_PARSER_LABEL,
} from "../utils/descriptionParsers";

interface ParserSelectProps {
  /**
   * Whether to show the select. Hidden for formats that don't emit the
   * description as data (e.g. CSS, or the variables-only DSCG JSON).
   */
  show?: boolean;
}

/**
 * Lets the user pick a parser that transforms each variable's `description`
 * string before it is exported (e.g. "Description to JSON"). The choice is
 * shared across views and persisted via the SelectionContext.
 */
export const ParserSelect: React.FC<ParserSelectProps> = ({ show = true }) => {
  const { parserId, setParserId } = useSelection();

  if (!show) return null;

  return (
    <Flex direction="column" gap="1">
      <Label
        htmlFor="varvar-parser-select"
        style={{ color: "var(--figma-color-text-secondary)" }}
      >
        Parser
      </Label>
      <Select.Root value={parserId} onValueChange={setParserId}>
        <Select.Trigger id="varvar-parser-select" placeholder={NO_PARSER_LABEL} />
        <Select.Content portal>
          <Select.Item value={NO_PARSER_ID}>{NO_PARSER_LABEL}</Select.Item>
          {descriptionParsers.map((parser) => (
            <Select.Item key={parser.id} value={parser.id}>
              {parser.name}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
};
