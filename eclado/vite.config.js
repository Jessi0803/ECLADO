import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const rootPath = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'eclado-local-routes',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const pathname = (request.url || '/').split('?')[0];
          const acceptsHtml = request.headers.accept?.includes('text/html');

          if (pathname === '/admin') {
            request.url = '/admin.html';
          } else if (
            acceptsHtml &&
            pathname !== '/' &&
            !pathname.startsWith('/api/') &&
            !pathname.includes('.')
          ) {
            request.url = '/index.html';
          }

          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
    },
  },
  root: rootPath,
});
