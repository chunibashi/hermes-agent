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

    if (!headers.Referer && !headers.referer) {
      headers.Referer = EMBED_REFERER
    }

    callback({ requestHeaders: headers })
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
