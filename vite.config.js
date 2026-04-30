import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/western-office/' : '/',
  server: {
    allowedHosts: ['.lhr.life', '.loca.lt'],
  },
}))
