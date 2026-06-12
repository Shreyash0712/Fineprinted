"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-[#FAF9F5]/50 dark:bg-[#0B0B0C]/50 backdrop-blur-md transition-all py-4 border-b border-zinc-200/10 dark:border-zinc-900/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 text-base font-bold tracking-tight sm:text-lg">
          <LogoIcon className="h-7 w-7" />
          <span className="font-heading">Fine<span className="text-accent">printed</span></span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
          <NavLink href="/">Browse</NavLink>
          <NavLink href="/request">Request</NavLink>
          <NavLink href="/about">About</NavLink>
          <NavLink href="/saved">Saved</NavLink>
          <span className="ml-2 border-l border-zinc-200/60 pl-2 dark:border-zinc-800/60">
            <ThemeToggle />
          </span>
        </nav>

        {/* Mobile menu toggle */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex sm:hidden items-center justify-center p-2 rounded-lg text-zinc-550 hover:bg-zinc-150/40 dark:text-zinc-450 dark:hover:bg-zinc-800/40 transition focus:outline-none cursor-pointer"
          aria-label="Toggle menu"
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

      {/* Mobile Drawer */}
      {isOpen && (
        <div className="sm:hidden absolute top-full left-0 right-0 bg-[#FAF9F5]/95 dark:bg-[#0B0B0C]/95 backdrop-blur-lg border-b border-zinc-200/50 dark:border-zinc-900/50 px-6 py-6 space-y-4 shadow-xl flex flex-col items-stretch text-center font-medium animate-fade-in-up">
          <Link
            href="/"
            onClick={() => setIsOpen(false)}
            className="rounded-xl py-3 text-zinc-650 dark:text-zinc-300 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm"
          >
            Browse
          </Link>
          <Link
            href="/request"
            onClick={() => setIsOpen(false)}
            className="rounded-xl py-3 text-zinc-650 dark:text-zinc-300 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm"
          >
            Request
          </Link>
          <Link
            href="/about"
            onClick={() => setIsOpen(false)}
            className="rounded-xl py-3 text-zinc-650 dark:text-zinc-300 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm"
          >
            About
          </Link>
          <Link
            href="/saved"
            onClick={() => setIsOpen(false)}
            className="rounded-xl py-3 text-zinc-650 dark:text-zinc-300 hover:bg-accent-light dark:hover:bg-[#1E1A14] transition text-sm"
          >
            Saved
          </Link>
          <div className="flex justify-center border-t border-zinc-200/50 dark:border-zinc-900/50 pt-4">
            <ThemeToggle />
          </div>
        </div>
      )}
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100 transition"
    >
      {children}
    </Link>
  );
}

export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M11 24V11c0-2.76 2.24-5 5-5h4c2.76 0 5 2.24 5 5s-2.24 5-5 5h-9M11 20h7"
        stroke="url(#logo-grad-inline)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient
          id="logo-grad-inline"
          x1="11"
          y1="6"
          x2="25"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E5C59E" />
          <stop offset="0.5" stopColor="#C5A880" />
          <stop offset="1" stopColor="#9A7B52" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BookmarkIcon({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

