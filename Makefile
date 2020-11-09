.PHONY: default
default: help

NPM?=$(shell which npm 2>/dev/null || echo .npm-not-found)
.npm-not-found:
	@echo "Could not find npm on the path. Please install"
	@exit 1

.PHONY: help
help:  ## Shows this help
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: prereqs
prereqs: node_modules

NODE_MODULES=.npm-updated
$(NODE_MODULES): package.json
	$(NPM) install
	@touch $@

WEBPACK:=./node_modules/webpack-cli/bin/cli.js
.PHONY: webpack
webpack: prereqs  ## Runs webpack (useful only for debugging webpack)
	$(NPM) run build

.PHONY: lint
lint: $(NODE_MODULES)  ## Checks if the source currently matches code conventions
	$(NPM) run lint

.PHONY: lint-fix
lint-fix: $(NODE_MODULES)  ## Checks if everything matches code conventions & fixes those which are trivial to do so
	$(NPM) run lint-fix

.PHONY: test
test: $(NODE_MODULES)  ## Runs the tests
	$(NPM) run test
	@echo Tests pass

.PHONY: check
check: $(NODE_MODULES) test lint-fix  ## Runs all checks required before committing (fixing trivial things automatically)
.PHONY: pre-commit
pre-commit: $(NODE_MODULES) test lint

.PHONY: clean
clean:  ## Cleans up everything
	rm -rf node_modules .*-updated .*-bin dist

.PHONY: run
run: prereqs  ## Runs a local version on port 8080
	$(NPM) start

HASH := $(shell git rev-parse HEAD)
.PHONY: dist
dist: export NODE_ENV=production
dist: export WEBPACK_ARGS=-p
dist: prereqs webpack  ## Creates a distribution
	echo $(HASH) > out/dist/git_hash

install-git-hooks:  ## Install git hooks that will ensure code is linted and tests are run before allowing a check in
	mkdir -p "$(shell git rev-parse --git-dir)/hooks"
	ln -sf "$(shell pwd)/scripts/pre-commit-hook.sh" "$(shell git rev-parse --git-dir)/hooks/pre-commit"
.PHONY: install-git-hooks
