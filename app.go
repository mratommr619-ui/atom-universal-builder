package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"isDir"`
	Children []*FileNode `json:"children"`
}

type App struct {
	ctx         context.Context
	stdin       io.WriteCloser
	projectPath string // လက်ရှိ အလုပ်လုပ်နေတဲ့ Folder လမ်းကြောင်းကို မှတ်ထားဖို့
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.initTerminal()
}

func (a *App) initTerminal() {
	var shell string
	var args []string
	if runtime.GOOS == "windows" {
		shell = "cmd.exe"
		// /K သုံးပြီး Prompt ကို အမြဲရှင်သန်နေအောင် လုပ်ထားတယ်
		args = []string{"/K", "echo [ATOM SHELL READY]"}
	} else {
		shell = "sh"
		args = []string{"-i"}
	}
	cmd := exec.Command(shell, args...)
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

func (a *App) GetFlutterVersion() (string, error) {
	cmd := exec.Command("flutter", "--version")
	out, err := cmd.Output()
	if err != nil {
		return "Flutter Unknown", nil
	}
	return string(out), nil
}

// Terminal Command ပို့တဲ့နေရာမှာ ပိုပြီး အဆင်ပြေအောင် ပြင်ထားတယ်
func (a *App) ExecuteCommand(input string) {
	if a.stdin != nil {
		inputLower := strings.ToLower(strings.TrimSpace(input))
		
		// CD command ရိုက်ရင် အထဲရောက်မရောက် သိသာအောင် list command ပါ တွဲပို့ပေးမယ်
		if strings.HasPrefix(inputLower, "cd ") {
			var autoList string
			if runtime.GOOS == "windows" {
				autoList = " & dir /w"
			} else {
				autoList = " && ls"
			}
			io.WriteString(a.stdin, input + autoList + "\n")
		} else {
			io.WriteString(a.stdin, input + "\n")
		}
	}
}

// --- EXPLORER & TERMINAL PATH SYNC ---

func (a *App) OpenFolder() (*FileNode, error) {
	path, _ := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{Title: "Open Project Folder"})
	if path == "" {
		return nil, nil
	}
	
	a.projectPath = path // လမ်းကြောင်းအသစ်ကို သိမ်းမယ်

	if a.stdin != nil {
		if runtime.GOOS == "windows" {
			// /d switch သုံးမှ drive မတူတာတွေကိုပါ တစ်ခါတည်း ပြောင်းပေးမှာပါ
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

// UI ကနေ Folder တစ်ခုခုကို Right-Click နှိပ်ပြီး ဝင်ချင်တဲ့အခါ သုံးဖို့
func (a *App) CdIntoFolder(path string) {
	if a.stdin != nil {
		if runtime.GOOS == "windows" {
			io.WriteString(a.stdin, fmt.Sprintf("cd /d \"%s\"\n", path))
		} else {
			io.WriteString(a.stdin, fmt.Sprintf("cd \"%s\"\n", path))
		}
	}
}

// --- EXPLORER CRUD OPERATIONS ---

func (a *App) CreateNewFile(parentPath string, fileName string) error {
	fullPath := filepath.Join(parentPath, fileName)
	f, err := os.Create(fullPath)
	if err != nil { return err }
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

// --- DIRECTORY READER ---

func (a *App) readDir(path string) *FileNode {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	node := &FileNode{Name: filepath.Base(path), Path: path, IsDir: info.IsDir()}
	if info.IsDir() {
		files, _ := ioutil.ReadDir(path)
		for _, f := range files {
			// Hidden files နဲ့ build folder တွေကို ဖျောက်ထားမယ်
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

func (a *App) CreateProject(name string) {
	go func() {
		name = strings.ReplaceAll(name, " ", "_")
		path, _ := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{Title: "Select Folder"})
		if path != "" && name != "" {
			wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> Initializing Flutter Create: "+name)
			var cmd *exec.Cmd
			if runtime.GOOS == "windows" {
				cmd = exec.Command("cmd", "/C", "flutter create "+name)
			} else {
				cmd = exec.Command("flutter", "create", name)
			}
			cmd.Dir = path
			cmd.Run()
			
			projectPath := filepath.Join(path, name)
			a.projectPath = projectPath
			
			if a.stdin != nil {
				if runtime.GOOS == "windows" {
					io.WriteString(a.stdin, fmt.Sprintf("cd /d \"%s\"\n", projectPath))
				} else {
					io.WriteString(a.stdin, fmt.Sprintf("cd \"%s\"\n", projectPath))
				}
				io.WriteString(a.stdin, "echo [SUCCESS] Project Created.\n")
			}
		}
	}()
}

func (a *App) RunDebug(path string, platform string) {
	// Debug မလုပ်ခင် terminal ကို အဲ့ဒီ path ထဲအရင်သွင်းမယ်
	a.CdIntoFolder(path)
	a.ExecuteCommand("flutter run -d " + strings.ToLower(platform))
}

func (a *App) BuildPlatform(path string, platform string) {
	go func() {
		p := strings.ToLower(platform)
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> Building Release: "+p)

		var cmd *exec.Cmd
		if p == "ios" {
			cmd = exec.Command("flutter", "build", "ios", "--release", "--no-codesign")
		} else {
			cmd = exec.Command("flutter", "build", p, "--release")
		}

		cmd.Dir = path
		out, _ := cmd.CombinedOutput()
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", string(out))

		var outPath string
		switch p {
		case "apk":
			outPath = filepath.Join(path, "build", "app", "outputs", "flutter-apk")
		case "appbundle":
			outPath = filepath.Join(path, "build", "app", "outputs", "bundle", "release")
		case "ios":
			outPath = filepath.Join(path, "build", "ios", "iphoneos")
		case "windows":
			outPath = filepath.Join(path, "build", "windows", "x64", "runner", "Release")
		case "macos":
			outPath = filepath.Join(path, "build", "macos", "Build", "Products", "Release")
		case "linux":
			outPath = filepath.Join(path, "build", "linux", "x64", "release", "bundle")
		default:
			outPath = filepath.Join(path, "build")
		}

		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> [FINISH] Opening Folder: "+outPath)

		if runtime.GOOS == "windows" {
			exec.Command("explorer", outPath).Run()
		} else if runtime.GOOS == "darwin" {
			exec.Command("open", outPath).Run()
		} else {
			exec.Command("xdg-open", outPath).Run()
		}
	}()
}

func (a *App) GetToolsByVersion() []map[string]string {
	return []map[string]string{
		{"name": "Flutter Win", "url": "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.0-stable.zip", "desc": "Win SDK", "filename": "flutter_win.zip"},
		{"name": "Flutter Mac", "url": "https://storage.googleapis.com/flutter_infra_release/releases/stable/macos/flutter_macos_3.24.0-stable.zip", "desc": "Mac SDK", "filename": "flutter_mac.zip"},
		{"name": "Flutter Linux", "url": "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.24.0-stable.tar.xz", "desc": "Linux SDK", "filename": "flutter_linux.tar.xz"},
		{"name": "JDK 17 (Win)", "url": "https://download.oracle.com/java/17/latest/jdk-17_windows-x64_bin.exe", "desc": "Java 17 Win", "filename": "jdk_win.exe"},
		{"name": "JDK 17 (Mac)", "url": "https://download.oracle.com/java/17/latest/jdk-17_macos-x64_bin.dmg", "desc": "Java 17 Mac", "filename": "jdk_mac.dmg"},
		{"name": "JDK 17 (Linux)", "url": "https://download.oracle.com/java/17/latest/jdk-17_linux-x64_bin.tar.gz", "desc": "Java 17 Linux", "filename": "jdk_linux.tar.gz"},
	}
}

func (a *App) DownloadAndRunTool(url string, filename string) {
	go func() {
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> Downloading "+filename)
		home, _ := os.UserHomeDir()
		tmpPath := filepath.Join(home, "Downloads", filename)
		out, err := os.Create(tmpPath)
		if err != nil { return }
		resp, err := http.Get(url)
		if err != nil { return }
		defer resp.Body.Close()
		io.Copy(out, resp.Body)
		out.Close()
		wailsRuntime.EventsEmit(a.ctx, "terminal_log", ">> Success: "+tmpPath)
		if runtime.GOOS == "windows" {
			exec.Command("explorer", "/select,", tmpPath).Run()
		} else {
			exec.Command("open", filepath.Dir(tmpPath)).Run()
		}
	}()
}