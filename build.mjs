import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const copyTargets = ['index.html', 'brochure.html', '_redirects', 'functions'];

for (const target of copyTargets) {
  await cp(path.join(rootDir, target), path.join(distDir, target), {
    recursive: true,
  });
}

await mkdir(path.join(distDir, 'server'), { recursive: true });
await mkdir(path.join(distDir, '.openai'), { recursive: true });
await mkdir(path.join(distDir, 'server', 'functions'), { recursive: true });

await cp(
  path.join(rootDir, 'functions', 'submit.js'),
  path.join(distDir, 'server', 'functions', 'submit.js')
);
await cp(
  path.join(rootDir, 'functions', 'book.js'),
  path.join(distDir, 'server', 'functions', 'book.js')
);

const indexHtml = await readFile(path.join(rootDir, 'index.html'), 'utf8');
const brochureHtml = await readFile(path.join(rootDir, 'brochure.html'), 'utf8');

const workerSource = `import { onRequest as handleSubmit } from './functions/submit.js';
import { onRequest as handleBook } from './functions/book.js';

const indexHtml = ${JSON.stringify(indexHtml)};
const brochureHtml = ${JSON.stringify(brochureHtml)};

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const context = { request, env, ctx };

    if (pathname === '/submit') {
      return handleSubmit(context);
    }

    if (pathname === '/book') {
      return handleBook(context);
    }

    if (pathname === '/' || pathname === '/index.html') {
      return htmlResponse(indexHtml);
    }

    if (pathname === '/brochure' || pathname === '/brochure.html') {
      return htmlResponse(brochureHtml);
    }

    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
`;

await writeFile(path.join(distDir, 'server', 'index.js'), workerSource);
await writeFile(
  path.join(distDir, '.openai', 'hosting.json'),
  JSON.stringify({ d1: null, r2: null }, null, 2)
);

console.log('Static site copied to dist/');
