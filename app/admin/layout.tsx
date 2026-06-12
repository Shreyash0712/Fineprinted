"use client";

import Link from "next/link";
import { useState } from "react";
import { logout } from "./actions";
import { ThemeToggle } from "../components/theme-toggle";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-[#1C1C1E] transition-colors dark:bg-[#0B0B0C] dark:text-[#E5E5E7] font-sans selection:bg-accent/30 flex flex-col">
      <header className="sticky top-0 z-50 w-full bg-[#FAF9F5]/50 dark:bg-[#0B0B0C]/50 backdrop-blur-md border-b border-zinc-200/50 dark:border-zinc-900/50 py-4 transition-all">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6">
          <Link href="/admin" className="flex items-center gap-2.5 text-base font-bold tracking-tight sm:text-lg">
            <span className="font-heading">Fine<span className="text-accent">printed</span> <span className="text-zinc-400 dark:text-zinc-550 font-normal text-xs sm:text-sm">/ admin</span></span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden sm:flex items-center gap-4 text-sm font-medium">
            <Link href="/admin/requests" className="text-xs text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition">
              Requests Queue
            </Link>
            <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" />
            <Link href="/" className="text-xs text-zinc-650 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition">
              Back to site
            </Link>
            <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" />
            <form action={logout}>
              <button className="text-xs font-semibold text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition cursor-pointer">
                Sign out
              </button>
            </form>
            <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" />
            <ThemeToggle />
          </div>

          {/* Mobile Right Controls */}
          <div className="flex sm:hidden items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center justify-center p-2 rounded-lg text-zinc-555 hover:bg-zinc-150/40 dark:text-zinc-450 dark:hover:bg-zinc-800/40 transition focus:outline-none cursor-pointer"
              aria-label="Toggle admin menu"
            >
              {isOpen ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {isOpen && (
          <div className="sm:hidden absolute top-full left-0 right-0 bg-[#FAF9F5]/95 dark:bg-[#0B0B0C]/95 backdrop-blur-lg border-b border-zinc-200/50 dark:border-zinc-900/50 px-6 py-6 space-y-4 shadow-xl flex flex-col items-stretch text-center font-medium animate-fade-in-up">
            <Link
              href="/admin/requests"
              onClick={() => setIsOpen(false)}
              className="rounded-xl py-3 text-zinc-650 dark:text-zinc-300 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm"
            >
              Requests Queue
            </Link>
            <Link
              href="/"
              onClick={() => setIsOpen(false)}
              className="rounded-xl py-3 text-zinc-650 dark:text-zinc-300 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm"
            >
              Back to Site
            </Link>
            <form action={logout} onSubmit={() => setIsOpen(false)} className="w-full">
              <button
                type="submit"
                className="w-full rounded-xl py-3 text-zinc-650 dark:text-zinc-350 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm font-semibold text-red-500 cursor-pointer"
              >
                Sign Out
              </button>
            </form>
          </div>
        )}
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</div>
    </div>
  );
}
