import Link from "next/link";
import { logout } from "./actions";

// Auth is enforced per-page via requireAdmin() (the login page shares this
// layout, so the layout itself stays public).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/admin" className="text-sm font-semibold tracking-tight">
            Fineprint <span className="text-zinc-500">/ admin</span>
          </Link>
          <form action={logout}>
            <button className="text-xs text-zinc-400 hover:text-zinc-100">Sign out</button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
