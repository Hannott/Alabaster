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

# >>> installer-ui
# The terminal presentation both scripts share. It is copied verbatim between
# the two markers in install.sh and uninstall.sh, because each is fetched and
# run as a single file; scripts/__tests__/installerUi.spec.ts fails the build
# when the copies differ.
#
# Pure bash 4+ and printf: no tput, dialog, whiptail or ncurses, which minimal
# Klipper host images do not all ship. Three output modes, chosen once:
#   rich   stdout is a terminal with a UTF-8 locale: banner, framed panels,
#          colour, panels that redraw in place
#   ascii  the same panels drawn with + - | when the locale is not UTF-8
#   plain  stdout is not a terminal, or --plain was given: one line per event,
#          no colour and no cursor movement, so logs and scripted runs read
#          the same as they always have
# Nothing clears the screen or switches to the alternate screen, so the whole
# run stays in scrollback for the owner to scroll back through and copy from.

shopt -s extglob

ui_init() {
    UI_TTY=0
    [ -t 1 ] && UI_TTY=1
    [ "${UI_FORCE_PLAIN:-0}" -eq 1 ] && UI_TTY=0

    local locale="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"
    UI_UTF8=0
    case "$locale" in *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) UI_UTF8=1 ;; esac

    UI_COLOR=16
    case "${COLORTERM:-}" in truecolor | 24bit) UI_COLOR=true ;; esac
    [ "$UI_COLOR" = 16 ] && case "${TERM:-}" in *256color*) UI_COLOR=256 ;; esac
    if [ -n "${NO_COLOR:-}" ] || [ "${TERM:-}" = dumb ] || [ "$UI_TTY" -eq 0 ]; then
        UI_COLOR=none
    fi

    local cols=''
    if [ "$UI_TTY" -eq 1 ] && [ -r /dev/tty ]; then
        cols="$(stty size < /dev/tty 2>/dev/null | cut -d' ' -f2 || true)"
    fi
    UI_COLS="${cols:-${COLUMNS:-80}}"
    case "$UI_COLS" in '' | *[!0-9]*) UI_COLS=80 ;; esac
    UI_W=78
    ((UI_COLS < 80)) && UI_W=$((UI_COLS - 2))
    ((UI_W < 48)) && UI_W=48
    UI_IW=$((UI_W - 2))

    UI_MODE=plain
    if [ "$UI_TTY" -eq 1 ]; then
        [ "$UI_UTF8" -eq 1 ] && UI_MODE=rich || UI_MODE=ascii
    fi
    UI_SPIN_PID=''
    UI_DRAWN=0

    ui_palette
    ui_glyphs
}

# Okabe-Ito, the hues the app's own palette is built from, each with the
# nearest 256-colour index and the 16-colour ANSI code it falls back to.
# Neutral text stays on the terminal's default foreground, so the installer
# reads on light and dark terminal themes alike — which is also why the
# warning mark is orange: yellow vanishes on a light background, and the
# script cannot know which background it has.
ui_color() {
    local r="$1" g="$2" b="$3" c256="$4" c16="$5" layer="${6:-38}"
    case "$UI_COLOR" in
        true) printf '\033[%s;2;%s;%s;%sm' "$layer" "$r" "$g" "$b" ;;
        256) printf '\033[%s;5;%sm' "$layer" "$c256" ;;
        16)
            [ "$layer" = 48 ] && c16=$((c16 + 10))
            printf '\033[%sm' "$c16"
            ;;
        *) ;;
    esac
}

ui_palette() {
    C_SKY="$(ui_color 86 180 233 74 36)"
    C_BLUE="$(ui_color 0 114 178 25 34)"
    C_OK="$(ui_color 0 158 115 36 32)"
    C_WARN="$(ui_color 230 159 0 178 33)"
    C_ERR="$(ui_color 213 94 0 166 31)"
    if [ "$UI_COLOR" = none ]; then
        C_BOLD=''
        C_DIM=''
        C_OFF=''
        C_FG=''
    else
        C_BOLD=$'\033[1m'
        C_DIM=$'\033[2m'
        C_OFF=$'\033[0m'
        C_FG=$'\033[39m'
    fi
    C_FRAME="$C_BLUE"

    declare -gA PX_FG PX_BG
    PX_FG[s]="$C_FG"
    PX_BG[s]=''
    PX_FG[p]="$C_BLUE"
    PX_BG[p]="$(ui_color 0 114 178 25 34 48)"
    PX_FG[g]="$C_SKY"
    PX_BG[g]="$(ui_color 86 180 233 74 36 48)"
    PX_FG[a]="$(ui_color 240 228 66 227 33)"
    PX_BG[a]="$(ui_color 240 228 66 227 33 48)"
}

# Some glyphs are drawn by only one of the two scripts.
# shellcheck disable=SC2034
ui_glyphs() {
    if [ "$UI_MODE" = rich ]; then
        B_TL='╭' B_TR='╮' B_BL='╰' B_BR='╯' B_H='─' B_V='│'
        B_LT='├' B_RT='┤' B_TT='┬' B_BT='┴'
        G_OK='✓' G_WARN='!' G_ERR='✗' G_SKIP='–' G_TODO='·'
        G_ON='✓' G_BAR_DONE='━' G_BAR_TODO='─' G_SEP='·' G_PROMPT='›' G_ELLIPSIS='…'
        G_SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
    else
        B_TL='+' B_TR='+' B_BL='+' B_BR='+' B_H='-' B_V='|'
        B_LT='+' B_RT='+' B_TT='+' B_BT='+'
        G_OK='+' G_WARN='!' G_ERR='x' G_SKIP='-' G_TODO='.'
        G_ON='x' G_BAR_DONE='#' G_BAR_TODO='.' G_SEP='-' G_PROMPT='>' G_ELLIPSIS='...'
        G_SPIN=('|' '/' '-' '\')
    fi
}

# Measuring and padding text that carries colour escapes.

ui_visible() {
    local p="${1//$'\033['*([0-9;])m/}"
    UI_LEN=${#p}
}

# A line too long for its space loses its colour and is shortened, rather than
# breaking the panel's right edge on a narrow terminal.
ui_pad() {
    ui_visible "$1"
    if ((UI_LEN > $2)); then
        ui_fit "${1//$'\033['*([0-9;])m/}" "$2"
        return 0
    fi
    printf '%s%*s' "$1" $(($2 - UI_LEN)) ''
}

# Shortens plain text (no escapes) to a width.
ui_fit() {
    local text="$1" width="$2"
    if ((${#text} > width)); then
        text="${text:0:$((width - ${#G_ELLIPSIS}))}${G_ELLIPSIS}"
    fi
    printf '%s' "$text"
}

ui_repeat() {
    local out='' i
    for ((i = 0; i < $2; i++)); do out+="$1"; done
    printf '%s' "$out"
}

ui_wrap() { printf '%s\n' "$1" | fold -s -w "$2" | sed 's/ *$//'; }

# Every mark differs in shape as well as colour, so no state is told by colour
# alone.
ui_mark() {
    case "$1" in
        ok) printf '%s%s%s' "$C_OK" "$G_OK" "$C_OFF" ;;
        warn) printf '%s%s%s' "$C_WARN" "$G_WARN" "$C_OFF" ;;
        err) printf '%s%s%s' "$C_ERR" "$G_ERR" "$C_OFF" ;;
        skip) printf '%s%s%s' "$C_DIM" "$G_SKIP" "$C_OFF" ;;
        todo) printf '%s%s%s' "$C_DIM" "$G_TODO" "$C_OFF" ;;
        run) printf '%s%s%s' "$C_SKY" "${G_SPIN[${2:-0}]}" "$C_OFF" ;;
        *) printf ' ' ;;
    esac
}

ui_key() { printf '%s%s%s %s' "$C_SKY$C_BOLD" "$1" "$C_OFF" "$2"; }

# The banner: the favicon's A-frame printer and the wordmark, drawn in
# half-block pixels.

# Read through a nameref in ui_pixels.
# shellcheck disable=SC2034
UI_LOGO=(
    '....ssss....'
    '....ssss....'
    '...ss..ss...'
    '...ss..ss...'
    '.gggggggggg.'
    '.gggggggggg.'
    '..pp.gg.ss..'
    '..pp.pp.ss..'
    '.pp..pp..ss.'
    '.pp......ss.'
    '.ppppppppps.'
    '.pppaaaapps.'
)

# shellcheck disable=SC2034
UI_WORDMARK=(
    '.ssss..ss......ssss..sssss...ssss...sssss.ssssss.ssssss.sssss.'
    'ss..ss.ss.....ss..ss.ss..ss.ss..ss.ss.......ss...ss.....ss..ss'
    'ss..ss.ss.....ss..ss.ss..ss.ss..ss.ss.......ss...ss.....ss..ss'
    'ssssss.ss.....ssssss.sssss..ssssss..ssss....ss...sssss..sssss.'
    'ss..ss.ss.....ss..ss.ss..ss.ss..ss.....ss...ss...ss.....ss.ss.'
    'ss..ss.ss.....ss..ss.ss..ss.ss..ss.....ss...ss...ss.....ss..ss'
    'ss..ss.ss.....ss..ss.ss..ss.ss..ss.....ss...ss...ss.....ss..ss'
    'ss..ss.ssssss.ss..ss.sssss..ss..ss.sssss....ss...ssssss.ss..ss'
)

# Two bitmap rows become one line of text: ▀ carries the upper pixel in the
# foreground and the lower one in the background. The default foreground has
# no background equivalent, so a cell pairing it with a colour puts the
# default in the foreground and flips the half block instead.
ui_pixels() {
    local -n rows_ref="$1"
    UI_PIX=()
    local n=${#rows_ref[@]} r c top bot w out key last fg bg ch
    for ((r = 0; r < n; r += 2)); do
        local a="${rows_ref[r]}" b="${rows_ref[r + 1]:-}"
        # Without colour the parts cannot be told apart, and a ▀ whose lower
        # half was a background colour would render as half a pixel.
        if [ "$UI_COLOR" = none ]; then
            a="${a//[!.]/s}"
            b="${b//[!.]/s}"
        fi
        out=''
        last=''
        w=${#a}
        for ((c = 0; c < w; c++)); do
            top="${a:c:1}"
            bot="${b:c:1}"
            [ -n "$bot" ] || bot=.
            fg=''
            bg=''
            ch=' '
            if [ "$top" = . ] && [ "$bot" = . ]; then
                ch=' '
            elif [ "$top" = "$bot" ]; then
                fg="${PX_FG[$top]}"
                ch='█'
            elif [ "$bot" = . ]; then
                fg="${PX_FG[$top]}"
                ch='▀'
            elif [ "$top" = . ]; then
                fg="${PX_FG[$bot]}"
                ch='▄'
            elif [ "$bot" = s ]; then
                fg="${PX_FG[s]}"
                bg="${PX_BG[$top]}"
                ch='▄'
            else
                fg="${PX_FG[$top]}"
                bg="${PX_BG[$bot]}"
                ch='▀'
            fi
            key="${fg}|${bg}"
            if [ "$ch" = ' ' ]; then
                [ -n "$last" ] && out+="$C_OFF"
                last=''
            elif [ "$key" != "$last" ]; then
                out+="${C_OFF}${fg}${bg}"
                last="$key"
            fi
            out+="$ch"
        done
        UI_PIX+=("${out}${C_OFF}")
    done
}

# title is the line under the wordmark, note an optional badge after it.
ui_banner() {
    local title="$1" note="${2:-}"
    [ "$UI_MODE" = plain ] && return 0
    local tagline="${C_DIM}${title}${C_OFF}${note:+   $note}"

    if [ "$UI_MODE" = ascii ] || ((UI_COLS < 66)); then
        printf '\n %sA L A B A S T E R%s\n %s\n\n' "$C_BOLD" "$C_OFF" "$tagline"
        return 0
    fi

    ui_pixels UI_WORDMARK
    local -a word=("${UI_PIX[@]}")
    local i
    printf '\n'
    if ((UI_COLS < 80)); then
        for i in 0 1 2 3; do printf ' %s\n' "${word[i]}"; done
        printf ' %s\n\n' "$tagline"
        return 0
    fi
    ui_pixels UI_LOGO
    local -a logo=("${UI_PIX[@]}")
    local -a side=("${word[0]}" "${word[1]}" "${word[2]}" "${word[3]}" '' "$tagline")
    for i in 0 1 2 3 4 5; do printf ' %s   %s\n' "${logo[i]}" "${side[i]}"; done
    printf '\n'
}

# Framed panels. The title sits in the top border, key hints in the bottom one.

ui_box_top() {
    local title="$1" right="${2:-}" frame="${3:-$C_FRAME}"
    local t=" ${C_BOLD}${title}${C_OFF} " r=''
    [ -n "$right" ] && r=" ${C_DIM}${right}${C_OFF} "
    ui_visible "$t"
    local tl=$UI_LEN
    ui_visible "$r"
    local rl=$UI_LEN
    local fill=$((UI_IW - 1 - tl - rl - (rl > 0 ? 1 : 0)))
    ((fill < 1)) && fill=1
    printf '%s%s%s%s%s%s' "$frame" "$B_TL" "$B_H" "$C_OFF" "$t" "$frame"
    ui_repeat "$B_H" "$fill"
    [ -n "$r" ] && printf '%s%s%s%s' "$C_OFF" "$r" "$frame" "$B_H"
    printf '%s%s\n' "$B_TR" "$C_OFF"
}

ui_box_line() {
    local frame="${2:-$C_FRAME}"
    printf '%s%s%s  %s %s%s%s\n' "$frame" "$B_V" "$C_OFF" "$(ui_pad "$1" $((UI_IW - 3)))" "$frame" "$B_V" "$C_OFF"
}

ui_box_blank() { ui_box_line '' "${1:-$C_FRAME}"; }

ui_box_rule() {
    local frame="${1:-$C_FRAME}"
    printf '%s%s' "$frame" "$B_LT"
    ui_repeat "$B_H" "$UI_IW"
    printf '%s%s\n' "$B_RT" "$C_OFF"
}

ui_box_bottom() {
    local hint="${1:-}" frame="${2:-$C_FRAME}"
    if [ -z "$hint" ]; then
        printf '%s%s' "$frame" "$B_BL"
        ui_repeat "$B_H" "$UI_IW"
        printf '%s%s\n' "$B_BR" "$C_OFF"
        return 0
    fi
    local h=" ${hint} "
    ui_visible "$h"
    printf '%s%s%s%s%s%s' "$frame" "$B_BL" "$B_H" "$C_OFF" "$h" "$frame"
    ui_repeat "$B_H" $((UI_IW - 1 - UI_LEN))
    printf '%s%s\n' "$B_BR" "$C_OFF"
}

# A mark and a sentence, wrapped inside the panel with a hanging indent.
ui_box_para() {
    local mark="$1" text="$2" frame="${3:-$C_FRAME}" first=1 line
    while IFS= read -r line; do
        if [ "$first" -eq 1 ]; then
            ui_box_line "$(ui_mark "$mark")  ${line}" "$frame"
            first=0
        else
            ui_box_line "   ${line}" "$frame"
        fi
    done < <(ui_wrap "$text" $((UI_IW - 6)))
}

# Two columns, for the menu shown when Alabaster is already installed.
UI_LW=28

ui_box_split() {
    local left="$1" mid="$2" right="$3" frame="${4:-$C_FRAME}"
    printf '%s%s' "$frame" "$left"
    ui_repeat "$B_H" "$UI_LW"
    printf '%s' "$mid"
    ui_repeat "$B_H" $((UI_IW - UI_LW - 1))
    printf '%s%s\n' "$right" "$C_OFF"
}

ui_box_line2() {
    local frame="${3:-$C_FRAME}"
    printf '%s%s%s  %s%s%s%s  %s %s%s%s\n' \
        "$frame" "$B_V" "$C_OFF" "$(ui_pad "$1" $((UI_LW - 2)))" \
        "$frame" "$B_V" "$C_OFF" "$(ui_pad "$2" $((UI_IW - UI_LW - 4)))" \
        "$frame" "$B_V" "$C_OFF"
}

# mark, label, state, detail: the shape of every status row. The detail is
# plain text and is shortened to fit.
ui_status_row() {
    local mark="$1" label="$2" state="$3" detail="${4:-}"
    ui_box_line "$(ui_mark "$mark")  $(ui_pad "$label" 16)$(ui_pad "$state" 15)${C_DIM}$(ui_fit "$detail" $((UI_IW - 39)))${C_OFF}"
}

# key, on|off|blocked|fixed|present|na, label, detail
ui_plan_row() {
    local key="$1" state="$2" label="$3" detail="${4:-}" box
    case "$state" in
        on | fixed | present) box="[${C_OK}${G_ON}${C_OFF}]" ;;
        blocked) box="[${C_WARN}${G_WARN}${C_OFF}]" ;;
        *) box='[ ]' ;;
    esac
    local k="${C_SKY}${C_BOLD}${key}${C_OFF}"
    [ -z "$key" ] && k=' '
    case "$state" in off | na) label="${C_DIM}${label}${C_OFF}" ;; esac
    case "$state" in na | present) detail="${C_DIM}${detail}${C_OFF}" ;; esac
    ui_box_line "${box} ${k}  $(ui_pad "$label" 22)${detail}"
}

ui_plan_cont() { ui_box_line "$(ui_repeat ' ' 29)$1"; }

ui_progress_bar() {
    local done="$1" total="$2" w=$((UI_IW - 13)) fill=0
    ((total > 0)) && fill=$((w * done / total))
    ui_box_line "${C_SKY}$(ui_repeat "$G_BAR_DONE" "$fill")${C_OFF}${C_DIM}$(ui_repeat "$G_BAR_TODO" $((w - fill)))${C_OFF}  ${done} of ${total}"
}

# Prints what a drawing function prints, remembering its height so the next
# ui_redraw can move back over it.
ui_draw() {
    local out
    out="$("$@")"
    printf '%s\n' "$out"
    UI_DRAWN=$(($(printf '%s\n' "$out" | wc -l)))
}

# extra is any lines printed below the drawing since, such as a prompt.
ui_redraw() {
    local extra="$1"
    shift
    printf '\r\033[%dA\033[J' $((UI_DRAWN + extra))
    ui_draw "$@"
}

# Animates the mark of a row `up` lines above the cursor, at column `col`,
# while the foreground work runs with its output sent elsewhere.
ui_spin_start() {
    local up="$1" col="$2"
    [ "$UI_MODE" = plain ] && return 0
    (
        trap 'exit 0' TERM
        i=0
        while :; do
            printf '\0337\033[%dA\r\033[%dC%s\0338' "$up" "$col" "$(ui_mark run "$i")"
            i=$(((i + 1) % ${#G_SPIN[@]}))
            sleep 0.1
        done
    ) &
    UI_SPIN_PID=$!
}

ui_spin_stop() {
    [ -n "${UI_SPIN_PID:-}" ] || return 0
    kill "$UI_SPIN_PID" 2>/dev/null || true
    wait "$UI_SPIN_PID" 2>/dev/null || true
    UI_SPIN_PID=''
}

ui_cursor() { [ "$UI_MODE" = plain ] || { [ "$1" = hide ] && printf '\033[?25l' || printf '\033[?25h'; }; }

# A fatal error: what stopped, then the tail of the log when there is one.
ui_fail_panel() {
    local title="$1" message="$2" log="${3:-}" f="$C_ERR" line
    printf '\n'
    ui_box_top "${C_ERR}${G_ERR}${C_OFF}${C_BOLD} ${title}" '' "$f"
    ui_box_blank "$f"
    while IFS= read -r line; do ui_box_line "$line" "$f"; done < <(ui_wrap "$message" $((UI_IW - 3)))
    if [ -n "$log" ] && [ -s "$log" ]; then
        ui_box_blank "$f"
        while IFS= read -r line; do
            ui_box_line "${C_DIM}$(ui_fit "$line" $((UI_IW - 3)))${C_OFF}" "$f"
        done < <(tail -n 6 "$log")
        ui_box_blank "$f"
        ui_box_line "${C_DIM}Full log:${C_OFF} ${log}" "$f"
    fi
    ui_box_bottom '' "$f"
}
# <<< installer-ui

install_path="${DEFAULT_PATH}"
config_repo_path="${DEFAULT_CONFIG_REPO_PATH}"
assume_yes=0
dry_run=0

config_dir=''
printer_cfg=''
moonraker_conf=''
did_actions=()
skipped_actions=()

say() { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s%s\n' "$C_DIM" "$C_OFF" "$C_BOLD" "$*" "$C_OFF"; }
warn() { printf '%s!%s  %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die() {
    if [ "$UI_MODE" = plain ]; then
        printf '%serror:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2
    else
        ui_fail_panel 'Uninstall stopped' "$*" >&2
    fi
    exit 1
}

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
  --plain                 Print one line per step, without panels or colour
  --dry-run               Print what would happen and change nothing
  -h, --help              This message
USAGE
}

UI_FORCE_PLAIN=0
for arg in "$@"; do [ "$arg" = --plain ] && UI_FORCE_PLAIN=1; done
ui_init

while [ $# -gt 0 ]; do
    case "$1" in
        --path) install_path="${2:?--path needs a directory}"; shift 2 ;;
        --config-repo-path) config_repo_path="${2:?--config-repo-path needs a directory}"; shift 2 ;;
        --yes|-y) assume_yes=1; shift ;;
        --dry-run) dry_run=1; shift ;;
        --plain) shift ;;
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

removals=("${install_path}")
[ -n "$printer_cfg" ] && removals+=("the [include alabaster.cfg] line in ${printer_cfg}, if present")
[ -n "$config_dir" ] && removals+=("${config_dir}/alabaster.cfg, if you say so")
[ -n "$config_dir" ] && removals+=("${config_dir}/alabaster-user.cfg, if you say so")
removals+=("${config_repo_path}, if you say so")
[ -n "$moonraker_conf" ] && removals+=("the [update_manager] blocks for Alabaster and its macro pack in ${moonraker_conf}, if present")
removals+=('the nginx site, if present')

if [ "$UI_MODE" = plain ]; then
    step 'What this will remove'
    for entry in "${removals[@]}"; do say "  ${entry}"; done
else
    installed=''
    [ -f "${install_path}/release_info.json" ] \
        && installed="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${install_path}/release_info.json" | head -n1)"
    note=''
    [ "$dry_run" -eq 1 ] && note="${C_WARN}dry run ${G_SEP} nothing will change${C_OFF}"
    ui_banner "Klipper web interface ${G_SEP} uninstaller" "$note"
    ui_box_top 'What this will remove' "${installed}"
    for entry in "${removals[@]}"; do ui_box_para todo "$entry"; done
    ui_box_bottom
fi

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

# Nothing includes it once alabaster.cfg is gone, so keeping it is harmless;
# it defaults to no because it holds the owner's own settings.
if [ -n "$config_dir" ] && [ -f "${config_dir}/alabaster-user.cfg" ]; then
    if ask "Delete ${config_dir}/alabaster-user.cfg? (your macro pack settings)" n; then
        run rm -f "${config_dir}/alabaster-user.cfg"
        did 'alabaster-user.cfg deleted'
    else
        skipped 'alabaster-user.cfg kept'
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

if [ "$UI_MODE" = plain ]; then
    step 'Done'
    for entry in "${did_actions[@]}"; do say "  done     ${entry}"; done
    for entry in "${skipped_actions[@]}"; do say "  skipped  ${entry}"; done
    say ''
    say 'Restart Klipper if the configuration changed.'
else
    printf '\n'
    title="${C_OK}${G_OK}${C_OFF}${C_BOLD} Alabaster is uninstalled"
    [ "$dry_run" -eq 1 ] && title='Dry run finished, nothing was changed'
    ui_box_top "$title" ''
    for entry in "${did_actions[@]}"; do ui_box_para ok "$entry"; done
    for entry in "${skipped_actions[@]}"; do ui_box_para skip "$entry"; done
    ui_box_rule
    ui_box_line 'Restart Klipper if the configuration changed.'
    ui_box_bottom
fi
