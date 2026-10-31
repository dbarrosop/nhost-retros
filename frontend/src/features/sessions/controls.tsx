import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { type AppRole, changeFailed, requireAffected, useRetroApi } from "../../lib/retro-api";
import { plainText } from "../../lib/text";

export function useChange(role: AppRole) {
  const api = useRetroApi(role);
  return useMutation({
    // Never queue an offline management intent for an unexpected later replay.
    networkMode: "always",
    mutationFn: async ({
      query,
      variables,
      field,
    }: {
      query: string;
      variables: Record<string, unknown>;
      field: string;
    }) => {
      if (!navigator.onLine) throw new Error(changeFailed);
      const result = await api.request<Record<string, { affected_rows: number }>>(query, variables);
      requireAffected(result[field]);
    },
    onSettled: () => api.invalidate(),
  });
}

export function TextForm({
  label,
  maximum,
  initial = "",
  submit,
  disabled = false,
  multiline = false,
  onSave,
  onCancel,
  onDirty,
}: {
  label: string;
  maximum: number;
  initial?: string;
  submit: string;
  disabled?: boolean;
  multiline?: boolean;
  onSave: (text: string) => Promise<unknown>;
  onCancel?: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = {
    id,
    value,
    disabled,
    readOnly: pending,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue(event.target.value);
      onDirty?.(Boolean(event.target.value));
    },
    "aria-describedby": `${id}-hint`,
    required: true,
  };
  return (
    <form
      className="text-form"
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || pending) return;
        setError("");
        let text: string;
        try {
          text = plainText(value, maximum);
        } catch (failure) {
          setError((failure as Error).message);
          return;
        }
        setPending(true);
        try {
          await onSave(text);
          setValue("");
        } catch {
          setError(changeFailed);
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea {...input} rows={3} /> : <input {...input} type="text" />}
      <span id={`${id}-hint`} className="field-hint">
        1–{maximum} characters. Plain text only.
      </span>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {disabled && (
        <p className="field-hint">This session is read-only. Your unsaved draft is kept above.</p>
      )}
      <div className="action-row">
        <button className="primary-link" disabled={disabled} aria-disabled={pending} type="submit">
          {pending ? "Saving…" : submit}
        </button>
        {onCancel && (
          <button className="secondary-button" type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function ConfirmAction({
  label,
  title,
  description,
  onConfirm,
  afterConfirm,
  disabled = false,
}: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  afterConfirm?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        className="secondary-button"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <Confirmation
          title={title}
          description={description}
          label={label}
          disabled={disabled}
          onConfirm={onConfirm}
          onClose={(confirmed) => {
            setOpen(false);
            if (confirmed && afterConfirm) afterConfirm();
            else trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}
function Confirmation({
  title,
  description,
  label,
  disabled,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  label: string;
  disabled: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: (confirmed: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const finish = (confirmed = false) => {
    // Outside targets are inert until the native modal leaves the top layer.
    ref.current?.close();
    onClose(confirmed);
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) finish();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="dialog-description" id={`${id}-description`}>
        {description}
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="action-row">
        <button
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={() => finish()}
        >
          Cancel
        </button>
        <button
          className="primary-link"
          type="button"
          disabled={pending || disabled}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              await onConfirm();
              finish(true);
            } catch {
              setError(changeFailed);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Saving…" : label}
        </button>
      </div>
    </dialog>
  );
}
