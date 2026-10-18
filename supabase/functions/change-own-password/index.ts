import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply(401, { error: "Sign in first." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return reply(500, { error: "Password update is not configured on the server." });

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const token = authHeader.slice("Bearer ".length);
    const { data: userResult, error: userError } = await callerClient.auth.getUser(token);
    if (userError || !userResult.user) return reply(401, { error: "Your session is invalid. Sign in again." });

    const payload = await req.json();
    const newPassword = String(payload.new_password ?? "");
    if (newPassword.length < 12) return reply(400, { error: "Choose a password with at least 12 characters." });

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_approved")
      .eq("id", userResult.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_approved) return reply(403, { error: "Your membership is not approved." });

    const { error: passwordError } = await adminClient.auth.admin.updateUserById(userResult.user.id, { password: newPassword });
    if (passwordError) return reply(400, { error: passwordError.message });

    const { error: profileUpdateError } = await adminClient.from("profiles")
      .update({ must_change_password: false })
      .eq("id", userResult.user.id);
    if (profileUpdateError) throw profileUpdateError;

    await adminClient.from("audit_logs").insert({
      action: "PASSWORD_CHANGED",
      table_name: "profiles",
      record_id: userResult.user.id,
      actor_id: userResult.user.id,
      details: { self_service: true },
    });

    return reply(200, { message: "Password updated. You can now access the app." });
  } catch (error) {
    console.error("change-own-password failed", error);
    return reply(500, { error: "Could not update the password. Try again or contact the administrator." });
  }
});