import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { TLSSocket } from 'node:tls'

const configureAdminProxyOrigin = (server: ViteDevServer | PreviewServer, preview = false) => {
  const settings = preview ? server.config.preview : server.config.server
  const proxy = settings.proxy?.['/api']
  if (!proxy) return
  const target = typeof proxy === 'string' ? proxy : proxy.target
  if (!target) return
  const backendOrigin = new URL(String(target)).origin
  const hostname = (value: string) => value.toLowerCase().replace(/^\[|\]$/g, '')

  server.middlewares.use((req, res, next) => {
    const origin = req.headers.origin
    // Preserve CLI/no-Origin behavior; authentication and CSRF remain upstream.
    if (!req.url?.startsWith('/api') || origin === undefined) return next()
    const scheme = (req.socket as TLSSocket).encrypted ? 'https:' : 'http:'
    const authority = `${scheme}//${req.headers.host ?? ''}`
    let trusted = false
    if (typeof origin === 'string' && URL.canParse(origin) && URL.canParse(authority)) {
      const source = new URL(origin)
      const host = new URL(authority)
      const local = hostname(req.socket.localAddress ?? '').replace(/^::ffff:/, '')
      const hosts = new Set([local])
      if (local === '::1' || local.startsWith('127.')) {
        for (const alias of ['localhost', '127.0.0.1', '::1']) hosts.add(alias)
      }
      if (typeof settings.host === 'string' && !['0.0.0.0', '::', '[::]'].includes(settings.host)) {
        hosts.add(hostname(settings.host))
      }
      const port = source.port ? Number(source.port) : scheme === 'https:' ? 443 : 80
      trusted = source.origin === origin && source.protocol === scheme && port === req.socket.localPort
        && hosts.has(hostname(source.hostname)) && host.origin === source.origin
        && !host.username && !host.password && host.pathname === '/' && !host.search && !host.hash
    }
    if (!trusted) {
      res.writeHead(403, {'Content-Type': 'application/json'})
      res.end(JSON.stringify({success: false, message: 'Forbidden development proxy origin'}))
      return
    }
    req.headers.origin = backendOrigin
    next()
  })
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte(), {
    name: 'admin-proxy-origin',
    apply: 'serve',
    configureServer: (server) => configureAdminProxyOrigin(server),
    configurePreviewServer: (server) => configureAdminProxyOrigin(server, true),
  }],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9300/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,
        ws: true
      }
    }
  }
})
