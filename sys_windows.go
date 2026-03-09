//go:build windows

package main

import "syscall"

func (a *App) setupWindowsAttr(attr *syscall.SysProcAttr) {
	attr.HideWindow = true
	attr.CreationFlags = 0x08000000
}