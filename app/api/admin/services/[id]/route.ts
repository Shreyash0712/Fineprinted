import { timingSafeEqual } from "node:crypto";
import { isAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin service API. Auth: either the admin session cookie (browser) or
 * `Authorization: Bearer <ADMIN_PASSWORD>` for curl/scripts.
 *
 * PATCH /api/admin/services/:id  { "name": "Spotify" }
 */

function bearerOk(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = process.env.ADMIN_PASSWORD;
  if (!token || !expected) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!bearerOk(req) && !(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return Response.json({ error: '"name" is required' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("services")
    .update({ name })
    .eq("id", id)
    .select("id, name, root_domain")
    .maybeSingle();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Service not found" }, { status: 404 });
  }
  return Response.json({ service: data });
}
