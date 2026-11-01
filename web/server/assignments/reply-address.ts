// Reply addresses for assignment emails, and the parsing of what comes back.
//
// Every assignment email sets Reply-To to `a-<id prefix>-<token>@<reply domain>`. The local part
// is both the route (which assignment) and the credential (a secret only that assignment's emails
// carry), because a From header proves nothing: anyone can put the owner's address on an email.
// The domain is the Resend receiving domain from settings (e.g. an account's *.resend.app
// subdomain), where any local part is accepted and stored for the API to read back.

/** 16 hex chars from the assignment's replyToken; 8 from its id. */
const LOCAL_PART_RE = /^a-([0-9a-f]{8})-([0-9a-f]{16})$/i;

export function buildReplyLocalPart(assignmentId: string, token: string): string {
  return `a-${assignmentId.slice(0, 8)}-${token}`;
}

export function parseReplyLocalPart(localPart: string): { idPrefix: string; token: string } | null {
  const m = LOCAL_PART_RE.exec(localPart.trim());
  return m ? { idPrefix: m[1].toLowerCase(), token: m[2].toLowerCase() } : null;
}

/** The bare address out of a `Name <addr>` header, lowercased; null when there is none. */
export function extractAddress(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null;
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(headerValue);
  const addr = angled ? angled[1] : /^[^<>\s]+@[^<>\s]+$/.exec(headerValue.trim())?.[0];
  return addr ? addr.toLowerCase() : null;
}

// Lines that start the quoted history in common clients (Gmail, Proton, Apple Mail, Outlook).
const QUOTE_STARTERS = [
  /^On .{1,200} wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{10,}\s*$/,
  /^>/,
];

/**
 * The text the owner actually typed: everything above the first quoted-history marker. Gmail wraps
 * its "On ... wrote:" attribution across lines, so an "On ..." line whose next line or two ends in
 * "wrote:" counts as the marker too. Returns the whole text when no marker is found.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (QUOTE_STARTERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    if (
      /^On .{1,200}$/.test(line) &&
      [lines[i + 1], lines[i + 2]].some((l) => l !== undefined && /wrote:\s*$/.test(l.trim()))
    ) {
      cut = i;
      break;
    }
  }
  return lines.slice(0, cut).join('\n').trim();
}
