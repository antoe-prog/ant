PLUGIN_NAME := FinalJudoAuthorizationPlugin
BUNDLE_ID := kr.co.finaljudo.multigym.authorizationplugin
VERSION := 1.0.0
BUILD_DIR := build
BUNDLE_DIR := $(BUILD_DIR)/$(PLUGIN_NAME).bundle
CONTENTS_DIR := $(BUNDLE_DIR)/Contents
MACOS_DIR := $(CONTENTS_DIR)/MacOS
INFO_PLIST := $(CONTENTS_DIR)/Info.plist
EXECUTABLE := $(MACOS_DIR)/$(PLUGIN_NAME)
SOURCE := Sources/AuthorizationPlugin.c
SDKROOT := $(shell xcrun --sdk macosx --show-sdk-path)
CC := xcrun clang

CFLAGS := -std=c17 -Wall -Wextra -Werror -fvisibility=hidden -isysroot $(SDKROOT) -mmacosx-version-min=13.0
LDFLAGS := -bundle -framework Security -framework CoreFoundation

.PHONY: all clean lint inspect

all: $(EXECUTABLE)

$(CONTENTS_DIR) $(MACOS_DIR):
	mkdir -p "$@"

$(INFO_PLIST): Info.plist.in | $(CONTENTS_DIR)
	sed \
		-e 's/@PLUGIN_NAME@/$(PLUGIN_NAME)/g' \
		-e 's/@BUNDLE_ID@/$(BUNDLE_ID)/g' \
		-e 's/@VERSION@/$(VERSION)/g' \
		"$<" > "$@"
	plutil -lint "$@"

$(EXECUTABLE): $(SOURCE) $(INFO_PLIST) | $(MACOS_DIR)
	$(CC) $(CFLAGS) $(SOURCE) $(LDFLAGS) -o "$@"
	codesign --force --sign - --timestamp=none "$(BUNDLE_DIR)"

lint: $(INFO_PLIST)
	$(CC) $(CFLAGS) -fsyntax-only $(SOURCE)

inspect: $(EXECUTABLE)
	file "$(EXECUTABLE)"
	codesign --verify --deep --strict --verbose=2 "$(BUNDLE_DIR)"
	codesign --display --verbose=2 "$(BUNDLE_DIR)"

clean:
	rm -rf "$(BUILD_DIR)"
