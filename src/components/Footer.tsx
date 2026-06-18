import React from "react";
import { Text, Link, Flex } from "figma-kit";

/**
 * Footer component with plugin information and links
 */
export const Footer: React.FC = () => {
    return (
        <Flex gap="2" justify="between" align="end">
            <Text style={{ color: 'var(--figma-color-text-secondary)' }}>
                Open source. <Link target="_blank" href="https://github.com/minikas/Variform">Contribute ↗</Link>
                {" · "}
                Fork of <Link target="_blank" href="https://github.com/atropical/varvar">VarVar</Link>
            </Text>
            <Text style={{ color: 'var(--figma-color-text-secondary)' }}>
                Maintained by <Link target="_blank" href="https://github.com/minikas">Kas</Link>
            </Text>
        </Flex>
    );
};
