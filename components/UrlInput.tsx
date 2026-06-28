"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface UrlInputProps {
  onSubmit: (url: string) => void;
  disabled?: boolean;
  submitLabel?: string;
  placeholder?: string;
}

export function UrlInput({
  onSubmit,
  disabled,
  submitLabel = "Generate",
  placeholder = "https://example.com",
}: UrlInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = normalizeUrl(value);
    if (url) onSubmit(url);
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="url">Website URL</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={disabled}
            />
            <Button
              type="submit"
              disabled={disabled || value.trim().length === 0}
            >
              {submitLabel}
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </form>
  );
}

/** Be forgiving: accept bare domains and add https:// when missing. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).toString();
  } catch {
    return null;
  }
}
