import type { ComponentProps } from "react";

/**
 * Full-page navigation to sign-in. This stays a plain anchor: Base UI Button gives
 * a rendered `<a>` role="button", and links must keep link semantics.
 */
export function SignInLink({
  returnTo,
  ...props
}: Omit<ComponentProps<"a">, "href" | "className"> & { returnTo?: string }) {
  const destination =
    returnTo ?? (typeof window === "undefined" ? undefined : window.location.pathname);
  const href =
    destination &&
    destination !== "/" &&
    destination.startsWith("/") &&
    !destination.startsWith("//")
      ? `/api/auth/login?returnTo=${encodeURIComponent(destination)}`
      : "/api/auth/login";
  return (
    <a
      {...props}
      className="inline-flex min-h-11 items-center underline underline-offset-4"
      href={href}
    />
  );
}
