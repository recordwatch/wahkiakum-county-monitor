import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' so the site works under GitHub Pages' /<repo>/ path.
export default defineConfig({
  base: './',
  plugins: [react()],
})
