import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const staticOptions = {
  acceptRanges: true,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
  },
};

app.use(express.static(__dirname, staticOptions));
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scripters server listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;
