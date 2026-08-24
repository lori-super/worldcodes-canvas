#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
relay_release_script=""
relay_env="${script_dir}/relay-temporary-media.env.example"
while (($#)); do
	case "$1" in
		--relay-release-script)
			(($# >= 2)) || { echo "Missing value for $1" >&2; exit 2; }
			relay_release_script="$2"
			shift 2
			;;
		--relay-env)
			(($# >= 2)) || { echo "Missing value for $1" >&2; exit 2; }
			relay_env="$2"
			shift 2
			;;
		*)
			echo "Usage: verify-canvas-deploy.sh [--relay-env PATH] [--relay-release-script PATH]" >&2
			exit 2
			;;
	esac
done

[[ -r "$relay_env" ]] || { echo "Relay env is not readable: $relay_env" >&2; exit 1; }

bash -n "${script_dir}/install-canvas-caddy.sh"
bash -n "${script_dir}/install-relay-r2-config.sh"
bash -n "${script_dir}/publish-canvas-release.sh"
python3 -m py_compile "${script_dir}/patch-relay-bluegreen-613a3820.py"

jq -e '
  .rules == [{
    id: "worldcodes-canvas-browser-upload",
    allowed: {
      origins: ["https://canvas.worldcodes.online"],
      methods: ["PUT", "HEAD"],
      headers: ["Content-Type", "x-amz-checksum-sha256"]
    },
    exposeHeaders: ["ETag"],
    maxAgeSeconds: 3600
  }]
' "${script_dir}/r2-cors.json" >/dev/null
jq -e '
  .rules[0].enabled == true and
  .rules[0].conditions.prefix == "canvas-temp/" and
  .rules[0].deleteObjectsTransition.condition == {type: "Age", maxAge: 86400} and
  .rules[0].abortMultipartUploadsTransition.condition == {type: "Age", maxAge: 86400}
' "${script_dir}/r2-lifecycle.json" >/dev/null

prompt_source_dir="${script_dir}/../../web/public/prompt-sources"
prompt_source_ids=(
	banana-prompt-quicker
	davidwu-gpt-image2-prompts
	freestylefly-gpt-image-2
	awesome-gpt-image
	awesome-gpt4o-image-prompts
	youmind-gpt-image-2
	youmind-nano-banana-pro
)
prompt_total=0
for prompt_source_id in "${prompt_source_ids[@]}"; do
	prompt_source_file="${prompt_source_dir}/${prompt_source_id}.json"
	[[ -s "$prompt_source_file" ]] || { echo "Missing built-in prompt source: $prompt_source_file" >&2; exit 1; }
	prompt_count="$(jq -er 'if type == "array" and all(.[]; (.title | type == "string" and length > 0) and (.prompt | type == "string" and length > 0)) then length else error("invalid prompt source") end' "$prompt_source_file")"
	prompt_total=$((prompt_total + prompt_count))
done
[[ "$prompt_total" == "1730" ]] || { echo "Unexpected built-in prompt total: $prompt_total" >&2; exit 1; }

relay_prefix_entries="$({
	sed -nE 's/^[[:space:]]*(export[[:space:]]+)?TEMP_MEDIA_S3_PREFIX[[:space:]]*=[[:space:]]*([^#[:space:]]+)[[:space:]]*(#.*)?$/\2/p' "$relay_env"
} || true)"
relay_prefix_count="$(printf '%s\n' "$relay_prefix_entries" | awk 'NF { count++ } END { print count + 0 }')"
if [[ "$relay_prefix_count" != "1" ]]; then
	echo "Relay env must contain exactly one non-empty TEMP_MEDIA_S3_PREFIX: $relay_env" >&2
	exit 1
fi
relay_prefix="$relay_prefix_entries"
relay_prefix="${relay_prefix#\"}"
relay_prefix="${relay_prefix%\"}"
relay_prefix="${relay_prefix#\'}"
relay_prefix="${relay_prefix%\'}"
relay_prefix="${relay_prefix#/}"
relay_prefix="${relay_prefix%/}"
lifecycle_prefix="$(jq -er '.rules[0].conditions.prefix' "${script_dir}/r2-lifecycle.json")"
lifecycle_prefix="${lifecycle_prefix#/}"
lifecycle_prefix="${lifecycle_prefix%/}"
if [[ -z "$relay_prefix" || "$relay_prefix" != "$lifecycle_prefix" ]]; then
	echo "TEMP_MEDIA_S3_PREFIX ($relay_prefix) does not match the R2 lifecycle prefix ($lifecycle_prefix)" >&2
	exit 1
fi

temporary="$(mktemp -d "${TMPDIR:-/tmp}/worldcodes-canvas-contract.XXXXXX")"
cleanup() {
	rm -rf -- "$temporary"
}
trap cleanup EXIT

rendered="${temporary}/Caddyfile"
adapted="${temporary}/caddy.json"
compose_base="${temporary}/docker-compose.base.yml"
compose_validation="${temporary}/docker-compose.validation.yml"
compose_installed="${temporary}/docker-compose.installed.yml"
sed \
	-e "s#__R2_ORIGIN__#https://00000000000000000000000000000000.r2.cloudflarestorage.com#g" \
	-e "s#__RELAY_PORT__#3000#g" \
	"${script_dir}/Caddyfile.canvas" >"$rendered"
if grep -Fq 'raw.githubusercontent.com' "$rendered"; then
	echo "Canvas connect policy must not allow raw.githubusercontent.com" >&2
	exit 1
fi
if ! grep -Fq "connect-src 'self' data: https://00000000000000000000000000000000.r2.cloudflarestorage.com" "$rendered"; then
	echo "Canvas connect policy must allow same-site, inline data and the exact R2 origin" >&2
	exit 1
fi
printf 'services:\n  new-api:\n    image: worldcodes-relay:validation-only\n' >"$compose_base"
sed "s#__TEMP_MEDIA_ENV_FILE__#${relay_env}#" \
	"${script_dir}/docker-compose.canvas-r2.yml" >"$compose_validation"
sed 's#__TEMP_MEDIA_ENV_FILE__#/etc/worldcodes/relay-temporary-media.env#' \
	"${script_dir}/docker-compose.canvas-r2.yml" >"$compose_installed"

docker compose -f "$compose_base" -f "$compose_validation" config --quiet
if command -v sha256sum >/dev/null 2>&1; then
	canvas_r2_compose_hash="$(sha256sum "$compose_installed" | awk '{print $1}')"
else
	canvas_r2_compose_hash="$(shasum -a 256 "$compose_installed" | awk '{print $1}')"
fi

if command -v caddy >/dev/null 2>&1; then
	caddy adapt --config "$rendered" --adapter caddyfile >"$adapted"
elif command -v docker >/dev/null 2>&1 && docker image inspect caddy:2.10.2-alpine >/dev/null 2>&1; then
	docker run --rm -i caddy:2.10.2-alpine caddy adapt --config - --adapter caddyfile <"$rendered" >"$adapted"
else
	echo "Caddy 2.10.2 or the local caddy:2.10.2-alpine image is required" >&2
	exit 1
fi

jq -e '
  ([.. | objects | select(.handler? == "reverse_proxy") | .upstreams[]?.dial]
    | map(select(. == "127.0.0.1:3000")) | length) == 1 and
  ([.. | objects | select(.handler? == "file_server")] | length) == 2 and
  ([.. | objects | .expression? // empty | select(.name == "canvasAPI") | .expr
    | gsub("[[:space:]]"; "")] == [
      "(method(\u0027GET\u0027)&&path(\u0027/v1/models\u0027,\u0027/v1/images/content/*\u0027,\u0027/v1/images/tasks/*\u0027,\u0027/v1/videos/*\u0027))||" +
      "(method(\u0027POST\u0027)&&path(\u0027/v1/responses\u0027,\u0027/v1/audio/speech\u0027,\u0027/v1/images/generations\u0027,\u0027/v1/images/edits\u0027,\u0027/v1/videos\u0027,\u0027/v1/media/uploads/presign\u0027,\u0027/v1/media/uploads/*\u0027,\u0027/v1beta/models/*\u0027))||" +
      "(method(\u0027DELETE\u0027)&&path(\u0027/v1/media/uploads/*\u0027))"
    ]) and
  ([.. | objects | select(.path? == ["/api", "/api/*", "/v1", "/v1/*", "/v1beta", "/v1beta/*"])] | length) == 1
' "$adapted" >/dev/null

if [[ -n "$relay_release_script" ]]; then
	python3 "${script_dir}/patch-relay-bluegreen-613a3820.py" check \
		--script "$relay_release_script" \
		--expected-main-caddy-sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
		--expected-canvas-caddy-sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
		--expected-canvas-r2-compose-sha256 "$canvas_r2_compose_hash" >/dev/null
fi

echo "Canvas deployment contract is valid"
