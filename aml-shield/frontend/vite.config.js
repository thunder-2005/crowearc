import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Adds extra lines to Vite's startup banner so the manager and employee
// landing URLs are right there as clickable links in the terminal.
function printRoleUrls() {
  return {
    name: 'aml-shield-role-urls',
    configureServer(server) {
      const originalPrint = server.printUrls.bind(server);
      server.printUrls = () => {
        originalPrint();
        const port = server.config.server.port || 3000;
        const host = `http://localhost:${port}`;
        const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
        const bold = (s) => `\x1b[1m${s}\x1b[0m`;
        const arrow = '\x1b[32m  ➜\x1b[39m ';
        console.log('');
        console.log(`${arrow} ${bold('Manager view')}:  ${cyan(host + '/manager/dashboard')}`);
        console.log(`${arrow} ${bold('Employee view')}: ${cyan(host + '/employee/dashboard')}`);
        console.log('');
      };
    }
  };
}

export default defineConfig({
  plugins: [react(), printRoleUrls()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
});
