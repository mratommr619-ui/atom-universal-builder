package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Progress ကို တွက်ပေးဖို့အတွက် Custom WriteCounter
type WriteCounter struct {
	Total      uint64
	Downloaded uint64
	ctx        context.Context
	fileName   string
}

func (wc *WriteCounter) Write(p []byte) (int, error) {
	n := len(p)
	wc.Downloaded += uint64(n)
	if wc.Total > 0 {
		percentage := float64(wc.Downloaded) / float64(wc.Total) * 100
		// 1MB တိုင်းမှာ Progress လှမ်းပို့မယ်
		if int(wc.Downloaded)%1048576 == 0 || wc.Downloaded == wc.Total {
			msg := fmt.Sprintf(">> [DOWNLOADING] %s: %.2f%%", wc.fileName, percentage)
			wailsRuntime.EventsEmit(wc.ctx, "terminal_log", msg)
		}
	}
	return n, nil
}

type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Children []*FileNode `json:"children"`
}

type App struct {
	ctx         context.Context
	stdin       io.WriteCloser
	projectPath string
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.initTerminal()
}

// --- Terminal Core (Single Persistent Session) ---
func (a *App) initTerminal() {
	var shell string
	var args []string
	if runtime.GOOS == "windows" {
		shell = "cmd.exe"
		args = []string{"/K", "echo [ATOM SHELL READY]"}
	} else {
		shell = "sh"
		args = []string{"-i"}
	}
	cmd := exec.Command(shell, args...)

	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow:    true,
			CreationFlags: 0x08000000,
		}
	}

	cmd.Env = os.Environ()
	a.stdin, _ = cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	cmd.Start()

	go func() {
		reader := io.MultiReader(stdout, stderr)
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", scanner.Text())
		}
	}()
}

// --- ExecuteCommand Function (Fix: Moved outside initTerminal) ---
func (a *App) ExecuteCommand(input string) {
	if a.stdin != nil {
		trimmedInput := strings.TrimSpace(input)
		inputLower := strings.ToLower(trimmedInput)

		if strings.HasPrefix(inputLower, "cd ") {
			targetPath := strings.TrimSpace(input[3:])
			var fullCmd string
			if runtime.GOOS == "windows" {
				fullCmd = fmt.Sprintf("cd /d \"%s\" & dir /w\n", targetPath)
			} else {
				fullCmd = fmt.Sprintf("cd \"%s\" && ls\n", targetPath)
			}
			io.WriteString(a.stdin, fullCmd)
		} else {
			io.WriteString(a.stdin, input+"\n")
		}
	}
}

// --- File & Project Operations ---

func (a *App) OpenFolder() (*FileNode, error) {
	path, _ := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{Title: "Open Project Folder"})
	if path == "" {
		return nil, nil
	}

	a.projectPath = path

	if a.stdin != nil {
		if runtime.GOOS == "windows" {
			io.WriteString(a.stdin, fmt.Sprintf("cd /d \"%s\"\n", path))
			io.WriteString(a.stdin, "echo Current Directory: %cd%\n")
		} else {
			io.WriteString(a.stdin, fmt.Sprintf("cd \"%s\"\n", path))
			io.WriteString(a.stdin, "echo Current Directory: $(pwd)\n")
		}
	}

	os.Chdir(path)
	return a.readDir(path), nil
}

func (a *App) CdIntoFolder(path string) {
	if a.stdin != nil {
		if runtime.GOOS == "windows" {
			io.WriteString(a.stdin, fmt.Sprintf("cd /d \"%s\"\n", path))
		} else {
			io.WriteString(a.stdin, fmt.Sprintf("cd \"%s\"\n", path))
		}
	}
}

func (a *App) CreateNewFile(parentPath string, fileName string) error {
	fullPath := filepath.Join(parentPath, fileName)
	f, err := os.Create(fullPath)
	if err != nil {
		return err
	}
	f.Close()
	return nil
}

func (a *App) CreateNewFolder(parentPath string, folderName string) error {
	fullPath := filepath.Join(parentPath, folderName)
	return os.MkdirAll(fullPath, 0755)
}

func (a *App) DeleteItem(path string) error {
	return os.RemoveAll(path)
}

func (a *App) RenameItem(oldPath string, newName string) error {
	dir := filepath.Dir(oldPath)
	newPath := filepath.Join(dir, newName)
	return os.Rename(oldPath, newPath)
}

func (a *App) readDir(path string) *FileNode {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	node := &FileNode{Name: filepath.Base(path), Path: path, IsDir: info.IsDir()}
	if info.IsDir() {
		files, _ := os.ReadDir(path)
		for _, f := range files {
			if f.Name()[0] == '.' || f.Name() == "build" || f.Name() == ".dart_tool" {
				continue
			}
			child := a.readDir(filepath.Join(path, f.Name()))
			if child != nil {
				node.Children = append(node.Children, child)
			}
		}
	}
	return node
}

func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) SaveFile(path string, content string) error {
	if path == "" {
		return nil
	}
	return os.WriteFile(path, []byte(content), 0644)
}

// --- Flutter Commands (Integrated) ---

func (a *App) GetFlutterVersion() (string, error) {
	cmd := exec.Command("flutter", "--version")
	out, err := cmd.Output()
	if err != nil {
		return "Flutter Unknown", nil
	}
	return string(out), nil
}

func (a *App) CreateProject(name string) {
	go func() {
		cleanName := strings.ToLower(strings.ReplaceAll(name, " ", "_"))
		path, _ := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{Title: "Select Folder"})

		if path != "" && cleanName != "" {
			a.CdIntoFolder(path)
			a.ExecuteCommand("flutter create " + cleanName)

			projectPath := filepath.Join(path, cleanName)
			a.projectPath = projectPath

			a.CdIntoFolder(projectPath)
			a.ExecuteCommand("echo [SUCCESS] Project Created: " + cleanName)
		}
	}()
}

func (a *App) RunDebug(path string, platform string) {
	a.CdIntoFolder(path)
	a.ExecuteCommand("flutter run -d " + strings.ToLower(platform))
}

// --- SECURED RELEASE BUILD (Full Support) ---
func (a *App) BuildPlatform(path string, platform string) {
	go func() {
		p := strings.ToLower(platform)
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [RELEASE] Building Secured: "+p)

		debugInfoPath := filepath.Join(path, "build", "debug-info")
		os.MkdirAll(debugInfoPath, 0755)

		var buildCmd string
		switch p {
		case "web":
			buildCmd = "flutter build web --release --base-href=./"
		case "ios":
			buildCmd = fmt.Sprintf("flutter build ios --release --no-codesign --obfuscate --split-debug-info=\"%s\"", debugInfoPath)
		case "apk":
			buildCmd = fmt.Sprintf("flutter build apk --release --obfuscate --split-debug-info=\"%s\"", debugInfoPath)
		case "appbundle":
			buildCmd = fmt.Sprintf("flutter build appbundle --release --obfuscate --split-debug-info=\"%s\"", debugInfoPath)
		case "windows":
			buildCmd = fmt.Sprintf("flutter build windows --release --obfuscate --split-debug-info=\"%s\"", debugInfoPath)
		case "macos":
			buildCmd = fmt.Sprintf("flutter build macos --release --obfuscate --split-debug-info=\"%s\"", debugInfoPath)
		case "linux":
			buildCmd = fmt.Sprintf("flutter build linux --release --obfuscate --split-debug-info=\"%s\"", debugInfoPath)
		default:
			buildCmd = fmt.Sprintf("flutter build %s --release --obfuscate --split-debug-info=\"%s\"", p, debugInfoPath)
		}

		a.CdIntoFolder(path)
		a.ExecuteCommand(buildCmd)
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> Build command sent to shell.")
	}()
}

func (a *App) openDirectory(path string) {
	if runtime.GOOS == "windows" {
		exec.Command("explorer", path).Run()
	} else if runtime.GOOS == "darwin" {
		exec.Command("open", path).Run()
	} else {
		exec.Command("xdg-open", path).Run()
	}
}

// --- Tools & Downloads ---

func (a *App) GetToolsByVersion() []map[string]string {
	osType := runtime.GOOS
	tools := []map[string]string{}

	// --- 1. Flutter SDK (OS အလိုက် သီးသန့်ပြမည်) ---
	if osType == "windows" {
		tools = append(tools, map[string]string{"name": "Flutter Windows", "url": "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.0-stable.zip", "desc": "Flutter SDK for Windows", "filename": "flutter_win.zip"})
	} else if osType == "darwin" {
		tools = append(tools, map[string]string{"name": "Flutter macOS (Apple Silicon)", "url": "https://storage.googleapis.com/flutter_infra_release/releases/stable/macos/flutter_macos_arm64_3.24.0-stable.zip", "desc": "Flutter SDK for Mac (M1/M2/M3)", "filename": "flutter_mac_arm.zip"})
	} else {
		tools = append(tools, map[string]string{"name": "Flutter Linux", "url": "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.24.0-stable.tar.xz", "desc": "Flutter SDK for Linux", "filename": "flutter_linux.tar.xz"})
	}

	// --- 2. OS Specific Desktop Tools ---
	if osType == "darwin" {
		tools = append(tools, map[string]string{"name": "Xcode (App Store)", "url": "https://apps.apple.com/us/app/xcode/id497799835", "desc": "Required for iOS & macOS Builds", "filename": "xcode_link.html"})
		tools = append(tools, map[string]string{"name": "CocoaPods", "url": "https://guides.cocoapods.org/using/getting-started.html", "desc": "iOS Dependency Manager", "filename": "cocoapods_info.html"})
	}
	if osType == "windows" {
		tools = append(tools, map[string]string{"name": "Visual Studio Community", "url": "https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community&rel=17", "desc": "Required for Windows Apps", "filename": "vs_community.exe"})
	}

	// --- 3. Browsers & Common Tools ---
	tools = append(tools, map[string]string{"name": "Google Chrome", "url": "https://www.google.com/chrome/", "desc": "Required for Web Debugging", "filename": "chrome_installer.exe"})

	// --- 4. JDK 17 (OS အလိုက် Link ပြောင်းမည်) ---
	jdk := map[string]string{"name": "JDK 17", "desc": "Java for Android Build"}
	if osType == "windows" {
		jdk["url"] = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.msi"
		jdk["filename"] = "jdk_win.msi"
	} else if osType == "darwin" {
		jdk["url"] = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.12_7.pkg"
		jdk["filename"] = "jdk_mac.pkg"
	} else {
		jdk["url"] = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jdk_x64_linux_hotspot_17.0.12_7.tar.gz"
		jdk["filename"] = "jdk_linux.tar.gz"
	}
	tools = append(tools, jdk)

	// --- 5. Android Studio & Git (OS အလိုက် Installer ပြောင်းမည်) ---
	as := map[string]string{"name": "Android Studio", "desc": "Android SDK Manager"}
	git := map[string]string{"name": "Git", "desc": "Required for Flutter Packages"}

	if osType == "windows" {
		as["url"] = "https://redirector.gvt1.com/edgedl/android/studio/install/2024.1.1.11/android-studio-2024.1.1.11-windows.exe"
		as["filename"] = "android_studio.exe"
		git["url"] = "https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe"
		git["filename"] = "git_setup.exe"
	} else if osType == "darwin" {
		as["url"] = "https://redirector.gvt1.com/edgedl/android/studio/install/2024.1.1.11/android-studio-2024.1.1.11-mac_arm.dmg"
		as["filename"] = "android_studio_mac.dmg"
		git["url"] = "https://sourceforge.net/projects/git-osx-installer/files/git-2.33.0-intel-universal-mavericks.dmg/download"
		git["filename"] = "git_mac.dmg"
	}

	tools = append(tools, as)
	tools = append(tools, git)

	return tools
}

func (a *App) DownloadAndRunTool(url string, filename string) {
	go func() {
		wailsRuntime.EventsEmit(a.ctx, "terminal_clear", true) 
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [START] Downloading "+filename)
		home, _ := os.UserHomeDir()
		downloadsPath := filepath.Join(home, "Downloads")
		tmpPath := filepath.Join(downloadsPath, filename)

		// 1. Download with Percentage
		resp, err := http.Get(url)
		if err != nil {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [ERROR] Connection failed!")
			return
		}
		defer resp.Body.Close()

		out, err := os.Create(tmpPath)
		if err != nil {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [ERROR] File creation failed!")
			return
		}

		// မင်းရဲ့ WriteCounter ကို ပြန်သုံးပြီး Percentage ပြမယ်
		counter := &WriteCounter{
			Total:      uint64(resp.ContentLength),
			ctx:        a.ctx,
			fileName:   filename,
		}

		// io.TeeReader သုံးပြီး download ဆွဲရင်း percentage ပါ ပို့ပေးမယ်
		_, err = io.Copy(out, io.TeeReader(resp.Body, counter))
		out.Close() // ဒေါင်းပြီးရင် ဖိုင်ကို ပိတ်မှ နောက်ကောင်တွေ အလုပ်လုပ်လို့ရမှာ
		
		if err != nil {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [ERROR] Download interrupted!")
			return
		}

		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [SUCCESS] Download Finished: "+filename)

		// 2. Action Logic
		ext := strings.ToLower(filepath.Ext(filename))
		
		if ext == ".zip" {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [EXTRACTING] Unzipping, please wait...")
			extractDir := filepath.Join(downloadsPath, strings.TrimSuffix(filename, ext))
			os.MkdirAll(extractDir, 0755)

			psCmd := fmt.Sprintf("Expand-Archive -Path '%s' -DestinationPath '%s' -Force", tmpPath, extractDir)
			err := exec.Command("powershell", "-Command", psCmd).Run()
			
			if err != nil {
				wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [ERROR] Extraction failed!")
			} else {
				wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [FINISHED] Extracted to folder.")
				a.openDirectory(extractDir)
			}
		} else {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [LAUNCHING] Installer Page opened. Please finish the setup...")
			
			var cmd *exec.Cmd
			if runtime.GOOS == "windows" {
				// cmd /c start /wait သုံးရင် installer ပိတ်တဲ့အထိ စောင့်ပေးပါတယ်
				cmd = exec.Command("cmd", "/c", "start", "/wait", "", tmpPath)
			} else {
				cmd = exec.Command("open", "-W", tmpPath)
			}

			err := cmd.Run() // Installer window ပိတ်တဲ့အထိ ဒီမှာ တန့်နေမှာပါ

			if err != nil {
				wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [INFO] Installer closed.")
			} else {
				wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [DONE] Installation for "+filename+" is completed!")
			}
		}
	}()
}