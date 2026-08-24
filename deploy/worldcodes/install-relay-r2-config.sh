#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
	cat <<'EOF'
Usage:
  install-relay-r2-config.sh --check --env-file PATH
  sudo install-relay-r2-config.sh --apply --env-file PATH

PATH must be an owner-only production env file created outside the repository.
The script never prints credentials and does not restart or recreate Relay.
EOF
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mode=""
source_env=""
template="${script_dir}/docker-compose.canvas-r2.yml"
target_dir="/etc/worldcodes"
target_env="${target_dir}/relay-temporary-media.env"
target_compose="${target_dir}/docker-compose.canvas-r2.yml"

while (($#)); do
	case "$1" in
		--check | --apply)
			[[ -z "$mode" ]] || { echo "Exactly one mode is required" >&2; exit 2; }
			mode="$1"
			shift
			;;
		--env-file)
			(($# >= 2)) || { echo "Missing value for $1" >&2; exit 2; }
			source_env="$2"
			shift 2
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "Unknown argument: $1" >&2
			usage >&2
			exit 2
			;;
	esac
done

[[ -n "$mode" && -n "$source_env" ]] || { usage >&2; exit 2; }
[[ -f "$source_env" && -r "$source_env" ]] || { echo "Production env is not readable: $source_env" >&2; exit 1; }
[[ -r "$template" ]] || { echo "Compose template is not readable: $template" >&2; exit 1; }
[[ "$source_env" == /* && "$source_env" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
	echo "--env-file must be an absolute path containing only safe path characters" >&2
	exit 1
}
if [[ "$mode" == "--apply" && ${EUID:-$(id -u)} -ne 0 ]]; then
	echo "--apply must run as root" >&2
	exit 1
fi

file_mode() {
	if stat -c '%a' "$1" >/dev/null 2>&1; then
		stat -c '%a' "$1"
	else
		stat -f '%Lp' "$1"
	fi
}

sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	else
		shasum -a 256 "$1" | awk '{print $1}'
	fi
}

source_mode="$(file_mode "$source_env")"
[[ "$source_mode" == "400" || "$source_mode" == "600" ]] || {
	echo "Production env must be owner-only (mode 0400 or 0600), got $source_mode" >&2
	exit 1
}
if LC_ALL=C grep -q $'\r' "$source_env"; then
	echo "Production env must use LF line endings" >&2
	exit 1
fi

required_keys=(
	TEMP_MEDIA_S3_ENDPOINT
	TEMP_MEDIA_S3_REGION
	TEMP_MEDIA_S3_BUCKET
	TEMP_MEDIA_S3_ACCESS_KEY_ID
	TEMP_MEDIA_S3_SECRET_ACCESS_KEY
	TEMP_MEDIA_S3_PREFIX
	TEMP_MEDIA_PUBLIC_BASE_URL
	TEMP_MEDIA_MAX_BYTES
	TEMP_MEDIA_MAX_ACTIVE_PER_USER
	TEMP_MEDIA_MAX_ACTIVE_BYTES_PER_USER
	TEMP_MEDIA_RETENTION_HOURS
	TEMP_MEDIA_UPLOAD_URL_TTL_MINUTES
	TEMP_MEDIA_ASSET_URL_TTL_MINUTES
)
for key in "${required_keys[@]}"; do
	count="$(awk -F= -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$source_env")"
	[[ "$count" == "1" ]] || { echo "$key must appear exactly once" >&2; exit 1; }
done

env_value() {
	awk -v key="$1" 'index($0, key "=") == 1 { print substr($0, length(key) + 2) }' "$source_env"
}

endpoint="$(env_value TEMP_MEDIA_S3_ENDPOINT)"
region="$(env_value TEMP_MEDIA_S3_REGION)"
bucket="$(env_value TEMP_MEDIA_S3_BUCKET)"
access_key="$(env_value TEMP_MEDIA_S3_ACCESS_KEY_ID)"
secret_key="$(env_value TEMP_MEDIA_S3_SECRET_ACCESS_KEY)"
prefix="$(env_value TEMP_MEDIA_S3_PREFIX)"
public_base_url="$(env_value TEMP_MEDIA_PUBLIC_BASE_URL)"
[[ "$endpoint" =~ ^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com$ ]] || {
	echo "TEMP_MEDIA_S3_ENDPOINT must be one exact R2 S3 HTTPS origin" >&2
	exit 1
}
[[ "$region" == "auto" ]] || { echo "TEMP_MEDIA_S3_REGION must be auto" >&2; exit 1; }
[[ "$bucket" == "worldcodes-canvas-temp" ]] || {
	echo "TEMP_MEDIA_S3_BUCKET must be worldcodes-canvas-temp" >&2
	exit 1
}
[[ "$prefix" == "canvas-temp" ]] || { echo "TEMP_MEDIA_S3_PREFIX must be canvas-temp" >&2; exit 1; }
[[ "$public_base_url" == "https://media.canvas.worldcodes.online" ]] || {
	echo "TEMP_MEDIA_PUBLIC_BASE_URL must be https://media.canvas.worldcodes.online" >&2
	exit 1
}
[[ "$access_key" =~ ^[A-Za-z0-9]{16,}$ ]] || { echo "TEMP_MEDIA_S3_ACCESS_KEY_ID is missing or invalid" >&2; exit 1; }
[[ "$secret_key" =~ ^[A-Za-z0-9/+=._-]{32,}$ ]] || { echo "TEMP_MEDIA_S3_SECRET_ACCESS_KEY is missing or invalid" >&2; exit 1; }

while IFS='=' read -r key expected; do
	[[ "$(env_value "$key")" == "$expected" ]] || {
		echo "$key must be $expected" >&2
		exit 1
	}
done <<'EOF'
TEMP_MEDIA_MAX_BYTES=536870912
TEMP_MEDIA_MAX_ACTIVE_PER_USER=50
TEMP_MEDIA_MAX_ACTIVE_BYTES_PER_USER=2147483648
TEMP_MEDIA_RETENTION_HOURS=24
TEMP_MEDIA_UPLOAD_URL_TTL_MINUTES=15
TEMP_MEDIA_ASSET_URL_TTL_MINUTES=1440
EOF

placeholder_count="$(grep -o '__TEMP_MEDIA_ENV_FILE__' "$template" | wc -l | tr -d ' ')"
[[ "$placeholder_count" == "1" ]] || { echo "Compose template placeholder count must be one" >&2; exit 1; }

temporary="$(mktemp -d "${TMPDIR:-/tmp}/worldcodes-relay-r2-config.XXXXXX")"
cleanup() {
	rm -rf -- "$temporary"
}
trap cleanup EXIT

installed_candidate="${temporary}/docker-compose.installed.yml"
validation_candidate="${temporary}/docker-compose.validation.yml"
validation_base="${temporary}/docker-compose.base.yml"
sed "s#__TEMP_MEDIA_ENV_FILE__#${target_env}#" "$template" >"$installed_candidate"
sed "s#__TEMP_MEDIA_ENV_FILE__#${source_env}#" "$template" >"$validation_candidate"
printf 'services:\n  new-api:\n    image: worldcodes-relay:validation-only\n' >"$validation_base"

docker compose version >/dev/null
docker compose -f "$validation_base" -f "$validation_candidate" config --quiet
compose_hash="$(sha256_file "$installed_candidate")"

if [[ "$mode" == "--check" ]]; then
	printf 'validated=yes\ncompose_target=%s\ncompose_sha256=%s\nenv_target=%s\nprefix=%s\n' \
		"$target_compose" "$compose_hash" "$target_env" "$prefix"
	exit 0
fi

install -d -o root -g root -m 0750 "$target_dir"
staged_env="$(mktemp "${target_dir}/.relay-temporary-media.env.next.XXXXXX")"
staged_compose="$(mktemp "${target_dir}/.docker-compose.canvas-r2.yml.next.XXXXXX")"
install -o root -g root -m 0600 "$source_env" "$staged_env"
install -o root -g root -m 0640 "$installed_candidate" "$staged_compose"

stamp="$(date -u +%Y%m%dT%H%M%SZ).$$"
env_backup=""
compose_backup=""
if [[ -e "$target_env" ]]; then
	env_backup="${target_env}.rollback.${stamp}"
	cp -a -- "$target_env" "$env_backup"
fi
if [[ -e "$target_compose" ]]; then
	compose_backup="${target_compose}.rollback.${stamp}"
	cp -a -- "$target_compose" "$compose_backup"
fi
rollback_install() {
	if [[ -n "$env_backup" ]]; then
		cp -a -- "$env_backup" "$target_env"
	else
		rm -f -- "$target_env"
	fi
	if [[ -n "$compose_backup" ]]; then
		cp -a -- "$compose_backup" "$target_compose"
	else
		rm -f -- "$target_compose"
	fi
}

if ! mv -f -- "$staged_env" "$target_env" || ! mv -f -- "$staged_compose" "$target_compose"; then
	echo "Failed to install Relay R2 configuration; restoring previous files" >&2
	rollback_install
	exit 1
fi

if [[ "$(stat -c '%u:%g:%a' "$target_env")" != "0:0:600" || \
	"$(stat -c '%u:%g:%a' "$target_compose")" != "0:0:640" || \
	"$(sha256_file "$target_compose")" != "$compose_hash" ]] || \
	! docker compose -f "$validation_base" -f "$target_compose" config --quiet; then
	echo "Installed Relay R2 configuration failed verification; restoring previous files" >&2
	rollback_install
	exit 1
fi

printf 'installed=yes\nenv_target=%s\ncompose_target=%s\ncompose_sha256=%s\n' \
	"$target_env" "$target_compose" "$compose_hash"
[[ -z "$env_backup" ]] || printf 'env_rollback=%s\n' "$env_backup"
[[ -z "$compose_backup" ]] || printf 'compose_rollback=%s\n' "$compose_backup"
