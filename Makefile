.DEFAULT_GOAL := help

FRONTEND_DOMAIN ?= retros.nhost.app
CLOUDFLARE_DISPATCH_NAMESPACE ?= nhost-app
WRANGLER ?= wrangler
WRANGLER_DEPLOY_ARGS ?=

export FRONTEND_DOMAIN CLOUDFLARE_DISPATCH_NAMESPACE WRANGLER

.PHONY: help deploy-frontend
help:
	@printf 'make deploy-frontend    Build and deploy to %s\n' "$$FRONTEND_DOMAIN"
	@echo 'Override FRONTEND_DOMAIN with another <name>.nhost.app hostname.'
	@echo 'Use WRANGLER_DEPLOY_ARGS=--dry-run to build without publishing.'

# The infra dispatcher maps <name>.nhost.app to Worker <name> in nhost-app.
# No per-app DNS record, Worker route, or custom domain is needed.
deploy-frontend:
	@sh scripts/deploy-frontend.sh $(WRANGLER_DEPLOY_ARGS)
