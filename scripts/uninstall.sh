#!/usr/bin/env bash
#
# Alabaster uninstaller. Removes what the installer added, and asks before each
# thing it touches outside its own directory.
#
# Your dashboards, printers, and theme are stored in your browser rather than on
# the printer, so nothing here removes them. Clear the site data for the address
# you opened Alabaster at if you want those gone too.

set -euo pipefail

DEFAULT_PATH="${HOME}/alabaster"
DEFAULT_CONFIG_REPO_PATH="${HOME}/alabaster-config"

install_path="${DEFAULT_PATH}"
config_repo_path="${DEFAULT_CONFIG_REPO_PATH}"
assume_yes=0
dry_run=0

config_dir=''
printer_cfg=''
moonraker_conf=''
did_actions=()
skipped_actions=()

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
else
    C_BOLD=''; C_DIM=''; C_WARN=''; C_ERR=''; C_OFF=''
fi

say() { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s%s\n' "$C_DIM" "$C_OFF" "$C_BOLD" "$*" "$C_OFF"; }
warn() { printf '%s!%s  %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die() { printf '%serror:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

did() { did_actions+=("$1"); }
skipped() { skipped_actions+=("$1"); }

# As in install.sh, `--yes` takes each prompt's default rather than answering
# yes to all, so the prompts guarding something you wrote stay on the safe side.
ask() {
    local prompt="$1" default="${2:-y}" hint reply
    if [ "$assume_yes" -eq 1 ]; then
        [ "$default" = 'y' ] && return 0 || return 1
    fi
    if [ ! -r /dev/tty ]; then
        warn "Not running interactively and --yes was not given; skipping: ${prompt}"
        return 1
    fi
    [ "$default" = 'y' ] && hint='Y/n' || hint='y/N'
    printf '%s [%s] ' "$prompt" "$hint" > /dev/tty
    read -r reply < /dev/tty || reply=''
    reply="${reply:-$default}"
    case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

run() {
    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s %s\n' "$C_DIM" "$C_OFF" "$*"
        return 0
    fi
    "$@"
}

usage() {
    cat <<'USAGE'
Alabaster uninstaller

  --path DIR              Where Alabaster was installed (default: ~/alabaster)
  --config-repo-path DIR  Where the macro pack was cloned (default: ~/alabaster-config)
  --yes                   Answer yes to every prompt
  --dry-run               Print what would happen and change nothing
  -h, --help              This message
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --path) install_path="${2:?--path needs a directory}"; shift 2 ;;
        --config-repo-path) config_repo_path="${2:?--config-repo-path needs a directory}"; shift 2 ;;
        --yes|-y) assume_yes=1; shift ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

[ "$(id -u)" -ne 0 ] || die 'Run this as the user that owns Klipper, not as root.'

for candidate in "${HOME}/printer_data/config" "${HOME}/klipper_config"; do
    [ -d "$candidate" ] && { config_dir="$candidate"; break; }
done
[ -n "$config_dir" ] && [ -f "${config_dir}/printer.cfg" ] && printer_cfg="${config_dir}/printer.cfg"
[ -n "$config_dir" ] && [ -f "${config_dir}/moonraker.conf" ] && moonraker_conf="${config_dir}/moonraker.conf"

step 'What this will remove'
say "  ${install_path}"
[ -n "$printer_cfg" ] && say "  the [include alabaster.cfg] line in ${printer_cfg}, if present"
[ -n "$config_dir" ] && say "  ${config_dir}/alabaster.cfg, if you say so"
say "  ${config_repo_path}, if you say so"
[ -n "$moonraker_conf" ] && say "  the [update_manager] blocks for Alabaster and its macro pack in ${moonraker_conf}, if present"
say '  the nginx site, if present'

# Checked against the flag directly rather than through `ask`, whose default
# here is deliberately no: running the uninstaller is already the decision, so
# --yes must not be turned into "changed nothing" by that default.
if [ "$assume_yes" -eq 0 ] && ! ask 'Continue?' n; then
    say 'Nothing was changed.'
    exit 0
fi

# --------------------------------------------------------------------------

step 'Application files'
if [ -d "$install_path" ]; then
    run rm -rf "$install_path"
    did "removed ${install_path}"
else
    skipped "${install_path} was not there"
fi

# The include comes out before the file it points at, so the configuration is
# never left referring to something that has been deleted.
step 'Klipper configuration'
if [ -n "$printer_cfg" ] && grep -qE '^[[:space:]]*\[include[[:space:]]+alabaster\.cfg\]' "$printer_cfg"; then
    if ask "Remove the include line from ${printer_cfg}?" y; then
        if [ "$dry_run" -eq 1 ]; then
            printf '%s(dry run)%s would remove the include and back up first\n' "$C_DIM" "$C_OFF"
        else
            cp "$printer_cfg" "${printer_cfg}.alabaster-backup"
            grep -vE '^[[:space:]]*\[include[[:space:]]+alabaster\.cfg\]' "$printer_cfg" > "${printer_cfg}.tmp"
            mv "${printer_cfg}.tmp" "$printer_cfg"
        fi
        did "include removed from printer.cfg (backup at ${printer_cfg}.alabaster-backup)"
    else
        warn 'Leaving the include in place means Klipper will not start once alabaster.cfg is gone.'
        skipped 'include left in printer.cfg'
    fi
else
    skipped 'no include found in printer.cfg'
fi

# A symlink is cheap to remove — the real content lives in the clone, removed
# separately below — so it defaults to yes, unlike a plain file, which still
# defaults to no since deleting one loses real content.
if [ -n "$config_dir" ] && [ -L "${config_dir}/alabaster.cfg" ]; then
    if ask "Remove the alabaster.cfg symlink at ${config_dir}/alabaster.cfg?" y; then
        run rm -f "${config_dir}/alabaster.cfg"
        did 'alabaster.cfg symlink removed'
    else
        skipped 'alabaster.cfg symlink kept'
    fi
elif [ -n "$config_dir" ] && [ -f "${config_dir}/alabaster.cfg" ]; then
    if ask "Delete ${config_dir}/alabaster.cfg? (any edits you made go with it)" n; then
        run rm -f "${config_dir}/alabaster.cfg"
        did 'alabaster.cfg deleted'
    else
        skipped 'alabaster.cfg kept'
    fi
fi

step 'Macro pack repository'
if [ -d "$config_repo_path" ]; then
    if ask "Remove ${config_repo_path}? (any edits you made directly in it go with it)" n; then
        run rm -rf "$config_repo_path"
        did "${config_repo_path} removed"
    else
        skipped "${config_repo_path} kept"
    fi
else
    skipped "${config_repo_path} was not there"
fi

step 'Moonraker'
# The app (type: web) and the macro pack (type: git_repo) are two independent
# blocks — see add_update_manager in install.sh. Backed up once, before either
# is touched, rather than per block: removing both in one run must not let the
# second removal's backup silently replace the first's.
moonraker_backed_up=0
moonraker_changed=0

back_up_moonraker_once() {
    [ "$moonraker_backed_up" -eq 1 ] && return 0
    [ "$dry_run" -eq 0 ] && cp "$moonraker_conf" "${moonraker_conf}.alabaster-backup"
    moonraker_backed_up=1
}

remove_update_manager_block() {
    local section="$1"
    if [ -n "$moonraker_conf" ] && grep -qE "^[[:space:]]*\[update_manager[[:space:]]+${section}\]" "$moonraker_conf"; then
        if ask "Remove the [update_manager ${section}] block from ${moonraker_conf}?" y; then
            back_up_moonraker_once
            if [ "$dry_run" -eq 1 ]; then
                printf '%s(dry run)%s would remove [update_manager %s]\n' "$C_DIM" "$C_OFF" "$section"
            else
                # Drops the section header and its indented body, stopping at
                # the next section so the other block is untouched.
                awk -v section="$section" '
                    $0 ~ ("^[[:space:]]*\\[update_manager[[:space:]]+" section "\\]") { skipping = 1; next }
                    skipping && /^[[:space:]]*\[/ { skipping = 0 }
                    !skipping { print }
                ' "$moonraker_conf" > "${moonraker_conf}.tmp"
                mv "${moonraker_conf}.tmp" "$moonraker_conf"
            fi
            did "[update_manager ${section}] removed"
            moonraker_changed=1
        else
            skipped "[update_manager ${section}] kept"
        fi
    else
        skipped "no [update_manager ${section}] block found"
    fi
}

remove_update_manager_block alabaster
remove_update_manager_block alabaster-config

if [ "$moonraker_changed" -eq 1 ]; then
    [ "$dry_run" -eq 0 ] && say "Backup at ${moonraker_conf}.alabaster-backup"
    say 'Restart Moonraker for it to take effect.'
fi

step 'Web server'
removed_site=0
for site in /etc/nginx/sites-available/alabaster /etc/nginx/conf.d/alabaster.conf; do
    if [ -f "$site" ]; then
        if ask "Remove ${site}? (needs sudo)" y; then
            run sudo rm -f "$site"
            removed_site=1
        else
            skipped "${site} kept"
        fi
    fi
done
if [ -L /etc/nginx/sites-enabled/alabaster ]; then
    run sudo rm -f /etc/nginx/sites-enabled/alabaster
    removed_site=1
fi
if [ "$removed_site" -eq 1 ]; then
    did 'nginx site removed'
    if [ "$dry_run" -eq 0 ] && command -v nginx >/dev/null 2>&1; then
        if sudo nginx -t >/dev/null 2>&1; then
            sudo systemctl reload nginx || warn 'nginx accepted the config but would not reload.'
        else
            warn 'Reload nginx yourself once its configuration is valid.'
        fi
    fi
else
    skipped 'no nginx site removed'
fi

step 'Done'
for entry in "${did_actions[@]}"; do say "  done     ${entry}"; done
for entry in "${skipped_actions[@]}"; do say "  skipped  ${entry}"; done
say ''
say 'Restart Klipper if the configuration changed.'
