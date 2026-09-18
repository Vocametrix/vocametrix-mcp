import { lookup as dnsLookup, LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

/**
 * Whether this deployment may fetch URLs that resolve to private, loopback or
 * otherwise reserved addresses.
 *
 * Off by default everywhere, including stdio/local mode: the caller of an MCP
 * tool is an LLM, and an LLM that has read a malicious page can be talked into
 * calling vocametrix_ingest_url against the user's own network. A local
 * deployment that legitimately serves audio from a LAN host opts in, the same
 * way reading the local filesystem is opt-in.
 */
function privateHostsEnabled(): boolean {
  return process.env["VOCAMETRIX_MCP_ALLOW_PRIVATE_HOSTS"] === "1";
}

const MAX_REDIRECTS = 5;

/**
 * Is this literal IP address one we refuse to connect to?
 *
 * Covers loopback, RFC1918, carrier-grade NAT, link-local (which is where cloud
 * metadata services live), multicast, and the reserved/documentation ranges, for
 * both IPv4 and IPv6 — including the IPv4 addresses that can hide inside an IPv6
 * one (::ffff:a.b.c.d mapped, 2002:: 6to4, 64:ff9b:: NAT64).
 */
/**
 * Expand an IPv6 address to its eight 16-bit groups, or null if it is not one.
 *
 * Needed because an address is not judged by how it was written: new URL()
 * rewrites '::ffff:127.0.0.1' as '::ffff:7f00:1', so any check that pattern-matches
 * the dotted form misses the very address it meant to block.
 */
function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const bytes = dotted[1]!.split(".").map(Number);
    if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
    const hi = ((bytes[0]! << 8) | bytes[1]!).toString(16);
    const lo = ((bytes[2]! << 8) | bytes[3]!).toString(16);
    text = text.slice(0, dotted.index) + `${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g || "0", 16));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function ipv4FromGroups(g: number[]): string {
  return [(g[6]! >> 8) & 255, g[6]! & 255, (g[7]! >> 8) & 255, g[7]! & 255].join(".");
}

/**
 * Is this literal IP address one we refuse to connect to?
 *
 * Covers loopback, RFC1918, carrier-grade NAT, link-local (which is where cloud
 * metadata services live), multicast, and the reserved/documentation ranges, for
 * both IPv4 and IPv6 — including the IPv4 addresses that can hide inside an IPv6
 * one (::ffff: mapped, 2002:: 6to4, 64:ff9b:: NAT64).
 */
export function isBlockedAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0) return true;                              // 0.0.0.0/8 "this network"
    if (a === 10) return true;                             // RFC1918
    if (a === 127) return true;                            // loopback
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64/10
    if (a === 169 && b === 254) return true;               // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;      // RFC1918
    if (a === 192 && b === 168) return true;               // RFC1918
    if (a === 192 && b === 0) return true;                 // 192.0.0/24 + 192.0.2/24
    if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
    if (a === 198 && b === 51) return true;                // documentation
    if (a === 203 && b === 0) return true;                 // documentation
    if (a >= 224) return true;                             // multicast + reserved + broadcast
    return false;
  }

  const g = expandIPv6(ip);
  if (!g) return true;                                      // unparseable: refuse rather than guess

  // IPv6 forms that carry an IPv4 address — judge the address they carry.
  const isMapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
  const isNat64 = g[0] === 0x64 && g[1] === 0xff9b;
  if (isMapped || isNat64) return isBlockedAddress(ipv4FromGroups(g));
  if (g[0] === 0x2002) {                                    // 6to4: IPv4 sits in groups 1-2
    const embedded = [(g[1]! >> 8) & 255, g[1]! & 255, (g[2]! >> 8) & 255, g[2]! & 255].join(".");
    if (isBlockedAddress(embedded)) return true;
  }

  if (g.every((n) => n === 0)) return true;                 // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true;  // ::1 loopback
  if ((g[0]! & 0xfe00) === 0xfc00) return true;             // fc00::/7 unique-local
  if ((g[0]! & 0xffc0) === 0xfe80) return true;             // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true;             // ff00::/8 multicast
  return false;
}

class BlockedHostError extends Error {}

function blocked(hostname: string, address: string): BlockedHostError {
  const where = hostname === address ? "it is" : `it resolves to ${address}, which is`;
  return new BlockedHostError(
    `Refused to fetch from '${hostname}': ${where} a private, ` +
    `loopback, link-local or otherwise reserved address. Only publicly routable audio URLs are ` +
    `fetched. Pass a public HTTPS URL, or call vocametrix_upload_audio with the file content ` +
    `base64-encoded instead.`
  );
}

/**
 * dns.lookup, but it fails the connection when the name resolves to an address
 * we refuse. Validating here rather than before the request is what closes the
 * DNS-rebinding window: this is the address the socket actually connects to.
 */
function guardedLookup(hostname: string): LookupFunction {
  return (host, options, callback) => {
    dnsLookup(host, options, (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => {
      if (err || privateHostsEnabled()) { (callback as (...a: unknown[]) => void)(err, address, family); return; }
      if (Array.isArray(address)) {
        const bad = address.find((a) => isBlockedAddress(a.address));
        if (bad) { (callback as (...a: unknown[]) => void)(blocked(hostname, bad.address)); return; }
      } else if (isBlockedAddress(address)) {
        (callback as (...a: unknown[]) => void)(blocked(hostname, address)); return;
      }
      (callback as (...a: unknown[]) => void)(null, address, family);
    });
  };
}

function requestOnce(url: URL): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      reject(new Error(`Refused to fetch '${url.protocol}' URL: only http(s) audio sources are fetched.`));
      return;
    }
    // A literal IP address never reaches the lookup below: Node connects straight
    // to it. That is precisely the shape of the attack, so it is checked here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !privateHostsEnabled() && isBlockedAddress(host)) {
      reject(blocked(host, host));
      return;
    }

    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, {
      lookup: guardedLookup(url.hostname),
      headers: { accept: "*/*" },
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}

function readBody(resp: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    resp.on("data", (c: Buffer) => chunks.push(c));
    resp.on("end", () => resolve(Buffer.concat(chunks)));
    resp.on("error", reject);
  });
}

/**
 * Download audio from an http(s) URL, refusing any hop that lands on a private
 * or reserved address.
 *
 * Redirects are followed by hand, up to MAX_REDIRECTS, because every hop needs
 * the same check — a public hostname is free to redirect to 169.254.169.254,
 * and the automatic redirect-following of fetch() would take it.
 */
export async function fetchAudioUrl(input: string): Promise<Buffer> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const resp = await requestOnce(url);
    const status = resp.statusCode ?? 0;
    if (status >= 300 && status < 400 && resp.headers.location) {
      resp.resume();
      url = new URL(resp.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      resp.resume();
      throw new Error(`Failed to download audio from URL: HTTP ${String(status)}`);
    }
    return readBody(resp);
  }
  throw new Error(`Failed to download audio from URL: more than ${String(MAX_REDIRECTS)} redirects.`);
}
