//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework Foundation
#import <AppKit/AppKit.h>

void ningMakeWindowsTransparent(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		for (NSWindow *w in [NSApp windows]) {
			[w setOpaque:NO];
			[w setBackgroundColor:[NSColor clearColor]];
		}
	});
}
*/
import "C"

// makeWindowTransparent 让 macOS 窗口真正可透出桌面（Wails 仅设背景色不够）。
func makeWindowTransparent() {
	C.ningMakeWindowsTransparent()
}
