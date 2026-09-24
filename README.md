# dugcanlift-site

The Jekyll site behind [www.dugcanlift.com](https://www.dugcanlift.com), built
and served by GitHub Pages.

It hosts the macro calculator, the install guides, the supplement price tracker,
and the blog — plus the deployed copy of LIFT Coach.

## The DUGCANLIFT apps

A free, open-source wellness ecosystem. Everything runs on your own device;
there are no accounts and no servers holding your data.

| | | |
|---|---|---|
| **LIFT** | training and nutrition tracker | [iOS](https://github.com/dougray/dugcanlift-lift-ios) · [Android](https://github.com/dougray/dugcanlift-lift) — AGPL-3.0 |
| **COACH** | trainer dashboard, live at [/coach](https://www.dugcanlift.com/coach/) | [dugcanlift-coach](https://github.com/dougray/dugcanlift-coach) — AGPL-3.0 |

### About the `coach/` directory

`coach/` is a **deployed copy, not the source.** Its source of truth is the
[dugcanlift-coach](https://github.com/dougray/dugcanlift-coach) repository,
which copies it here on release.

Edit it there, not here — a change made in this repo is overwritten by the next
deploy. The URL stays put because shipped LIFT builds have it compiled into
`CoachShare.coachURL`, the PWA scope is `/coach/`, and every coach's roster
lives in `localStorage` keyed to this origin.

## Build

```bash
bundle install
script/jekyll serve    # http://localhost:4000
script/jekyll build
```

`script/jekyll` runs Jekyll under the Ruby in `.ruby-version` whatever shell
you are in. In a terminal, `bundle exec jekyll` works too, because `rbenv init`
in `~/.zshrc` puts the right `bundle` first. A script, a scheduled job or an
agent's shell never reads `.zshrc`, gets Homebrew's `bundle` instead, and fails
with "command not found: jekyll" or a bundler version mismatch — which reads as
a broken site and is really a broken PATH. That cost an evening on
2026-09-23.

Always go through `bundle exec` (or `script/jekyll`). The `github-pages` gem drives the build, so
plugins are limited to what GitHub Pages allows — an unsupported one works
locally and silently no-ops once deployed.

Push to the default branch to deploy. There is no deploy script.

## License

This repository holds three different kinds of thing, and they are not all
covered by the same terms.

**Code — [MIT](LICENSE).** The macro calculator, `scripts/`, the SCSS, the
layouts and includes. Take it, change it, ship it. The calculator in particular
is open so anyone can check that its Mifflin-St Jeor implementation matches what
the apps compute.

**Writing — all rights reserved.** Blog posts in `_posts/`, the install guides,
and the other prose pages. Quote and link freely; ask before republishing whole.

**Brand — all rights reserved.** The DUGCANLIFT name, the logo, and the icons in
`assets/images/`. The MIT grant above covers code only and grants no trademark
rights.

`coach/` is not covered by any of the above — it is AGPL-3.0, under its own
repository's license.
