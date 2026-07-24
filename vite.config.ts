import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base must match the GitHub Pages repo path: https://<user>.github.io/lagoon-dashboard/
export default defineConfig({
  base: '/lagoon-dashboard/',
  plugins: [react(), tailwindcss()],
})
