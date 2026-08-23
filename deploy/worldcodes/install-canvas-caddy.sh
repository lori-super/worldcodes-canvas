#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
	cat <<'EOF'
Usage:
  install-canvas-caddy.sh --check [options]
  sudo install-canvas-caddy.sh --apply [options]

Required environment:
  WORLDCODES_CANVAS_R2_ORIGIN
      Exact R2 S3 origin, for example:
      https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com

Required for --apply:
  WORLDCODES_EXPECTED_MAIN_CADDY_SHA256
      Current /etc/caddy/Caddyfile SHA-256. This prevents overwriting drift.

Optional environment:
  WORLDCODES_CANVAS_RELAY_PORT   Relay loopback port: 3000 (current) or 8080 (Sub2API)

Options:
  --template PATH      Canvas fragment template
  --target PATH        Installed fragment (default: /etc/caddy/Caddyfile.canvas)
  --main-config PATH   Main Caddyfile (default: /etc/caddy/Caddyfile)
  --caddy-bin PATH     Caddy executable (default: caddy)
  --systemctl-bin PATH systemctl executable (default: systemctl)
EOF
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mode=""
template="${script_dir}/Caddyfile.canvas"
target="${CADDY_CANVAS_TARGET:-/etc/caddy/Caddyfile.canvas}"
main_config="${CADDY_MAIN_CONFIG:-/etc/caddy/Caddyfile}"
caddy_bin="${CADDY_BIN:-caddy}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"

while (($#)); do
	case "$1" in
		--check | --apply)
			[[ -z "$mode" ]] || { echo "Exactly one mode is required" >&2; exit 2; }
			mode="$1"
			shift
			;;
		--template | --target | --main-config | --caddy-bin | --systemctl-bin)
			(($# >= 2)) || { echo "Missing value for $1" >&2; exit 2; }
			case "$1" in
				--template) template="$2" ;;
				--target) target="$2" ;;
				--main-config) main_config="$2" ;;
				--caddy-bin) caddy_bin="$2" ;;
				--systemctl-bin) systemctl_bin="$2" ;;
			esac
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

[[ -n "$mode" ]] || { usage >&2; exit 2; }
[[ -r "$template" ]] || { echo "Template is not readable: $template" >&2; exit 1; }
[[ -r "$main_config" ]] || { echo "Main Caddyfile is not readable: $main_config" >&2; exit 1; }
if [[ "$mode" == "--apply" && ${EUID:-$(id -u)} -ne 0 ]]; then
	echo "--apply must run as root" >&2
	exit 1
fi

r2_origin="${WORLDCODES_CANVAS_R2_ORIGIN:-}"
relay_port="${WORLDCODES_CANVAS_RELAY_PORT:-3000}"
expected_main_hash="${WORLDCODES_EXPECTED_MAIN_CADDY_SHA256:-}"

if [[ ! "$r2_origin" =~ ^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com$ ]]; then
	echo "WORLDCODES_CANVAS_R2_ORIGIN must be one exact R2 S3 HTTPS origin" >&2
	exit 1
fi
if [[ "$relay_port" != "3000" && "$relay_port" != "8080" ]]; then
	echo "WORLDCODES_CANVAS_RELAY_PORT must be 3000 or 8080" >&2
	exit 1
fi
if [[ -n "$expected_main_hash" && ! "$expected_main_hash" =~ ^[0-9a-f]{64}$ ]]; then
	echo "WORLDCODES_EXPECTED_MAIN_CADDY_SHA256 must be 64 lowercase hex characters" >&2
	exit 1
fi
if [[ "$mode" == "--apply" && -z "$expected_main_hash" ]]; then
	echo "WORLDCODES_EXPECTED_MAIN_CADDY_SHA256 is required for --apply" >&2
	exit 1
fi

current_main_hash="$(sha256sum "$main_config" | awk '{print $1}')"
if [[ -n "$expected_main_hash" && "$current_main_hash" != "$expected_main_hash" ]]; then
	echo "Main Caddyfile hash drifted: expected $expected_main_hash, got $current_main_hash" >&2
	exit 1
fi

candidate_fragment="$(mktemp "${TMPDIR:-/tmp}/worldcodes-canvas-fragment.XXXXXX")"
candidate_main_install="$(mktemp "${TMPDIR:-/tmp}/worldcodes-canvas-main-install.XXXXXX")"
candidate_main_validate="$(mktemp "${TMPDIR:-/tmp}/worldcodes-canvas-main-validate.XXXXXX")"
staged_fragment=""
staged_main=""
cleanup() {
	rm -f -- "$candidate_fragment" "$candidate_main_install" "$candidate_main_validate"
	[[ -z "$staged_fragment" ]] || rm -f -- "$staged_fragment"
	[[ -z "$staged_main" ]] || rm -f -- "$staged_main"
}
trap cleanup EXIT

sed \
	-e "s#__R2_ORIGIN__#${r2_origin}#g" \
	-e "s#__RELAY_PORT__#${relay_port}#g" \
	"$template" >"$candidate_fragment"
if grep -Eq '__R2_ORIGIN__|__RELAY_PORT__' "$candidate_fragment"; then
	echo "Rendered Canvas fragment still has unresolved placeholders" >&2
	exit 1
fi

import_line="import ${target}"
import_count="$(grep -Fxc "$import_line" "$main_config" || true)"
case "$import_count" in
	0)
		cp -a -- "$main_config" "$candidate_main_install"
		printf '\n%s\n' "$import_line" >>"$candidate_main_install"
		;;
	1)
		cp -a -- "$main_config" "$candidate_main_install"
		;;
	*)
		echo "Main Caddyfile contains duplicate Canvas imports" >&2
		exit 1
		;;
esac

awk -v target="$target" -v candidate="$candidate_fragment" '
	$1 == "import" && $2 == target && NF == 2 {
		print "import " candidate
		found = 1
		next
	}
	{ print }
	END { if (!found) exit 42 }
' "$candidate_main_install" >"$candidate_main_validate" || {
	status=$?
	[[ $status -ne 42 ]] || echo "Failed to stage the Canvas import" >&2
	exit 1
}

"$caddy_bin" adapt --config "$candidate_fragment" --adapter caddyfile >/dev/null
(
	cd -- "$(dirname -- "$main_config")"
	"$caddy_bin" validate --config "$candidate_main_validate" --adapter caddyfile
)

next_main_hash="$(sha256sum "$candidate_main_install" | awk '{print $1}')"
next_canvas_hash="$(sha256sum "$candidate_fragment" | awk '{print $1}')"
if [[ "$mode" == "--check" ]]; then
	printf 'validated=yes\ncurrent_main_sha256=%s\nnext_main_sha256=%s\ncanvas_sha256=%s\nrelay_port=%s\n' \
		"$current_main_hash" "$next_main_hash" "$next_canvas_hash" "$relay_port"
	exit 0
fi

target_dir="$(dirname -- "$target")"
main_dir="$(dirname -- "$main_config")"
staged_fragment="$(mktemp "${target_dir}/.$(basename -- "$target").next.XXXXXX")"
staged_main="$(mktemp "${main_dir}/.$(basename -- "$main_config").next.XXXXXX")"
install -o root -g root -m 0644 -- "$candidate_fragment" "$staged_fragment"
install -o root -g root -m 0644 -- "$candidate_main_install" "$staged_main"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
main_backup="${main_config}.rollback.${stamp}"
canvas_backup=""
cp -a -- "$main_config" "$main_backup"
if [[ -e "$target" ]]; then
	canvas_backup="${target}.rollback.${stamp}"
	cp -a -- "$target" "$canvas_backup"
fi

mv -f -- "$staged_fragment" "$target"
staged_fragment=""
mv -f -- "$staged_main" "$main_config"
staged_main=""

rollback() {
	cp -a -- "$main_backup" "$main_config"
	if [[ -n "$canvas_backup" ]]; then
		cp -a -- "$canvas_backup" "$target"
	else
		rm -f -- "$target"
	fi
	"$systemctl_bin" reload caddy || true
}

if ! "$systemctl_bin" reload caddy; then
	echo "Caddy reload failed; restoring previous files" >&2
	rollback
	exit 1
fi
if ! "$systemctl_bin" is-active --quiet caddy; then
	echo "Caddy is not active after reload; restoring previous files" >&2
	rollback
	exit 1
fi

printf 'installed=%s\nmain_sha256=%s\ncanvas_sha256=%s\nmain_rollback=%s\n' \
	"$target" "$next_main_hash" "$next_canvas_hash" "$main_backup"
[[ -z "$canvas_backup" ]] || printf 'canvas_rollback=%s\n' "$canvas_backup"
