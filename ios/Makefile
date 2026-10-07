PROJECT := DocVault.xcodeproj
SCHEME := DocVault
SIM ?= iPhone Air
DEST := platform=iOS Simulator,name=$(SIM)
DERIVED := build/DerivedData

.PHONY: generate build test run demo archive clean
generate:
	xcodegen generate
build: generate
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -destination '$(DEST)' -derivedDataPath $(DERIVED) build
test: generate
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -destination '$(DEST)' -derivedDataPath $(DERIVED) -collect-test-diagnostics never test
run: build
	@test -n "$(SIMID)" || (echo 'Set SIMID to a booted simulator UDID.' && exit 1)
	xcrun simctl install $(SIMID) $(DERIVED)/Build/Products/Debug-iphonesimulator/DocVault.app
	xcrun simctl launch $(SIMID) com.vanities.docvault
demo: build
	@test -n "$(SIMID)" || (echo 'Set SIMID to a booted simulator UDID.' && exit 1)
	xcrun simctl install $(SIMID) $(DERIVED)/Build/Products/Debug-iphonesimulator/DocVault.app
	xcrun simctl launch --terminate-running-process $(SIMID) com.vanities.docvault --demo
archive: generate
	xcodebuild archive -project $(PROJECT) -scheme $(SCHEME) -configuration Release -destination 'generic/platform=iOS' -archivePath build/DocVault.xcarchive
clean:
	rm -rf build
