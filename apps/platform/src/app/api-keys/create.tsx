import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@kayleai/ui/dialog";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Textarea } from "@kayleai/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useReducer, useState } from "react";
import { useCopyToClipboard } from "@/utils/use-copy";

type FormState = {
  status: "idle" | "loading" | "success" | "error";
  name: string;
  errorMessage: string;
  apiKey: string | null;
};

type FormAction =
  | { type: "SET_NAME"; name: string }
  | { type: "SUBMIT" }
  | { type: "SUCCESS"; apiKey: string }
  | { type: "ERROR"; message: string }
  | { type: "RESET" }
  | { type: "CLEAR_ERROR" };

const initialFormState: FormState = {
  status: "idle",
  name: "",
  errorMessage: "",
  apiKey: null,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_NAME":
      return {
        ...state,
        name: action.name,
        status: state.status === "error" ? "idle" : state.status,
        errorMessage: state.status === "error" ? "" : state.errorMessage,
      };
    case "SUBMIT":
      return { ...state, status: "loading", errorMessage: "" };
    case "SUCCESS":
      return { ...state, status: "success", apiKey: action.apiKey };
    case "ERROR":
      return { ...state, status: "error", errorMessage: action.message };
    case "RESET":
      return initialFormState;
    case "CLEAR_ERROR":
      return { ...state, status: "idle", errorMessage: "" };
    default:
      return state;
  }
}

function ApiKeySuccessView({
  apiKey,
  onClose,
}: {
  apiKey: string;
  onClose: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <>
      <DialogHeader>
        <DialogTitle>API Key Created</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label className="font-medium text-sm" htmlFor="api-key">
          Your API Key
        </Label>
        <div className="relative">
          <Textarea
            className="min-h-[0px]! resize-none pr-20 font-mono text-sm"
            id="api-key"
            readOnly
            value={apiKey}
          />
          <Button
            className="-translate-y-1/2 absolute top-1/2 right-2"
            onClick={() => copy(apiKey)}
            size="sm"
            type="button"
            variant="outline"
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          You won't be able to view this API key again.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>I've saved my API key</Button>
      </DialogFooter>
    </>
  );
}

function ApiKeyFormView({
  state,
  dispatch,
  onSubmit,
}: {
  state: FormState;
  dispatch: React.Dispatch<FormAction>;
  onSubmit: () => void;
}) {
  const isLoading = state.status === "loading";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create API Key</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {state.status === "error" && state.errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{state.errorMessage}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            disabled={isLoading}
            id="name"
            onChange={(e) =>
              dispatch({ type: "SET_NAME", name: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && state.name.trim()) {
                onSubmit();
              }
            }}
            placeholder="API Key Name"
            value={state.name}
          />
        </div>
      </div>
      <DialogFooter>
        <Button disabled={isLoading || !state.name.trim()} onClick={onSubmit}>
          {isLoading ? "Creating..." : "Create API Key"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function CreateApiKey() {
  const [isOpen, setIsOpen] = useState(false);
  const [state, dispatch] = useReducer(formReducer, initialFormState);
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    if (!state.name.trim()) {
      dispatch({
        type: "ERROR",
        message: "Please enter a name for your API key",
      });
      return;
    }

    dispatch({ type: "SUBMIT" });

    try {
      const response = await fetch("/api/auth/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: state.name.trim(),
        }),
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        dispatch({
          type: "ERROR",
          message:
            errorData?.error?.message ??
            "Failed to create API key. Please try again.",
        });
        return;
      }

      const data: { data: { key: string } } = await response.json();
      const key = data.data?.key;

      if (!key) {
        dispatch({
          type: "ERROR",
          message: "API key was not returned. Please try again.",
        });
        return;
      }

      dispatch({ type: "SUCCESS", apiKey: key });
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (err) {
      dispatch({
        type: "ERROR",
        message:
          err instanceof Error
            ? err.message
            : "Failed to create API key. Please try again.",
      });
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    // Reset form after dialog close animation
    setTimeout(() => dispatch({ type: "RESET" }), 150);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setIsOpen(true);
    } else {
      handleClose();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogTrigger
        render={<Button onClick={() => setIsOpen(true)}>Create API Key</Button>}
      />
      <DialogContent className="flex w-full max-w-lg! flex-col">
        {state.status === "success" && state.apiKey ? (
          <ApiKeySuccessView apiKey={state.apiKey} onClose={handleClose} />
        ) : (
          <ApiKeyFormView
            dispatch={dispatch}
            onSubmit={handleSubmit}
            state={state}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
