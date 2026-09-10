#!/usr/bin/env python3
"""Add the Canvas Caddy fragment to the audited 613a3820 Relay release script.

This intentionally targets one exact generated release baseline. A later Relay
release must port the same contract explicitly instead of accepting a fuzzy edit.
"""

from __future__ import annotations

import argparse
import datetime
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile


BASELINE_REVISION = "613a382079417daf47d2c46292ec7ce27b1d29fa"
MARKER = "# WORLDCODES_CANVAS_BLUEGREEN_V1"


def replace_exact(source: str, old: str, new: str, count: int = 1) -> str:
    found = source.count(old)
    if found != count:
        raise ValueError(f"blue-green anchor count mismatch: wanted {count}, got {found}: {old[:100]!r}")
    return source.replace(old, new)


def patch_release(source: str, main_hash: str, canvas_hash: str, canvas_r2_compose_hash: str) -> str:
    if MARKER in source:
        validate_contract(source, main_hash, canvas_hash, canvas_r2_compose_hash)
        return source
    if f"readonly revision='{BASELINE_REVISION}'" not in source:
        raise ValueError("only the audited Relay release 613a3820 baseline is supported")

    source = replace_exact(source, "set +x\n", f"set +x\n\n{MARKER}\n")
    source, replacements = re.subn(
        r"(?m)^readonly expected_caddy_hash='[0-9a-f]{64}'$",
        f"readonly expected_caddy_hash='{main_hash}'",
        source,
    )
    if replacements != 1:
        raise ValueError("expected one pinned main Caddy hash")
    source, replacements = re.subn(
        r"(?m)^(readonly expected_caddy_private_hash='[0-9a-f]{64}')$",
        rf"\1\nreadonly expected_caddy_canvas_hash='{canvas_hash}'\n"
        rf"readonly expected_canvas_r2_compose_hash='{canvas_r2_compose_hash}'",
        source,
    )
    if replacements != 1:
        raise ValueError("expected one pinned private Caddy hash")

    source = replace_exact(
        source,
        'readonly caddy_itest_backup="${release_dir}/Caddyfile.relay-itest.before"\n'
        'readonly caddy_green="${release_dir}/Caddyfile.green"',
        'readonly caddy_itest_backup="${release_dir}/Caddyfile.relay-itest.before"\n'
        'readonly caddy_canvas_backup="${release_dir}/Caddyfile.canvas.before"\n'
        'readonly caddy_green="${release_dir}/Caddyfile.green"',
    )
    source = replace_exact(
        source,
        'readonly caddy_private_green_active="/etc/caddy/Caddyfile.private.green-${short_revision}"\n'
        'readonly caddy_next="/etc/caddy/Caddyfile.next-${short_revision}"',
        'readonly caddy_private_green_active="/etc/caddy/Caddyfile.private.green-${short_revision}"\n'
        'readonly caddy_canvas_green="${release_dir}/Caddyfile.canvas.green"\n'
        'readonly caddy_canvas_green_active="/etc/caddy/Caddyfile.canvas.green-${short_revision}"\n'
        'readonly canvas_r2_compose="/etc/worldcodes/docker-compose.canvas-r2.yml"\n'
        'readonly canvas_r2_env="/etc/worldcodes/relay-temporary-media.env"\n'
        'readonly caddy_next="/etc/caddy/Caddyfile.next-${short_revision}"',
    )
    source = replace_exact(
        source,
        "compose_csv=''\n",
        "compose_csv=''\ncanvas_r2_env_hash=''\ncanvas_r2_contract_hash=''\n",
    )
    source = replace_exact(source, "| length) == 8 and", "| length) == 9 and")

    source = replace_exact(
        source,
        """container_image() {
  docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true
}

wait_container_healthy() {""",
        """container_image() {
  docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true
}

verify_canvas_r2_source_config() {
  local key count endpoint access_key secret_key
  local -a required_keys=(
    TEMP_MEDIA_S3_ENDPOINT TEMP_MEDIA_S3_REGION TEMP_MEDIA_S3_BUCKET
    TEMP_MEDIA_S3_ACCESS_KEY_ID TEMP_MEDIA_S3_SECRET_ACCESS_KEY TEMP_MEDIA_S3_PREFIX
    TEMP_MEDIA_MAX_BYTES TEMP_MEDIA_MAX_ACTIVE_PER_USER TEMP_MEDIA_MAX_ACTIVE_BYTES_PER_USER
    TEMP_MEDIA_RETENTION_HOURS TEMP_MEDIA_UPLOAD_URL_TTL_MINUTES TEMP_MEDIA_ASSET_URL_TTL_MINUTES
  )
  test "$(stat -c '%u:%g:%a' "$canvas_r2_env")" = '0:0:600'
  test "$(stat -c '%u:%g:%a' "$canvas_r2_compose")" = '0:0:640'
  for key in "${required_keys[@]}"; do
    count=$(awk -F= -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$canvas_r2_env")
    test "$count" = 1
  done
  endpoint=$(awk -F= '$1 == "TEMP_MEDIA_S3_ENDPOINT" { print substr($0, index($0, "=") + 1) }' "$canvas_r2_env")
  access_key=$(awk -F= '$1 == "TEMP_MEDIA_S3_ACCESS_KEY_ID" { print substr($0, index($0, "=") + 1) }' "$canvas_r2_env")
  secret_key=$(awk -F= '$1 == "TEMP_MEDIA_S3_SECRET_ACCESS_KEY" { print substr($0, index($0, "=") + 1) }' "$canvas_r2_env")
  [[ "$endpoint" =~ ^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com$ ]]
  [[ "$access_key" =~ ^[A-Za-z0-9]{16,}$ ]]
  [[ "$secret_key" =~ ^[A-Za-z0-9/+=._-]{32,}$ ]]
  grep -Fqx 'TEMP_MEDIA_S3_REGION=auto' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_S3_BUCKET=worldcodes-canvas-temp' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_S3_PREFIX=canvas-temp' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_MAX_BYTES=536870912' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_MAX_ACTIVE_PER_USER=50' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_MAX_ACTIVE_BYTES_PER_USER=2147483648' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_RETENTION_HOURS=24' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_UPLOAD_URL_TTL_MINUTES=15' "$canvas_r2_env"
  grep -Fqx 'TEMP_MEDIA_ASSET_URL_TTL_MINUTES=1440' "$canvas_r2_env"
}

canvas_r2_source_contract_hash() {
  LC_ALL=C awk -F= '$1 ~ /^TEMP_MEDIA_[A-Z0-9_]+$/ { print }' "$canvas_r2_env" |
    LC_ALL=C sort |
    sha256sum |
    awk '{print $1}'
}

verify_canvas_r2_container_env() {
  docker inspect "$1" | jq -e '
    .[0].Config.Env
    | map(capture("^(?<key>[^=]+)=(?<value>.*)$"))
    | from_entries as $env
    | ($env.TEMP_MEDIA_S3_ENDPOINT | test("^https://[0-9a-f]{32}[.]r2[.]cloudflarestorage[.]com$")) and
      $env.TEMP_MEDIA_S3_REGION == "auto" and
      $env.TEMP_MEDIA_S3_BUCKET == "worldcodes-canvas-temp" and
      (($env.TEMP_MEDIA_S3_ACCESS_KEY_ID | type) == "string") and
      ($env.TEMP_MEDIA_S3_ACCESS_KEY_ID | length) >= 16 and
      (($env.TEMP_MEDIA_S3_SECRET_ACCESS_KEY | type) == "string") and
      ($env.TEMP_MEDIA_S3_SECRET_ACCESS_KEY | length) >= 32 and
      $env.TEMP_MEDIA_S3_PREFIX == "canvas-temp" and
      $env.TEMP_MEDIA_MAX_BYTES == "536870912" and
      $env.TEMP_MEDIA_MAX_ACTIVE_PER_USER == "50" and
      $env.TEMP_MEDIA_MAX_ACTIVE_BYTES_PER_USER == "2147483648" and
      $env.TEMP_MEDIA_RETENTION_HOURS == "24" and
      $env.TEMP_MEDIA_UPLOAD_URL_TTL_MINUTES == "15" and
      $env.TEMP_MEDIA_ASSET_URL_TTL_MINUTES == "1440"
  ' >/dev/null
  test "$(
    docker inspect "$1" |
      jq -r '.[0].Config.Env[] | select(test("^TEMP_MEDIA_[A-Z0-9_]+="))' |
      LC_ALL=C sort |
      sha256sum |
      awk '{print $1}'
  )" = "$canvas_r2_contract_hash"
}

wait_container_healthy() {""",
    )

    hash_pair = (
        'test "$(sha256_of /etc/caddy/Caddyfile.private)" = "$expected_caddy_private_hash"\n'
        'test "$(sha256_of /etc/caddy/Caddyfile.relay-itest)" = "$expected_caddy_itest_hash"'
    )
    source = replace_exact(
        source,
        hash_pair,
        'test "$(sha256_of /etc/caddy/Caddyfile.private)" = "$expected_caddy_private_hash"\n'
        'test "$(sha256_of /etc/caddy/Caddyfile.canvas)" = "$expected_caddy_canvas_hash"\n'
        'test "$(sha256_of /etc/caddy/Caddyfile.relay-itest)" = "$expected_caddy_itest_hash"',
        count=3,
    )

    live_shape = (
        'test "$(awk \'{n+=gsub(/3001/,"&")} END{print n+0}\' /etc/caddy/Caddyfile.private)" = 3\n'
        "verify_live_upstreams"
    )
    source = replace_exact(
        source,
        live_shape,
        'test "$(awk \'{n+=gsub(/3001/,"&")} END{print n+0}\' /etc/caddy/Caddyfile.private)" = 3\n'
        "test \"$(grep -Fxc 'import /etc/caddy/Caddyfile.canvas' /etc/caddy/Caddyfile)\" = 1\n"
        'test "$(awk \'{n+=gsub(/127\\.0\\.0\\.1:3000/,"&")} END{print n+0}\' /etc/caddy/Caddyfile.canvas)" = 1\n'
        "verify_live_upstreams",
        count=2,
    )

    source = replace_exact(
        source,
        'cp -a /etc/caddy/Caddyfile.private "$caddy_private_backup"\n'
        'cp -a /etc/caddy/Caddyfile.relay-itest "$caddy_itest_backup"',
        'cp -a /etc/caddy/Caddyfile.private "$caddy_private_backup"\n'
        'cp -a /etc/caddy/Caddyfile.canvas "$caddy_canvas_backup"\n'
        'cp -a /etc/caddy/Caddyfile.relay-itest "$caddy_itest_backup"',
    )
    source = replace_exact(
        source,
        'test "$(sha256_of "$caddy_private_backup")" = "$expected_caddy_private_hash"\n'
        'test "$(sha256_of "$caddy_itest_backup")" = "$expected_caddy_itest_hash"',
        'test "$(sha256_of "$caddy_private_backup")" = "$expected_caddy_private_hash"\n'
        'test "$(sha256_of "$caddy_canvas_backup")" = "$expected_caddy_canvas_hash"\n'
        'test "$(sha256_of "$caddy_itest_backup")" = "$expected_caddy_itest_hash"',
    )

    source = replace_exact(
        source,
        'container_healthy new-api-postgres\n'
        'container_healthy new-api-redis\n'
        'test "$(sha256_of /etc/caddy/Caddyfile)" = "$expected_caddy_hash"',
        'container_healthy new-api-postgres\n'
        'container_healthy new-api-redis\n'
        'test "$(sha256_of "$canvas_r2_compose")" = "$expected_canvas_r2_compose_hash"\n'
        'verify_canvas_r2_source_config\n'
        'canvas_r2_env_hash=$(sha256_of "$canvas_r2_env")\n'
        'canvas_r2_contract_hash=$(canvas_r2_source_contract_hash)\n'
        'test "$(sha256_of /etc/caddy/Caddyfile)" = "$expected_caddy_hash"',
    )

    source = replace_exact(
        source,
        'cmp \\\n'
        '  <("${dc_history[@]}" config --format json | jq -S .) \\\n'
        '  <("${dc_base[@]}" config --format json | jq -S .)\n\n'
        "stage='image_load'",
        'cmp \\\n'
        '  <("${dc_history[@]}" config --format json | jq -S .) \\\n'
        '  <("${dc_base[@]}" config --format json | jq -S .)\n\n'
        'test "$(sha256_of "$canvas_r2_compose")" = "$expected_canvas_r2_compose_hash"\n'
        'verify_canvas_r2_source_config\n'
        'test "$(sha256_of "$canvas_r2_env")" = "$canvas_r2_env_hash"\n'
        'dc_base+=(-f "$canvas_r2_compose")\n'
        '"${dc_base[@]}" config --quiet\n'
        '"${dc_base[@]}" config --format json | jq -e \'\n'
        '  .services["new-api"].environment as $env |\n'
        '  ($env.TEMP_MEDIA_S3_ENDPOINT | test("^https://[0-9a-f]{32}[.]r2[.]cloudflarestorage[.]com$")) and\n'
        '  $env.TEMP_MEDIA_S3_REGION == "auto" and\n'
        '  $env.TEMP_MEDIA_S3_BUCKET == "worldcodes-canvas-temp" and\n'
        '  (($env.TEMP_MEDIA_S3_ACCESS_KEY_ID | type) == "string") and\n'
        '  ($env.TEMP_MEDIA_S3_ACCESS_KEY_ID | length) >= 16 and\n'
        '  (($env.TEMP_MEDIA_S3_SECRET_ACCESS_KEY | type) == "string") and\n'
        '  ($env.TEMP_MEDIA_S3_SECRET_ACCESS_KEY | length) >= 32 and\n'
        '  $env.TEMP_MEDIA_S3_PREFIX == "canvas-temp" and\n'
        '  $env.TEMP_MEDIA_MAX_BYTES == "536870912" and\n'
        '  $env.TEMP_MEDIA_MAX_ACTIVE_PER_USER == "50" and\n'
        '  $env.TEMP_MEDIA_MAX_ACTIVE_BYTES_PER_USER == "2147483648" and\n'
        '  $env.TEMP_MEDIA_RETENTION_HOURS == "24" and\n'
        '  $env.TEMP_MEDIA_UPLOAD_URL_TTL_MINUTES == "15" and\n'
        '  $env.TEMP_MEDIA_ASSET_URL_TTL_MINUTES == "1440"\n'
        "' >/dev/null\n"
        'test "$(\n'
        '  "${dc_base[@]}" config --format json |\n'
        '    jq -r \'.services["new-api"].environment | to_entries[] | select(.key | test("^TEMP_MEDIA_[A-Z0-9_]+$")) | "\\(.key)=\\(.value)"\' |\n'
        '    LC_ALL=C sort |\n'
        '    sha256sum |\n'
        "    awk '{print $1}'\n"
        ')" = "$canvas_r2_contract_hash"\n\n'
        "stage='image_load'",
    )

    source = replace_exact(
        source,
        'install -o root -g root -m 0644 "$caddy_private_green" "$caddy_private_green_active"\n\n'
        'cp -a "$caddy_blue_backup" "$caddy_green"',
        'install -o root -g root -m 0644 "$caddy_private_green" "$caddy_private_green_active"\n\n'
        'cp -a "$caddy_canvas_backup" "$caddy_canvas_green"\n'
        'test "$(awk \'{n+=gsub(/127\\.0\\.0\\.1:3000/,"&")} END{print n+0}\' "$caddy_canvas_green")" = 1\n'
        "sed -i 's/127\\.0\\.0\\.1:3000/127.0.0.1:13000/g' \"$caddy_canvas_green\"\n"
        'test "$(awk \'{n+=gsub(/127\\.0\\.0\\.1:13000/,"&")} END{print n+0}\' "$caddy_canvas_green")" = 1\n'
        'test "$(awk \'{n+=gsub(/127\\.0\\.0\\.1:3000/,"&")} END{print n+0}\' "$caddy_canvas_green")" = 0\n'
        'install -o root -g root -m 0644 "$caddy_canvas_green" "$caddy_canvas_green_active"\n\n'
        'cp -a "$caddy_blue_backup" "$caddy_green"',
    )
    source = replace_exact(
        source,
        "stage='green_start'\n"
        '! container_exists "$green_name"',
        "stage='green_start'\n"
        'test "$(sha256_of "$canvas_r2_env")" = "$canvas_r2_env_hash"\n'
        '! container_exists "$green_name"',
    )
    source = replace_exact(
        source,
        'verify_new_api_security_shape "$green_name" 13000 slave false\n'
        'test "$(docker inspect -f \'{{.RestartCount}}\' "$green_name")" = 0',
        'verify_new_api_security_shape "$green_name" 13000 slave false\n'
        'verify_canvas_r2_container_env "$green_name"\n'
        'test "$(docker inspect -f \'{{.RestartCount}}\' "$green_name")" = 0',
    )
    source = replace_exact(
        source,
        "stage='canonical_rebuild'\n"
        '"${dc_release[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 240 new-api',
        "stage='canonical_rebuild'\n"
        'test "$(sha256_of "$canvas_r2_env")" = "$canvas_r2_env_hash"\n'
        '"${dc_release[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 240 new-api',
    )
    source = replace_exact(
        source,
        'verify_canonical_security_shape\n'
        'verify_schema_gate',
        'verify_canonical_security_shape\n'
        'verify_canvas_r2_container_env new-api\n'
        'verify_schema_gate',
    )
    source = replace_exact(
        source,
        'test "$(grep -Fxc "import ${caddy_private_green_active}" "$caddy_green")" = 1\n'
        'test "$(grep -Fxc \'import /etc/caddy/Caddyfile.relay-itest\' "$caddy_green")" = 1',
        'test "$(grep -Fxc "import ${caddy_private_green_active}" "$caddy_green")" = 1\n'
        'test "$(grep -Fxc \'import /etc/caddy/Caddyfile.canvas\' "$caddy_green")" = 1\n'
        'sed -i "s#^import /etc/caddy/Caddyfile\\.canvas$#import ${caddy_canvas_green_active}#" "$caddy_green"\n'
        'test "$(grep -Fxc "import ${caddy_canvas_green_active}" "$caddy_green")" = 1\n'
        'test "$(grep -Fxc \'import /etc/caddy/Caddyfile.relay-itest\' "$caddy_green")" = 1',
    )
    source = replace_exact(
        source,
        "printf 'caddy_routes=8@127.0.0.1:3000\\n'",
        "printf 'caddy_routes=9@127.0.0.1:3000\\n'",
    )

    source = replace_exact(
        source,
        "stage='final_verify'\n"
        'test "$(container_image new-api)" = "$new_image"',
        "stage='final_verify'\n"
        'test "$(sha256_of "$canvas_r2_env")" = "$canvas_r2_env_hash"\n'
        'test "$(container_image new-api)" = "$new_image"',
    )

    validate_contract(source, main_hash, canvas_hash, canvas_r2_compose_hash)
    return source


def validate_contract(source: str, main_hash: str, canvas_hash: str, canvas_r2_compose_hash: str) -> None:
    required = (
        MARKER,
        f"readonly expected_caddy_hash='{main_hash}'",
        f"readonly expected_caddy_canvas_hash='{canvas_hash}'",
        f"readonly expected_canvas_r2_compose_hash='{canvas_r2_compose_hash}'",
        'readonly caddy_canvas_green_active="/etc/caddy/Caddyfile.canvas.green-${short_revision}"',
        'readonly canvas_r2_compose="/etc/worldcodes/docker-compose.canvas-r2.yml"',
        'readonly canvas_r2_env="/etc/worldcodes/relay-temporary-media.env"',
        'cp -a /etc/caddy/Caddyfile.canvas "$caddy_canvas_backup"',
        'sed -i "s#^import /etc/caddy/Caddyfile\\.canvas$#import ${caddy_canvas_green_active}#" "$caddy_green"',
        'dc_base+=(-f "$canvas_r2_compose")',
        'verify_canvas_r2_container_env "$green_name"',
        'verify_canvas_r2_container_env new-api',
        'canvas_r2_contract_hash=$(canvas_r2_source_contract_hash)',
        'TEMP_MEDIA_S3_PREFIX=canvas-temp',
        '| length) == 9 and',
        "printf 'caddy_routes=9@127.0.0.1:3000\\n'",
    )
    missing = [item for item in required if item not in source]
    if missing:
        raise ValueError(f"patched release is missing Canvas blue-green contract: {missing}")
    if source.count('test "$(sha256_of /etc/caddy/Caddyfile.canvas)" = "$expected_caddy_canvas_hash"') != 3:
        raise ValueError("Canvas fragment hash is not guarded in every release phase")
    if source.count("grep -Fxc 'import /etc/caddy/Caddyfile.canvas' /etc/caddy/Caddyfile") != 2:
        raise ValueError("Canvas import is not guarded at preflight and final verification")


def bash_syntax_check(source: str) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".sh", delete=False) as handle:
        handle.write(source)
        temp_path = pathlib.Path(handle.name)
    try:
        subprocess.run(["bash", "-n", str(temp_path)], check=True)
    finally:
        temp_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("check", "apply"))
    parser.add_argument("--script", required=True, type=pathlib.Path)
    parser.add_argument("--expected-main-caddy-sha256", required=True)
    parser.add_argument("--expected-canvas-caddy-sha256", required=True)
    parser.add_argument("--expected-canvas-r2-compose-sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for value in (
        args.expected_main_caddy_sha256,
        args.expected_canvas_caddy_sha256,
        args.expected_canvas_r2_compose_sha256,
    ):
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise SystemExit("Pinned hashes must be 64 lowercase hex characters")
    source = args.script.read_text(encoding="utf-8")
    patched = patch_release(
        source,
        args.expected_main_caddy_sha256,
        args.expected_canvas_caddy_sha256,
        args.expected_canvas_r2_compose_sha256,
    )
    bash_syntax_check(patched)
    if args.mode == "check":
        print("validated=yes")
        print(f"changed={'yes' if patched != source else 'no'}")
        return 0

    if patched == source:
        print("already_patched=yes")
        return 0
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = args.script.with_name(f"{args.script.name}.before-canvas.{stamp}")
    shutil.copy2(args.script, backup)
    mode = stat.S_IMODE(args.script.stat().st_mode)
    temporary = args.script.with_name(f".{args.script.name}.canvas-next.{os.getpid()}")
    temporary.write_text(patched, encoding="utf-8")
    temporary.chmod(mode)
    os.replace(temporary, args.script)
    print(f"patched={args.script}")
    print(f"rollback={backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
