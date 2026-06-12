import type { Metadata } from "next";
import { loadServicesIndex } from "@/lib/static-data";
import { ServiceExplorer } from "../components/service-explorer";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Browse Services : Fineprinted",
  description: "Search and browse all tracked services, check their grades, and read simplified terms of service.",
};

export default async function BrowsePage() {
  const { services } = await loadServicesIndex();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="sr-only">Browse Services</h1>
        <div className="animate-fade-in-up">
          <ServiceExplorer services={services} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
