#!/bin/bash
# Contract subject: `wechatide-call`.
#
# Read [DevTools CLI contract](../references/cli.md). Use tool `wechatide`.
#
# Usage: call.sh CLIENT OPERATION [FLAG...]
# Runs one delivered DevTools operation. The MCP token comes from the login keychain and is passed only to the
# resolved DevTools CLI; it never reaches this script's output or the caller's arguments. After the checks below,
# the CLI's stdout, stderr and exit status pass through unchanged.
set -euo pipefail

readonly token_service=wechatide-mcp-token
# Delivered operations by entry: initializer, compiler, debugger, previewer, project-manager, automator, then cloudbase-operator. Later entries extend this list with their own delivery.
readonly operations=" check_wechatide_status login polling_task_result open_project_window close_project_window get_user_appids automation_runtime_info quit simulator_open_page simulator_refresh build_npm compile_wxml compile_wxss get_simulator_console get_simulator_network simulator_screenshot automation_wx_api debug_clear_cache auto_preview create_preview_qrcode upload project_list project_import share_minicode import_minicode project_remove automation_navigate automation_element_action automation_page_action automation_viewport_action automation_game_action automation_evaluate automation_testaccount automation_generate_script cloud_env_list cloud_fn_list cloud_fn_info cloud_fn_deploy cloud_fn_inc_deploy cloud_db_read_struct cloud_db_read_doc cloud_db_write_struct cloud_db_write_doc cloud_query_storage cloud_manage_storage cloud_query_msg_push cloud_manage_msg_push "

fail() {
  printf 'wechatide-call: %s\n' "$1" >&2
  exit "$2"
}

[ "$#" -ge 2 ] || fail usage 2
client=$1
operation=$2
shift 2
case "$client" in
  ClaudeCode|Codex) ;;
  *) fail unsupported-client 2 ;;
esac
if [ "$operation" != auth ]; then
  case "$operations" in
    *" $operation "*) ;;
    *) fail undelivered-operation 2 ;;
  esac
fi

help=false
for argument in "$@"; do
  case "$argument" in
    # These select another client, tool, transport or token, which the fixed invocation owns. Attached values are
    # refused with the separated forms, so the boundary does not depend on how the CLI parses them.
    -c|-c*|--client-name|--client-name=*|-t|-t*|--tool|--tool=*|-a|-a*|--args|--args=*) fail reserved-option 2 ;;
    --token|--token=*|--mcp|--mcp=*|--idev|--electron|--debug) fail reserved-option 2 ;;
    -h|--help) help=true ;;
  esac
done
if [ "$operation" = auth ] && [ "$#" -ne 0 ]; then fail usage 2; fi

[ "$(uname -s)" = Darwin ] || fail unsupported-platform 3
cli=$(type -P wechatide) || fail cli-unavailable 3
cli=$(realpath "$cli") || fail cli-unavailable 3
case "$cli" in
  */*.app/Contents/MacOS/wechatide) ;;
  *) fail cli-unbound 3 ;;
esac

# Client authorization and local help do not use the MCP token.
if [ "$operation" = auth ]; then exec "$cli" auth -c "$client"; fi
if [ "$help" = true ]; then exec "$cli" -c "$client" "$operation" "$@"; fi

account=$(id -un) || fail mcp-token-unavailable 3
token=$(security find-generic-password -s "$token_service" -a "$account" -w 2>/dev/null) || fail mcp-token-unavailable 3
case "$token" in
  ''|*[[:space:]]*) fail mcp-token-invalid 3 ;;
esac
# The token precedes caller arguments so a trailing caller option cannot consume it as its value.
exec "$cli" -c "$client" "$operation" "--token=$token" "$@"
