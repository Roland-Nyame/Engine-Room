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
  if (!serviceKey) return reply(500, { error: "Server account provisioning is not configured." });

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

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role,is_approved,must_change_password")
      .eq("id", userResult.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!callerProfile || !callerProfile.is_approved || callerProfile.must_change_password ||
        !["admin", "super_admin"].includes(callerProfile.role)) {
      return reply(403, { error: "Only an approved administrator can create member accounts." });
    }

    const payload = await req.json();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const fullName = String(payload.full_name ?? "").trim();
    const temporaryPassword = String(payload.temporary_password ?? "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "Enter a valid email address." });
    if (fullName.length < 2 || fullName.length > 100) return reply(400, { error: "Enter the member's full name." });
    if (temporaryPassword.length < 12) return reply(400, { error: "Temporary password must be at least 12 characters." });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError) return reply(400, { error: createError.message });
    if (!created.user) return reply(500, { error: "Account was not created." });

    const { error: updateError } = await adminClient.from("profiles").upsert({
      id: created.user.id,
      full_name: fullName,
      role: "member",
      is_approved: true,
      must_change_password: true,
    }, { onConflict: "id" });
    if (updateError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      throw updateError;
    }

    await adminClient.from("audit_logs").insert({
      action: "CREATE_MEMBER",
      table_name: "profiles",
      record_id: created.user.id,
      actor_id: userResult.user.id,
      details: { email, full_name: fullName },
    });

    return reply(201, {
      user_id: created.user.id,
      email,
      full_name: fullName,
      message: "Member account created. Share the temporary password privately; the member must change it at first sign-in.",
    });
  } catch (error) {
    console.error("create-member failed", error);
    return reply(500, { error: "Could not create the member account. Check function logs if this continues." });
  }
});