import React, { useState } from "react";
import { Button } from "figma-kit";
import { useGitHub } from "../../hooks/useGitHub";
import { GitHubDialog } from "./GitHubDialog";

interface GitHubButtonProps {
  /** The exported file contents to commit. */
  data: string;
  /** Filename (without extension) used to seed the path and branch. */
  filename: string;
  /** File extension, e.g. "json" / "css". */
  fileFormat: string;
}

/**
 * Secondary action next to the download button: opens the GitHub dialog so the
 * user can commit the exported file and open a pull request. Disabled until an
 * export has been produced.
 */
export const GitHubButton: React.FC<GitHubButtonProps> = ({
  data,
  filename,
  fileFormat,
}) => {
  const [open, setOpen] = useState(false);
  const github = useGitHub();

  return (
    <>
      <Button
        variant="primary"
        fullWidth={true}
        size="medium"
        disabled={!data}
        onClick={() => setOpen(true)}
      >
        {github.isConnected ? "Push to GitHub" : "Connect GitHub…"}
      </Button>
      <GitHubDialog
        open={open}
        onOpenChange={setOpen}
        github={github}
        data={data}
        filename={filename}
        fileFormat={fileFormat}
      />
    </>
  );
};
