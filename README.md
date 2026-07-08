# Hava's Project Playground

My personal website — one tab per project. A single self-contained
`index.html` (no build step), hosted on GitHub Pages.

## Editing

Everything lives in `index.html`. Each tab is a `<section class="tab">` block;
the nav pills are at the top in `<nav id="tabs">`. To add a new tab, copy an
existing section, give it a new id (`tab-<name>`), and add a matching nav link
(`href="#<name>" data-tab="<name>"`).

## Publishing changes

```sh
git add -A
git commit -m "Update site"
git push
```

GitHub Pages redeploys automatically within a minute or two.

## Custom domain

The `CNAME` file in this repo tells GitHub Pages which domain to serve.
At the domain registrar, point the domain at GitHub Pages:

- `A` records for the apex domain → 185.199.108.153, 185.199.109.153,
  185.199.110.153, 185.199.111.153
- `CNAME` record for `www` → `vandanahava.github.io`

Then in the repo: Settings → Pages → Custom domain → enter the domain and
enable "Enforce HTTPS".
