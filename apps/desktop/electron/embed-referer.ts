import { createServer, type Server } from 'node:http'

import { session } from 'electron'

const EMBED_SESSION_PARTITION = 'persist:hermes-embed'
const EMBED_REFERER = 'https://www.youtube.com/'

const YOUTUBE_REFERER_HOST_RE =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|googlevideo\.com|ytimg\.com|youtubei\.googleapis\.com)$/i

function installEmbedRefererForSession(embedSession) {
  if (!embedSession) {
    return
  }

  embedSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let host = ''

    try {
      host = new URL(details.url).hostname
    } catch {
      host = ''
    }

    if (!YOUTUBE_REFERER_HOST_RE.test(host)) {
      callback({ requestHeaders: details.requestHeaders })

      return
    }

    const headers = { ...details.requestHeaders }

    // YouTube's embed player requires a valid HTTP(S) Referer. In the
    // packaged app the origin is file://, which the browser sends as the
    // Referer (via iframe referrerPolicy) but YouTube rejects. Override
    // any non-HTTP Referer so the embed doesn't get Error 153.
    const ref = headers.Referer || headers.referer || ''

    if (!ref || !/^https?:\/\//.test(ref)) {
      headers.Referer = EMBED_REFERER
    }

    callback({ requestHeaders: headers })
  })
}

/**
 * Serve a local wrapper page for YouTube embeds.
 *
 * The packaged app renders from `file://`, so a YouTube iframe's
 * `document.referrer` is empty and the player refuses to configure (Error 153,
 * "Video player configuration error"). The HTTP Referer header injected via
 * `webRequest` does NOT populate the iframe's `document.referrer` — Chromium
 * computes that from the parent page's URL. The one fix that works is making
 * the parent a real HTTP origin: this server serves `/yt/<videoId>` as a tiny
 * page that embeds the real YouTube iframe, so the player sees
 * `http://localhost:<port>/yt/<id>` as its referrer and plays.
 *
 * `localhost` (not `127.0.0.1`): YouTube rejects bare IP referrers as bot
 * traffic. The server binds dual-stack (IPv4 + IPv6 loopback) so `localhost`
 * resolves regardless of which family Chromium tries first.
 */
export function startYouTubeEmbedProxy(): Promise<{ port: number; server: Server }> {
  const server = createServer((req, res) => {
    const match = /^\/yt\/([A-Za-z0-9_-]{11})/.exec(req.url || '')

    if (!match) {
      res.writeHead(404)
      res.end('not found')

      return
    }

    const videoId = match[1]

    const query = (req.url || '').includes('?') ? (req.url || '').split('?')[1] : ''

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html><html><body style="margin:0">
<iframe width="640" height="360" style="border:0;width:100%;height:100vh"
  referrerpolicy="strict-origin-when-cross-origin"
  src="https://www.youtube-nocookie.com/embed/${videoId}${query ? `?${query}` : ''}"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
  allowfullscreen></iframe>
</body></html>`)
  })

  // Bind dual-stack: `::` accepts IPv6 ::1 AND IPv4-mapped 127.0.0.1 on most
  // platforms, so `http://localhost:<port>` works whichever family Chromium
  // resolves `localhost` to first.
  server.listen(0, '::')

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ port, server })
    })
  })
}

/** Stamp Referer on YouTube requests in the embed webview partition and default session. */
function installEmbedReferer() {
  try {
    installEmbedRefererForSession(session.fromPartition(EMBED_SESSION_PARTITION))
    // Also cover iframes (YouTube embeds use <iframe>, not <webview>): they
    // share the default session, which otherwise sends no Referer to YouTube
    // and triggers Error 153 ("Video player configuration error").
    installEmbedRefererForSession(session.defaultSession)
  } catch {
    // Non-fatal: embeds still render; YouTube may show referer errors.
  }
}

export { installEmbedReferer }
