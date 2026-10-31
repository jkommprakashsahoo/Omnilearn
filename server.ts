import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

dotenv.config();

async function startServer() {
  try {
    const { app } = await import('./backend/app.js');
    const uploadDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    app.use('/uploads', express.static(uploadDir));

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[OmniLearn Server] Running at http://0.0.0.0:${port}`);
    });

    server.on('error', (err: any) => {
      console.error('[OmniLearn Server] Listen error:', err);
    });
  } catch (err) {
    console.error('[OmniLearn Server] Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
