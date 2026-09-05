.DEFAULT_GOAL := help

# Thin wrapper over package.json scripts. The scripts stay the source of truth —
# CI runs them directly (.github/workflows/ci.yml), so a target that diverged
# from its script would be green here and red there.

CORE_REPO ?= ../soul-stack

.PHONY: help
help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN{FS=":.*?## "}{printf "%-18s %s\n", $$1, $$2}'

.PHONY: install
install: ## npm ci (clean install from the lockfile)
	npm ci

.PHONY: dev
dev: ## vite dev server on :5173 (served under /ui/)
	npm run dev

.PHONY: lint
lint: ## eslint
	npm run lint

.PHONY: test
test: ## vitest, one pass
	npm test

.PHONY: build
build: ## tsc -b && vite build — this is the type gate too
	npm run build

.PHONY: gen-api
gen-api: ## regenerate src/api/types.gen.ts from vendor/openapi/keeper.yaml
	npm run gen:api

.PHONY: check-gen
# Compares the checked-in generated files against a fresh generation, NOT against
# git HEAD: on a ticket branch the re-vendored spec is legitimately uncommitted,
# and a HEAD comparison would call that drift.
check-gen: ## fail when the generated types are out of date with the vendored spec
	@cp src/api/types.gen.ts /tmp/.check-gen-types.$$$$ && \
	 cp src/api/constraints.gen.ts /tmp/.check-gen-consts.$$$$ && \
	 npm run --silent gen:api >/dev/null && \
	 if ! diff -q /tmp/.check-gen-types.$$$$ src/api/types.gen.ts >/dev/null || \
	    ! diff -q /tmp/.check-gen-consts.$$$$ src/api/constraints.gen.ts >/dev/null; then \
		echo "check-gen: FAIL - the generated files were stale for vendor/openapi/keeper.yaml."; \
		echo "  They have now been regenerated; review and commit them."; \
		rm -f /tmp/.check-gen-types.$$$$ /tmp/.check-gen-consts.$$$$; \
		exit 1; \
	 fi; \
	 rm -f /tmp/.check-gen-types.$$$$ /tmp/.check-gen-consts.$$$$; \
	 echo "check-gen: generated types match the vendored spec"

.PHONY: vendor-openapi
vendor-openapi: ## re-vendor the openapi spec + audit catalog from CORE_REPO, then regenerate
	@test -d "$(CORE_REPO)" || { echo "vendor-openapi: CORE_REPO=$(CORE_REPO) not found"; exit 1; }
	cp "$(CORE_REPO)/docs/keeper/openapi.yaml" vendor/openapi/keeper.yaml
	@# The audit catalog is a separate vendored file: OpenAPI carries the enum but
	@# src/test/auditEventLabels.test.ts reads this list (NIM-346).
	@{ grep '^#' vendor/openapi/audit-event-types.txt; \
	   grep -oE '^	"[a-z0-9._-]+",' "$(CORE_REPO)/shared/audit/event_types_gen.go" \
	     | sed -E 's/^	"//; s/",$$//' | sort -u; } > vendor/openapi/audit-event-types.txt.new
	mv vendor/openapi/audit-event-types.txt.new vendor/openapi/audit-event-types.txt
	$(MAKE) --no-print-directory gen-api

.PHONY: check
check: lint test build check-gen ## the full local gate — run this before merging a ticket branch
	@echo "check: lint + test + build + check-gen all green"

.PHONY: e2e
e2e: ## playwright e2e — needs a live stand (keeper :8080 + vite :5173)
	npm run test:e2e
