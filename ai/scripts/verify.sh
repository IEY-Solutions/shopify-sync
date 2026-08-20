#!/usr/bin/env bash
# verify.sh — Gate determinístico. Detecta el stack, corre lint/typecheck/test/build y
# un guardarraíl contra tests debilitados. Sale 0 = VERIFY_PASS, !=0 = falla (ver ai/state/verify.log).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p ai/state
LOG="ai/state/verify.log"
: > "$LOG"
FAIL=0

run() { echo "+ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }
has_npm() { node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts['$1']?0:1)" 2>/dev/null; }

# ── Node / TS ──────────────────────────────────────────────
if [ -f package.json ]; then
  [ -f package-lock.json ] && run npm ci || true
  has_npm lint      && { run npm run lint      || FAIL=1; }
  has_npm typecheck && { run npm run typecheck || FAIL=1; }
  has_npm test      && { run npm test          || FAIL=1; }
  has_npm build     && { run npm run build     || FAIL=1; }
fi

# ── .NET ───────────────────────────────────────────────────
if ls ./*.sln ./**/*.csproj >/dev/null 2>&1; then
  run dotnet build --nologo || FAIL=1
  run dotnet test  --nologo || FAIL=1
fi

# ── Go ─────────────────────────────────────────────────────
[ -f go.mod ] && { run go vet ./... || FAIL=1; run go test ./... || FAIL=1; }

# ── Python ─────────────────────────────────────────────────
{ [ -f pyproject.toml ] || [ -f pytest.ini ]; } && { run python -m pytest -q || FAIL=1; }

# ── Package ownership gate ─────────────────────────────────
# When FEATURE_STATE and PACKAGE_ID are provided by the orchestrator, enforce package-owned paths before
# the deep package review. Without those variables, keep verify.sh usable as a generic project gate.
if [ -n "${FEATURE_STATE:-}" ] && [ -n "${PACKAGE_ID:-}" ]; then
  BASELINE="${BASELINE:-HEAD}"
  run python3 ai/scripts/check-owned-paths.py --state-file "$FEATURE_STATE" --package-id "$PACKAGE_ID" --baseline "$BASELINE" || FAIL=1
fi

# ── Guardarraíl anti-tests-debilitados (sobre el DIFF, no todo el repo) ─────
# Un marcador preexistente en OTRO archivo ya no bloquea toda tarea (falso-positivo DoS), y detectamos
# debilitamiento por BORRADO de asserts (no solo .skip/.only), que el grep global no veía.
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "+ guardrail (tests debilitados, sobre el diff)" | tee -a "$LOG"
  DIFF="$(git diff HEAD -- . 2>/dev/null || git diff -- . 2>/dev/null)"
  # (a) marcador de skip/only AGREGADO en el diff (línea que empieza con '+')
  # `\b` antes de xit/xdescribe: sin él, `xit\(` matchea dentro de `process.exit(`
  # y cualquier diff que agregue una salida con código distinto de cero falla el
  # gate. Es el falso-positivo DoS que este mismo guardarraíl dice evitar.
  # Un `xit(` real (inicio de línea, tras espacio o `;`) sigue teniendo frontera
  # de palabra y se sigue detectando.
  if printf '%s\n' "$DIFF" | grep -nE '^\+.*(\.skip\(|\.only\(|it\.only|test\.only|describe\.only|\bxit\(|\bxdescribe\(|\[Skip|\[Ignore|@pytest\.mark\.skip|TODO_WEAKEN_TEST)' | tee -a "$LOG" | grep -q .; then
    echo "VERIFY_FAIL: el diff AGREGA un marcador de test omitido/debilitado" | tee -a "$LOG"; FAIL=1
  fi
  # (b) el diff elimina más asserts de los que agrega (debilitamiento por borrado/cambio de valor esperado)
  ASSERT_RE='(assert|expect\(|Assert\.|\.Should\(|toBe|toEqual|toThrow|assertEqual|assertTrue|assertThat|EXPECT_|ASSERT_)'
  ADDED=$(printf '%s\n' "$DIFF" | grep -cE "^\+.*${ASSERT_RE}")
  REMOVED=$(printf '%s\n' "$DIFF" | grep -cE "^-.*${ASSERT_RE}")
  if [ "${REMOVED:-0}" -gt "${ADDED:-0}" ]; then
    echo "VERIFY_FAIL: el diff elimina más asserts (${REMOVED}) de los que agrega (${ADDED}) — posible debilitamiento" | tee -a "$LOG"; FAIL=1
  fi
else
  echo "+ (guardarraíl de tests salteado: no es repo git)" | tee -a "$LOG"
fi

if [ "$FAIL" -eq 0 ]; then echo "VERIFY_PASS" | tee -a "$LOG"; exit 0
else echo "VERIFY_FAIL" | tee -a "$LOG"; exit 1; fi
