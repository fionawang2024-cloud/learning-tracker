import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary:
    "bg-teal-500 text-white hover:bg-teal-600 focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 transition-colors duration-200 disabled:bg-gray-200 disabled:text-gray-600 disabled:hover:bg-gray-200",
  secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200 transition-colors duration-200 disabled:bg-gray-100 disabled:text-gray-500",
  ghost: "bg-transparent text-gray-700 hover:bg-gray-100 transition-colors duration-200 disabled:text-gray-400",
  danger: "bg-red-600 text-white hover:bg-red-700 transition-colors duration-200 disabled:bg-gray-200 disabled:text-gray-600 disabled:hover:bg-gray-200",
} as const;

const defaultVariant = "primary" satisfies keyof typeof variants;

export type ButtonVariant = keyof typeof variants;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({
  children,
  variant = defaultVariant,
  className = "",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const resolvedVariant = variants[variant] ?? variants[defaultVariant];
  return (
    <button
      type={type}
      disabled={disabled}
      className={`rounded-2xl px-5 py-2.5 font-medium text-sm transition duration-200 focus:outline-none disabled:cursor-not-allowed ${resolvedVariant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
