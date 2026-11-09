import type React from 'react'

/**
 * The original panel embeds a native WebView (Bun-only). This build drives a
 * headless browser through the WebBrowser tool instead, so there is nothing
 * to render inline; screenshots are files the user can open.
 */
export function WebBrowserPanel(): React.ReactNode {
  return null
}
