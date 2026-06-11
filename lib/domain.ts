import { parse } from "tldts";

/**
 * Strict root-domain sanitization for the request flow (spec section 2.3).
 * Whatever the user types — full URLs, subdomains, paths, ports — is reduced
 * to the registrable root domain (eTLD+1), or rejected.
 *
 * "https://www.app.example.co.uk/terms?x=1" -> "example.co.uk"
 */
export function sanitizeToRootDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.length > 2048) return null;

  const result = parse(trimmed, { allowPrivateDomains: false });

  if (
    !result.domain ||           // no registrable domain found
    !result.isIcann ||          // reject private suffixes & made-up TLDs
    result.isIp                 // reject raw IP addresses
  ) {
    return null;
  }

  return result.domain;
}
