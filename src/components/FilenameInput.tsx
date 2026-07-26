import React from "react";
import { Flex, Text, Input, Label } from "figma-kit";

interface FilenameInputProps {
    /** File extension shown in the input and used for validation (no dot). */
    extension: string;
    filename: string;
    onFilenameChange: (filename: string) => void;
}

/**
 * Reusable filename input component with format-specific validation
 */
export const FilenameInput: React.FC<FilenameInputProps> = ({ 
    extension, 
    filename, 
    onFilenameChange 
}) => {
    const handleFilenameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let value = e.target.value;
        if (!value) {
            value = `tokens`;
        }
        // Remove format extension if present
        const cleanValue = value.replace(`.${extension}`, '');
        onFilenameChange(cleanValue);
    };

    return (
        <Flex gap="2" direction="column">
            <Label style={{ color: 'var(--figma-color-text-secondary)' }} htmlFor="varvar-filename">
                Filename
            </Label>
            <Input
                id="varvar-filename"
                placeholder={`Ex.: export_variables.${extension}`}
                value={`${filename}.${extension}`}
                required
                selectOnClick
                pattern={`^[a-zA-Z0-9_-]+\\.(${extension})$`}
                title={`Enter a valid filename with .${extension} extension`}
                onChange={handleFilenameChange}
            />
        </Flex>
    );
};
