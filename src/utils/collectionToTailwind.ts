import { rgbToTailwindColor } from "./color";
import { toCssVar } from "./stringTransformation";
import { getLocalStyles, stylesToTailwindTokens, filterStyles } from "./styleSerializers";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import type { ExportSelection, StyleSelection, TailwindUnit } from "../types.d";

/** Base font size used when converting px lengths to rem/em. */
const REM_BASE_PX = 16;

/**
 * Formats a px length in the chosen unit. rem/em values are converted from a
 * 16px base and rounded to 4 decimal places (e.g. 10px → "0.625rem").
 * @param value - The length in px
 * @param unit - Target unit (px, rem or em)
 * @returns The formatted length string
 */
export function formatTailwindLength(value: number, unit: TailwindUnit = "px"): string {
    if (unit === "px") return `${value}px`;
    const converted = parseFloat((value / REM_BASE_PX).toFixed(4));
    return `${converted}${unit}`;
}

/**
 * Detects the Tailwind theme category for a variable from its resolved type and
 * naming conventions. Returns the v4 theme-namespace segment (e.g. "color",
 * "spacing", "font-size") or "" when no pattern matches.
 * @param name - Original variable name
 * @param resolvedType - Type of the variable
 * @returns Tailwind category segment, or "" as fallback
 */
export function detectTailwindCategory(name: string, resolvedType: string): string {
    const lowerName = name.toLowerCase();

    // Auto-detect color variables
    if (resolvedType === "COLOR" ||
        lowerName.includes('color') ||
        lowerName.includes('primary') ||
        lowerName.includes('secondary') ||
        lowerName.includes('accent') ||
        lowerName.includes('background') ||
        lowerName.includes('foreground') ||
        lowerName.includes('border') ||
        lowerName.includes('text')) {
        return "color";
    }

    // Auto-detect spacing/size variables
    if (lowerName.includes('spacing') ||
        lowerName.includes('margin') ||
        lowerName.includes('padding') ||
        lowerName.includes('gap') ||
        lowerName.includes('space')) {
        return "spacing";
    }

    // Auto-detect size variables
    if (lowerName.includes('size') ||
        lowerName.includes('width') ||
        lowerName.includes('height') ||
        lowerName.includes('radius') ||
        lowerName.includes('border')) {
        return "size";
    }

    // Auto-detect typography variables
    if (lowerName.includes('font') ||
        lowerName.includes('text') ||
        lowerName.includes('line') ||
        lowerName.includes('letter') ||
        lowerName.includes('weight')) {
        if (lowerName.includes('family') || lowerName.includes('font')) {
            return "font-family";
        } else if (lowerName.includes('size')) {
            return "font-size";
        } else if (lowerName.includes('weight')) {
            return "font-weight";
        } else if (lowerName.includes('line')) {
            return "line-height";
        } else if (lowerName.includes('letter')) {
            return "letter-spacing";
        }
        return "font";
    }

    // Auto-detect animation/transition variables
    if (lowerName.includes('duration') ||
        lowerName.includes('delay') ||
        lowerName.includes('ease') ||
        lowerName.includes('transition') ||
        lowerName.includes('animation')) {
        return "duration";
    }

    // Auto-detect shadow variables
    if (lowerName.includes('shadow') || lowerName.includes('drop')) {
        return "shadow";
    }

    // Auto-detect opacity variables
    if (lowerName.includes('opacity') || lowerName.includes('alpha')) {
        return "opacity";
    }

    // No recognized pattern
    return "";
}

/**
 * Transforms variable names to Tailwind CSS v4+ conventions
 * @param name - Original variable name
 * @param resolvedType - Type of the variable
 * @param prefix - Optional prefix inserted after the category segment
 * @returns Transformed name following Tailwind conventions
 */
export function transformToTailwindName(name: string, resolvedType: string, prefix: string = ""): string {
    const category = detectTailwindCategory(name, resolvedType);
    const prefixSegment = prefix ? `${toCssVar(prefix)}-` : "";
    return `--${category ? `${category}-` : ""}${prefixSegment}${toCssVar(name)}`;
}

/**
 * Processes a variable collection into Tailwind CSS v4+ format
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @param prefix - Optional prefix inserted after the category segment
 * @returns Object containing theme variables and custom variants
 */
async function processCollection(
    collection: VariableCollection,
    selection?: ExportSelection,
    prefix: string = "",
    unit: TailwindUnit = "px"
): Promise<{ theme: string[], variants: string[] }> {
    const { variableIds } = collection;
    const themeVars: string[] = [];
    const customVariants: string[] = [];
    const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);

    for(const mode of selectedModes(collection.id, collection.modes, selection)) {
        let cssVars: string[] = [];

        for (const variableId of variableIds) {
            const figVar = await figma.variables.getVariableByIdAsync(variableId);
            if (figVar !== null) {
                const { name, resolvedType, valuesByMode, description }: Variable = figVar;
                const value: VariableValue = valuesByMode[mode.modeId];

                if (value !== undefined && validTypes.has(resolvedType)) {
                    const tailwindVarName = transformToTailwindName(name, resolvedType, prefix);
                    let cssValue: string;

                    const isColor: boolean = resolvedType === "COLOR";
                    const isNumber: boolean = resolvedType === "FLOAT";
                    const isBool: boolean = resolvedType === "BOOLEAN";

                    if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
                        const linkedVar = await figma.variables.getVariableByIdAsync(value.id);

                        if(linkedVar) {
                            const linkedName = transformToTailwindName(linkedVar.name, linkedVar.resolvedType, prefix);
                            cssValue = `var(${linkedName})`;
                        }
                        else {
                            cssValue = "initial";
                        }
                    }
                    else {
                        cssValue = isColor
                            ? rgbToTailwindColor(value as RGBA)
                            : isNumber
                                ? formatTailwindLength(parseFloat(value as string), unit)
                                : isBool
                                    ? Boolean(value) ? '1' : '0'
                                    : `"${String(value)}"`;
                    }
                    cssVars.push(`  ${tailwindVarName}: ${cssValue};${description ? `\t/* ${description} */` : ''}`);
                }
            }
        }

        const isRoot = (mode.name === 'Default' || mode.name === 'Mode 1');
        if(isRoot) {
            themeVars.push(...cssVars);
        }
        else {
            // Create custom variant for non-default modes
            const variantName = `theme-${toCssVar(mode.name)}`;
            const selector = `&:where([data-theme="${mode.name}"] *)`;
            customVariants.push(`@custom-variant ${variantName} (${selector});`);

            // Add mode-specific variables to theme block
            themeVars.push(...cssVars);
        }
        cssVars = [];
    }

    return { theme: themeVars, variants: customVariants };
}

/**
 * Exports all local variable collections to Tailwind CSS v4+ format
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @param prefix - Optional prefix inserted after the category segment
 * @returns Tailwind CSS string with @theme directive and @custom-variant directives
 */
export const exportToTailwind = async (
    selection?: ExportSelection,
    styleSelection: StyleSelection = ALL_STYLES,
    prefix: string = "",
    unit: TailwindUnit = "px"
): Promise<string> => {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    try {
        const themeVars = new Set<string>();  // Use Set to avoid duplicates
        const customVariants: string[] = [];

        for(const collection of collections) {
            if (!isCollectionSelected(collection.id, selection)) continue;
            const { theme, variants } = await processCollection(collection, selection, prefix, unit);
            theme.forEach(v => themeVars.add(v));
            customVariants.push(...variants);
        }

        // Merge the selected local style kinds into the same @theme block
        if (anyStyleSelected(styleSelection)) {
            const styles = filterStyles(await getLocalStyles(), styleSelection);
            stylesToTailwindTokens(styles).forEach(token => themeVars.add(token));
        }

        // Create @theme block with all variables and styles
        const themeBlock = `@theme {\n${Array.from(themeVars).join('\n')}\n}`;

        // Combine theme and custom variants
        const result = [themeBlock, ...customVariants].join('\n\n');

        return result;
    } catch (err) {
        console.error(err);
        return `/* Something went wrong while converting to Tailwind CSS:
            ${err}*/`;
    }
};
