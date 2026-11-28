import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { cookieOptions, startReaderSession, VERIFIER_COOKIE } from "../../_lib/session";
import { exchangeCode } from "../../_lib/supabase";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const jar = await cookies();
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  if (code && verifier) {
    jar.set(VERIFIER_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    const result = await exchangeCode(code, verifier);
    if (result.ok) {
      await startReaderSession(result.session);
      redirect("/swarm");
    }
  }
  redirect("/swarm/sign-in?error=That%20link%20has%20expired%20or%20was%20already%20used.");
}
