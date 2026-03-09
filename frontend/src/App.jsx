import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import './App.css';
import * as API from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";

function App() {
    const [fileTree, setFileTree] = useState(null);
    const [openFiles, setOpenFiles] = useState([]);
    const [activePath, setActivePath] = useState("");
    const [expandedFolders, setExpandedFolders] = useState({});
    
    // Modal States
    const [showWizard, setShowWizard] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    
    // UI Dialog States
    const [confirmAction, setConfirmAction] = useState({ show: false, type: "", path: "", name: "", newName: "" });
    const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, path: "", isDir: false });

    const [pName, setPName] = useState("");
    const [fVersion, setFVersion] = useState("Checking...");
    const [tools, setTools] = useState([]);
    const [logs, setLogs] = useState(["[SYSTEM] ATOM IDE READY"]);
    const [cmdInput, setCmdInput] = useState("");
    const logEndRef = useRef(null);
    const tabContainerRef = useRef(null); 
    const [copyStatus, setCopyStatus] = useState(false);
    const [draggedTabIdx, setDraggedTabIdx] = useState(null);

    const platforms = ['apk', 'appbundle', 'ios', 'windows', 'macos', 'linux', 'web'];

    const copyAddress = () => {
        const address = "0x56824c51be35937da7E60a6223E82cD1795984cC";
        navigator.clipboard.writeText(address).then(() => {
            setCopyStatus(true);
            setTimeout(() => setCopyStatus(false), 2000);
        });
    };

    // Keyboard Shortcuts & Global Clicks
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveCurrentFile();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        const closeMenu = () => setContextMenu(prev => ({ ...prev, show: false }));
        window.addEventListener('click', closeMenu);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('click', closeMenu);
        };
    }, [activePath, openFiles]);

    // Initial Load & Event Listeners
    useEffect(() => {
        if (API.GetFlutterVersion) {
            API.GetFlutterVersion().then(v => {
                const match = v.match(/\d+\.\d+\.\d+/); 
                const ver = match ? match[0] : v.split('•')[0].replace('Flutter','').trim();
                setFVersion(ver);
            }).catch(() => setFVersion("N/A"));
        }
        if (API.GetToolsByVersion) {
            API.GetToolsByVersion().then(setTools);
        }

        // Terminal Log listener
        const offLog = EventsOn("terminal_log", m => setLogs(p => [...p, m]));
        
        // 👇 TERMINAL CLEAR EVENT (Backend က လှမ်းခေါ်ရင် Log ရှင်းပေးမယ်)
        const offClear = EventsOn("terminal_clear", () => setLogs([]));

        return () => {
            if (offLog) offLog();
            if (offClear) offClear();
        };
    }, []);

    // Auto Scroll Terminal
    useEffect(() => { 
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: "smooth" }); 
        }
    }, [logs]);

    const handleOpenFolder = () => {
        API.OpenFolder().then(node => {
            if (node) {
                setFileTree(node);
                setExpandedFolders(prev => ({ ...prev, [node.path]: true })); 
            }
        });
    };

    const refreshExplorer = () => {
        if (fileTree?.path) { handleOpenFolder(); }
    };

    const saveCurrentFile = () => {
        const file = openFiles.find(f => f.path === activePath);
        if (file && API.SaveFile) {
            API.SaveFile(file.path, file.content)
                .then(() => setLogs(p => [...p, `[SYSTEM] Saved: ${file.name}`]))
                .catch(err => setLogs(p => [...p, `[ERROR] Save failed: ${err}`]));
        }
    };

    const handleOpenFile = (path, name) => {
        if (!openFiles.find(f => f.path === path)) {
            API.ReadFile(path).then(content => {
                setOpenFiles(prev => [...prev, { path, name, content }]);
                setActivePath(path);
            });
        } else { setActivePath(path); }
    };

    const handleFileDropToEditor = (e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData("fileData");
        if (data) {
            const { path, name, isDir } = JSON.parse(data);
            if (!isDir) handleOpenFile(path, name);
        }
    };

    // Tab Scroll Handler (Mouse Wheel)
    const handleTabScroll = (e) => {
        if (tabContainerRef.current) {
            tabContainerRef.current.scrollLeft += e.deltaY;
        }
    };

    const onContextMenu = (e, path, isDir) => {
        e.preventDefault();
        e.stopPropagation();
        const menuWidth = 160;
        const menuHeight = isDir ? 160 : 100;
        let x = e.pageX;
        let y = e.pageY;
        if (x + menuWidth > window.innerWidth) x -= menuWidth;
        if (y + menuHeight > window.innerHeight) y -= menuHeight;
        setContextMenu({ show: true, x, y, path, isDir });
    };

    const triggerConfirm = (type, path) => {
        const name = path.split(/[\\/]/).pop();
        setConfirmAction({ show: true, type, path, name, newName: name });
        setContextMenu(p => ({ ...p, show: false }));
    };

    const renderFileTree = (node) => {
        if (!node) return null;
        return (
            <div key={node.path} style={{ marginLeft: '12px' }}>
                <div className={node.isDir ? "folder" : "file"} 
                     draggable={!node.isDir}
                     onDragStart={(e) => {
                         if(!node.isDir) e.dataTransfer.setData("fileData", JSON.stringify(node));
                     }}
                     style={{ backgroundColor: activePath === node.path ? "#333" : "transparent" }}
                     onContextMenu={(e) => onContextMenu(e, node.path, node.isDir)}
                     onClick={() => node.isDir ? setExpandedFolders(p => ({...p, [node.path]: !p[node.path]})) : handleOpenFile(node.path, node.name)}>
                    {node.isDir ? (expandedFolders[node.path] ? "📂 " : "📁 ") : "📄 "}{node.name}
                </div>
                {node.isDir && expandedFolders[node.path] && node.children?.map(child => renderFileTree(child))}
            </div>
        );
    };

    const currentFile = openFiles.find(f => f.path === activePath) || { content: "" };

    const handleEditorChange = (value) => {
        setOpenFiles(prev => prev.map(f => f.path === activePath ? { ...f, content: value } : f));
    };

    return (
        <div className="ide-root">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" />
            
            <header className="navbar">
                <div className="nav-left">
                    <div className="menu">File 
                        <div className="drop">
                            <p onClick={() => setShowCreate(true)}>New Project</p>
                            <p onClick={handleOpenFolder}>Open Folder</p>
                            <p onClick={saveCurrentFile}>Save (Ctrl+S)</p>
                        </div>
                    </div>
                    <div className="menu">Debug 
                        <div className="drop">
                            {platforms.map(p => (
                                <p key={p} onClick={() => API.RunDebug(fileTree?.path || "", p)}>{p.toUpperCase()}</p>
                            ))}
                        </div>
                    </div>
                    <div className="menu">Build 
                        <div className="drop">
                            {platforms.map(p => (
                                <p key={p} onClick={() => API.BuildPlatform(fileTree?.path || "", p)}>{p.toUpperCase()}</p>
                            ))}
                        </div>
                    </div>
                    <div className="menu" onClick={() => setShowWizard(true)}>Setup Wizard</div>
                    <div className="menu" onClick={() => setShowAbout(true)}>About</div>
                </div>
                <div className="nav-center rainbow-text">ATOM UNIVERSAL BUILDER</div>
                <div className="nav-right version-box">Flutter : {fVersion}</div>
            </header>

            <div className="workspace">
                <aside className="sidebar">
                    <div className="stitle">EXPLORER</div>
                    <div className="tree-box">
                        {fileTree ? renderFileTree(fileTree) : <p style={{color:'#444', padding:'10px', fontSize:'11px'}}>No Project Open</p>}
                    </div>
                </aside>

                <main className="editor-area" 
                      onDragOver={(e) => e.preventDefault()} 
                      onDrop={handleFileDropToEditor}>
                    
                    <div className="tab-container" 
                         ref={tabContainerRef} 
                         onWheel={handleTabScroll}
                         style={{ 
                            display: 'flex', 
                            overflowX: 'auto', 
                            overflowY: 'hidden',
                            whiteSpace: 'nowrap', 
                            width: '100%',
                            minWidth: '0',
                            height: '35px',
                            background: '#252526',
                            scrollbarWidth: 'none', 
                            msOverflowStyle: 'none'
                         }}>
                        {openFiles.map((f, i) => (
                            <div 
                                key={f.path} 
                                className={`tab ${activePath === f.path ? "active" : ""}`} 
                                onClick={() => setActivePath(f.path)}
                                draggable
                                onDragStart={() => setDraggedTabIdx(i)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    e.stopPropagation();
                                    const newFiles = [...openFiles];
                                    const item = newFiles.splice(draggedTabIdx, 1)[0];
                                    newFiles.splice(i, 0, item);
                                    setOpenFiles(newFiles);
                                }}
                                style={{ 
                                    flexShrink: 0, 
                                    minWidth: '130px', 
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '0 10px',
                                    cursor: 'pointer',
                                    borderRight: '1px solid #1e1e1e',
                                    userSelect: 'none'
                                }}
                            >
                                <span style={{ fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                <span className="tab-close" 
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          const n = openFiles.filter(of => of.path !== f.path);
                                          setOpenFiles(n);
                                          if (activePath === f.path) setActivePath(n.length > 0 ? n[0].path : "");
                                      }}>×</span>
                            </div>
                        ))}
                    </div>

                    <Editor 
                        height="calc(100% - 35px)" 
                        theme="vs-dark" 
                        language="dart" 
                        value={currentFile.content} 
                        onChange={handleEditorChange}
                        options={{ fontSize: 14, automaticLayout: true, minimap: { enabled: false } }}
                    />
                </main>
            </div>

            <footer className="terminal">
                <div className="term-body">
                    {logs.map((l, i) => <div key={i} className="log-line">{l}</div>)}
                    <div className="term-input-line">
                        <span className="prompt">$</span>
                        <input className="term-input" value={cmdInput} onChange={(e)=>setCmdInput(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter' && cmdInput.trim() !== ""){ API.ExecuteCommand(cmdInput); setCmdInput(""); }}} />
                    </div>
                    <div ref={logEndRef} />
                </div>
            </footer>

            {contextMenu.show && (
                <div className="context-menu floating-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    {contextMenu.isDir && (
                        <>
                            <p onClick={() => { const name = prompt("File Name:"); if(name) API.CreateNewFile(contextMenu.path, name).then(refreshExplorer); }}><i className="fas fa-file-plus"></i> New File</p>
                            <p onClick={() => { const name = prompt("Folder Name:"); if(name) API.CreateNewFolder(contextMenu.path, name).then(refreshExplorer); }}><i className="fas fa-folder-plus"></i> New Folder</p>
                            <div className="menu-divider"></div>
                        </>
                    )}
                    <p onClick={() => triggerConfirm("rename", contextMenu.path)}><i className="fas fa-edit"></i> Rename</p>
                    <p className="danger" onClick={() => triggerConfirm("delete", contextMenu.path)}><i className="fas fa-trash"></i> Delete</p>
                </div>
            )}

            {confirmAction.show && (
                <div className="modal-overlay">
                    <div className="modal-dark dialog-box">
                        <h3 className={confirmAction.type === 'delete' ? 'text-danger' : 'rainbow-text'}>{confirmAction.type.toUpperCase()}</h3>
                        <p style={{margin: '15px 0', fontSize: '13px'}}>{confirmAction.type === 'delete' ? `Delete "${confirmAction.name}"?` : `Rename "${confirmAction.name}":`}</p>
                        {confirmAction.type === 'rename' && <input className="ide-input" value={confirmAction.newName} onChange={(e) => setConfirmAction(p => ({...p, newName: e.target.value}))} autoFocus />}
                        <div style={{marginTop: '20px', textAlign: 'right'}}>
                            <button onClick={() => setConfirmAction({show:false})}>Cancel</button>
                            <button className={confirmAction.type === 'delete' ? 'btn-danger' : 'btn-ok'} style={{marginLeft: '10px'}} onClick={() => {
                                if(confirmAction.type === 'delete') { API.DeleteItem(confirmAction.path).then(refreshExplorer); setOpenFiles(prev => prev.filter(f => f.path !== confirmAction.path)); }
                                else { API.RenameItem(confirmAction.path, confirmAction.newName).then(refreshExplorer); }
                                setConfirmAction({show:false});
                            }}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {showCreate && (
                <div className="modal-overlay">
                    <div className="modal-dark">
                        <h3>New Project</h3>
                        <input 
                            className="ide-input" 
                            value={pName} 
                            onChange={(e) => setPName(e.target.value)} 
                            placeholder="Project name..."
                            autoFocus
                        />
                    <div className="modal-buttons">
                    <button className="btn-ok" onClick={() => { API.CreateProject(pName); setShowCreate(false); }}>
                    Create
                    </button>
                    <button className="btn-cancel" onClick={() => setShowCreate(false)}>
                    Cancel
                    </button>
                    </div>
                    </div>
                </div>
        )}

            {showWizard && (
                <div className="modal-overlay">
                    <div className="wizard-card" style={{ maxWidth: '800px', maxHeight: '80vh', overflowY: 'auto' }}>
                        <h3 className="rainbow-text">ATOM SETUP WIZARD</h3>
                        <div className="tool-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px', padding: '10px' }}>
                            {tools.map((t, i) => (
                                <div key={i} className="tool-card" style={{ border: '1px solid #333', padding: '15px', borderRadius: '8px', background: '#1e1e1e' }}>
                                    <div style={{fontWeight:'bold', marginBottom: '5px'}}>{t.name}</div>
                                    <button className="inst-btn" onClick={() => API.DownloadAndRunTool(t.url, t.filename)}>Download</button>
                                </div>
                            ))}
                        </div>
                        <button style={{display:'block', margin:'20px auto'}} onClick={() => setShowWizard(false)}>Close</button>
                    </div>
                </div>
            )}
            
            {showAbout && (
                <div className="modal-overlay">
                    <div className="modal-dark about-card">
                        <h2 className="rainbow-text">ATOM Universal Builder</h2>
                        <div className="about-content">
                            <p>Developed by: <b>Mr. Atom</b></p>
                            <p>Engine: Wails + React + Go</p>
                            <p className="coffee">Please, Buy me a coffee if you don't mind.</p>
                            <div className="support-container" style={{textAlign:'center', marginTop:'20px'}}>
                                <p>Wallet: 0x56824c51be35937da7E60a6223E82cD1795984cC</p>
                                <button onClick={copyAddress} className="copy-btn"><i className="fas fa-copy"></i></button>
                                {copyStatus && <div style={{color:'green', fontSize:'11px'}}>Copied!</div>}
                            </div>
                        </div>
                        <button className="btn-ok" style={{marginTop:'20px'}} onClick={()=>setShowAbout(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;