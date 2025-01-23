.PHONY: default
default: help

NPM_UPDATED=node_modules/.npm-updated
NPM?=$(shell which npm 2>/dev/null || echo .npm-not-found)
.npm-not-found:
	@echo "Could not find npm on the path. Please install"
	@exit 1

.PHONY: help
help:  ## Shows this help
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: prereqs
prereqs: $(NPM_UPDATED) roms

$(NPM_UPDATED): package.json
	$(NPM) install --production=false
	@touch $@

.PHONY: roms
ROM_DIR:=./node_modules/jsbeeb/roms
roms: $(ROM_DIR)/gxr.rom

$(ROM_DIR)/gxr.rom: $(NPM_UPDATED)
	curl -sL https://mdfs.net/System/ROMs/Graphics/GXR120 -o $@

WEBPACK:=./node_modules/webpack-cli/bin/cli.js
.PHONY: webpack
webpack: prereqs  ## Runs webpack (useful only for debugging webpack)
	$(NPM) run build

.PHONY: lint
lint: prereqs  ## Checks if the source currently matches code conventions
	$(NPM) run lint

.PHONY: lint-fix
lint-fix: prereqs  ## Checks if everything matches code conventions & fixes those which are trivial to do so
	$(NPM) run lint-fix

.PHONY: test
test: prereqs  ## Runs the tests
	$(NPM) run test
	@echo Tests pass

.PHONY: check
check: test lint-fix  ## Runs all checks required before committing (fixing trivial things automatically)

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
	echo $(HASH) > dist/git_hash
