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
ROM_DIR:=./node_modules/jsbeeb/public/roms
# The GXR ROM is not ours to keep in the repo, so it is fetched once into a cache outside node_modules (where CI can
# keep it between runs, and npm reinstalling jsbeeb does not wipe it), checked against its hash, and copied in.
ROM_CACHE:=.cache/roms
GXR_URL:=https://mdfs.net/System/ROMs/Graphics/GXR120
GXR_SHA256:=d434f9288b737907c1937cf72e34bed51c1e07e6e31b422ae7922bc3063e4f5e
roms: $(ROM_DIR)/gxr.rom

$(ROM_CACHE)/gxr.rom:
	@mkdir -p $(dir $@)
	curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 120 -o $@.tmp $(GXR_URL) || { rm -f $@.tmp; exit 1; }
	@node -e 'const h=require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"); if (h !== process.argv[2]) { console.error("gxr.rom: expected sha256 " + process.argv[2] + " but got " + h); process.exit(1); }' $@.tmp $(GXR_SHA256) || { rm -f $@.tmp; exit 1; }
	mv $@.tmp $@

# Order-only on npm: installing must come first, but a newer install is no reason to copy the ROM again.
$(ROM_DIR)/gxr.rom: $(ROM_CACHE)/gxr.rom | $(NPM_UPDATED)
	@mkdir -p $(ROM_DIR)
	cp $< $@

.PHONY: build
build: prereqs  ## Builds the project
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
	rm -rf node_modules .*-updated .*-bin .cache dist

.PHONY: run
run: prereqs  ## Runs a local version on port 8080
	$(NPM) run dev

HASH := $(shell git rev-parse HEAD)
.PHONY: dist
dist: export NODE_ENV=production
dist: prereqs build  ## Creates a distribution
	echo $(HASH) > dist/git_hash
