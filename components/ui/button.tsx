import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold outline-none transition-[transform,background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-md bg-primary px-5 text-primary-foreground shadow-[0_4px_0_var(--button-shadow)] hover:-translate-y-0.5 active:translate-y-[3px] active:shadow-[0_1px_0_var(--button-shadow)]",
        quest:
          "rounded-md border border-primary-foreground/20 bg-quest px-6 text-quest-foreground shadow-[0_5px_0_var(--quest-shadow)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_1px_0_var(--quest-shadow)]",
        parchment:
          "rounded-md border border-border bg-parchment px-5 text-parchment-foreground shadow-[0_3px_0_var(--parchment-shadow)] hover:bg-parchment-emphasis active:translate-y-0.5 active:shadow-[0_1px_0_var(--parchment-shadow)]",
        ghost:
          "rounded-sm text-foreground underline decoration-border underline-offset-8 hover:decoration-foreground",
      },
      size: {
        default: "h-11",
        sm: "h-9 px-3 text-xs",
        lg: "h-14 px-7 text-base",
        icon: "size-10 rounded-full p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
