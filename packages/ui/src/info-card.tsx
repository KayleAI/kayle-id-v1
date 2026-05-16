import { Button } from "@kayleai/ui/button";
import { Logo } from "@kayleai/ui/logo";
import { cn } from "@kayleai/ui/utils/cn";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import OctagonCheck from "./icons/octagon-check.tsx";
import OctagonInfo from "./icons/octagon-info.tsx";
import OctagonAlert from "./icons/octagon-warning.tsx";

const TERMS_URL = "/terms";
const PRIVACY_URL = "/privacy";

type ButtonAction = {
  label: string;
} & (
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
) &
  ({ disabled?: never } | { disabled: boolean });

interface InfoCardProps {
  buttons?: {
    primary?: ButtonAction;
    secondary?: ButtonAction;
  };
  children?: ReactNode;
  colour: "red" | "blue" | "emerald";
  footer?: boolean;
  header: {
    title: string;
    description: string;
  };
  message: {
    title: string;
    description: string;
    list?: string[];
  };
}

const ICONS = {
  red: <OctagonAlert className="size-5 text-red-400" />,
  blue: <OctagonInfo className="size-5 text-blue-800 dark:text-blue-300" />,
  emerald: (
    <OctagonCheck className="size-5 text-emerald-800 dark:text-emerald-300" />
  ),
};

const COLOUR_CLASSES = {
  red: {
    container:
      "bg-red-50 border border-red-200 dark:bg-red-950/40 dark:border-red-900",
    title: "text-red-800 dark:text-red-200",
    description: "text-red-700 dark:text-red-300",
  },
  blue: {
    container:
      "bg-blue-50 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-900",
    title: "text-blue-800 dark:text-blue-200",
    description: "text-blue-700 dark:text-blue-300",
  },
  emerald: {
    container:
      "bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900",
    title: "text-emerald-800 dark:text-emerald-200",
    description: "text-emerald-700 dark:text-emerald-300",
  },
};

interface ButtonProps {
  button?: ButtonAction;
}

export function InfoCard({
  colour = "red",
  header = {
    title: "Session Error",
    description: "An error occurred while loading the session.",
  },
  message = {
    title: "Something went wrong",
    description: "Something went wrong while loading the session.",
    list: [],
  },
  buttons = {
    primary: {
      label: "Try again",
      onClick: () => window.location.reload(),
    },
    secondary: {
      label: "Go back to the previous page",
      onClick: () => window.history.back(),
    },
  },
  footer = true,
  children,
}: InfoCardProps) {
  const hasButtons = Boolean(buttons?.primary || buttons?.secondary);

  return (
    <div className="relative flex w-full flex-col items-center justify-center">
      <div className={cn("w-full max-w-md space-y-8")}>
        {/* Header */}
        <div>
          <div className="mb-8">
            <Logo className="" title="Kayle ID" />
          </div>
          <h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
            {header.title}
          </h1>
          <p className="text-lg text-muted-foreground">{header.description}</p>
        </div>

        {/* Message */}
        <div className={cn("rounded-lg p-4", COLOUR_CLASSES[colour].container)}>
          <div className="flex items-start">
            <div className="mt-0.5 shrink-0">{ICONS[colour]}</div>
            <div className="ml-3">
              <h3
                className={cn(
                  "font-medium text-sm",
                  COLOUR_CLASSES[colour].title
                )}
              >
                {message.title}
              </h3>
              <div
                className={cn("text-sm", COLOUR_CLASSES[colour].description)}
              >
                <p>{message.description}</p>
                {message.list && (
                  <ul className="mt-1 list-outside list-none space-y-1">
                    {message.list.map((item) => (
                      <li key={item}>&ndash; {item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        {children ? (
          <div className="flex flex-1 flex-col justify-center">{children}</div>
        ) : null}

        {/* Action Buttons */}
        {hasButtons ? (
          <div className="flex flex-col space-y-4">
            <PrimaryButton button={buttons?.primary} />
            <SecondaryButton button={buttons?.secondary} />
          </div>
        ) : null}

        {/* Footer Links */}
        {footer ? (
          <p className="inline-block text-center text-muted-foreground text-xs">
            By using Kayle ID, you agree to our{" "}
            <Button
              className="inline-block h-fit! p-0 text-foreground text-xs!"
              nativeButton={false}
              render={
                <a href={TERMS_URL} rel="noopener noreferrer" target="_blank">
                  Terms of Service
                </a>
              }
              variant="link"
            >
              Terms of Service
            </Button>{" "}
            and{" "}
            <Button
              className="inline-block h-fit! p-0 text-foreground text-xs!"
              nativeButton={false}
              render={
                <a href={PRIVACY_URL} rel="noopener noreferrer" target="_blank">
                  Privacy Policy
                </a>
              }
              variant="link"
            >
              Privacy Policy
            </Button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PrimaryButton({ button }: ButtonProps) {
  if (!button) {
    return null;
  }

  if (button.onClick) {
    return (
      <Button disabled={button.disabled} onClick={button.onClick} type="button">
        {button.label}
      </Button>
    );
  }

  return (
    <Button
      nativeButton={false}
      render={<Link to={button.href}>{button.label}</Link>}
      variant="default"
    />
  );
}

function SecondaryButton({ button }: ButtonProps) {
  if (!button) {
    return null;
  }

  if (button.onClick) {
    return (
      <Button
        disabled={button.disabled}
        onClick={button.onClick}
        type="button"
        variant="outline"
      >
        {button.label}
      </Button>
    );
  }

  return (
    <Button
      nativeButton={false}
      render={<Link to={button.href}>{button.label}</Link>}
      variant="outline"
    />
  );
}
