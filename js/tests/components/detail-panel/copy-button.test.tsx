import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { CopyButton } from "../../../src/components/detail-panel/copy-button.tsx";

type ClipboardStub = {
  readonly writeText: ReturnType<typeof mock>;
};

const originalClipboard = navigator.clipboard;

const installClipboard = (stub: ClipboardStub): void => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: stub,
  });
};

const restoreClipboard = (): void => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
};

let resolveWrite: () => void;
let writeSpy: ReturnType<typeof mock>;

beforeEach(() => {
  writeSpy = mock(
    () =>
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
  );
  installClipboard({ writeText: writeSpy });
});

afterEach(() => {
  restoreClipboard();
});

describe("CopyButton", () => {
  test("click invokes navigator.clipboard.writeText with the result of getText", () => {
    const { getByLabelText } = render(<CopyButton getText={() => "payload"} />);
    fireEvent.click(getByLabelText("Copy to clipboard"));
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0]?.[0]).toBe("payload");
  });

  test("shows the check icon once writeText resolves", async () => {
    const { getByLabelText, container } = render(<CopyButton getText={() => "x"} />);
    fireEvent.click(getByLabelText("Copy to clipboard"));
    resolveWrite();
    await waitFor(() => {
      expect(container.querySelector("svg.text-diff-added")).not.toBeNull();
    });
  });
});
