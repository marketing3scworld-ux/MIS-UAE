import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve Tailwind conflicts
 * (e.g. cn("px-2", condition && "px-4") -> "px-4"). Used by all shadcn/ui
 * components and throughout the app.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
