import type { ComponentProps } from "react";

/**
 * Full-page navigation to sign-in. This stays a plain anchor: Base UI Button gives
 * a rendered `<a>` role="button", and links must keep link semantics.
 */
export function SignInLink(props: Omit<ComponentProps<"a">, "href" | "className">) {
  return (
    <a
      {...props}
      className="inline-flex min-h-11 items-center underline underline-offset-4"
      href="/api/auth/login"
    />
  );
}
