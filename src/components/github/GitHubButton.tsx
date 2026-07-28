import React, { useState } from "react";
import { Button } from "figma-kit";
import { useGitHub } from "../../hooks/useGitHub";
import { GitHubDialog } from "./GitHubDialog";

interface GitHubButtonProps {
  /** Disabled until an export has been produced. */
  disabled?: boolean;
}

/**
 * Secondary action next to the download button: opens the GitHub dialog so the
 * user can push the configured export formats and open pull requests. The
 * dialog owns the export requests — this button only gates on "something to
 * export".
 */
export const GitHubButton: React.FC<GitHubButtonProps> = ({ disabled }) => {
  const [open, setOpen] = useState(false);
  const github = useGitHub();

  return (
    <>
      <Button
        variant="primary"
        fullWidth={true}
        size="medium"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {github.isConnected ? "Push to GitHub" : "Connect GitHub…"}
      </Button>
      <GitHubDialog open={open} onOpenChange={setOpen} github={github} />
    </>
  );
};
