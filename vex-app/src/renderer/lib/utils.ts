/**
 * shadcn-pattern class composition helper. clsx handles falsy/conditional
 * inputs; tailwind-merge resolves conflicting Tailwind utility classes
 * deterministically (last wins, matching CSS specificity expectations).
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
