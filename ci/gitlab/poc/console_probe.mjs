// console_probe.mjs: what a headless browser without a human Google session
// sees when it opens a Model Garden model page, with and without a service
// account bearer token on the request.
//
// RESULT (run on 2026-10-12 in a headless Linux container, Playwright 1.56.1,
// Chromium 141 at /opt/pw-browsers/chromium-1194, identity: service account
// <audit-sa>@my-project.iam.gserviceaccount.com through the proxy):
//   no-bearer : 302 -> console shell -> client redirect -> accounts.google.com
//               /v3/signin/identifier (title "Google Cloud Platform", body
//               "Sign in to continue to Google Cloud Platform"). Verdict:
//               sign-in page.
//   sa-bearer : same 302 and the same 401 on accounts.google.com
//               /RotateCookiesPage; the page stays on the empty console
//               shell with a "SIGN IN" link (title "Google Cloud console",
//               body "... Accessibility Feedback SIGN IN"). Verdict: console
//               shell, no session. No model card, no Enable button.
//   SUMMARY no-bearer: sign-in page; sa-bearer: console shell, no session.
//   Exit code 0 (expected negative result). The Authorization header does
//   not create a console session: the console is a cookie-based user surface.
//   The 2026-10-12 run attached the bearer as a context-wide extra header,
//   so the token also went to the third-party hosts the console page loads
//   (gstatic, googletagmanager, analytics, fonts). The script now adds the
//   header only on requests to console.cloud.google.com. SA access tokens
//   live about an hour; rotate the token if that run is ever repeated with
//   a long-lived credential.
//
// Usage (read-only, no clicks, no form input):
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   node ci/gitlab/poc/console_probe.mjs [--token TOKEN] [--out DIR] \
//     --project PROJECT_ID [--model SLUG]
// The token defaults to $GOOGLE_OAUTH_ACCESS_TOKEN, then "proxy-injected".
// The project defaults to $GOOGLE_CLOUD_PROJECT; with neither, exit code 2.
// The script needs the playwright package (npm i playwright@1.56.1) and a
// full Chromium build (chromium-1194 here, not chromium_headless_shell).
// Exit code: 0 when both runs end on a sign-in page or a non-console page
// (the expected negative result), 1 when a run reaches a signed-in console
// page (unexpected: investigate), 2 on a script error.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
}
const token = opt("--token", process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "proxy-injected");
const outDir = opt("--out", "console-probe-out");
const project = opt("--project", process.env.GOOGLE_CLOUD_PROJECT || "");
if (!project) {
  console.error("console_probe: give --project PROJECT_ID or set GOOGLE_CLOUD_PROJECT");
  process.exit(2);
}
const model = opt("--model", "claude-opus-4-6");
const url = `https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/${model}?project=${project}`;
mkdirSync(outDir, { recursive: true });

function classify(finalUrl, title) {
  if (/accounts\.google\.com/.test(finalUrl)) return "sign-in page";
  if (/console\.cloud\.google\.com/.test(finalUrl) && /Model Garden|Agree|Enable/i.test(title)) return "console page (signed in?)";
  if (/console\.cloud\.google\.com/.test(finalUrl)) return "console shell, no session";
  return "other";
}

const BEARER_HOST = "console.cloud.google.com";

async function run(label, bearer) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  if (bearer) {
    // Scope the token to the console host. A context-wide extraHTTPHeaders
    // entry would send it to every host the page loads.
    await ctx.route("**/*", (route, req) => {
      let host = "";
      try { host = new URL(req.url()).host; } catch (_) { /* leave empty */ }
      route.continue(host === BEARER_HOST ? { headers: { ...req.headers(), Authorization: `Bearer ${bearer}` } } : {});
    });
  }
  const page = await ctx.newPage();
  const hops = [];
  page.on("response", (r) => { if (r.request().isNavigationRequest()) hops.push(`${r.status()} ${r.url().slice(0, 140)}`); });
  let navError = "";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000); // let client-side redirects settle
  } catch (e) {
    navError = String(e && e.message || e).slice(0, 200);
  }
  const finalUrl = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = (await page.evaluate(() => document.body ? document.body.innerText.slice(0, 400) : "").catch(() => "")).replace(/\s+/g, " ");
  const png = join(outDir, `${label}.png`);
  await page.screenshot({ path: png, fullPage: false }).catch(() => {});
  await browser.close();
  const verdict = classify(finalUrl, title);
  const result = { label, requestUrl: url, finalUrl, title, verdict, navError, hops: hops.slice(0, 12), bodyTextStart: bodyText.slice(0, 200), screenshot: png };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

try {
  const a = await run("no-bearer", "");
  const b = await run("sa-bearer", token);
  const report = { date: new Date().toISOString().slice(0, 10), runs: [a, b] };
  writeFileSync(join(outDir, "console-probe.json"), JSON.stringify(report, null, 2));
  const signedIn = [a, b].some((r) => r.verdict.startsWith("console page"));
  console.log(`SUMMARY no-bearer: ${a.verdict}; sa-bearer: ${b.verdict}; same outcome: ${a.verdict === b.verdict}`);
  process.exit(signedIn ? 1 : 0);
} catch (e) {
  console.error("probe error:", e);
  process.exit(2);
}
