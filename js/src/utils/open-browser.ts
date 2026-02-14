/** Cross-platform browser opening — shared between dev server and CLI. */

const detectOpenCommand = (): string => {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "start";
    default:
      return "xdg-open";
  }
};

export const tryOpenBrowser = async (target: string): Promise<void> => {
  const proc = Bun.spawn([detectOpenCommand(), target], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.warn("dagshund: could not open browser automatically");
    console.warn(`dagshund: open this URL manually: ${target}`);
  }
};
