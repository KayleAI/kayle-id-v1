/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@kayleai/ui/button", () => ({
  Button: ({
    children,
    onClick,
    type = "button",
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
  }) => (
    <button onClick={onClick} type={type}>
      {children}
    </button>
  ),
}));

vi.mock("@kayleai/ui/logo", () => ({
  Logo: () => <div>Kayle ID</div>,
}));

import { SessionExplain } from "./explain";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionExplain", () => {
  test("renders the organization name in the share copy", () => {
    render(<SessionExplain organizationName="Test Organization" />);

    expect(screen.getByText("Test Organization")).not.toBeNull();
    expect(screen.queryByText("Platform Name")).toBeNull();
  });
});
