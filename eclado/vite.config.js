import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const rootPath = fileURLToPath(new URL('.', import.meta.url));
const productionSupabaseProjectRef = 'ilvdvlkdpntwmaijncaz';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, rootPath, ''), ...process.env };
  const deploymentEnvironment = String(env.VITE_ECLADO_ENV || 'production').trim().toLowerCase();
  if (deploymentEnvironment !== 'production') {
    const supabaseUrl = String(env.VITE_SUPABASE_URL || '').trim();
    const supabaseAnonKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
    const paymentMode = String(env.VITE_PAYMENT_MODE || '').trim().toLowerCase();
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('非正式環境建置缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY。');
    }
    if (supabaseUrl.includes(productionSupabaseProjectRef)) {
      throw new Error('非正式環境建置不得連線正式 Supabase project。');
    }
    if (!['disabled', 'mock'].includes(paymentMode)) {
      throw new Error('非正式環境建置的 VITE_PAYMENT_MODE 必須是 disabled 或 mock。');
    }
  }

  return ({
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
});
