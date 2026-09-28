source "https://rubygems.org"

# Jekyll itself, not the `github-pages` meta-gem.
#
# `github-pages` pins the whole tree to the versions GitHub's own Pages
# builder runs, which was the point of it while that builder published this
# site. It no longer does: the workflow in .github/workflows/pages.yml builds
# the site and this Gemfile *is* the environment that ships, so pinning to
# somebody else's is now a constraint with nothing on the other end of it.
#
# It was also carrying a vulnerability we could not act on. `github-pages`
# pins `jekyll-remote-theme = 0.4.3`, which requires `rubyzip < 3.0`, and the
# fix for GHSA-47m2-wp7j-p9vc is rubyzip 3.4.0 -- bundler cannot resolve that,
# so there was no version of this file that both kept `github-pages` and took
# the patch. Nothing here ever used `remote_theme`, so the gem came out and
# rubyzip with it.
gem "jekyll", "~> 4.4"

# The theme, unchanged.
gem "minima", "~> 2.5"

group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.12"
  # Both of these are on by default under GitHub's builder and cannot be
  # switched off there, so they were shaping this site's output without
  # appearing in _config.yml. Listed explicitly now that the build is ours:
  # dropping them silently changes pages, which is the failure this move is
  # most exposed to.
  gem "jekyll-optional-front-matter", "~> 0.3"
  gem "jekyll-relative-links", "~> 0.6"
  gem "jekyll-default-layout", "~> 0.1"
  gem "jekyll-titles-from-headings", "~> 0.5"
  gem "jekyll-readme-index", "~> 0.3"
end

# Windows and JRuby do not include zoneinfo files, so bundle the tzinfo-data
# gem and associated library.
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

# Performance-booster for watching directories on Windows
gem "wdm", "~> 0.1", :platforms => [:mingw, :x64_mingw, :mswin]

# Lock `http_parser.rb` to v0.6.x on JRuby: newer versions have no Java
# counterpart.
gem "http_parser.rb", "~> 0.6.0", :platforms => [:jruby]
