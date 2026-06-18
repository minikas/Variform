import { describe, it, expect } from "vitest";
import { stylesToInspectRows } from "./styleSerializers";

const emptyStyles = { text: [], paint: [], effect: [], grid: [] } as any;

describe("stylesToInspectRows", () => {
  it("returns no rows when there are no local styles", () => {
    expect(stylesToInspectRows(emptyStyles)).toEqual([]);
  });

  it("builds [name, kind, value, description] rows per style kind", () => {
    const styles = {
      ...emptyStyles,
      paint: [
        {
          name: "Brand/Accent",
          description: "primary",
          paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
        },
      ],
    } as any;

    const rows = stylesToInspectRows(styles);

    expect(rows).toHaveLength(1);
    const [name, kind, value, description] = rows[0];
    expect(name).toBe("Brand/Accent");
    expect(kind).toBe("Paint");
    expect(value.length).toBeGreaterThan(0);
    expect(description).toBe("primary");
  });
});
