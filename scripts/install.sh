#!/usr/bin/env bash
#
# Alabaster installer.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hannott/Alabaster/main/scripts/install.sh)"
#
# Safe to run again: it installs over an existing copy, leaves your own
# configuration alone, and asks before every change it makes outside its own
# directory.

set -euo pipefail

REPO='Hannott/Alabaster'
CONFIG_REPO_ORIGIN="https://github.com/${REPO}.git"
DEFAULT_PATH="${HOME}/alabaster"
DEFAULT_CONFIG_REPO_PATH="${HOME}/alabaster-config"
DEFAULT_PORT='8081'
DEFAULT_MOONRAKER='127.0.0.1:7125'

# The macros this pack defines. Another interface's macro pack defines the same
# names, and Klipper refuses to start when a macro is defined twice — so these
# are what the conflict scan looks for. Matched by macro name rather than by
# filename so a renamed or hand-written pack is caught just the same.
CONFLICT_MACROS='PAUSE RESUME CANCEL_PRINT SET_PAUSE_AT_LAYER SET_PAUSE_NEXT_LAYER SET_PRINT_STATS_INFO'
# Config sections it declares, which collide the same way.
CONFLICT_SECTIONS='pause_resume display_status respond exclude_object virtual_sdcard'

install_path="${DEFAULT_PATH}"
config_repo_path="${DEFAULT_CONFIG_REPO_PATH}"
version=''
from_zip=''
port="${DEFAULT_PORT}"
moonraker_address="${DEFAULT_MOONRAKER}"
assume_yes=0
dry_run=0
want_config=1
want_include=1
want_nginx=1
want_update_manager=1

config_dir=''
printer_cfg=''
moonraker_conf=''
did_actions=()
skipped_actions=()
# Global rather than local to main, because the EXIT trap that cleans it up
# runs after main has returned and would otherwise see an unset variable.
work=''
# Set by install_release, read by ensure_config_repo — the macro pack clones
# the exact tag the app itself just installed, so the two can never disagree
# about which version they are.
installed_version=''

# --------------------------------------------------------------------------
# Output and prompts
# --------------------------------------------------------------------------

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

# Prompts read from the terminal rather than stdin, so piping this script into
# bash does not silently answer every question with the script's own text.
#
# `--yes` takes each prompt's own default rather than answering yes to
# everything. The difference matters on the prompts whose default is no: those
# are the ones that would overwrite something you wrote, and an unattended
# re-install must never do that. Answering "yes to all" would make the safe
# path unreachable exactly where it is needed.
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
Alabaster installer

  --path DIR              Where to install (default: ~/alabaster)
  --config-repo-path DIR  Where to clone the macro pack (default: ~/alabaster-config)
  --version TAG           Install a specific release, such as v0.2.0
  --from-zip FILE         Install a local alabaster.zip instead of downloading
  --port PORT             Port for the nginx site (default: 8081)
  --moonraker HOST:PORT   Moonraker's address for the proxy (default: 127.0.0.1:7125)
  --yes                   Do not prompt; take each prompt's default. Defaults
                          never overwrite a file you have edited.
  --no-config             Do not offer to install alabaster.cfg
  --no-include            Do not offer to add the include to printer.cfg
  --no-nginx              Do not offer to configure nginx
  --no-update-manager     Do not offer to add update entries to moonraker.conf
  --dry-run               Print what would happen and change nothing
  -h, --help              This message
USAGE
}

# --------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --path) install_path="${2:?--path needs a directory}"; shift 2 ;;
        --config-repo-path) config_repo_path="${2:?--config-repo-path needs a directory}"; shift 2 ;;
        --version) version="${2:?--version needs a tag}"; shift 2 ;;
        --from-zip) from_zip="${2:?--from-zip needs a file}"; shift 2 ;;
        --port) port="${2:?--port needs a port}"; shift 2 ;;
        --moonraker) moonraker_address="${2:?--moonraker needs host:port}"; shift 2 ;;
        --yes|-y) assume_yes=1; shift ;;
        --no-config) want_config=0; shift ;;
        --no-include) want_include=0; shift ;;
        --no-nginx) want_nginx=0; shift ;;
        --no-update-manager) want_update_manager=0; shift ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------

preflight() {
    step 'Checking this machine'

    [ "$(id -u)" -ne 0 ] || die 'Run this as the user that owns Klipper, not as root. It uses sudo only where it has to.'

    local missing=''
    # git clones the macro pack's own tracked copy — see ensure_config_repo.
    # Klipper and Moonraker both already depend on it being present, so this
    # is a safe floor rather than a new burden.
    for tool in curl unzip git; do
        command -v "$tool" >/dev/null 2>&1 || missing="${missing} ${tool}"
    done
    [ -z "$missing" ] || die "Missing required tools:${missing}"

    command -v sha256sum >/dev/null 2>&1 || warn 'sha256sum not found; the download cannot be verified.'

    # Moonraker refuses to manage a client directory that sits inside a git
    # repository, so an install there would work once and never update.
    if git -C "$(dirname "$install_path")" rev-parse --git-dir >/dev/null 2>&1; then
        die "${install_path} is inside a git repository. Moonraker cannot manage updates there — choose another --path."
    fi

    for candidate in "${HOME}/printer_data/config" "${HOME}/klipper_config"; do
        if [ -d "$candidate" ]; then
            config_dir="$candidate"
            break
        fi
    done

    if [ -n "$config_dir" ]; then
        [ -f "${config_dir}/printer.cfg" ] && printer_cfg="${config_dir}/printer.cfg"
        for candidate in "${config_dir}/moonraker.conf" "${HOME}/printer_data/config/moonraker.conf"; do
            [ -f "$candidate" ] && { moonraker_conf="$candidate"; break; }
        done
        say "Config directory:  ${config_dir}"
        say "printer.cfg:       ${printer_cfg:-not found}"
        say "moonraker.conf:    ${moonraker_conf:-not found}"
    else
        warn 'No Klipper config directory found. The macro pack and update manager steps will be skipped.'
    fi

    say "Install path:      ${install_path}"
}

# --------------------------------------------------------------------------
# Fetching and installing the release
# --------------------------------------------------------------------------

fetch_release() {
    local dir="$1" url checksum_url

    if [ -n "$from_zip" ]; then
        [ -f "$from_zip" ] || die "No such file: ${from_zip}"
        cp "$from_zip" "${dir}/alabaster.zip"
        say "Using ${from_zip}"
        return 0
    fi

    if [ -n "$version" ]; then
        url="https://github.com/${REPO}/releases/download/${version}/alabaster.zip"
    else
        # GitHub redirects this to whatever the newest release is, which saves
        # parsing the releases API with tools a Pi may not have.
        url="https://github.com/${REPO}/releases/latest/download/alabaster.zip"
    fi
    checksum_url="${url}.sha256"

    say "Downloading ${url}"
    curl -fsSL --retry 3 -o "${dir}/alabaster.zip" "$url" \
        || die "Could not download the release. Check the network, or pass --from-zip."

    if command -v sha256sum >/dev/null 2>&1; then
        if curl -fsSL --retry 3 -o "${dir}/alabaster.zip.sha256" "$checksum_url" 2>/dev/null; then
            ( cd "$dir" && sha256sum -c alabaster.zip.sha256 >/dev/null 2>&1 ) \
                || die 'The download does not match its published checksum. Nothing has been installed.'
            say 'Checksum verified.'
        else
            warn 'No published checksum for this release; skipping verification.'
        fi
    fi
}

install_release() {
    local zip="$1" staging="${install_path}.new" previous="${install_path}.old"

    step 'Installing Alabaster'

    rm -rf "$staging" "$previous"
    mkdir -p "$staging"
    unzip -q "$zip" -d "$staging" || die 'The archive could not be extracted.'

    # Verified before anything is swapped, so a truncated or wrong download
    # cannot replace a working install with a broken one.
    for required in index.html release_info.json; do
        [ -f "${staging}/${required}" ] || die "The archive is missing ${required}; it is not an Alabaster release."
    done

    installed_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${staging}/release_info.json" | head -n1)"
    say "Version: ${installed_version:-unknown}"

    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s would replace %s\n' "$C_DIM" "$C_OFF" "$install_path"
        rm -rf "$staging"
        did "Alabaster ${installed_version} (dry run)"
        return 0
    fi

    # The swap. Staging beside the target rather than extracting over it is
    # what makes an interrupted install recoverable: until this point the
    # existing copy is untouched, and if the move fails it goes straight back.
    if [ -d "$install_path" ]; then
        mv "$install_path" "$previous"
    fi
    if ! mv "$staging" "$install_path"; then
        [ -d "$previous" ] && mv "$previous" "$install_path"
        die 'Could not move the new release into place. The previous version has been restored.'
    fi
    rm -rf "$previous"

    did "Alabaster ${installed_version} installed to ${install_path}"
}

# --------------------------------------------------------------------------
# Klipper configuration
# --------------------------------------------------------------------------

# Every config file printer.cfg pulls in, following [include] directives and
# their globs. Without this the scan would only see printer.cfg itself, which
# is the one file a macro pack is least likely to be written into.
collect_configs() {
    local file="$1" dir pattern match
    [ -f "$file" ] || return 0
    case " ${SEEN_CONFIGS-} " in *" ${file} "*) return 0 ;; esac
    SEEN_CONFIGS="${SEEN_CONFIGS-} ${file}"
    printf '%s\n' "$file"

    dir="$(dirname "$file")"
    while IFS= read -r pattern; do
        [ -n "$pattern" ] || continue
        # Deliberately unquoted: an include may be a glob such as macros/*.cfg.
        # shellcheck disable=SC2086
        for match in ${dir}/${pattern}; do
            [ -f "$match" ] || continue
            collect_configs "$match"
        done
    done < <(sed -n 's/^[[:space:]]*\[include[[:space:]]\+\([^]]*\)\].*/\1/p' "$file")
}

scan_for_conflicts() {
    local conflicts='' file name section base

    SEEN_CONFIGS=''
    while IFS= read -r file; do
        base="$(basename "$file")"
        # Our own pack is not a conflict with itself, which is what makes
        # re-running the installer quiet rather than alarming.
        [ "$base" = 'alabaster.cfg' ] && continue

        for name in $CONFLICT_MACROS; do
            if grep -qiE "^[[:space:]]*\[gcode_macro[[:space:]]+${name}\]" "$file"; then
                conflicts="${conflicts}  ${name}  in ${file}"$'\n'
            fi
        done
        for section in $CONFLICT_SECTIONS; do
            if grep -qiE "^[[:space:]]*\[${section}\]" "$file"; then
                conflicts="${conflicts}  [${section}]  in ${file}"$'\n'
            fi
        done
        # Klipper enables [display_status] on its own when a display is
        # configured, so alabaster.cfg's copy would be the second one.
        if grep -qiE '^[[:space:]]*\[display\]' "$file"; then
            conflicts="${conflicts}  [display] (enables display_status)  in ${file}"$'\n'
        fi
    done < <(collect_configs "$printer_cfg")

    printf '%s' "$conflicts"
}


# Clones (once) or leaves the existing clone alone; Moonraker's own
# `alabaster-config` update_manager entry is what keeps it current after this.
# Pinned to the version just installed, so the macro pack can never disagree
# with the app about which release it came from — the exact drift a
# separately-versioned config repository would risk.
#
# Tries a partial, sparse clone first — only `klipper/` rather than the whole
# application source — and falls back to a plain clone on a git old enough
# not to support that. Returns non-zero only when no clone could be made at
# all (typically no network), so the caller can fall back further, to the
# plain copy this release also carries for exactly that case.
ensure_config_repo() {
    if [ -d "${config_repo_path}/.git" ]; then
        return 0
    fi
    if [ -e "$config_repo_path" ]; then
        warn "${config_repo_path} exists and is not a git repository; leaving it alone."
        return 1
    fi

    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s would clone the macro pack repository (%s) into %s\n' \
            "$C_DIM" "$C_OFF" "${installed_version:-latest}" "$config_repo_path"
        return 0
    fi

    say "Cloning the macro pack (${installed_version:-latest})..."
    local clone_args=(--depth 1)
    [ -n "$installed_version" ] && clone_args=(--depth 1 --branch "$installed_version")

    if git clone --filter=blob:none --sparse "${clone_args[@]}" "$CONFIG_REPO_ORIGIN" "$config_repo_path" 2>/dev/null \
        && git -C "$config_repo_path" sparse-checkout set klipper 2>/dev/null; then
        return 0
    fi

    rm -rf "$config_repo_path"
    if git clone "${clone_args[@]}" "$CONFIG_REPO_ORIGIN" "$config_repo_path" 2>/dev/null; then
        warn 'Cloned the full repository rather than just klipper/; an older git here does not support partial clones.'
        return 0
    fi

    rm -rf "$config_repo_path"
    warn 'Could not clone the macro pack repository. Check your network, then re-run this installer to add it.'
    return 1
}

# Puts alabaster.cfg where printer.cfg's [include] expects it, as a symlink
# into the clone rather than a copy — so editing the file, whether by hand or
# through Alabaster's own Configuration page, edits the real file inside the
# git working tree. That is what lets an edit surface as "local changes" on
# the Machine page's own repository-recovery flow instead of vanishing
# silently on the next update.
link_macro_pack() {
    local repo_file="${config_repo_path}/klipper/alabaster.cfg" target="${config_dir}/alabaster.cfg"

    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s would link %s to the macro pack repository\n' "$C_DIM" "$C_OFF" "$target"
        return 0
    fi

    if [ ! -f "$repo_file" ]; then
        warn "${repo_file} was not found after cloning; alabaster.cfg was not linked in."
        return 1
    fi

    if [ -L "$target" ]; then
        local current
        current="$(readlink "$target")"
        if [ "$current" = "$repo_file" ]; then
            did 'alabaster.cfg already links to the macro pack repository'
            return 0
        fi
        if ! ask "${target} already links elsewhere (${current}). Replace it?" n; then
            skipped 'existing symlink left in place'
            return 0
        fi
        run rm -f "$target"
    elif [ -f "$target" ]; then
        # A plain file here is an install from before the macro pack was
        # git-tracked. Backed up rather than replaced silently: any edits to
        # its _ALABASTER settings do not carry forward automatically — there
        # is no safe way to merge them into the new copy.
        warn "${target} is a plain file from an earlier install. Backing it up — reapply any of your own settings by editing the new one."
        run cp "$target" "${target}.pre-git-migration"
        run rm -f "$target"
    fi

    run ln -s "$repo_file" "$target"
    did "alabaster.cfg linked to ${repo_file}"
}

# Copies the file that shipped inside this release, exactly as earlier
# versions of this installer always did. Used only when the git clone above
# could not be made — offline, or an unreachable network — so the macro pack
# still installs, just without an update_manager entry of its own until the
# clone can be retried.
copy_macro_pack_plain() {
    local source="$1" target="${config_dir}/alabaster.cfg"

    if [ -L "$target" ]; then
        did 'alabaster.cfg already links to the macro pack repository; leaving it as is'
        return 0
    fi

    if [ -f "$target" ]; then
        if ask "${target} already exists. Replace it? (your edits would be lost)" n; then
            run cp "$target" "${target}.backup"
            run cp "$source" "$target"
            did "alabaster.cfg replaced (previous kept as alabaster.cfg.backup)"
        else
            run cp "$source" "${target}.new"
            did "New version written to ${target}.new; your alabaster.cfg was left alone"
        fi
    else
        run cp "$source" "$target"
        did "alabaster.cfg installed to ${target}"
    fi
}

install_macro_pack() {
    local fallback_source="$1"

    step 'Macro pack'
    say 'alabaster.cfg gives Alabaster the macros its own controls call, and'
    say 'parks the nozzle when a print pauses. It is optional, and is tracked'
    say 'as its own git-managed copy so it can update independently of the app.'

    if ! ask 'Install alabaster.cfg?' y; then
        skipped 'alabaster.cfg not installed'
        return 0
    fi

    if ensure_config_repo && link_macro_pack; then
        add_include
        return 0
    fi

    warn 'Falling back to the copy included in this release; it will not update on its own.'
    copy_macro_pack_plain "$fallback_source"
    add_include
}

add_include() {
    local conflicts backup

    [ "$want_include" -eq 1 ] || { skipped 'include not added'; return 0; }
    [ -n "$printer_cfg" ] || { skipped 'no printer.cfg found, include not added'; return 0; }

    if grep -qE '^[[:space:]]*\[include[[:space:]]+alabaster\.cfg\]' "$printer_cfg"; then
        did 'printer.cfg already includes alabaster.cfg'
        return 0
    fi

    say ''
    say 'Checking printer.cfg for macros that would collide...'
    conflicts="$(scan_for_conflicts)"

    if [ -n "$conflicts" ]; then
        warn 'Your configuration already defines things alabaster.cfg defines:'
        # Command substitution strips the trailing newline, so it is added back
        # rather than letting the last entry run into the warning below it.
        printf '%s\n' "$conflicts" >&2
        warn 'Klipper will not start with either defined twice, so the include was NOT added.'
        say ''
        say 'Most likely another Klipper web interface ships a macro pack you already'
        say 'include. Use one pack or the other: remove that include, then add'
        say '  [include alabaster.cfg]'
        say "to the top of ${printer_cfg} yourself."
        skipped 'include not added — conflicting definitions found'
        return 0
    fi

    if ! ask "Add [include alabaster.cfg] to the top of ${printer_cfg}?" y; then
        skipped 'include not added'
        return 0
    fi

    backup="${printer_cfg}.alabaster-backup"
    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s would back up to %s and prepend the include\n' "$C_DIM" "$C_OFF" "$backup"
    else
        cp "$printer_cfg" "$backup"
        printf '[include alabaster.cfg]\n\n%s' "$(cat "$printer_cfg")" > "${printer_cfg}.tmp"
        mv "${printer_cfg}.tmp" "$printer_cfg"
    fi
    did "include added to printer.cfg (backup at ${backup})"
}

# --------------------------------------------------------------------------
# nginx and Moonraker
# --------------------------------------------------------------------------

configure_nginx() {
    local template="$1" site rendered

    [ "$want_nginx" -eq 1 ] || return 0
    command -v nginx >/dev/null 2>&1 || { skipped 'nginx not installed, site not configured'; return 0; }

    step 'Web server'
    if ! ask "Configure an nginx site serving Alabaster on port ${port}?" y; then
        skipped 'nginx site not configured'
        return 0
    fi

    if [ -d /etc/nginx/sites-available ]; then
        site='/etc/nginx/sites-available/alabaster'
    else
        site='/etc/nginx/conf.d/alabaster.conf'
    fi

    if [ -f "$site" ] && ! ask "${site} already exists. Replace it?" n; then
        skipped 'nginx site left unchanged'
        return 0
    fi

    rendered="$(mktemp)"
    sed -e "s|__PORT__|${port}|g" \
        -e "s|__ROOT__|${install_path}|g" \
        -e "s|__MOONRAKER__|${moonraker_address}|g" \
        "$template" > "$rendered"

    say 'This step needs sudo.'
    run sudo cp "$rendered" "$site"
    rm -f "$rendered"

    if [ -d /etc/nginx/sites-enabled ]; then
        run sudo ln -sf "$site" /etc/nginx/sites-enabled/alabaster
    fi

    if [ "$dry_run" -eq 0 ]; then
        if sudo nginx -t >/dev/null 2>&1; then
            sudo systemctl reload nginx || warn 'nginx accepted the config but would not reload.'
            did "nginx serving ${install_path} on port ${port}"
        else
            warn 'nginx rejected the configuration. Run "sudo nginx -t" to see why.'
            skipped 'nginx not reloaded'
        fi
    else
        did "nginx site (dry run)"
    fi
}


# Two independent blocks, since the app (a downloaded release, type: web) and
# the macro pack (a git clone, type: git_repo) are tracked by Moonraker in
# fundamentally different ways — see deploy/moonraker/update_manager.conf for
# the reference copy of both. Only appends whichever of the two is both wanted
# and not already present, so re-running after adding the app with --no-config
# and the macro pack later does not duplicate the first block.
add_update_manager() {
    local have_alabaster=0 have_config=0

    [ "$want_update_manager" -eq 1 ] || return 0
    [ -n "$moonraker_conf" ] || { skipped 'no moonraker.conf found, update manager not added'; return 0; }

    step 'Updates through Moonraker'

    grep -qE '^[[:space:]]*\[update_manager[[:space:]]+alabaster\]' "$moonraker_conf" && have_alabaster=1
    local config_cloned=0
    [ -d "${config_repo_path}/.git" ] && config_cloned=1
    grep -qE '^[[:space:]]*\[update_manager[[:space:]]+alabaster-config\]' "$moonraker_conf" && have_config=1

    if [ "$have_alabaster" -eq 1 ] && { [ "$have_config" -eq 1 ] || [ "$config_cloned" -eq 0 ]; }; then
        did 'moonraker.conf already tracks what is installed'
        return 0
    fi

    if ! ask 'Let Moonraker manage updates for Alabaster and its macro pack?' y; then
        skipped 'update manager not added'
        return 0
    fi

    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s would update %s\n' "$C_DIM" "$C_OFF" "$moonraker_conf"
        did 'update_manager entries (dry run)'
        return 0
    fi

    cp "$moonraker_conf" "${moonraker_conf}.alabaster-backup"

    if [ "$have_alabaster" -eq 0 ]; then
        {
            printf '\n[update_manager alabaster]\n'
            printf 'type: web\n'
            printf 'channel: stable\n'
            printf 'repo: %s\n' "$REPO"
            printf 'path: %s\n' "$install_path"
        } >> "$moonraker_conf"
    fi

    if [ "$have_config" -eq 0 ] && [ "$config_cloned" -eq 1 ]; then
        {
            printf '\n[update_manager alabaster-config]\n'
            printf 'type: git_repo\n'
            printf 'channel: stable\n'
            printf 'path: %s\n' "$config_repo_path"
            printf 'origin: %s\n' "$CONFIG_REPO_ORIGIN"
            printf 'primary_branch: main\n'
            printf 'managed_services: klipper\n'
        } >> "$moonraker_conf"
    fi

    did "update_manager updated in moonraker.conf (backup at ${moonraker_conf}.alabaster-backup)"
    say 'Restart Moonraker for it to take effect.'
}

# --------------------------------------------------------------------------

main() {
    preflight

    work="$(mktemp -d)"
    trap 'rm -rf "${work:-}"' EXIT

    fetch_release "$work"

    # Read the pack out of the archive rather than from the internet, so an
    # install is one download and an offline --from-zip install works fully.
    local unpacked="${work}/contents"
    mkdir -p "$unpacked"
    unzip -q -o "${work}/alabaster.zip" -d "$unpacked" || die 'The archive could not be read.'

    install_release "${work}/alabaster.zip"

    if [ "$want_config" -eq 1 ] && [ -n "$config_dir" ] && [ -f "${unpacked}/klipper/alabaster.cfg" ]; then
        install_macro_pack "${unpacked}/klipper/alabaster.cfg"
    else
        skipped 'macro pack not offered'
    fi

    [ -f "${unpacked}/deploy/nginx/alabaster.conf" ] && configure_nginx "${unpacked}/deploy/nginx/alabaster.conf"
    add_update_manager

    step 'Done'
    for entry in "${did_actions[@]}"; do say "  done     ${entry}"; done
    for entry in "${skipped_actions[@]}"; do say "  skipped  ${entry}"; done

    say ''
    say "Open Alabaster at ${C_BOLD}http://$(hostname).local:${port}${C_OFF}"
    if [ -n "$printer_cfg" ]; then
        say 'If you added the macro pack, restart Klipper so it loads.'
    fi
}

main "$@"
