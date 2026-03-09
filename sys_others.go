//go:build !windows

package main

import "syscall"

func (a *App) setupWindowsAttr(attr *syscall.SysProcAttr) {
	
}