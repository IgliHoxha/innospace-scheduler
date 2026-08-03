.DEFAULT_GOAL := help
.PHONY: help install install-local setup dev kill-dev build start lint lint-fix format format-check fmt check typecheck typecheck-tests test test-watch coverage verify clean secret purge docker-build docker-up docker-down docker-logs

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

install-local: ## Set up .env, install deps, and build for a local run
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example. Fill in your secrets.")
	npm install
	npm run build
	@echo "Done. Run 'make start' (prod) or 'make dev' to launch on http://localhost:4001"

setup: ## First-time dev setup: copy .env and install deps (no build)
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example. Fill in your secrets.")
	npm install
	@echo "Done. Run 'make dev' to launch on http://localhost:4001"

dev: kill-dev ## Run the dev server (http://localhost:4001), replacing any running one
	npm run dev

# Next picks a different port when 4001 is busy, so a forgotten server leaves you
# testing one app while editing another. Kill by port: pkill misses next-server.
kill-dev: ## Stop whatever is listening on port 4001
	@pids=$$(lsof -t -i:4001 2>/dev/null); \
	if [ -z "$$pids" ]; then echo "port 4001 is free"; exit 0; fi; \
	echo "stopping pid(s) on :4001: $$pids"; \
	kill $$pids 2>/dev/null || true; \
	for i in 1 2 3 4 5; do \
	  sleep 1; \
	  [ -z "$$(lsof -t -i:4001 2>/dev/null)" ] && break; \
	done; \
	pids=$$(lsof -t -i:4001 2>/dev/null); \
	if [ -n "$$pids" ]; then kill -9 $$pids 2>/dev/null || true; sleep 1; fi; \
	echo "port 4001 freed"

build: ## Production build
	npm run build

start: ## Run the production build
	npm run start

## ---- Code format & quality ----

format: ## Auto-format all files with Prettier
	npm run format

format-check: ## Check formatting without writing
	npm run format:check

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint and auto-fix
	npm run lint:fix

typecheck: ## TypeScript type check (no emit)
	npm run typecheck

typecheck-tests: ## Type-check the Vitest suite (separate tsconfig)
	npm run typecheck:tests

fmt: format lint-fix typecheck ## Format, lint --fix, then typecheck in one go

check: format-check lint typecheck typecheck-tests test ## CI-style: format, lint, types (app + tests) and the test suite

verify: check ## Alias for check

## ---- Tests ----

test: ## Run the Vitest suite once
	npm run test

test-watch: ## Run the tests in watch mode
	npm run test:watch

coverage: ## Run the tests with a V8 coverage report
	npm run test:coverage

## ---- Production config (Fly + Cloudflare) ----

# Cloudflare credentials for the purge, from a gitignored file. Kept out of .env
# because that one is the app's own config and is read by the dev server.
-include .env.deploy

# The only long-lived cached page. Availability expires on its own in 30s.
PURGE_URL ?= https://scheduler.innospacetirana.com/

secret: ## Set a Fly secret AND purge the edge: make secret KEY=CLOSE_HOUR VALUE=23
	@test -n "$(KEY)" || { echo "Usage: make secret KEY=NAME VALUE=value"; exit 1; }
	@test -n "$(VALUE)" || { echo "Usage: make secret KEY=NAME VALUE=value"; exit 1; }
	flyctl secrets set $(KEY)="$(VALUE)" --config fly.toml.example
	@$(MAKE) --no-print-directory purge

purge: ## Purge the booking page from Cloudflare's edge cache
	@test -n "$(CLOUDFLARE_ZONE_ID)" || { echo "CLOUDFLARE_ZONE_ID not set (see .env.deploy)"; exit 1; }
	@test -n "$(CLOUDFLARE_API_TOKEN)" || { echo "CLOUDFLARE_API_TOKEN not set (see .env.deploy)"; exit 1; }
	@umask 077; printf 'Authorization: Bearer %s\n' "$(CLOUDFLARE_API_TOKEN)" > .cf-hdr.tmp; \
	  curl --fail-with-body -sS -X POST \
	    "https://api.cloudflare.com/client/v4/zones/$(CLOUDFLARE_ZONE_ID)/purge_cache" \
	    -H "@.cf-hdr.tmp" -H "Content-Type: application/json" \
	    --data '{"files":["$(PURGE_URL)"]}' > /dev/null; \
	  rc=$$?; rm -f .cf-hdr.tmp; \
	  test $$rc -eq 0 && echo "purged $(PURGE_URL)" || { echo "purge failed"; exit $$rc; }

## ---- Docker ----

docker-build: ## Build the Docker image
	docker compose build

docker-up: ## Build and start the container in the background
	docker compose up -d --build

docker-down: ## Stop and remove the container (data kept)
	docker compose down

docker-logs: ## Tail container logs
	docker compose logs -f

clean: ## Remove build artifacts
	rm -rf .next
