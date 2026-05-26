#!/usr/bin/env bash
# Генерация TypeScript-типов из docs/keeper/openapi.yaml.
#
# Запуск: cd ui && npm run gen:api
#
# Не вызывается из vite build — оператор обновляет вручную при изменении
# openapi.yaml (так пайплайн остаётся явным и предсказуемым).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${UI_DIR}/.." && pwd)"

OPENAPI_PATH="${REPO_ROOT}/docs/keeper/openapi.yaml"
OUT_PATH="${UI_DIR}/src/api/types.gen.ts"

if [[ ! -f "${OPENAPI_PATH}" ]]; then
  echo "openapi spec not found: ${OPENAPI_PATH}" >&2
  exit 1
fi

cd "${UI_DIR}"
npx --no-install openapi-typescript "${OPENAPI_PATH}" -o "${OUT_PATH}"

echo "generated: ${OUT_PATH}"
