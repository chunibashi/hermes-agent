'use client'

import { useEffect, useMemo, useState } from 'react'

import type { FrameEmbed } from './providers/types'
import { useIsDark } from './use-is-dark'

const YOUTUBE_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen'

// Packaged-app local wrapper: the renderer loads from file://, so a direct
// YouTube iframe gets an empty `document.referrer` and the player refuses to
// configure (Error 153). The backend starts a localhost proxy that serves
// /yt/<videoId> as a tiny page re-embedding the real YouTube iframe — that
// inner iframe sees `http://localhost:<port>` as its referrer and plays.
// YouTube also rejects bare-IP referrers (127.0.0.1), which is why the proxy
// is addressed as `localhost`.
let cachedProxyPort: number | null | undefined

async function embedProxyPort(): Promise<number | null> {
  if (cachedProxyPort !== undefined) {
    return cachedProxyPort
  }

  try {
    cachedProxyPort = (await window.hermesDesktop?.getEmbedProxyPort?.()) ?? null
  } catch {
    cachedProxyPort = null
  }

  return cachedProxyPort
}

function youtubeSrc(embedUrl: string, proxyPort: number | null | undefined): string {
  const url = new URL(embedUrl)

  // Route through the local wrapper when the packaged app provides one. The
  // wrapper re-embeds the same nocookie URL, so the query (modestbranding,
  // rel, start...) is forwarded verbatim.
  if (proxyPort != null) {
    const videoId = url.pathname.replace(/^\/embed\//, '')

    return `http://localhost:${proxyPort}/yt/${videoId}${url.search}`
  }

  // Dev / no-proxy fallback: direct embed. Only pass origin when it is an
  // HTTP(S) origin; custom schemes (app://, file://) can make the player
  // reject otherwise embeddable videos.
  if (
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    window.location.origin &&
    window.location.origin !== 'null'
  ) {
    url.searchParams.set('origin', window.location.origin)
  }

  return url.toString()
}

// Keep this as a plain iframe and let YouTube render its native player/error UI.
export default function YouTubeEmbedRenderer({ descriptor }: { descriptor: FrameEmbed }) {
  const isDark = useIsDark()
  const [proxyPort, setProxyPort] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    embedProxyPort().then(port => {
      if (!cancelled) {
        setProxyPort(port)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const src = useMemo(() => youtubeSrc(descriptor.embedUrl, proxyPort), [descriptor.embedUrl, proxyPort])

  // Wait for the proxy-port probe before rendering — otherwise the iframe
  // briefly loads the direct URL (Error 153 on file://) before the proxy URL.
  if (proxyPort === undefined) {
    return null
  }

  // Width is capped to the ratio by UrlEmbed, so aspect-video sizes height ≤ cap.
  return (
    <iframe
      allow={YOUTUBE_ALLOW}
      allowFullScreen
      className="block aspect-video w-full border-0 bg-transparent"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      scrolling="no"
      src={src}
      style={{ colorScheme: isDark ? 'dark' : 'light' }}
      title="YouTube embed"
    />
  )
}
