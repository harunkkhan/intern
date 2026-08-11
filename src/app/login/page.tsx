import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInWithGoogle } from "@/app/actions";
import Logo from "@/components/Logo";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Sign-in did not return a code. Please try again.",
  auth: "Could not complete sign-in (code exchange failed).",
  not_allowed:
    "That account does not have access to this tracker. Ask the owner to add your email.",
  server: "The sign-in callback hit a server error.",
  oauth: "Could not start the Google sign-in flow.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { error, detail } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? "Sign-in failed.")
    : null;

  return (
    <main className="grid min-h-screen grid-cols-1 bg-white lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm text-center">
          <Logo className="text-7xl text-neutral-900" />
          <p className="mt-6 text-base text-neutral-600">
            Sign in to Internship Tracker
          </p>

          {errorMessage && (
            <div className="mt-6 border border-neutral-300 bg-neutral-50 px-3 py-2 text-left text-sm text-neutral-800">
              <p className="font-medium">{errorMessage}</p>
              {detail && (
                <p className="mt-1 break-words font-mono text-xs text-neutral-500">
                  {detail}
                </p>
              )}
            </div>
          )}

          <form action={signInWithGoogle} className="mt-8">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2.5 rounded-none bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-700"
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </form>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-neutral-950 lg:block">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 78% 18%, rgba(255,255,255,0.16), transparent 55%)",
          }}
        />
        <div className="absolute -bottom-44 -left-44 h-[30rem] w-[30rem] rounded-full border border-white/10" />
        <div className="absolute -bottom-28 -left-28 h-96 w-96 rounded-full border border-white/[0.08]" />
        <div className="absolute -bottom-14 -left-14 h-64 w-64 rounded-full border border-white/[0.06]" />

        <div className="relative flex h-full flex-col justify-end p-12">
          <div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white">
              Every application, captured straight from your inbox.
            </h2>
            <p className="mt-3 max-w-sm text-sm text-white/50">
              Applied, assessment, interview, offer — tracked automatically as
              the emails land.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" />
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" />
      <path d="M9 3.582c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.582 9 3.582Z" />
    </svg>
  );
}
