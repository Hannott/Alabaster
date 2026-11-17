#!/usr/bin/env bash
#
# Alabaster installer.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hannott/Alabaster/main/scripts/install.sh)"
#
# Safe to run again: it installs over an existing copy, leaves your own
# configuration alone, and asks before every change it makes outside its own
# directory. Every question is asked before the first change is made.

set -euo pipefail

REPO='Hannott/Alabaster'
CONFIG_REPO_ORIGIN="https://github.com/${REPO}.git"
DEFAULT_PATH="${HOME}/alabaster"
DEFAULT_CONFIG_REPO_PATH="${HOME}/alabaster-config"
DEFAULT_PORT='8090'
DEFAULT_MOONRAKER='127.0.0.1:7125'

# The macros this pack defines. Another interface's macro pack defines the same
# names, and Klipper merges a second definition into the first without a word,
# the one included last winning — a silent half-and-half of two packs, which is
# worse than an error. So these are what the conflict scan looks for. Matched by macro name rather than by
# filename so a renamed or hand-written pack is caught just the same.
CONFLICT_MACROS='PAUSE RESUME CANCEL_PRINT SET_PAUSE_AT_LAYER SET_PAUSE_NEXT_LAYER SET_PRINT_STATS_INFO'
# Config sections it declares, which collide the same way.
CONFLICT_SECTIONS='pause_resume display_status respond exclude_object virtual_sdcard'

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
version=''
from_zip=''
port="${DEFAULT_PORT}"
port_given=0
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
warnings=()
# Global rather than local to main, because the EXIT trap that cleans it up
# runs after main has returned and would otherwise see an unset variable.
work=''
log=''
keep_log=0
# Set by install_release, read by ensure_config_repo — the macro pack clones
# the exact tag the app itself just installed, so the two can never disagree
# about which version they are.
installed_version=''

# What preflight found, and what the plan decided. Every decision is made
# before the first change, so the run itself never stops to ask.
host_name=''
host_model=''
host_arch=''
include_count=0
klipper_state=''
moonraker_version=''
moonraker_answers=0
nginx_present=0
nginx_site=''
nginx_site_exists=0
other_site=''
current_version=''
target_version=''
link_state='none'
link_current=''
include_present=0
conflicts=''
um_app=0
um_pack=0
download_size=''
checksum_state=''
do_pack=0
replace_link=0
do_include=0
do_nginx=0
do_updates=0
changed_klipper=0
changed_moonraker=0
banner_shown=0
RESTART_LINE=''
RESTART_ASK=0

# --------------------------------------------------------------------------
# Output and prompts
# --------------------------------------------------------------------------

say() { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s%s\n' "$C_DIM" "$C_OFF" "$C_BOLD" "$*" "$C_OFF"; }
warn() {
    warnings+=("$*")
    printf '%s!%s  %s\n' "$C_WARN" "$C_OFF" "$*" >&2
}

# In a terminal the failure is a panel on the terminal itself (fd 4), since a
# running step has its own output sent to the log.
die() {
    ui_spin_stop
    if [ "$UI_MODE" = plain ]; then
        printf '%serror:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2
    else
        local tail_log=''
        if [ -n "$log" ] && [ -s "$log" ]; then
            tail_log="$log"
            keep_log=1
        fi
        ui_fail_panel 'Installation stopped' "$*" "$tail_log" >&4
        ui_cursor show >&4
    fi
    exit 1
}

did() { did_actions+=("$1"); }
skipped() { skipped_actions+=("$1"); }

# shellcheck disable=SC2088
home_path() {
    local p="$1"
    case "$p" in
        "$HOME") p='~' ;;
        "$HOME"/*) p="~/${p#"$HOME"/}" ;;
    esac
    printf '%s' "$p"
}

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

interactive() { [ "$assume_yes" -eq 0 ] && [ -r /dev/tty ]; }

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
  --port PORT             Port for the nginx site (default: 8090)
  --moonraker HOST:PORT   Moonraker's address for the proxy (default: 127.0.0.1:7125)
  --yes                   Do not prompt; take each prompt's default. Defaults
                          never overwrite a file you have edited.
  --no-config             Do not offer to install alabaster.cfg
  --no-include            Do not offer to add the include to printer.cfg
  --no-nginx              Do not offer to configure nginx
  --no-update-manager     Do not offer to add update entries to moonraker.conf
  --plain                 Print one line per step, without panels or colour
  --dry-run               Print what would happen and change nothing
  -h, --help              This message
USAGE
}

# --------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------

UI_FORCE_PLAIN=0
for arg in "$@"; do [ "$arg" = --plain ] && UI_FORCE_PLAIN=1; done
ui_init
exec 4>&2

while [ $# -gt 0 ]; do
    case "$1" in
        --path) install_path="${2:?--path needs a directory}"; shift 2 ;;
        --config-repo-path) config_repo_path="${2:?--config-repo-path needs a directory}"; shift 2 ;;
        --version) version="${2:?--version needs a tag}"; shift 2 ;;
        --from-zip) from_zip="${2:?--from-zip needs a file}"; shift 2 ;;
        --port) port="${2:?--port needs a port}"; port_given=1; shift 2 ;;
        --moonraker) moonraker_address="${2:?--moonraker needs host:port}"; shift 2 ;;
        --yes|-y) assume_yes=1; shift ;;
        --no-config) want_config=0; shift ;;
        --no-include) want_include=0; shift ;;
        --no-nginx) want_nginx=0; shift ;;
        --no-update-manager) want_update_manager=0; shift ;;
        --plain) shift ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------

# The checks that stop the run outright, before anything is shown or fetched.
preflight_checks() {
    [ "$(id -u)" -ne 0 ] || die 'Run this as the user that owns Klipper, not as root. It uses sudo only where it has to.'

    local missing=''
    # git clones the macro pack's own tracked copy — see ensure_config_repo.
    # Klipper and Moonraker both already depend on it being present, so this
    # is a safe floor rather than a new burden.
    for tool in curl unzip git; do
        command -v "$tool" >/dev/null 2>&1 || missing="${missing} ${tool}"
    done
    [ -z "$missing" ] || die "Missing required tools:${missing}"

    # Moonraker refuses to manage a client directory that sits inside a git
    # repository, so an install there would work once and never update.
    if git -C "$(dirname "$install_path")" rev-parse --git-dir >/dev/null 2>&1; then
        die "${install_path} is inside a git repository. Moonraker cannot manage updates there — choose another --path."
    fi
}

moonraker_get() { curl -fsS --max-time 3 "http://${moonraker_address}$1" 2>/dev/null; }

# Empty when Moonraker or Klipper does not answer.
printer_state() {
    moonraker_get '/printer/objects/query?print_stats' \
        | sed -n 's/.*"state"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 || true
}

# Earlier installers wrote the site 0600 and owned by root, so it may only be
# readable through sudo; -n keeps that from ever stopping to ask for a password.
read_site() {
    if [ -r "$nginx_site" ]; then
        cat "$nginx_site"
    else
        sudo -n cat "$nginx_site" 2>/dev/null || true
    fi
}

nginx_site_path() {
    if [ -d /etc/nginx/sites-available ]; then
        printf '%s' '/etc/nginx/sites-available/alabaster'
    else
        printf '%s' '/etc/nginx/conf.d/alabaster.conf'
    fi
}

# The first other site nginx serves, as "<folder> on port <n>", so the owner
# can see before installing that something else already lives on this host.
find_other_site() {
    local f root listen
    for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
        [ -f "$f" ] && [ -r "$f" ] || continue
        case "$(basename "$f")" in alabaster | alabaster.conf) continue ;; esac
        root="$(sed -n 's/^[[:space:]]*root[[:space:]]\{1,\}\([^;]*\);.*/\1/p' "$f" | head -n1)"
        listen="$(grep -m 1 -oE '^[[:space:]]*listen[[:space:]]+[0-9]+' "$f" | grep -oE '[0-9]+$' || true)"
        if [ -n "$root" ]; then
            printf '%s' "$(home_path "$root")${listen:+ on port ${listen}}"
            return 0
        fi
    done
}

resolve_target_version() {
    if [ -n "$from_zip" ]; then
        [ -f "$from_zip" ] && unzip -p "$from_zip" release_info.json 2>/dev/null \
            | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 || true
    elif [ -n "$version" ]; then
        printf '%s' "$version"
    else
        local url
        url="$(curl -fsSIL -o /dev/null -w '%{url_effective}' --max-time 10 "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)"
        case "$url" in */tag/*) printf '%s' "${url##*/tag/}" ;; esac
    fi
}

detect() {
    host_name="$(hostname 2>/dev/null || printf 'printer')"
    if [ -r /proc/device-tree/model ]; then
        host_model="$(tr -d '\000' < /proc/device-tree/model | sed 's/ Rev .*//')"
    fi
    host_arch="$(uname -m 2>/dev/null || true)"

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
    fi
    if [ -n "$printer_cfg" ]; then
        SEEN_CONFIGS=''
        include_count=$(($(collect_configs "$printer_cfg" | wc -l) - 1))
    fi

    if command -v systemctl >/dev/null 2>&1; then
        case "$(systemctl is-active klipper 2>/dev/null || true)" in
            active) klipper_state='running' ;;
            inactive | failed) klipper_state='stopped' ;;
        esac
    fi

    local info
    if info="$(moonraker_get /server/info)"; then
        moonraker_answers=1
        moonraker_version="$(printf '%s' "$info" | sed -n 's/.*"moonraker_version"[[:space:]]*:[[:space:]]*"\([^"-]*\).*/\1/p' | head -n1)"
    fi

    if command -v nginx >/dev/null 2>&1; then
        nginx_present=1
        nginx_site="$(nginx_site_path)"
        [ -f "$nginx_site" ] && nginx_site_exists=1
        other_site="$(find_other_site || true)"
    fi
    # A reinstall keeps the port the existing site already listens on, so the
    # address people have bookmarked survives a change to the default.
    if [ "$nginx_site_exists" -eq 1 ] && [ "$port_given" -eq 0 ]; then
        local existing_port
        existing_port="$(read_site | grep -m 1 -oE '^[[:space:]]*listen[[:space:]]+[0-9]+' | grep -oE '[0-9]+$' || true)"
        [ -n "$existing_port" ] && port="$existing_port"
    fi

    if [ -f "${install_path}/release_info.json" ]; then
        current_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${install_path}/release_info.json" | head -n1)"
    fi
    target_version="$(resolve_target_version)"

    if [ -n "$config_dir" ]; then
        local target="${config_dir}/alabaster.cfg"
        if [ -L "$target" ]; then
            link_current="$(readlink "$target")"
            [ "$link_current" = "${config_repo_path}/klipper/alabaster.cfg" ] && link_state='ours' || link_state='elsewhere'
        elif [ -f "$target" ]; then
            link_state='plain'
        fi
    fi

    if [ -n "$printer_cfg" ]; then
        grep -qE '^[[:space:]]*\[include[[:space:]]+alabaster\.cfg\]' "$printer_cfg" && include_present=1
        [ "$include_present" -eq 0 ] && conflicts="$(scan_for_conflicts)"
    fi

    if [ -n "$moonraker_conf" ]; then
        grep -qE '^[[:space:]]*\[update_manager[[:space:]]+alabaster\]' "$moonraker_conf" && um_app=1
        grep -qE '^[[:space:]]*\[update_manager[[:space:]]+alabaster-config\]' "$moonraker_conf" && um_pack=1
    fi
    return 0
}

show_banner() {
    local note=''
    [ "$dry_run" -eq 1 ] && note="${C_WARN}dry run ${G_SEP} nothing will change${C_OFF}"
    ui_banner "Klipper web interface ${G_SEP} installer" "$note"
    banner_shown=1
}

show_machine() {
    if [ "$UI_MODE" = plain ]; then
        step 'Checking this machine'
        if [ -n "$config_dir" ]; then
            say "Config directory:  ${config_dir}"
            say "printer.cfg:       ${printer_cfg:-not found}"
            say "moonraker.conf:    ${moonraker_conf:-not found}"
        else
            warn 'No Klipper config directory found. The macro pack and update manager steps will be skipped.'
        fi
        say "Install path:      ${install_path}"
        return 0
    fi

    local right="$host_name"
    [ -n "$host_model" ] && right+=" ${G_SEP} ${host_model}"
    [ -n "$host_arch" ] && right+=" ${G_SEP} ${host_arch}"

    [ "$banner_shown" -eq 1 ] || show_banner
    ui_box_top 'This machine' "$right"

    local klipper_dir=''
    [ -d "${HOME}/klipper" ] && klipper_dir="$(home_path "${HOME}/klipper")"
    case "$klipper_state" in
        running) ui_status_row ok 'Klipper' 'running' "$klipper_dir" ;;
        stopped) ui_status_row warn 'Klipper' 'stopped' "$klipper_dir" ;;
        *) ui_status_row todo 'Klipper' 'no service' "$klipper_dir" ;;
    esac
    if [ "$moonraker_answers" -eq 1 ]; then
        ui_status_row ok 'Moonraker' 'answering' "${moonraker_address}${moonraker_version:+ ${G_SEP} ${moonraker_version}}"
    else
        ui_status_row warn 'Moonraker' 'not answering' "$moonraker_address"
    fi
    if [ "$nginx_present" -eq 1 ]; then
        ui_status_row ok 'nginx' 'installed' "${other_site:+also serves ${other_site}}"
    else
        ui_status_row todo 'nginx' 'not installed' 'serve the folder with your own web server'
    fi
    if [ -n "$config_dir" ]; then
        ui_status_row ok 'Config folder' 'found' "$(home_path "$config_dir")"
        if [ -n "$printer_cfg" ]; then
            local inc="${include_count} included files"
            [ "$include_count" -eq 1 ] && inc='1 included file'
            [ "$include_count" -eq 0 ] && inc=''
            ui_status_row ok 'printer.cfg' 'found' "$inc"
        else
            ui_status_row warn 'printer.cfg' 'not found' ''
        fi
        if [ -n "$moonraker_conf" ]; then
            ui_status_row ok 'moonraker.conf' 'found' ''
        else
            ui_status_row warn 'moonraker.conf' 'not found' ''
        fi
    else
        ui_status_row warn 'Config folder' 'not found' 'the macro pack and updates are skipped'
    fi
    if [ -n "$current_version" ]; then
        local newer=''
        [ -n "$target_version" ] && [ "$target_version" != "$current_version" ] && newer="${target_version} available"
        ui_status_row ok 'Alabaster' "$current_version" "${newer:-$(home_path "$install_path")}"
    else
        ui_status_row todo 'Alabaster' 'not installed' "${target_version:+newest release is ${target_version}}"
    fi
    ui_box_bottom
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
        checksum_state='local file'
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
            checksum_state='checksum verified'
        else
            warn 'No published checksum for this release; skipping verification.'
            checksum_state='no published checksum'
        fi
    else
        warn 'sha256sum not found; the download cannot be verified.'
        checksum_state='not verified'
    fi
}

# Downloads before the plan, so the plan can show the exact version and a
# failed download stops the run before a single question is asked.
download() {
    if [ "$UI_MODE" = plain ]; then
        fetch_release "$work"
        return 0
    fi
    local what="${target_version:-the newest release}"
    printf '  %s  Downloading %s\n' "$(ui_mark run 0)" "$what"
    ui_spin_start 1 2
    fetch_release "$work" >>"$log" 2>&1
    ui_spin_stop
    local bytes
    bytes="$(wc -c < "${work}/alabaster.zip" | tr -d ' ')"
    download_size="$(awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b / 1048576 }')"
    local mark=ok
    [ "$checksum_state" = 'checksum verified' ] || [ "$checksum_state" = 'local file' ] || mark=warn
    printf '\r\033[1A\033[J  %s  Downloaded %s %s %s %s %s\n' "$(ui_mark "$mark")" "$what" "$G_SEP" "$download_size" "$G_SEP" "$checksum_state"
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

    did "Alabaster ${installed_version} installed to $(home_path "$install_path")"
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
    # Greedy to the last ], as Klipper's own section header is: a pattern
    # such as alabaster.cfg's alabaster-user.cf[g] has a ] of its own.
    done < <(sed -n 's/^[[:space:]]*\[include[[:space:]]\+\(.*\)\].*/\1/p' "$file")
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

conflict_names() { printf '%s' "$conflicts" | awk 'NF { print $1 }' | awk '!seen[$0]++' | paste -sd, - | sed 's/,/, /g'; }

conflict_files() {
    printf '%s' "$conflicts" | while IFS= read -r line; do
        [ -n "$line" ] && basename "${line##*  in }"
    done | awk '!seen[$0]++' | paste -sd, - | sed 's/,/, /g'
}


# Clones (once), or repairs a clone an earlier installer left in a shape
# Moonraker cannot update; Moonraker's own `alabaster-config` update_manager
# entry is what keeps it current after this. Pinned to the version just
# installed, so the macro pack can never disagree with the app about which
# release it came from — the exact drift a separately-versioned config
# repository would risk.
#
# **The shape is Moonraker's, not git's default.** A `git_repo` entry needs the
# primary branch checked out, `branch.main.remote` set, and `origin/main`
# fetched: its validity check refuses a detached HEAD, and its recovery looks
# the remote up by branch name. Earlier installers cloned the release tag with
# `--depth 1 --branch <tag>`, which gives none of the three — a detached HEAD,
# no `main`, and a fetch refspec naming only that tag — so every such install
# showed "needs attention" and recovery failed with "Failed to find remote for
# primary branch 'main'". So the clone takes `main`, and `main` is then moved
# back to the installed release's commit: the same state Moonraker's own stable
# channel leaves after an update.
#
# Partial and sparse — only `klipper/`, and blobs only for what is checked out
# — rather than shallow, since a shallow clone has no tags for the stable
# channel to compare against. Falls back to a plain clone on a git too old for
# that. Returns non-zero only when no clone could be made at all (typically no
# network), so the caller can fall back further, to the plain copy this
# release also carries for exactly that case.
ensure_config_repo() {
    if [ -d "${config_repo_path}/.git" ]; then
        repair_config_repo
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
    if git clone --filter=blob:none --sparse --branch main "$CONFIG_REPO_ORIGIN" "$config_repo_path" 2>/dev/null \
        && git -C "$config_repo_path" sparse-checkout set klipper 2>/dev/null; then
        pin_config_repo
        return 0
    fi

    rm -rf "$config_repo_path"
    if git clone --branch main "$CONFIG_REPO_ORIGIN" "$config_repo_path" 2>/dev/null; then
        warn 'Cloned the full repository rather than just klipper/; an older git here does not support partial clones.'
        pin_config_repo
        return 0
    fi

    rm -rf "$config_repo_path"
    warn 'Could not clone the macro pack repository. Check your network, then re-run this installer to add it.'
    return 1
}

# Moves `main` to the installed release. A release that is not on `main` yet
# leaves it at `main`'s head rather than failing the install.
pin_config_repo() {
    [ -n "$installed_version" ] || return 0
    git -C "$config_repo_path" reset -q --hard "$installed_version" 2>/dev/null \
        || warn "Release ${installed_version} was not found in the macro pack repository; it is at the latest commit instead."
}

# Converts a clone an earlier installer made — a detached HEAD on a shallow,
# single-tag clone — into the shape described above ensure_config_repo,
# keeping the commit it is on and any edits to alabaster.cfg. A clone already
# on a branch with a remote is left alone.
repair_config_repo() {
    local repo="$config_repo_path"
    if git -C "$repo" symbolic-ref -q HEAD >/dev/null 2>&1 \
        && git -C "$repo" config "branch.main.remote" >/dev/null 2>&1; then
        return 0
    fi

    if [ "$dry_run" -eq 1 ]; then
        printf '%s(dry run)%s would repair %s so Moonraker can update it\n' "$C_DIM" "$C_OFF" "$repo"
        return 0
    fi

    say 'Repairing the macro pack repository so Moonraker can update it...'
    git -C "$repo" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
    local fetched=0
    if [ -f "$repo/.git/shallow" ]; then
        git -C "$repo" fetch -q --tags --unshallow origin 2>/dev/null && fetched=1
    else
        git -C "$repo" fetch -q --tags origin 2>/dev/null && fetched=1
    fi
    if [ "$fetched" -eq 0 ] || ! git -C "$repo" rev-parse -q --verify origin/main >/dev/null; then
        warn 'Could not fetch the macro pack repository, so it was not repaired. Check your network, then re-run this installer.'
        return 0
    fi

    # `checkout -B` keeps the current commit and the working tree, edits included.
    git -C "$repo" checkout -q -B main HEAD
    git -C "$repo" branch -q --set-upstream-to=origin/main main
    did "Repaired $(home_path "$repo") so Moonraker can update it"
}


# Puts alabaster.cfg where printer.cfg's [include] expects it, as a symlink
# into the clone rather than a copy, so the update manager's updates reach
# it. Moonraker reserves the paths of the repositories it updates, which
# makes the file read-only through its API; settings go in alabaster-user.cfg
# instead (install_user_settings).
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
        # Replacing a link that points somewhere else was decided on the plan.
        if [ "$replace_link" -ne 1 ]; then
            skipped "alabaster.cfg still links to ${current}"
            return 0
        fi
        run rm -f "$target"
    elif [ -f "$target" ]; then
        # A plain file here is an install from before the macro pack was
        # git-tracked. Backed up rather than replaced silently: any edits to
        # its _ALABASTER settings do not carry forward automatically — there
        # is no safe way to merge them into the new copy.
        warn "${target} is a plain file from an earlier install. Backing it up — reapply any of your own settings in alabaster-user.cfg."
        run cp "$target" "${target}.pre-git-migration"
        run rm -f "$target"
    fi

    run ln -s "$repo_file" "$target"
    local tag
    tag="$(git -C "$config_repo_path" describe --tags --exact-match 2>/dev/null || true)"
    did "Macro pack linked${tag:+, pinned to ${tag}}"
    # Klipper only reads the pack through the include; add_include sets this
    # when it adds one.
    if [ "$include_present" -eq 1 ]; then changed_klipper=1; fi
}

# Copies the file that shipped inside this release, exactly as earlier
# versions of this installer always did. Used only when the git clone above
# could not be made — offline, or an unreachable network — so the macro pack
# still installs, just without an update_manager entry of its own until the
# clone can be retried. An existing file is never replaced on this path: the
# question it would need cannot be predicted before the run, and the run
# does not stop to ask.
copy_macro_pack_plain() {
    local source="$1" target="${config_dir}/alabaster.cfg"

    if [ -L "$target" ]; then
        did 'alabaster.cfg already links to the macro pack repository; leaving it as is'
        return 0
    fi

    if [ -f "$target" ]; then
        run cp "$source" "${target}.new"
        did "New version written to ${target}.new; your alabaster.cfg was left alone"
    else
        run cp "$source" "$target"
        did "alabaster.cfg installed to ${target}"
        if [ "$include_present" -eq 1 ]; then changed_klipper=1; fi
    fi
}

install_macro_pack() {
    local fallback_source="$1"

    step 'Macro pack'

    if ensure_config_repo && link_macro_pack; then
        install_user_settings "$(dirname "$fallback_source")/alabaster-user.cfg"
        return 0
    fi

    warn 'Falling back to the copy included in this release; it will not update on its own.'
    copy_macro_pack_plain "$fallback_source"
    install_user_settings "$(dirname "$fallback_source")/alabaster-user.cfg"
}

# The owner's own file for the pack's settings, created once and never
# replaced: it holds the only edits the pack expects, so an update or a
# re-run that overwrote it would silently undo them. A plain copy, not a
# link, so Moonraker treats it as an ordinary editable config file.
install_user_settings() {
    local source="$1" target="${config_dir}/alabaster-user.cfg"

    if [ -e "$target" ]; then
        did 'alabaster-user.cfg already exists; your settings were left alone'
        return 0
    fi
    if [ ! -f "$source" ]; then
        warn "${source} was not found; alabaster-user.cfg was not created. The pack runs on its defaults."
        return 0
    fi
    run cp "$source" "$target"
    did 'alabaster-user.cfg created for your own pack settings'
}

add_include() {
    local found backup

    step 'Klipper configuration'

    if grep -qE '^[[:space:]]*\[include[[:space:]]+alabaster\.cfg\]' "$printer_cfg"; then
        did 'printer.cfg already includes alabaster.cfg'
        return 0
    fi

    # Scanned again, although the plan already did: the include must never
    # be written next to a definition it would silently merge with.
    say 'Checking printer.cfg for macros that would collide...'
    found="$(scan_for_conflicts)"
    if [ -n "$found" ]; then
        warn 'Your configuration already defines things alabaster.cfg defines:'
        printf '%s\n' "$found" >&2
        skipped 'include not added — conflicting definitions found'
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
    did "include added to printer.cfg (backup at $(home_path "$backup"))"
    changed_klipper=1
}

# The conflict found at preflight, explained once: in the plain output when
# the plan is asked, and as a skipped line in every summary.
explain_conflicts() {
    warn 'Your configuration already defines things alabaster.cfg defines:'
    printf '%s\n' "$conflicts" >&2
    warn 'Klipper would let one silently replace the other, so the include will NOT be added.'
    say ''
    say 'Most likely another Klipper web interface ships a macro pack you already'
    say 'include. Use one pack or the other: remove that include, then add'
    say '  [include alabaster.cfg]'
    say "to the top of ${printer_cfg} yourself."
}

# --------------------------------------------------------------------------
# nginx and Moonraker
# --------------------------------------------------------------------------

crowsnest_port() { case "$1" in 8080 | 8081 | 8082 | 8083) return 0 ;; esac; return 1; }

configure_nginx() {
    local template="$1" rendered

    step 'Web server'

    # crowsnest serves its cameras on 8080 to 8083, and this site proxies
    # `/webcam/` to `/webcam4/` onto exactly those ports.
    if crowsnest_port "$port"; then
        warn "Port ${port} is also a crowsnest camera port. Use --port to pick another if that camera does not show."
    fi

    rendered="$(mktemp)"
    sed -e "s|__PORT__|${port}|g" \
        -e "s|__ROOT__|${install_path}|g" \
        -e "s|__MOONRAKER__|${moonraker_address}|g" \
        "$template" > "$rendered"

    # Mode set explicitly: mktemp creates the file 0600, and a copy of it
    # would leave the site unreadable to the next run, which reads the port
    # back from it.
    run sudo install -m 644 "$rendered" "$nginx_site"
    rm -f "$rendered"

    if [ -d /etc/nginx/sites-enabled ]; then
        run sudo ln -sf "$nginx_site" /etc/nginx/sites-enabled/alabaster
    fi

    if [ "$dry_run" -eq 0 ]; then
        if sudo nginx -t >/dev/null 2>&1; then
            sudo systemctl reload nginx || warn 'nginx accepted the config but would not reload.'
            did "nginx serves Alabaster on port ${port}"
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
    local have_alabaster=0 have_config=0 config_cloned=0

    step 'Updates through Moonraker'

    grep -qE '^[[:space:]]*\[update_manager[[:space:]]+alabaster\]' "$moonraker_conf" && have_alabaster=1
    [ -d "${config_repo_path}/.git" ] && config_cloned=1
    grep -qE '^[[:space:]]*\[update_manager[[:space:]]+alabaster-config\]' "$moonraker_conf" && have_config=1

    if [ "$have_alabaster" -eq 1 ] && { [ "$have_config" -eq 1 ] || [ "$config_cloned" -eq 0 ]; }; then
        did 'moonraker.conf already tracks what is installed'
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

    local what='the app'
    [ "$config_cloned" -eq 1 ] && what='the app and the macro pack'
    did "Moonraker tracks ${what} (backup at $(home_path "${moonraker_conf}.alabaster-backup"))"
    changed_moonraker=1
}

# --------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------

pack_available() { [ "$want_config" -eq 1 ] && [ -n "$config_dir" ] && [ -f "${work}/contents/klipper/alabaster.cfg" ]; }
include_available() { [ "$want_include" -eq 1 ] && [ -n "$printer_cfg" ] && [ "$include_present" -eq 0 ] && [ -z "$conflicts" ]; }
nginx_available() { [ "$want_nginx" -eq 1 ] && [ "$nginx_present" -eq 1 ] && [ -f "${work}/contents/deploy/nginx/alabaster.conf" ]; }
updates_done() { [ "$um_app" -eq 1 ] && { [ "$um_pack" -eq 1 ] || { [ ! -d "${config_repo_path}/.git" ] && [ "$do_pack" -eq 0 ]; }; }; }
updates_available() { [ "$want_update_manager" -eq 1 ] && [ -n "$moonraker_conf" ] && ! updates_done; }

# Each step's default is the answer the old one-question-at-a-time installer
# gave under --yes: anything that would replace something already there
# starts off, everything else starts on.
plan_defaults() {
    do_pack=0
    if pack_available && [ "$link_state" != elsewhere ]; then do_pack=1; fi
    do_include=0
    if [ "$do_pack" -eq 1 ] && include_available; then do_include=1; fi
    do_nginx=0
    if nginx_available && [ "$nginx_site_exists" -eq 0 ]; then do_nginx=1; fi
    do_updates=0
    if updates_available; then do_updates=1; fi
}

# The same decisions, asked one line at a time, for plain output and for
# --yes (which takes each default without asking).
plan_plain() {
    step 'Choices'
    if pack_available; then
        say 'alabaster.cfg gives Alabaster the macros its own controls call, and'
        say 'parks the nozzle when a print pauses. It is optional, and is tracked'
        say 'as its own git-managed copy so it can update independently of the app.'
        if [ "$link_state" = elsewhere ]; then
            ask "${config_dir}/alabaster.cfg already links elsewhere (${link_current}). Replace it and install alabaster.cfg?" n && do_pack=1 || do_pack=0
        else
            ask 'Install alabaster.cfg?' y && do_pack=1 || do_pack=0
        fi
    fi

    if [ "$do_pack" -eq 1 ] && [ -n "$conflicts" ] && [ "$want_include" -eq 1 ]; then
        explain_conflicts
    elif [ "$do_pack" -eq 1 ] && include_available; then
        ask "Add [include alabaster.cfg] to the top of ${printer_cfg}?" y && do_include=1 || do_include=0
    fi

    if nginx_available; then
        if [ "$nginx_site_exists" -eq 1 ]; then
            ask "${nginx_site} already exists. Replace it with a site on port ${port}?" n && do_nginx=1 || do_nginx=0
        else
            ask "Configure an nginx site serving Alabaster on port ${port}?" y && do_nginx=1 || do_nginx=0
        fi
    fi

    if updates_available; then
        ask 'Let Moonraker manage updates for Alabaster and its macro pack?' y && do_updates=1 || do_updates=0
    fi
}

draw_plan() {
    local static="${1:-0}" right='nothing changes until you press Enter' title='What will happen'
    [ "$static" -eq 1 ] && right=''
    [ "$dry_run" -eq 1 ] && title='What would happen (dry run)'
    ui_box_top "$title" "$right"
    ui_box_blank

    local app_detail
    app_detail="install to $(home_path "$install_path")"
    [ -n "$current_version" ] && app_detail="replace ${current_version} in $(home_path "$install_path")"
    ui_plan_row '' fixed "Alabaster ${installed_version:-${target_version:-}}" "$app_detail"

    local pack_dir
    pack_dir="$(home_path "$config_repo_path")"
    if [ "$want_config" -eq 0 ]; then
        ui_plan_row '' na 'Macro pack' 'turned off by --no-config'
    elif [ -z "$config_dir" ]; then
        ui_plan_row '' na 'Macro pack' 'no Klipper config folder found'
    elif ! pack_available; then
        ui_plan_row '' na 'Macro pack' 'not in this release'
    else
        local s=off detail
        [ "$do_pack" -eq 1 ] && s=on
        case "$link_state" in
            elsewhere)
                if [ "$do_pack" -eq 1 ]; then
                    detail="replace the link to $(home_path "$link_current")"
                else
                    detail="keep alabaster.cfg linked to $(home_path "$link_current")"
                fi
                ;;
            plain) detail="clone to ${pack_dir}, back up the old file" ;;
            *)
                if [ -d "${config_repo_path}/.git" ]; then
                    detail="link ${pack_dir} in, already cloned"
                else
                    detail="clone to ${pack_dir}, link it in"
                fi
                ;;
        esac
        [ "$s" = off ] && [ "$link_state" != elsewhere ] && detail='not installed'
        ui_plan_row 2 "$s" 'Macro pack' "$detail"
    fi

    if [ "$want_include" -eq 0 ]; then
        ui_plan_row '' na 'printer.cfg include' 'turned off by --no-include'
    elif [ -z "$printer_cfg" ]; then
        ui_plan_row '' na 'printer.cfg include' 'no printer.cfg found'
    elif [ "$include_present" -eq 1 ]; then
        ui_plan_row '' present 'printer.cfg include' 'already in printer.cfg'
    elif [ -n "$conflicts" ]; then
        ui_plan_row 3 blocked 'printer.cfg include' "${C_WARN}blocked${C_OFF} $(ui_fit "$(conflict_names)" $((UI_IW - 43)))"
        ui_plan_cont "${C_DIM}$(ui_fit "already defined in $(conflict_files)" $((UI_IW - 32)))${C_OFF}"
    elif [ "$do_pack" -eq 0 ]; then
        ui_plan_row '' na 'printer.cfg include' 'needs the macro pack'
    else
        local s=off detail='not added'
        [ "$do_include" -eq 1 ] && { s=on; detail='add it at the top, with a backup'; }
        ui_plan_row 3 "$s" 'printer.cfg include' "$detail"
    fi

    if [ "$want_nginx" -eq 0 ]; then
        ui_plan_row '' na 'nginx site' 'turned off by --no-nginx'
    elif [ "$nginx_present" -eq 0 ]; then
        ui_plan_row '' na 'nginx site' 'nginx is not installed'
    elif ! nginx_available; then
        ui_plan_row '' na 'nginx site' 'not in this release'
    else
        local s=off detail
        if [ "$do_nginx" -eq 1 ]; then
            s=on
            detail="port ${C_BOLD}${port}${C_OFF} ${C_DIM}${G_SEP} asks for sudo once${C_OFF}"
            [ "$nginx_site_exists" -eq 1 ] && detail="replace the site, port ${C_BOLD}${port}${C_OFF} ${C_DIM}${G_SEP} sudo${C_OFF}"
        elif [ "$nginx_site_exists" -eq 1 ]; then
            detail="keep the existing site on port ${port}"
        else
            detail='not configured'
        fi
        ui_plan_row 4 "$s" 'nginx site' "$detail"
        if [ "$do_nginx" -eq 1 ] && crowsnest_port "$port"; then
            ui_plan_cont "${C_WARN}port ${port} is also a crowsnest camera port${C_OFF}"
        fi
    fi

    if [ "$want_update_manager" -eq 0 ]; then
        ui_plan_row '' na 'Moonraker updates' 'turned off by --no-update-manager'
    elif [ -z "$moonraker_conf" ]; then
        ui_plan_row '' na 'Moonraker updates' 'no moonraker.conf found'
    elif updates_done; then
        ui_plan_row '' present 'Moonraker updates' 'already tracked'
    else
        local what='track the app'
        { [ "$do_pack" -eq 1 ] || [ -d "${config_repo_path}/.git" ]; } && what='track the app and the macro pack'
        if [ "$do_updates" -eq 1 ]; then
            ui_plan_row 5 on 'Moonraker updates' "$what"
        else
            ui_plan_row 5 off 'Moonraker updates' 'not tracked'
        fi
    fi

    ui_box_blank
    if [ "$static" -eq 1 ]; then
        ui_box_bottom
    else
        local hint
        hint="$(ui_key 2-5 toggle)  $(ui_key P port)  $(ui_key Enter install)  $(ui_key Q quit)"
        [ "$dry_run" -eq 1 ] && hint="$(ui_key 2-5 toggle)  $(ui_key P port)  $(ui_key Enter 'dry run')  $(ui_key Q quit)"
        ui_box_bottom "$hint"
    fi
}

toggle() {
    case "$1" in
        2)
            pack_available || return 0
            do_pack=$((1 - do_pack))
            do_include=0
            if [ "$do_pack" -eq 1 ] && include_available; then do_include=1; fi
            ;;
        3) [ "$do_pack" -eq 1 ] && include_available && do_include=$((1 - do_include)) ;;
        4) nginx_available && do_nginx=$((1 - do_nginx)) ;;
        5) updates_available && do_updates=$((1 - do_updates)) ;;
    esac
    return 0
}

plan_interactive() {
    local key extra=0 reply
    printf '\n'
    ui_draw draw_plan 0
    while :; do
        printf '  %s%s%s ' "$C_SKY" "$G_PROMPT" "$C_OFF"
        IFS= read -rsn1 key < /dev/tty || key=q
        case "$key" in
            '') break ;;
            q | Q)
                printf '\n'
                say 'Nothing was changed.'
                exit 0
                ;;
            p | P)
                printf '\r\033[K  Port %s[%s]%s %s%s%s ' "$C_DIM" "$port" "$C_OFF" "$C_SKY" "$G_PROMPT" "$C_OFF"
                read -r reply < /dev/tty || reply=''
                extra=1
                if [[ "$reply" =~ ^[0-9]+$ ]] && ((reply > 0 && reply < 65536)); then
                    port="$reply"
                    port_given=1
                fi
                ;;
            $'\033') read -rsn2 -t 0.05 _ < /dev/tty || true ;;
            *) toggle "$key" ;;
        esac
        ui_redraw "$extra" draw_plan 0
        extra=0
    done
    printf '\r\033[K'
}

decide() {
    plan_defaults
    if [ "$UI_MODE" = plain ]; then
        do_pack=0 do_include=0 do_nginx=0 do_updates=0
        plan_plain
    elif interactive; then
        plan_interactive
    else
        # --yes, or no terminal to read from: the plan shows once and runs.
        # Without --yes the old installer skipped every optional step, so
        # this keeps doing so.
        if [ "$assume_yes" -eq 0 ]; then
            do_pack=0 do_include=0 do_nginx=0 do_updates=0
            warn 'Not running interactively and --yes was not given; installing the app only.'
        fi
        printf '\n'
        draw_plan 1
    fi
    [ "$link_state" = elsewhere ] && replace_link=$do_pack

    # Asked now rather than in the middle of the run, so the password prompt
    # never lands inside a panel that is redrawing itself.
    if [ "$do_nginx" -eq 1 ] && [ "$dry_run" -eq 0 ]; then
        [ "$UI_MODE" = plain ] || say "  nginx needs sudo; enter your password if asked."
        if ! sudo -v; then
            warn 'sudo was refused, so the nginx site will not be configured.'
            do_nginx=0
        fi
    fi
    return 0
}

# --------------------------------------------------------------------------
# Running the plan
# --------------------------------------------------------------------------

P_LABEL=()
P_STATE=()
P_DETAIL=()
P_FN=()

add_row() {
    P_LABEL+=("$1")
    P_STATE+=("$2")
    P_DETAIL+=("$3")
    P_FN+=("${4:-}")
}

draw_progress() {
    local title="Installing Alabaster ${installed_version:-${target_version:-}}"
    [ "$dry_run" -eq 1 ] && title='Dry run'
    ui_box_top "$title" ''
    local i done=0 total=0 state
    for i in "${!P_LABEL[@]}"; do
        state="${P_STATE[i]}"
        local word
        case "$state" in
            ok) word='done' ;;
            warn) word='done' ;;
            skip) word='skipped' ;;
            todo) word='waiting' ;;
            run) word="${C_SKY}working${C_OFF}" ;;
            err) word='failed' ;;
        esac
        ui_status_row "$state" "${P_LABEL[i]}" "$word" "${P_DETAIL[i]}"
        if [ -n "${P_FN[i]}" ] || [ "$i" -eq 0 ]; then
            total=$((total + 1))
            case "$state" in ok | warn) done=$((done + 1)) ;; esac
        fi
    done
    ui_box_blank
    ui_progress_bar "$done" "$total"
    ui_box_bottom
}

# Runs one row's function in this shell — so what it records stays visible
# here — with its own output sent to the log, while the row's mark spins.
run_row() {
    local i="$1" fn="${P_FN[$1]}"
    local before_did=${#did_actions[@]} before_skip=${#skipped_actions[@]} before_warn=${#warnings[@]}

    if [ "$UI_MODE" = plain ]; then
        eval "$fn"
        return 0
    fi

    P_STATE[i]=run
    ui_redraw 0 draw_progress
    ui_spin_start $((UI_DRAWN - 1 - i)) 3
    eval "$fn" >>"$log" 2>&1
    ui_spin_stop

    local state=ok detail=''
    if ((${#did_actions[@]} > before_did)); then
        detail="${did_actions[before_did]}"
    elif ((${#skipped_actions[@]} > before_skip)); then
        state=skip
        detail="${skipped_actions[before_skip]}"
    fi
    if ((${#warnings[@]} > before_warn)); then
        state=warn
        [ -n "$detail" ] || detail="${warnings[before_warn]}"
    fi
    P_STATE[i]=$state
    P_DETAIL[i]="$detail"
    ui_redraw 0 draw_progress
}

execute() {
    local pack_source="${work}/contents/klipper/alabaster.cfg"
    local template="${work}/contents/deploy/nginx/alabaster.conf"
    # Steps with nothing to do are reported after the ones that ran.
    local -a already=()

    add_row 'Download' ok "${download_size:+${download_size} ${G_SEP} }${checksum_state}"
    add_row 'Install' todo '' "install_release '${work}/alabaster.zip'"

    if [ "$do_pack" -eq 1 ]; then
        add_row 'Macro pack' todo '' "install_macro_pack '${pack_source}'"
    elif pack_available; then
        add_row 'Macro pack' skip 'not chosen'
        skipped 'alabaster.cfg not installed'
    else
        add_row 'Macro pack' skip 'not offered'
        skipped 'macro pack not offered'
    fi

    if [ "$do_include" -eq 1 ]; then
        add_row 'Include' todo '' 'add_include'
    elif [ "$include_present" -eq 1 ]; then
        add_row 'Include' ok 'already in printer.cfg'
        already+=('printer.cfg already includes alabaster.cfg')
    elif [ -n "$conflicts" ] && [ "$do_pack" -eq 1 ] && [ "$want_include" -eq 1 ]; then
        add_row 'Include' skip 'blocked by conflicting macros'
        skipped "include not added: $(conflict_files) already defines $(conflict_names). Keep one pack, then add [include alabaster.cfg] yourself."
    elif [ -z "$printer_cfg" ]; then
        add_row 'Include' skip 'no printer.cfg'
        skipped 'no printer.cfg found, include not added'
    elif [ "$do_pack" -eq 1 ]; then
        add_row 'Include' skip 'not chosen'
        skipped 'include not added'
    else
        add_row 'Include' skip 'no macro pack'
    fi

    if [ "$do_nginx" -eq 1 ]; then
        add_row 'nginx site' todo '' "configure_nginx '${template}'"
    elif [ "$want_nginx" -eq 0 ]; then
        add_row 'nginx site' skip 'not offered'
    elif [ "$nginx_present" -eq 0 ]; then
        add_row 'nginx site' skip 'nginx not installed'
        skipped 'nginx not installed, site not configured'
    elif [ "$nginx_site_exists" -eq 1 ]; then
        add_row 'nginx site' skip "kept on port ${port}"
        skipped 'nginx site left unchanged'
    else
        add_row 'nginx site' skip 'not chosen'
        skipped 'nginx site not configured'
    fi

    if [ "$do_updates" -eq 1 ]; then
        add_row 'Moonraker' todo '' 'add_update_manager'
    elif [ "$want_update_manager" -eq 0 ]; then
        add_row 'Moonraker' skip 'not offered'
    elif [ -z "$moonraker_conf" ]; then
        add_row 'Moonraker' skip 'no moonraker.conf'
        skipped 'no moonraker.conf found, update manager not added'
    elif updates_done; then
        add_row 'Moonraker' ok 'already tracks what is installed'
        already+=('moonraker.conf already tracks what is installed')
    else
        add_row 'Moonraker' skip 'not chosen'
        skipped 'update manager not added'
    fi

    if [ "$UI_MODE" != plain ]; then
        ui_cursor hide
        printf '\n'
        ui_draw draw_progress
    fi
    local i entry
    for i in "${!P_FN[@]}"; do
        [ -n "${P_FN[i]}" ] && run_row "$i"
    done
    for entry in "${already[@]}"; do did "$entry"; done
    ui_cursor show
}

# --------------------------------------------------------------------------
# The end
# --------------------------------------------------------------------------

restart_services() {
    local ok=1
    if [ "$changed_klipper" -eq 1 ]; then
        curl -fsS --max-time 10 -X POST "http://${moonraker_address}/printer/restart" >/dev/null 2>&1 || ok=0
    fi
    if [ "$changed_moonraker" -eq 1 ]; then
        curl -fsS --max-time 10 -X POST "http://${moonraker_address}/server/restart" >/dev/null 2>&1 || ok=0
    fi
    [ "$ok" -eq 1 ]
}

restart_what() {
    if [ "$changed_klipper" -eq 1 ] && [ "$changed_moonraker" -eq 1 ]; then
        printf 'Klipper and Moonraker'
    elif [ "$changed_klipper" -eq 1 ]; then
        printf 'Klipper'
    else
        printf 'Moonraker'
    fi
}

# Restarting Klipper ends a print, so the offer is only made when Moonraker
# says no print is running or paused. Never under --yes: an unattended run
# does not restart services it was not asked to.
offer_restart() {
    { [ "$changed_klipper" -eq 1 ] || [ "$changed_moonraker" -eq 1 ]; } || return 0
    [ "$dry_run" -eq 0 ] || return 0
    local what state
    what="$(restart_what)"
    state="$(printer_state)"
    RESTART_LINE=''
    RESTART_ASK=0
    case "$state" in
        printing) RESTART_LINE="A print is running. Restart ${what} after it finishes to load the changes." ;;
        paused) RESTART_LINE="A print is paused. Restart ${what} after it finishes to load the changes." ;;
        '') RESTART_LINE="Restart ${what} to load the changes." ;;
        *)
            if interactive; then
                RESTART_ASK=1
            else
                RESTART_LINE="Restart ${what} to load the changes."
            fi
            ;;
    esac
}

do_restart() {
    if restart_services; then
        say "  $(ui_mark ok)  Restarted $(restart_what)."
    else
        say "  $(ui_mark warn)  Moonraker did not accept the restart. Restart $(restart_what) from the Machine page."
    fi
}

url() { printf 'http://%s.local:%s' "$host_name" "$port"; }

finish_plain() {
    step 'Done'
    for entry in "${did_actions[@]}"; do say "  done     ${entry}"; done
    for entry in "${skipped_actions[@]}"; do say "  skipped  ${entry}"; done

    say ''
    say "Open Alabaster at ${C_BOLD}$(url)${C_OFF}"
    offer_restart
    if [ "$RESTART_ASK" -eq 1 ]; then
        ask "Klipper is idle. Restart $(restart_what) now?" y && do_restart
    elif [ -n "$RESTART_LINE" ]; then
        say "$RESTART_LINE"
    fi
}

draw_done() {
    local title="${C_OK}${G_OK}${C_OFF}${C_BOLD} Alabaster ${installed_version} is installed"
    [ "$dry_run" -eq 1 ] && title='Dry run finished, nothing was changed'
    ui_box_top "$title" ''
    ui_box_blank
    ui_box_line "   Open  ${C_SKY}${C_BOLD}$(url)${C_OFF}"
    ui_box_blank
    ui_box_rule
    local entry
    for entry in "${did_actions[@]}"; do ui_box_para ok "$entry"; done
    for entry in "${warnings[@]}"; do ui_box_para warn "$entry"; done
    for entry in "${skipped_actions[@]}"; do ui_box_para skip "$entry"; done
    if [ "$RESTART_ASK" -eq 1 ] || [ -n "$RESTART_LINE" ]; then
        ui_box_rule
        if [ "$RESTART_ASK" -eq 1 ]; then
            ui_box_line "Restart $(restart_what) to load the changes."
            ui_box_line "${C_DIM}No print is running, so it is safe now.${C_OFF}  Restart now? ${C_BOLD}[Y/n]${C_OFF}"
        else
            ui_box_para none "$RESTART_LINE"
        fi
    fi
    ui_box_bottom
}

finish() {
    if [ "$UI_MODE" = plain ]; then
        finish_plain
        return 0
    fi
    offer_restart
    printf '\n'
    draw_done
    if [ "$RESTART_ASK" -eq 1 ]; then
        local reply
        printf '  %s%s%s ' "$C_SKY" "$G_PROMPT" "$C_OFF"
        read -r reply < /dev/tty || reply=n
        case "${reply:-y}" in [Yy]*) do_restart ;; *) say "  Restart $(restart_what) when it suits you." ;; esac
    fi
}

# --------------------------------------------------------------------------
# Run again on a machine that already has it
# --------------------------------------------------------------------------

menu_status() {
    local name="$1"
    case "$name" in
        app)
            if [ -n "$target_version" ] && [ "$target_version" != "$current_version" ]; then
                printf '%s%s  %s %s%s available%s' "$(ui_pad Alabaster 13)" "$current_version" "$(ui_mark warn)" "$C_WARN" "$target_version" "$C_OFF"
            else
                printf '%s%s  %s newest' "$(ui_pad Alabaster 13)" "$current_version" "$(ui_mark ok)"
            fi
            ;;
        pack)
            local tag=''
            [ -d "${config_repo_path}/.git" ] && tag="$(git -C "$config_repo_path" describe --tags --exact-match 2>/dev/null || true)"
            case "$link_state" in
                ours) printf '%s%s linked%s' "$(ui_pad 'Macro pack' 13)" "$(ui_mark ok)" "${tag:+ ${C_DIM}${G_SEP} pinned ${tag}${C_OFF}}" ;;
                elsewhere) printf '%s%s links elsewhere' "$(ui_pad 'Macro pack' 13)" "$(ui_mark warn)" ;;
                plain) printf '%s%s plain copy' "$(ui_pad 'Macro pack' 13)" "$(ui_mark warn)" ;;
                *) printf '%s%s not installed' "$(ui_pad 'Macro pack' 13)" "$(ui_mark skip)" ;;
            esac
            ;;
        include)
            if [ "$include_present" -eq 1 ]; then
                printf '%s%s in printer.cfg' "$(ui_pad Include 13)" "$(ui_mark ok)"
            else
                printf '%s%s not included' "$(ui_pad Include 13)" "$(ui_mark skip)"
            fi
            ;;
        nginx)
            if [ "$nginx_site_exists" -eq 1 ]; then
                printf '%s%s port %s' "$(ui_pad nginx 13)" "$(ui_mark ok)" "$port"
            else
                printf '%s%s no site' "$(ui_pad nginx 13)" "$(ui_mark skip)"
            fi
            ;;
        updates)
            if [ "$um_app" -eq 1 ] && [ "$um_pack" -eq 1 ]; then
                printf '%s%s Moonraker tracks both' "$(ui_pad Updates 13)" "$(ui_mark ok)"
            elif [ "$um_app" -eq 1 ]; then
                printf '%s%s Moonraker tracks the app' "$(ui_pad Updates 13)" "$(ui_mark ok)"
            else
                printf '%s%s not tracked' "$(ui_pad Updates 13)" "$(ui_mark skip)"
            fi
            ;;
        printer)
            local state
            state="$(printer_state)"
            printf '%s%s%s%s' "$(ui_pad Printer 13)" "$C_DIM" "${state:-not answering}" "$C_OFF"
            ;;
    esac
}

MENU_KEYS=()

# Set outside draw_menu, which ui_draw runs in a subshell.
menu_keys() {
    MENU_KEYS=(1)
    [ "$nginx_site_exists" -eq 1 ] && MENU_KEYS+=(2)
    [ -d "${config_repo_path}/.git" ] && [ -n "$config_dir" ] && MENU_KEYS+=(3)
    [ -f "${install_path}/scripts/uninstall.sh" ] && MENU_KEYS+=(9)
    return 0
}

draw_menu() {
    local -a left=() right=()
    local key
    for key in "${MENU_KEYS[@]}"; do
        case "$key" in
            1)
                if [ -n "$target_version" ] && [ "$target_version" != "$current_version" ]; then
                    left+=("$(ui_key 1 "Update to ${target_version}")")
                else
                    left+=("$(ui_key 1 "Reinstall ${current_version}")")
                fi
                ;;
            2) left+=("$(ui_key 2 'Change port')") ;;
            3) left+=("$(ui_key 3 'Repair macro pack')") ;;
            9) left+=('' "$(ui_key 9 'Uninstall')") ;;
        esac
    done
    right=("$(menu_status app)" "$(menu_status pack)" "$(menu_status include)" "$(menu_status nginx)" "$(menu_status updates)" "$(menu_status printer)")

    local where
    where="$(home_path "$install_path")"
    [ "$nginx_site_exists" -eq 1 ] && where+=" ${G_SEP} port ${port}"
    ui_box_top 'Alabaster is installed here' "$where"
    ui_box_split "$B_LT" "$B_TT" "$B_RT"
    local i n=${#right[@]}
    ((${#left[@]} > n)) && n=${#left[@]}
    for ((i = 0; i < n; i++)); do ui_box_line2 "${left[i]:-}" "${right[i]:-}"; done
    ui_box_split "$B_BL" "$B_BT" "$B_BR"
}

change_port() {
    local reply old="$port"
    printf '  New port %s[%s]%s %s%s%s ' "$C_DIM" "$old" "$C_OFF" "$C_SKY" "$G_PROMPT" "$C_OFF"
    read -r reply < /dev/tty || reply=''
    if ! [[ "$reply" =~ ^[0-9]+$ ]] || ((reply < 1 || reply > 65535)) || [ "$reply" = "$old" ]; then
        say 'Nothing was changed.'
        return 0
    fi
    crowsnest_port "$reply" && warn "Port ${reply} is also a crowsnest camera port."
    [ "$dry_run" -eq 1 ] && { say "(dry run) would move ${nginx_site} from port ${old} to ${reply}"; return 0; }
    say '  nginx needs sudo; enter your password if asked.'
    sudo sed -i -E "s/^([[:space:]]*listen[[:space:]]+(\[::\]:)?)${old}([[:space:];])/\1${reply}\3/" "$nginx_site" \
        || die "Could not rewrite ${nginx_site}."
    if sudo nginx -t >/dev/null 2>&1; then
        sudo systemctl reload nginx || warn 'nginx accepted the config but would not reload.'
        port="$reply"
        say "  $(ui_mark ok)  Alabaster is now at ${C_SKY}${C_BOLD}$(url)${C_OFF}"
    else
        sudo sed -i -E "s/^([[:space:]]*listen[[:space:]]+(\[::\]:)?)${reply}([[:space:];])/\1${old}\3/" "$nginx_site" || true
        die "nginx rejected port ${reply}, so the site was put back on ${old}. Run \"sudo nginx -t\" to see why."
    fi
}

repair_pack() {
    replace_link=0
    repair_config_repo
    link_macro_pack || true
    local entry
    for entry in "${did_actions[@]}"; do say "  $(ui_mark ok)  ${entry}"; done
    for entry in "${skipped_actions[@]}"; do say "  $(ui_mark skip)  ${entry}"; done
    [ ${#did_actions[@]} -gt 0 ] || [ ${#skipped_actions[@]} -gt 0 ] || say "  $(ui_mark ok)  The macro pack is already in the shape Moonraker can update."
}

# Shown only to a person at a terminal re-running the installer with no
# explicit release in mind; --yes, --version and --from-zip keep the old
# behaviour of installing over the top.
menu() {
    [ -n "$current_version" ] || return 0
    [ "$UI_MODE" != plain ] && interactive || return 0
    [ -z "$version" ] && [ -z "$from_zip" ] || return 0

    show_banner
    menu_keys
    ui_draw draw_menu
    local key
    while :; do
        printf '  %s  %s%s%s ' "$(ui_key Q quit)" "$C_SKY" "$G_PROMPT" "$C_OFF"
        IFS= read -rsn1 key < /dev/tty || key=q
        case " ${MENU_KEYS[*]} q Q " in
            *" ${key} "*) break ;;
        esac
        printf '\r\033[K'
    done
    printf '%s\n' "$key"
    case "$key" in
        1) return 0 ;;
        2) change_port ;;
        3) repair_pack ;;
        9) exec bash "${install_path}/scripts/uninstall.sh" --path "$install_path" --config-repo-path "$config_repo_path" ;;
        *) say 'Nothing was changed.' ;;
    esac
    exit 0
}

# --------------------------------------------------------------------------

cleanup() {
    ui_spin_stop
    ui_cursor show
    rm -rf "${work:-}"
    if [ -n "$log" ] && [ "$keep_log" -eq 0 ]; then rm -f "$log"; fi
}

main() {
    preflight_checks
    work="$(mktemp -d)"
    log="$(mktemp "${TMPDIR:-/tmp}/alabaster-install.XXXXXX")"
    trap cleanup EXIT

    detect
    menu
    show_machine

    download
    # Read the pack out of the archive rather than from the internet, so an
    # install is one download and an offline --from-zip install works fully.
    mkdir -p "${work}/contents"
    if [ "$UI_MODE" = plain ]; then
        unzip -q -o "${work}/alabaster.zip" -d "${work}/contents" || die 'The archive could not be read.'
    else
        unzip -q -o "${work}/alabaster.zip" -d "${work}/contents" >>"$log" 2>&1 || die 'The archive could not be read.'
    fi
    installed_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${work}/contents/release_info.json" 2>/dev/null | head -n1 || true)"

    decide
    execute
    finish
}

main "$@"
