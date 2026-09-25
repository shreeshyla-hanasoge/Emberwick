# Security Policy

## Supported versions

Emberwick is pre-1.0 and ships from `master`. Fixes land in the next release;
older minor versions are not patched.

| Version | Supported |
| --- | --- |
| 0.10.x | ✅ Latest — fixes land here |
| < 0.10 | ❌ Upgrade to the latest release |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately, either way:

- [Open a private advisory](https://github.com/shreeshyla-hanasoge/Emberwick/security/advisories/new)
  on GitHub (preferred — it gives us a place to work on a fix with you), or
- email **shreeshyla.hanasoge@gmail.com** with `[Emberwick security]` in the
  subject.

Please include:

- the version or commit,
- what an attacker gains,
- a minimal reproduction — the data, options and calls in order,
- the browser or runtime, if it matters.

### What to expect

- **Acknowledgement within 3 days.** If you hear nothing, assume the mail was
  lost and send it again.
- An assessment within 7 days, with whether we consider it in scope and a
  rough timeline.
- A fix released, and an advisory published crediting you unless you'd rather
  stay anonymous.

Please give us 90 days before public disclosure, or until a fix ships,
whichever comes first.

## Scope

Emberwick is a client-side rendering library with no network layer, no storage,
no `eval`, and no runtime dependencies in its core. That rules out most of the
usual categories, and makes the realistic ones specific:

**In scope**

- Injection through chart content — marker text, tooltip text, axis labels,
  watermark, or any other consumer-supplied string reaching the DOM as markup
  rather than as text.
- A `DataFeed` payload that can escape its data role: malformed bars, hostile
  timestamps, or update messages that cause unbounded allocation, a hung frame
  loop, or a crash that takes the host page with it.
- Prototype pollution through the options object or feed messages.
- A supply-chain problem in the published tarball: files in the package that
  aren't in the repository, or a build step that pulls something unexpected.

**Out of scope**

- Denial of service from data you control yourself — loading ten million bars
  is slow, and that is arithmetic, not a vulnerability.
- Vulnerabilities in the demo app under `src/pages/`, `src/components/` or the
  landing site; it is a showcase, not shipped to consumers.
- Issues only reachable by a consumer passing already-untrusted HTML into an
  API documented to take HTML.
- `npm audit` output for `devDependencies`. The core ships zero runtime
  dependencies; dev tooling is not in a consumer's graph.
- Missing hardening headers on any demo deployment.

## A note for consumers

Emberwick renders whatever your feed gives it. If your bars, marker labels or
tooltips come from a source you don't control, validate them at the feed
boundary — the chart is not a sanitizer.
