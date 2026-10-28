#!/bin/bash
#
# Alibaba Cloud SMS Service CLI helper.
# Wraps the aliyun CLI to send SMS and query related resources.
#
# Requirements: aliyun-cli >= 3.3.3 + dysmsapi plugin + jq
# Before invoking this helper, the caller must check `aliyun version` for
# version 3.3.3 or later as required by SKILL.md; the helper does not compare versions.
# Install:      brew install aliyun-cli  (macOS)
# Plugin:       aliyun plugin install --names dysmsapi
#

# Read [SMS invocation contract](../SKILL.md). Use tool `aliyun-sms`.
# Read [JSON input contract](../../../policy/tool-contracts.md). Use tool `jq`.
set -e

# Default configuration
DEFAULT_REGION="cn-hangzhou"
API_VERSION="2017-05-25"
USER_AGENT="AlibabaCloud-Agent-Skills/alibabacloud-sms-send-short-message"
READ_TIMEOUT="3"

# Use colors only for terminal diagnostics.
RED=''
GREEN=''
YELLOW=''
NC=''
if [ -t 2 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    NC='\033[0m'
fi

# ========== Input validators ==========

# Validate phone numbers (only digits, commas and plus signs allowed)
validate_phone_numbers() {
    local phone="$1"
    if [[ ! "$phone" =~ ^\+?[0-9]+(,\+?[0-9]+)*$ ]]; then
        echo -e "${RED}Error: invalid phone number format. Only digits, commas and '+' are allowed.${NC}" >&2
        exit 1
    fi
}

# Match literal characters so Bash regex bracket rules cannot weaken the input policy.
contains_shell_metacharacter() {
    case "$1" in
        *'$'*|*'`'*|*"\\"*|*'"'*|*"'"*|*';'*|*'&'*|*'|'*|*'>'*|*'<'*|\
        *'('*|*')'*|*'{'*|*'}'*|*'['*|*']'*|*'!'*|*'#'*|*'*'*|*'?'*) return 0 ;;
        *) return 1 ;;
    esac
}

# Validate signature name (forbid shell metacharacters)
validate_sign_name() {
    local sign="$1"
    # Forbid shell metacharacters: $ ` \ " ' ; & | > < ( ) { } [ ] ! # * ?
    if contains_shell_metacharacter "$sign"; then
        echo -e "${RED}Error: signature name contains illegal characters.${NC}" >&2
        exit 1
    fi
}

# Validate template code (only letters, digits and underscore)
validate_template_code() {
    local code="$1"
    if [[ ! "$code" =~ ^[A-Za-z0-9_]+$ ]]; then
        echo -e "${RED}Error: invalid template code. Only letters, digits and underscore are allowed.${NC}" >&2
        exit 1
    fi
}

# Validate date format (digits only, yyyyMMdd)
validate_date() {
    local date="$1"
    if [[ ! "$date" =~ ^[0-9]{8}$ ]]; then
        echo -e "${RED}Error: invalid date format. Expected yyyyMMdd.${NC}" >&2
        exit 1
    fi
}

# Validate one template-parameter JSON object without interpreting its values as shell code.
validate_json_param() {
    local json="$1"
    check_json_tool
    if ! printf '%s\n' "$json" | jq -se 'length == 1 and (.[0] | type == "object" and all(.[]; type == "string"))' >/dev/null 2>&1; then
        echo "Error: template parameters must be a JSON object of string values." >&2
        exit 1
    fi
}

# Validate a generic safe string (forbid dangerous characters)
validate_safe_string() {
    local str="$1"
    local name="$2"
    if contains_shell_metacharacter "$str"; then
        echo -e "${RED}Error: ${name} contains illegal characters.${NC}" >&2
        exit 1
    fi
}

# Help message
show_help() {
    cat << EOF
Alibaba Cloud SMS Service CLI helper

Usage:
  $0 <command> [options]

Commands:
  send              Send an SMS message
  list-signs        List SMS signatures
  list-templates    List SMS templates
  query-sign        Query a specific signature status
  query-template    Query a specific template status
  query-status      Query the send status of an SMS
  query-statistics  Query send statistics by date range

Send options:
  -p, --phone-numbers     Phone numbers (required), comma-separated for multiple
  -s, --sign-name         Signature name (required)
  -t, --template-code     Template code (required)
  -tp, --template-param   Template variables (JSON)
  -o, --out-id            External tracking ID
  --verify                Verify signature & template status before sending

Query options:
  -s, --sign-name         Signature name (required for query-sign)
  -t, --template-code     Template code (required for query-template)
  -p, --phone-numbers     One phone number (required for query-status)
  --send-date             Send date in yyyyMMdd (required for query-status)
  --biz-id                BizId returned by send

Statistics options (query-statistics):
  -s, --sign-name         Filter by SMS signature name
  --start-date            Start date in yyyyMMdd (required)
  --end-date              End date in yyyyMMdd (required)
  --is-globe              Scope: 1 = domestic, 2 = international/HK-Macao-Taiwan (default 1)
  --template-type         Template type: 0=verification, 1=notification, 2=marketing,
                          3=international, 7=digital
  --page-index            Page index, default 1
  --page-size             Page size, default 10 (1-50)

Common options:
  -r, --region            Region ID, default cn-hangzhou
  --profile               Use the given aliyun CLI profile
  -h, --help              Show this help

Examples:
  # Send an SMS
  $0 send -p "13800138000" -s "AliyunDemo" -t "SMS_123456" -tp '{"code":"123456"}'

  # Verify signature/template first
  $0 send -p "13800138000" -s "AliyunDemo" -t "SMS_123456" -tp '{"code":"123456"}' --verify

  # List signatures
  $0 list-signs

  # List templates
  $0 list-templates

  # Query a signature status
  $0 query-sign --sign-name "AliyunDemo"

  # Query a template status
  $0 query-template --template-code "SMS_123456"

  # Query send status
  $0 query-status -p "13800138000" --send-date "20260326"

  # Query send statistics
  $0 query-statistics --start-date "20260301" --end-date "20260326"

EOF
}

# Check whether the aliyun CLI is installed
check_cli() {
    if ! command -v aliyun &> /dev/null; then
        echo "Error: aliyun CLI is not installed; setup needs separate authorization." >&2
        exit 1
    fi
}

# Check whether the dysmsapi plugin is installed
check_plugin() {
    local plugins
    if ! plugins=$(aliyun plugin list 2>/dev/null); then
        echo "Error: could not inspect installed aliyun plugins." >&2
        exit 1
    fi
    if ! printf '%s\n' "$plugins" | grep -Eq '^[[:space:]]*(aliyun-cli-)?dysmsapi([[:space:]]|$)'; then
        echo "Error: the dysmsapi plugin is not installed." >&2
        echo "After installation approval, run: aliyun plugin install --names dysmsapi" >&2
        exit 1
    fi
}

# Let the CLI resolve the selected existing profile/provider without dumping credentials.
check_json_tool() {
    if ! command -v jq >/dev/null; then
        echo "Error: jq is required; setup needs separate authorization." >&2
        exit 1
    fi
}

check_dependencies() {
    check_cli
    check_json_tool
    check_plugin
}

# Preserve CLI failures and reject malformed/business-error responses without retrying.
call_api() (
    local output status diagnostic_file
    umask 077
    if ! diagnostic_file=$(mktemp "${TMPDIR:-/tmp}/agents-sms-stderr.XXXXXX"); then
        echo "Error: could not prepare private diagnostics; SMS CLI was not invoked." >&2
        return 1
    fi
    trap 'rm -f -- "$diagnostic_file"' EXIT
    if output=$(aliyun "$@" 2>"$diagnostic_file"); then
        status=0
    else
        status=$?
    fi
    if [[ "$status" != 0 ]]; then
        report_verification_failure "$2" "$status" "$output"$'\n'"$(cat "$diagnostic_file")"
    elif ! printf '%s\n' "$output" | jq -se 'length == 1 and (.[0] | type == "object" and (.Code | type == "string"))' >/dev/null 2>&1; then
        printf 'Error: %s returned an invalid response; expected one JSON object with a string Code.\n' "$2" >&2
    elif ! printf '%s\n' "$output" | jq -e '.Code == "OK"' >/dev/null 2>&1; then
        # Use only top-level response fields; nested values and stderr are not business results.
        report_verification_failure "$2" "$status" "$(printf '%s\n' "$output" | jq '{Code, RequestId} | with_entries(select(.value | type == "string"))')"
    else
        if [[ "$2" == send-sms ]] && ! printf '%s\n' "$output" | jq -e '.BizId | type == "string" and length > 0' >/dev/null 2>&1; then
            echo "Error: missing send BizId. Outcome is unknown. Do not resend." >&2
            return 1
        fi
        printf '%s\n' "$output"
        return 0
    fi
    if [[ "$2" == send-sms ]]; then
        echo "Send result is not confirmed. Do not resend; reconcile the original attempt." >&2
    else
        echo "Read-only query failed; this call did not send an SMS." >&2
    fi
    if [[ "$status" != 0 ]]; then return "$status"; fi
    return 1
)

require_option_value() {
    if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
        printf 'Error: missing value for %s.\n' "$1" >&2
        exit 2
    fi
}

unknown_option() {
    printf 'Error: unknown option or unexpected argument. Run with --help for usage information.\n' >&2
    exit 2
}

report_verification_failure() {
    local operation="$1"
    local status="$2"
    local output="$3"
    local code='' request_id=''
    local code_pattern='"Code"[[:space:]]*:[[:space:]]*"([A-Za-z][A-Za-z0-9_.-]{0,79})"'
    local request_id_pattern='"RequestId"[[:space:]]*:[[:space:]]*"([A-Fa-f0-9-]{8,64})"'
    # Keep only the first bounded match per field; raw CLI errors may contain secrets.
    if [[ "$output" =~ $code_pattern ]]; then code="${BASH_REMATCH[1]}"; fi
    if [[ "$output" =~ $request_id_pattern ]]; then request_id="${BASH_REMATCH[1]}"; fi
    if [[ "$status" == 0 ]]; then
        printf 'Error: service rejected the %s request.\n' "$operation" >&2
    else
        printf 'Error: %s failed (CLI exit %s).\n' "$operation" "$status" >&2
    fi
    if [[ -n "$code" ]]; then printf 'Code: %s\n' "$code" >&2; fi
    if [[ -n "$request_id" ]]; then printf 'RequestId: %s\n' "$request_id" >&2; fi
}

# Send an SMS
send_sms() {
    local phone_numbers=""
    local sign_name=""
    local template_code=""
    local template_param=""
    local out_id=""
    local verify=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_help; return 0 ;;
        esac
        case $1 in
            -p|--phone-numbers)
                require_option_value "$@"
                phone_numbers="$2"
                shift 2
                ;;
            -s|--sign-name)
                require_option_value "$@"
                sign_name="$2"
                shift 2
                ;;
            -t|--template-code)
                require_option_value "$@"
                template_code="$2"
                shift 2
                ;;
            -tp|--template-param)
                require_option_value "$@"
                template_param="$2"
                shift 2
                ;;
            -o|--out-id)
                require_option_value "$@"
                out_id="$2"
                shift 2
                ;;
            --verify)
                verify=true
                shift
                ;;
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    # Validate required parameters
    if [ -z "$phone_numbers" ]; then
        echo -e "${RED}Error: missing phone numbers (-p/--phone-numbers).${NC}" >&2
        exit 1
    fi
    if [ -z "$sign_name" ]; then
        echo -e "${RED}Error: missing signature name (-s/--sign-name).${NC}" >&2
        exit 1
    fi
    if [ -z "$template_code" ]; then
        echo -e "${RED}Error: missing template code (-t/--template-code).${NC}" >&2
        exit 1
    fi

    # Enforce input constraints; command arrays preserve argument boundaries.
    validate_phone_numbers "$phone_numbers"
    validate_sign_name "$sign_name"
    validate_template_code "$template_code"
    [ -n "$template_param" ] && validate_json_param "$template_param"
    [ -n "$out_id" ] && validate_safe_string "$out_id" "out-id"

    check_dependencies

    # Pre-send verification
    if [ "$verify" = true ]; then
        echo -e "${YELLOW}Verifying signature status...${NC}" >&2
        local sign_result
        if sign_result=$(call_api dysmsapi get-sms-sign \
            --api-version "$API_VERSION" \
            --user-agent "$USER_AGENT" \
            --read-timeout "$READ_TIMEOUT" \
            ${REGION:+--region "$REGION"} \
            ${PROFILE:+--profile "$PROFILE"} \
            --sign-name "$sign_name"); then
            :
        else
            local status=$?
            echo "Pre-send verification failed; no send was attempted." >&2
            exit "$status"
        fi
        local sign_status
        sign_status=$(printf '%s\n' "$sign_result" | jq -r '.SignStatus // empty')

        if [ "$sign_status" != "1" ]; then
            echo -e "${RED}Signature verification failed: not approved (status: $sign_status).${NC}" >&2
            echo "Pre-send verification failed; no send was attempted." >&2
            exit 1
        fi
        echo -e "${GREEN}Signature verified.${NC}" >&2

        echo -e "${YELLOW}Verifying template status...${NC}" >&2
        local template_result
        if template_result=$(call_api dysmsapi get-sms-template \
            --api-version "$API_VERSION" \
            --user-agent "$USER_AGENT" \
            --read-timeout "$READ_TIMEOUT" \
            ${REGION:+--region "$REGION"} \
            ${PROFILE:+--profile "$PROFILE"} \
            --template-code "$template_code"); then
            :
        else
            local status=$?
            echo "Pre-send verification failed; no send was attempted." >&2
            exit "$status"
        fi
        local template_status
        template_status=$(printf '%s\n' "$template_result" | jq -r '.TemplateStatus // empty')

        if [ "$template_status" != "1" ]; then
            echo -e "${RED}Template verification failed: not approved (status: $template_status).${NC}" >&2
            echo "Pre-send verification failed; no send was attempted." >&2
            exit 1
        fi
        echo -e "${GREEN}Template verified.${NC}" >&2
    fi

    # Build the command via an array (avoid eval)
    local cmd_args=(
        "call_api" "dysmsapi" "send-sms"
        "--api-version" "$API_VERSION"
        "--user-agent" "$USER_AGENT"
        "--read-timeout" "$READ_TIMEOUT"
        "--phone-numbers" "$phone_numbers"
        "--sign-name" "$sign_name"
        "--template-code" "$template_code"
    )

    [ -n "$template_param" ] && cmd_args+=("--template-param" "$template_param")
    [ -n "$out_id" ] && cmd_args+=("--out-id" "$out_id")
    [ -n "$REGION" ] && cmd_args+=("--region" "$REGION")
    [ -n "$PROFILE" ] && cmd_args+=("--profile" "$PROFILE")

    echo -e "${YELLOW}Submitting one SMS request; acceptance is not delivery.${NC}" >&2
    "${cmd_args[@]}"
}

# List signatures
list_signs() {
    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -h || "$1" == --help ]]; then show_help; return 0; fi
        case $1 in
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    check_dependencies
    echo -e "${YELLOW}Querying signature list...${NC}" >&2
    call_api dysmsapi query-sms-sign-list \
        --api-version "$API_VERSION" \
        --user-agent "$USER_AGENT" \
        --read-timeout "$READ_TIMEOUT" \
        ${REGION:+--region "$REGION"} \
        ${PROFILE:+--profile "$PROFILE"} \
        --page-index 1 \
        --page-size 50
}

# List templates
list_templates() {
    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -h || "$1" == --help ]]; then show_help; return 0; fi
        case $1 in
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    check_dependencies
    echo -e "${YELLOW}Querying template list...${NC}" >&2
    call_api dysmsapi query-sms-template-list \
        --api-version "$API_VERSION" \
        --user-agent "$USER_AGENT" \
        --read-timeout "$READ_TIMEOUT" \
        ${REGION:+--region "$REGION"} \
        ${PROFILE:+--profile "$PROFILE"} \
        --page-index 1 \
        --page-size 50
}

# Query a specific signature status
query_sign() {
    local sign_name=""

    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -h || "$1" == --help ]]; then show_help; return 0; fi
        case $1 in
            --sign-name|-s)
                require_option_value "$@"
                sign_name="$2"
                shift 2
                ;;
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    if [ -z "$sign_name" ]; then
        echo -e "${RED}Error: missing signature name (--sign-name).${NC}" >&2
        exit 1
    fi

    # Input validation
    validate_sign_name "$sign_name"

    check_dependencies
    echo -e "${YELLOW}Querying signature status...${NC}" >&2
    call_api dysmsapi get-sms-sign \
        --api-version "$API_VERSION" \
        --user-agent "$USER_AGENT" \
        --read-timeout "$READ_TIMEOUT" \
        ${REGION:+--region "$REGION"} \
        ${PROFILE:+--profile "$PROFILE"} \
        --sign-name "$sign_name"
}

# Query a specific template status
query_template() {
    local template_code=""

    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -h || "$1" == --help ]]; then show_help; return 0; fi
        case $1 in
            --template-code|-t)
                require_option_value "$@"
                template_code="$2"
                shift 2
                ;;
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    if [ -z "$template_code" ]; then
        echo -e "${RED}Error: missing template code (--template-code).${NC}" >&2
        exit 1
    fi

    # Input validation
    validate_template_code "$template_code"

    check_dependencies
    echo -e "${YELLOW}Querying template status...${NC}" >&2
    call_api dysmsapi get-sms-template \
        --api-version "$API_VERSION" \
        --user-agent "$USER_AGENT" \
        --read-timeout "$READ_TIMEOUT" \
        ${REGION:+--region "$REGION"} \
        ${PROFILE:+--profile "$PROFILE"} \
        --template-code "$template_code"
}

# Query the send status
query_status() {
    local phone_number=""
    local send_date=""
    local biz_id=""

    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -h || "$1" == --help ]]; then show_help; return 0; fi
        case $1 in
            -p|--phone-numbers)
                require_option_value "$@"
                phone_number="$2"
                shift 2
                ;;
            --send-date)
                require_option_value "$@"
                send_date="$2"
                shift 2
                ;;
            --biz-id)
                require_option_value "$@"
                biz_id="$2"
                shift 2
                ;;
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    if [ -z "$phone_number" ]; then
        echo -e "${RED}Error: missing phone number (-p/--phone-numbers).${NC}" >&2
        exit 1
    fi
    if [ -z "$send_date" ]; then
        echo "Error: --send-date must identify the original send date." >&2
        exit 1
    fi

    # Input validation
    validate_phone_numbers "$phone_number"
    if [[ "$phone_number" == *,* ]]; then echo "Error: query-status requires one phone number." >&2; exit 1; fi
    validate_date "$send_date"
    [ -n "$biz_id" ] && validate_safe_string "$biz_id" "BizId"

    # Build the command via an array (avoid eval)
    local cmd_args=(
        "call_api" "dysmsapi" "query-send-details"
        "--api-version" "$API_VERSION"
        "--user-agent" "$USER_AGENT"
        "--read-timeout" "$READ_TIMEOUT"
        "--phone-number" "$phone_number"
        "--send-date" "$send_date"
        "--page-size" "10"
        "--current-page" "1"
    )

    [ -n "$biz_id" ] && cmd_args+=("--biz-id" "$biz_id")
    [ -n "$REGION" ] && cmd_args+=("--region" "$REGION")
    [ -n "$PROFILE" ] && cmd_args+=("--profile" "$PROFILE")

    check_dependencies
    echo -e "${YELLOW}Querying send status...${NC}" >&2
    "${cmd_args[@]}"
}

# Query send statistics
query_statistics() {
    local start_date=""
    local end_date=""
    local is_globe="1"
    local template_type=""
    local sign_name=""
    local page_index="1"
    local page_size="10"

    while [[ $# -gt 0 ]]; do
        if [[ "$1" == -h || "$1" == --help ]]; then show_help; return 0; fi
        case $1 in
            --start-date)
                require_option_value "$@"
                start_date="$2"
                shift 2
                ;;
            --end-date)
                require_option_value "$@"
                end_date="$2"
                shift 2
                ;;
            --is-globe)
                require_option_value "$@"
                is_globe="$2"
                shift 2
                ;;
            --template-type)
                require_option_value "$@"
                template_type="$2"
                shift 2
                ;;
            --sign-name|-s)
                require_option_value "$@"
                sign_name="$2"
                shift 2
                ;;
            --page-index)
                require_option_value "$@"
                page_index="$2"
                shift 2
                ;;
            --page-size)
                require_option_value "$@"
                page_size="$2"
                shift 2
                ;;
            -r|--region)
                require_option_value "$@"
                REGION="$2"
                shift 2
                ;;
            --profile)
                require_option_value "$@"
                PROFILE="$2"
                shift 2
                ;;
            *)
                unknown_option
                ;;
        esac
    done

    if [ -z "$start_date" ]; then
        echo -e "${RED}Error: missing start date (--start-date).${NC}" >&2
        exit 1
    fi
    if [ -z "$end_date" ]; then
        echo -e "${RED}Error: missing end date (--end-date).${NC}" >&2
        exit 1
    fi

    # Input validation
    validate_date "$start_date"
    validate_date "$end_date"
    if [[ ! "$is_globe" =~ ^[12]$ ]]; then
        echo -e "${RED}Error: --is-globe must be 1 (domestic) or 2 (international/HK-Macao-Taiwan).${NC}" >&2
        exit 1
    fi
    if [ -n "$template_type" ] && [[ ! "$template_type" =~ ^[01237]$ ]]; then
        echo -e "${RED}Error: --template-type must be one of 0/1/2/3/7.${NC}" >&2
        exit 1
    fi
    if [[ ! "$page_index" =~ ^[1-9][0-9]{0,8}$ ]] || [[ ! "$page_size" =~ ^([1-9]|[1-4][0-9]|50)$ ]]; then
        echo -e "${RED}Error: --page-index must be an integer from 1 to 999999999; --page-size must be an integer from 1 to 50.${NC}" >&2
        exit 1
    fi
    [ -n "$sign_name" ] && validate_sign_name "$sign_name"

    # Build the command via an array (avoid eval)
    local cmd_args=(
        "call_api" "dysmsapi" "query-send-statistics"
        "--api-version" "$API_VERSION"
        "--user-agent" "$USER_AGENT"
        "--read-timeout" "$READ_TIMEOUT"
        "--is-globe" "$is_globe"
        "--start-date" "$start_date"
        "--end-date" "$end_date"
        "--page-index" "$page_index"
        "--page-size" "$page_size"
    )

    [ -n "$template_type" ] && cmd_args+=("--template-type" "$template_type")
    [ -n "$sign_name" ] && cmd_args+=("--sign-name" "$sign_name")
    [ -n "$REGION" ] && cmd_args+=("--region" "$REGION")
    [ -n "$PROFILE" ] && cmd_args+=("--profile" "$PROFILE")

    check_dependencies
    echo -e "${YELLOW}Querying send statistics...${NC}" >&2
    "${cmd_args[@]}"
}

# Main entry
main() {
    # Initialize variables
    REGION="${DEFAULT_REGION}"
    PROFILE=""

    # Parse the command
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi

    local command=$1
    shift

    case $command in
        send)
            send_sms "$@"
            ;;
        list-signs)
            list_signs "$@"
            ;;
        list-templates)
            list_templates "$@"
            ;;
        query-sign)
            query_sign "$@"
            ;;
        query-template)
            query_template "$@"
            ;;
        query-status)
            query_status "$@"
            ;;
        query-statistics)
            query_statistics "$@"
            ;;
        -h|--help|help)
            show_help
            ;;
        *)
            printf 'Error: unknown command. Run with --help for usage information.\n' >&2
            exit 1
            ;;
    esac
}

main "$@"
