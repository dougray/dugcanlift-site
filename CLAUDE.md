# dugcanlift-site

Jekyll site for DUGCANLIFT, published to **GitHub Pages** at
<https://www.dugcanlift.com> (`CNAME` = `www.dugcanlift.com`). The canonical
host is **www** — do not emit bare-domain URLs.

## Build & run

```bash
bundle install                 # first run / after Gemfile changes
bundle exec jekyll serve       # local preview, http://localhost:4000
bundle exec jekyll build       # build into _site/
```

Always go through `bundle exec` so the pinned version is used. The `github-pages`
gem drives the build, so **plugins are limited to what GitHub Pages allows** —
an unsupported plugin works locally and silently no-ops once deployed.

## Deploy

Push to the default branch. GitHub Pages builds it. There is no deploy script.

## Layout

- `_config.yml` — `title: DUGCANLIFT`, `url: https://www.dugcanlift.com`,
  `baseurl: ""`, `theme: minima`
- `_layouts/` · `_includes/` · `_data/` · `_posts/` · `assets/`
- `calculator.html`, `app.html`, `about.markdown`, `app-privacy.md`, `404.html`
- `coach/` + `coach-install.html` — the LIFT Coach trainer dashboard
- `_site/` — **build output, never edit by hand**

## Notes

- `baseurl` is empty because this serves from a custom domain at the root.
  Use `{{ site.url }}` / `relative_url` rather than hardcoding paths.
- Keep `CNAME` in place — deleting it drops the custom domain on next build.
