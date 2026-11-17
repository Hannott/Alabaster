#!/usr/bin/env bash
#
# Alabaster uninstaller. Removes what the installer added, and asks before each
# thing it touches outside its own directory.
#
# Your dashboards, printers, and theme are stored in your browser rather than on
# the printer, so nothing here removes them. Clear the site data for the address
# you opened Alabaster at if you want those gone too.
#
# The uninstall lives in install.sh, which offers it as a plan of its own and
# returns to its Home screen afterwards. This runs that: the copy beside this
# script when a release installed both, so it works offline, or the published
# one when this script was fetched on its own. Every option install.sh takes
# for uninstalling (--path, --config-repo-path, --yes, --dry-run, --plain)
# passes straight through.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "${here}/install.sh" ]; then
    exec bash "${here}/install.sh" --uninstall "$@"
fi
exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hannott/Alabaster/main/scripts/install.sh)" install.sh --uninstall "$@"
