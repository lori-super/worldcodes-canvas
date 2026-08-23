#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
	cat <<'EOF'
Usage:
  publish-canvas-release.sh --check --artifact FILE --revision HEX --sha256 HEX
  sudo publish-canvas-release.sh --apply --artifact FILE --revision HEX --sha256 HEX

The .tar.gz artifact must contain index.html, config.js and assets/ at its root.
--check validates and extracts only to a temporary directory.
--apply atomically switches /opt/worldcodes-canvas/current and reloads Caddy.
EOF
}

mode=""
artifact=""
revision=""
expected_sha256=""
caddy_bin="${CADDY_BIN:-caddy}"
systemctl_bin="${SYSTEMCTL_BIN:-systemctl}"
main_config="${CADDY_MAIN_CONFIG:-/etc/caddy/Caddyfile}"
site_root="${WORLDCODES_CANVAS_SITE_ROOT:-/opt/worldcodes-canvas}"

while (($#)); do
	case "$1" in
		--check | --apply)
			[[ -z "$mode" ]] || { echo "Exactly one mode is required" >&2; exit 2; }
			mode="$1"
			shift
			;;
		--artifact | --revision | --sha256 | --caddy-bin | --systemctl-bin | --main-config | --site-root)
			(($# >= 2)) || { echo "Missing value for $1" >&2; exit 2; }
			case "$1" in
				--artifact) artifact="$2" ;;
				--revision) revision="$2" ;;
				--sha256) expected_sha256="$2" ;;
				--caddy-bin) caddy_bin="$2" ;;
				--systemctl-bin) systemctl_bin="$2" ;;
				--main-config) main_config="$2" ;;
				--site-root) site_root="$2" ;;
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

[[ -n "$mode" && -n "$artifact" && -n "$revision" && -n "$expected_sha256" ]] || {
	usage >&2
	exit 2
}
[[ -f "$artifact" ]] || { echo "Artifact does not exist: $artifact" >&2; exit 1; }
[[ "$revision" =~ ^[0-9a-f]{7,64}$ ]] || { echo "Revision must be 7-64 lowercase hex characters" >&2; exit 1; }
[[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "SHA-256 must be 64 lowercase hex characters" >&2; exit 1; }
if [[ "$site_root" != "/opt/worldcodes-canvas" ]]; then
	echo "Site root must remain /opt/worldcodes-canvas" >&2
	exit 1
fi
if [[ "$mode" == "--apply" && ${EUID:-$(id -u)} -ne 0 ]]; then
	echo "--apply must run as root" >&2
	exit 1
fi

actual_sha256="$(sha256sum "$artifact" | awk '{print $1}')"
[[ "$actual_sha256" == "$expected_sha256" ]] || {
	echo "Artifact checksum mismatch: expected $expected_sha256, got $actual_sha256" >&2
	exit 1
}

staging="$(mktemp -d "${TMPDIR:-/tmp}/worldcodes-canvas-release.XXXXXX")"
header_file="$(mktemp "${TMPDIR:-/tmp}/worldcodes-canvas-headers.XXXXXX")"
cleanup() {
	rm -rf -- "$staging"
	rm -f -- "$header_file"
}
trap cleanup EXIT

python3 - "$artifact" "$staging" <<'PY'
import pathlib
import sys
import tarfile

artifact = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
with tarfile.open(artifact, "r:gz") as archive:
    members = archive.getmembers()
    if not members:
        raise SystemExit("artifact is empty")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or not (member.isdir() or member.isfile()):
            raise SystemExit(f"unsafe archive entry: {member.name}")
        target = (destination / pathlib.Path(*path.parts)).resolve()
        if destination.resolve() not in (target, *target.parents):
            raise SystemExit(f"archive entry escapes destination: {member.name}")
    archive.extractall(destination, members=members)
PY

[[ -f "$staging/index.html" ]] || { echo "Artifact root is missing index.html" >&2; exit 1; }
[[ -f "$staging/config.js" ]] || { echo "Artifact root is missing config.js" >&2; exit 1; }
[[ -d "$staging/assets" ]] || { echo "Artifact root is missing assets/" >&2; exit 1; }
if find "$staging" -type l -print -quit | grep -q .; then
	echo "Artifact must not contain symbolic links" >&2
	exit 1
fi

if [[ "$mode" == "--check" ]]; then
	printf 'validated=yes\nrevision=%s\nsha256=%s\nfiles=%s\n' \
		"$revision" "$actual_sha256" "$(find "$staging" -type f | wc -l | tr -d ' ')"
	exit 0
fi

[[ -r "$main_config" ]] || { echo "Main Caddyfile is not readable: $main_config" >&2; exit 1; }
grep -Fqx 'import /etc/caddy/Caddyfile.canvas' "$main_config" || {
	echo "Main Caddyfile does not import /etc/caddy/Caddyfile.canvas" >&2
	exit 1
}

releases_dir="${site_root}/releases"
release_dir="${releases_dir}/${revision}"
current_link="${site_root}/current"
[[ ! -e "$release_dir" ]] || { echo "Release already exists: $release_dir" >&2; exit 1; }
if [[ -e "$current_link" && ! -L "$current_link" ]]; then
	echo "Current path exists but is not a symbolic link: $current_link" >&2
	exit 1
fi

install -d -o root -g root -m 0755 "$site_root" "$releases_dir" "$release_dir"
cp -a -- "$staging/." "$release_dir/"
chown -R root:root "$release_dir"
find "$release_dir" -type d -exec chmod 0755 {} +
find "$release_dir" -type f -exec chmod 0644 {} +

previous=""
if [[ -L "$current_link" ]]; then
	previous="$(readlink -f "$current_link")"
fi
next_link="${site_root}/.current.next.${revision}"
ln -s -- "$release_dir" "$next_link"
mv -Tf -- "$next_link" "$current_link"

rollback() {
	if [[ -n "$previous" ]]; then
		rollback_link="${site_root}/.current.rollback.${revision}"
		ln -s -- "$previous" "$rollback_link"
		mv -Tf -- "$rollback_link" "$current_link"
	else
		rm -f -- "$current_link"
	fi
	"$systemctl_bin" reload caddy || true
}

if ! "$caddy_bin" validate --config "$main_config" --adapter caddyfile >/dev/null; then
	echo "Caddy validation failed; restoring previous release" >&2
	rollback
	exit 1
fi
if ! "$systemctl_bin" reload caddy || ! "$systemctl_bin" is-active --quiet caddy; then
	echo "Caddy reload failed; restoring previous release" >&2
	rollback
	exit 1
fi

request_status() {
	local method="$1" path="$2"
	curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
		--request "$method" --max-time 15 \
		--resolve canvas.worldcodes.online:443:127.0.0.1 \
		"https://canvas.worldcodes.online${path}"
}

if [[ "$(request_status GET /)" != "200" || \
	"$(request_status GET /v1/models)" != "401" || \
	"$(request_status POST /v1/responses)" != "401" || \
	"$(request_status POST /v1/audio/speech)" != "401" || \
	"$(request_status POST /v1beta/models/nano-banana-2:generateContent)" != "401" || \
	"$(request_status GET /v1beta/models/nano-banana-2:generateContent)" != "404" || \
	"$(request_status GET /v1/images/generations)" != "404" || \
	"$(request_status GET /v1/not-allowed)" != "404" || \
	"$(request_status GET /v1/media/uploads/presign)" != "404" ]]; then
	echo "Canvas smoke checks failed; restoring previous release" >&2
	rollback
	exit 1
fi

curl --silent --show-error --output /dev/null --dump-header "$header_file" \
	--max-time 15 --resolve canvas.worldcodes.online:443:127.0.0.1 \
	https://canvas.worldcodes.online/
if ! grep -Eiq '^Content-Security-Policy:.*connect-src.*r2\.cloudflarestorage\.com' "$header_file"; then
	echo "Canvas CSP smoke check failed; restoring previous release" >&2
	rollback
	exit 1
fi

printf 'release=healthy\nrevision=%s\nsha256=%s\ncurrent=%s\nprevious=%s\n' \
	"$revision" "$actual_sha256" "$release_dir" "${previous:-none}"
