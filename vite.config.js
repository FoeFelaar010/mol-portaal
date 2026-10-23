import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// base './' = werkt zowel op github.io/mol-portaal/ als op een eigen domein
export default defineConfig({ plugins: [react()], base: './' })
