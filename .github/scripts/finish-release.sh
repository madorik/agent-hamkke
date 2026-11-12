#!/usr/bin/env bash
# 초안 릴리스의 macOS 공증이 끝났는지 Apple 에 물어보고, 끝났으면 dmg 에 공증표를 붙여(staple) 릴리스를 공개한다.
# 빌드(release.yml)는 Apple 에 보내기만 하고 끝나므로, Apple 이 몇 시간 늦어도 빌드는 실패하지 않는다.
#
# 사용: finish-release.sh <tag> [기다릴 분, 기본 45]
# 필요한 환경 변수: GH_TOKEN, GH_REPO, APPLE_API_KEY(.p8 파일 경로), APPLE_API_KEY_ID, APPLE_API_ISSUER
#
# 끝내는 값: 0 = 공개했거나 아직 Apple 이 확인 중(30분 뒤 Finish release 가 다시 본다)
#           1 = 파일이 빠졌거나 Apple 이 거절했다(사람이 봐야 한다)
set -euo pipefail

tag=$1
minutes=${2:-45}
archs=(arm64 x64)
auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
work=$(mktemp -d)

# 네트워크가 잠깐 끊겨도 몇 번 더 해 본다
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge 5 ]; then return 1; fi
    sleep $((n * 20))
  done
}

# 1) 빌드가 올려 둔 파일이 다 있는지
assets=$(retry gh release view "$tag" --json assets --jq '.assets[].name')
missing=()
for f in Agent-Hamkke-win-x64.exe; do
  grep -qx "$f" <<<"$assets" || missing+=("$f")
done
for a in "${archs[@]}"; do
  for f in "Agent-Hamkke-mac-$a.dmg" "Agent-Hamkke-mac-$a.zip" "notary-mac-$a.txt"; do
    grep -qx "$f" <<<"$assets" || missing+=("$f")
  done
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::$tag is missing ${missing[*]}. Build it again: Actions > Release > Run workflow, tag $tag."
  exit 1
fi

# 2) Apple 의 답을 기다린다. 한 번 묻다 끊겨도 다음 번에 다시 묻는다.
ids=()
for a in "${archs[@]}"; do
  ids+=("$(retry gh release download "$tag" --pattern "notary-mac-$a.txt" --output - | tr -d '[:space:]')")
done
deadline=$(($(date +%s) + minutes * 60))
while :; do
  waiting=0
  for i in "${!archs[@]}"; do
    id=${ids[$i]}
    status=$(xcrun notarytool info "$id" "${auth[@]}" --output-format json 2>/dev/null | jq -r '.status // empty' || true)
    echo "mac-${archs[$i]} ($id): ${status:-no answer, will ask again}"
    case $status in
      Accepted) ;;
      Invalid | Rejected)
        echo "::error::Apple rejected the mac-${archs[$i]} build ($status). Its log follows."
        xcrun notarytool log "$id" "${auth[@]}" || true
        exit 1
        ;;
      *) waiting=1 ;;
    esac
  done
  if [ "$waiting" -eq 0 ]; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::notice::Apple is still checking $tag. The Finish release workflow checks again every 30 minutes and publishes it when Apple is done."
    exit 0
  fi
  sleep 60
done

# 3) dmg 에 공증표를 붙인다(인터넷 없이도 열리게). 못 붙여도 공증은 끝났으니 온라인에선 열린다.
for a in "${archs[@]}"; do
  dmg="$work/Agent-Hamkke-mac-$a.dmg"
  retry gh release download "$tag" --pattern "Agent-Hamkke-mac-$a.dmg" --dir "$work" --clobber
  if retry xcrun stapler staple "$dmg"; then
    retry gh release upload "$tag" --clobber "$dmg"
  else
    echo "::warning::Couldn't staple mac-$a.dmg. It's notarized, so it still opens on a Mac that's online."
  fi
done

# 4) 공개하고, 공증 번호 파일은 지운다(공개 뒤라 Finish release 가 다시 집어 들지 않는다)
retry gh release edit "$tag" --draft=false --latest
for a in "${archs[@]}"; do
  gh release delete-asset "$tag" "notary-mac-$a.txt" --yes || true
done
echo "Published $tag"
