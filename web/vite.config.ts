import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://kendratang.github.io/airport-bus-tracker/
export default defineConfig({
  base: '/airport-bus-tracker/',
  plugins: [react()],
});
