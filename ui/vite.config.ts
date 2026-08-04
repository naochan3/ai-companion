import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ローカル専用コンパニオンUI。brain(8100)とIrodori(8088)へは同一マシンで直接fetchする。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0', // Tailscale経由でスマホからも開ける
    port: 3100,
    proxy: {
      // CORS回避: ブラウザからは同一オリジンで叩き、Viteが転送する
      '/brain': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/brain/, ''),
      },
      '/tts': {
        target: 'http://127.0.0.1:8088',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tts/, ''),
      },
    },
  },
})
