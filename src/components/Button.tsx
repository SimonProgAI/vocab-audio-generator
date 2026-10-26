import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "repeat";
type Size = "sm" | "md";

// Hover and pressed shades apply only to buttons that can be clicked.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-blue-600 text-white shadow-sm enabled:hover:bg-blue-700 enabled:active:bg-blue-800 focus-visible:outline-blue-600",
  secondary:
    "border border-slate-300 bg-white text-slate-700 shadow-sm enabled:hover:border-slate-400 enabled:hover:bg-slate-200 enabled:active:bg-slate-300 focus-visible:outline-blue-600",
  danger: "border border-red-200 bg-white text-red-700 enabled:hover:bg-red-50 enabled:active:bg-red-100 focus-visible:outline-red-600",
  ghost: "text-slate-600 enabled:hover:bg-slate-100 enabled:hover:text-slate-900 enabled:active:bg-slate-200 focus-visible:outline-blue-600",
  /** An action already done once and fine to repeat, like saving a file again. */
  repeat:
    "border border-amber-300 bg-amber-50 text-amber-800 shadow-sm enabled:hover:border-amber-400 enabled:hover:bg-amber-100 enabled:active:bg-amber-200 focus-visible:outline-amber-600",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
};

/** A quick press-down on click, left out for people who ask their system for less motion. */
const PRESS_CLASSES = "transition duration-100 motion-safe:enabled:active:scale-95";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium ${PRESS_CLASSES} focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
