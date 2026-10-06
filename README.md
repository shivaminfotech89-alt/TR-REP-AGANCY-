<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/24815277-6016-4ae2-8734-e6d2444b37dd

## Where it is deployed

**https://www.transregister.com** - the live app. `transregister.com` 308-redirects to the `www` host, so a check
that does not follow redirects sees only the redirect.

It builds on **Vercel** from a push to `main`; there is no separate deploy step (AUDIT O71). Nothing else in this
repository recorded the URL, which cost three separate reconstructions of "where does this actually run" - hence
this section.

**Useful checks against it, all read-only:**

```bash
# which bundle is live (Vite content-hashes it, so this names the build)
curl -sSL https://www.transregister.com/ | grep -oE 'src="/assets/[^"]+"'

# the cache headers that decide whether a browser picks up a new build
curl -sSIL https://www.transregister.com/ | grep -iE '^HTTP|^cache-control|^age|^etag'

# which commits are in the live bundle - grep it for a string a commit introduced
curl -sSL https://www.transregister.com/assets/<hash>.js | grep -c 'some string from that commit'
```

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
