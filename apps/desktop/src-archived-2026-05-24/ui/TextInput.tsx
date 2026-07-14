// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { leadingIcon, className, ...rest },
  ref,
) {
  return (
    <div className="alm-input-wrap">
      {leadingIcon ? <span className="alm-input-wrap__icon">{leadingIcon}</span> : null}
      <input
        ref={ref}
        className={clsx("alm-input", className)}
        data-has-leading={leadingIcon ? "true" : undefined}
        {...rest}
      />
    </div>
  );
});
