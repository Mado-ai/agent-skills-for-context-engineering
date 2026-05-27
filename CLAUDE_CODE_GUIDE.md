# Claude Code Dev Environment Guide

Install commands for the local toolchain used in this repo's example projects:
**Node 20+**, **pnpm**, and the **Supabase CLI**.

> Verified on Ubuntu 24.04 (x86_64). On Claude Code web sessions the container is
> ephemeral — it is re-cloned from git on each session, so these installs do not
> persist. Re-run them (or wire them into a SessionStart hook) when you need them.

## Quick check

```bash
node --version       # expect v20+ (image ships v22)
pnpm --version       # expect v10+
supabase --version   # expect 2.x
```

## Node 20+

The web image already ships Node 22, so no install is normally needed. To install
or upgrade elsewhere, use nvm:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 22        # any 20+ release works
nvm use 22
```

Or NodeSource (Debian/Ubuntu, system-wide):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## pnpm

Preferred — via Corepack (bundled with Node 16.13+):

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Or the standalone install script:

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

## Supabase CLI

Supabase does **not** support `npm install -g supabase`. On Debian/Ubuntu, install
the official `.deb` from GitHub releases (this fetches the latest tag automatically):

```bash
cd /tmp
TAG=$(curl -sI https://github.com/supabase/cli/releases/latest \
  | grep -i '^location:' | sed -E 's#.*/tag/(v[0-9.]+).*#\1#' | tr -d '\r')
VER=${TAG#v}
curl -fL -o supabase.deb \
  "https://github.com/supabase/cli/releases/download/${TAG}/supabase_${VER}_linux_amd64.deb"
sudo dpkg -i supabase.deb
```

Other platforms:

```bash
# macOS / Linux (Homebrew)
brew install supabase/tap/supabase

# Per-project, no global install
npx supabase --help
```

## Notes

- For `arm64` machines, swap `linux_amd64` for `linux_arm64` in the `.deb` URL.
- The Supabase local stack (`supabase start`) also requires Docker.
