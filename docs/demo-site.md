---
title: Demo Website
description: Static demo site deployed on Vercel
---

# Demo Website

The demo website is a static HTML page that describes eXpress402. It is
intended to deploy on Vercel without a build step.

## Structure

- `index.html` is the main page at the repository root.
- `vercel.json` configures the Vercel deployment as a static site.
- `/docs` is served as static content so the site can link to project docs.

## Deploy on Vercel

1. Import the repository into Vercel.
2. Keep the default settings and deploy.

Vercel will use `vercel.json` to serve the static site.

## Local preview

Open `index.html` directly in a browser, or use any static file server:

```bash
npx serve .
```

## Update copy or links

Edit `index.html` to update the content or add new links. Keep the file
ASCII-only unless there is a specific reason to introduce Unicode.
