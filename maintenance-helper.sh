#!/bin/bash
# Adapt Mole's native review and deletion functions to a structured UI protocol.
# File removal, identity checks and protected-path rules stay inside Mole.
set +x
set -euo pipefail

native_script="$1"
gui_operation="$2"
gui_mode="$3"
gui_token="$4"
gui_preview_file="$5"
gui_purge_path="${6:-}"
[[ "$gui_token" =~ ^[a-f0-9-]{36}$ ]] || exit 64
[[ "$gui_mode" == preview || "$gui_mode" == execute ]] || exit 64
case "$gui_operation" in clean | optimize | purge | installer) ;; *) exit 64 ;; esac
[[ -t 0 && -t 1 ]] || exit 65
stty -echo rows 60 cols 240
export NO_COLOR=1
export MOLE_TEST_MODE=0 MOLE_TEST_NO_AUTH=0 MOLE_PURGE_YES=0
unset MOLE_DRY_RUN MOLE_SKIP_MAIN

# JSON strings are encoded byte for byte, including control characters in paths.
gui_quote() {
    local value="$1" char code i
    printf '"'
    for ((i = 0; i < ${#value}; i++)); do
        char="${value:i:1}"
        case "$char" in
            '"') printf '\\"' ;;
            '\') printf '\\\\' ;;
            $'\n') printf '\\n' ;;
            $'\r') printf '\\r' ;;
            $'\t') printf '\\t' ;;
            *)
                printf -v code '%d' "'$char"
                if ((code >= 0 && code < 32)); then printf '\\u%04x' "$code"; else printf '%s' "$char"; fi
                ;;
        esac
    done
    printf '"'
}

gui_emit() {
    local separator='' field
    printf '\nMOLE_GUI_%s\t[' "$gui_token"
    for field in "$@"; do
        printf '%s' "$separator"
        gui_quote "$field"
        separator=','
    done
    printf ']\n'
}

gui_read() {
    stty -echo
    IFS= read -r GUI_REPLY || exit 130
    stty -echo
}

gui_confirm() {
    gui_emit confirm "$@"
    gui_read
    [[ "$GUI_REPLY" == confirm ]] || exit 130
    gui_emit executing
}

gui_read_selection() {
    local count="$1" index seen=','
    gui_read
    [[ "$GUI_REPLY" =~ ^select:[0-9]+(,[0-9]+)*$ ]] || exit 65
    GUI_SELECTION="${GUI_REPLY#select:}"
    IFS=',' read -r -a GUI_INDICES <<< "$GUI_SELECTION"
    for index in "${GUI_INDICES[@]}"; do
        [[ "$index" =~ ^(0|[1-9][0-9]*)$ && ${#index} -le 5 ]] || exit 65
        ((index < count)) || exit 65
        [[ "$seen" != *",$index,"* ]] || exit 65
        seen+="$index,"
    done
}

# Passwords travel only over the private stdin pipe, with terminal echo off.
# Delegate verification and the sudo session lifecycle to Mole.
gui_request_sudo() {
    local secret rc
    while true; do
        gui_emit auth '管理员权限' '需要 Mac 登录密码，也可以跳过需要管理员权限的步骤。'
        gui_read
        if [[ "$GUI_REPLY" == skip ]]; then
            gui_emit auth_skipped
            return 1
        fi
        [[ "$GUI_REPLY" == password:* ]] || exit 65
        secret="${GUI_REPLY#password:}"
        unset GUI_REPLY
        [[ -n "$secret" && ${#secret} -le 256 ]] || exit 65
        rc=0
        request_sudo_access_with_password "$secret" 'Mole maintenance' || rc=$?
        unset secret
        if [[ "$rc" -eq 0 ]]; then
            gui_emit auth_accepted
            return 0
        fi
        gui_emit auth_rejected '密码验证失败，请重试或跳过管理员步骤。'
    done
}

# Read the outcomes already recorded by Mole, without changing task execution.
gui_optimize_result() {
    local action="$1" outcome="$2" title="$1"
    if declare -F optimize_catalog_health_name_for > /dev/null; then title=$(optimize_catalog_health_name_for "$action"); fi
    gui_emit optimize_result "$action" "$title" "$outcome"
}

gui_emit hello '1' "$gui_operation" "$gui_mode"

case "$gui_operation" in
    clean)
        source "$native_script"
        declare -F main > /dev/null
        declare -F request_sudo_access_with_password > /dev/null
        CLEAN_PREVIEW_FINAL_FILE="$gui_preview_file"
        EXPORT_LIST_FILE="$gui_preview_file"
        request_sudo_access() { gui_request_sudo; }
        prompt_for_system_clean() {
            SYSTEM_CLEAN=false
            if ensure_sudo_session 'System cleanup requires admin access'; then SYSTEM_CLEAN=true; fi
        }
        if [[ "$gui_mode" == execute ]]; then
            gui_confirm 'batch' '0' '0'
            main
        else
            main --dry-run
        fi
        ;;
    optimize)
        # The native script runs main when sourced; its first pass is always read-only.
        source "$native_script" --dry-run
        if declare -F optimize_task_finish > /dev/null && declare -p MOLE_OPTIMIZE_RESULT_ACTIONS MOLE_OPTIMIZE_RESULT_OUTCOMES > /dev/null 2>&1; then
            for ((gui_i = 0; gui_i < ${#MOLE_OPTIMIZE_RESULT_ACTIONS[@]}; gui_i++)); do
                gui_optimize_result "${MOLE_OPTIMIZE_RESULT_ACTIONS[gui_i]}" "${MOLE_OPTIMIZE_RESULT_OUTCOMES[gui_i]}"
            done
            eval "$(declare -f optimize_task_finish | sed '1s/optimize_task_finish/gui_native_optimize_task_finish/')"
            optimize_task_finish() {
                local gui_action="$1" gui_outcome="$MOLE_OPTIMIZE_TASK_OUTCOME"
                gui_native_optimize_task_finish "$@" || return $?
                gui_optimize_result "$gui_action" "$gui_outcome"
            }
        fi
        if [[ "$gui_mode" == execute ]]; then
            declare -F request_sudo_access_with_password > /dev/null
            request_sudo_access() { gui_request_sudo; }
            gui_confirm 'batch' '0' '0'
            unset MOLE_DRY_RUN
            gui_emit reset_steps
            main
        fi
        ;;
    installer)
        # This flag is scoped to loading the library and cleared before any work.
        export MOLE_TEST_MODE=1
        source "$native_script"
        export MOLE_TEST_MODE=0
        for gui_function in collect_installers mole_deletion_identity build_installer_delete_plan execute_installer_delete_plan; do
            declare -F "$gui_function" > /dev/null || exit 65
        done
        gui_scan_rc=0
        collect_installers || gui_scan_rc=$?
        if [[ "$gui_scan_rc" -eq 1 && ${#INSTALLER_PATHS[@]} -eq 0 ]]; then
            gui_emit inventory '0' complete
            exit 0
        elif [[ "$gui_scan_rc" -ne 0 ]]; then
            gui_emit failure installer_scan "$gui_scan_rc" "${INSTALLER_SCAN_FAILURE_PATH:-}"
            exit "$gui_scan_rc"
        fi
        gui_count=${#INSTALLER_PATHS[@]}
        GUI_IDENTITIES=()
        for ((gui_i = 0; gui_i < gui_count; gui_i++)); do
            gui_identity=''
            gui_selectable=true
            if ! gui_identity=$(mole_deletion_identity "${INSTALLER_PATHS[gui_i]}"); then gui_selectable=false; fi
            GUI_IDENTITIES+=("$gui_identity")
            gui_emit item "$gui_i" "${INSTALLER_PATHS[gui_i]}" "${INSTALLER_SIZES[gui_i]}" "${INSTALLER_SOURCES[gui_i]}" '' "$gui_identity" "$gui_selectable"
        done
        gui_emit inventory "$gui_count" complete
        if [[ "$gui_mode" == preview || "$gui_count" -eq 0 ]]; then exit 0; fi
        gui_read_selection "$gui_count"
        reset_installer_delete_results
        build_installer_delete_plan "${GUI_INDICES[@]}"
        [[ ${#INSTALLER_DELETE_PATHS[@]} -eq ${#GUI_INDICES[@]} ]] || exit 65
        gui_total=0
        for ((gui_i = 0; gui_i < ${#GUI_INDICES[@]}; gui_i++)); do
            gui_index="${GUI_INDICES[gui_i]}"
            [[ "${INSTALLER_DELETE_PATHS[gui_i]}" == "${INSTALLER_PATHS[gui_index]}" ]] || exit 65
            [[ "${INSTALLER_DELETE_IDENTITIES[gui_i]}" == "${GUI_IDENTITIES[gui_index]}" ]] || exit 65
            [[ "${INSTALLER_DELETE_SIZES[gui_i]}" == "${INSTALLER_SIZES[gui_index]}" ]] || exit 65
            gui_total=$((gui_total + INSTALLER_DELETE_SIZES[gui_i]))
        done
        gui_confirm "${#GUI_INDICES[@]}" "$gui_total" '0'
        gui_rc=0
        execute_installer_delete_plan || gui_rc=$?
        show_summary
        gui_emit finished "$gui_rc" "$total_deleted" "$total_delete_failed"
        exit "$gui_rc"
        ;;
    purge)
        export MOLE_SKIP_MAIN=1
        source "$native_script"
        unset MOLE_SKIP_MAIN
        declare -F clean_project_artifacts > /dev/null
        [[ -n "$gui_purge_path" && "$gui_purge_path" == /* && -d "$gui_purge_path" ]] || exit 66
        # Scope this run without changing Mole's saved search directories.
        PURGE_SEARCH_PATHS=("$gui_purge_path")
        PURGE_DISCOVERY_STATUS=0
        select_purge_categories() {
            local i count=${#item_paths[@]}
            for ((i = 0; i < count; i++)); do
                local identity="${item_expected_parent_ids[i]}|${item_expected_target_ids[i]}"
                local size=''
                [[ "${item_size_unknown_flags[i]:-false}" == true ]] || size=$((item_sizes[i] * 1024))
                local detail="${item_age_labels[i]:-}"
                [[ "${item_cloud_flags[i]:-false}" != true ]] || detail+=" · 云同步目录"
                gui_emit item "$i" "${item_paths[i]}" "$size" "${item_project_paths[i]}" "$detail" "$identity" true
            done
            gui_emit inventory "$count" "${PURGE_RUN_OUTCOME:-completed}"
            if [[ "$gui_mode" == preview ]]; then return 1; fi
            gui_read_selection "$count"
            PURGE_SELECTION_RESULT="$GUI_SELECTION"
            return 0
        }
        confirm_purge_cleanup() {
            gui_confirm "$1" "$(($2 * 1024))" "$4"
        }
        gui_rc=0
        if [[ "$gui_mode" == preview ]]; then main --dry-run || gui_rc=$?; else main || gui_rc=$?; fi
        gui_emit finished "$gui_rc" "${PURGE_RUN_OUTCOME:-scan_failed}"
        exit "$gui_rc"
        ;;
esac
