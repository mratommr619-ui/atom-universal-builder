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
    
    // Context Menu State
    const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, path: "", isDir: false });

    const [pName, setPName] = useState("");
    const [fVersion, setFVersion] = useState("Checking...");
    const [tools, setTools] = useState([]);
    const [logs, setLogs] = useState(["[SYSTEM] ATOM IDE READY"]);
    const [cmdInput, setCmdInput] = useState("");
    const logEndRef = useRef(null);

    // Copy Status State
    const [copyStatus, setCopyStatus] = useState(false);

    // --- Drag and Drop State ---
    const [draggedIdx, setDraggedIdx] = useState(null);

    const platforms = ['apk', 'appbundle', 'ios', 'windows', 'macos', 'linux', 'web'];

    const copyAddress = () => {
        const address = "0x56824c51be35937da7E60a6223E82cD1795984cC";
        navigator.clipboard.writeText(address).then(() => {
            setCopyStatus(true);
            setTimeout(() => setCopyStatus(false), 2000);
        });
    };

    // Keyboard Shortcuts & Click Listeners
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

    useEffect(() => {
        if (API.GetFlutterVersion) {
            API.GetFlutterVersion().then(v => {
                const ver = v.split('•')[0].replace('Flutter','').trim();
                setFVersion(ver);
            }).catch(() => setFVersion("N/A"));
        }
        if (API.GetToolsByVersion) {
            API.GetToolsByVersion().then(setTools);
        }
        const off = EventsOn("terminal_log", m => setLogs(p => [...p, m]));
        return () => off && off();
    }, []);

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

    const onContextMenu = (e, path, isDir) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            show: true,
            x: e.pageX,
            y: e.pageY,
            path: path,
            isDir: isDir
        });
    };

    // --- Drag & Drop Functions ---
    const onDragStart = (idx) => setDraggedIdx(idx);
    const onDragOver = (e) => e.preventDefault();
    const onDrop = (idx) => {
        const newFiles = [...openFiles];
        const item = newFiles.splice(draggedIdx, 1)[0];
        newFiles.splice(idx, 0, item);
        setOpenFiles(newFiles);
        setDraggedIdx(null);
    };

    const renderFileTree = (node) => {
        if (!node) return null;
        return (
            <div key={node.path} style={{ marginLeft: '12px' }}>
                <div className={node.isDir ? "folder" : "file"} 
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
                    <div className="tree-box" onContextMenu={(e) => fileTree && onContextMenu(e, fileTree.path, true)}>
                        {fileTree ? renderFileTree(fileTree) : <p style={{color:'#444', padding:'10px', fontSize:'11px'}}>No Project Open</p>}
                    </div>
                </aside>
                <main className="editor-area">
                    {/* Updated Tab Container with Horizontal Scroll */}
                    <div className="tab-container" style={{ overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex' }}>
                        {openFiles.map((f, i) => (
                            <div 
                                key={f.path} 
                                className={`tab ${activePath === f.path ? "active" : ""}`} 
                                onClick={() => setActivePath(f.path)}
                                draggable
                                onDragStart={() => onDragStart(i)}
                                onDragOver={onDragOver}
                                onDrop={() => onDrop(i)}
                                style={{ flexShrink: 0 }}
                            >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                <span className="tab-close" 
                                      style={{ fontSize: '18px', marginLeft: '15px', padding: '0 5px' }} 
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
                        height="100%" 
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
                        <input 
                            className="term-input" 
                            value={cmdInput} 
                            onChange={(e)=>setCmdInput(e.target.value)} 
                            onKeyDown={(e)=>{
                                if(e.key==='Enter' && cmdInput.trim() !== ""){
                                    API.ExecuteCommand(cmdInput); 
                                    setCmdInput("");
                                }
                            }} 
                            autoFocus
                        />
                    </div>
                    <div ref={logEndRef} />
                </div>
            </footer>

            {/* Context Menu, Modals stay same as original... */}
            {contextMenu.show && (
                <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    {contextMenu.isDir && (
                        <>
                            <p onClick={() => {
                                const name = prompt("File Name:");
                                if(name) API.CreateNewFile(contextMenu.path, name).then(handleOpenFolder);
                            }}>New File</p>
                            <p onClick={() => {
                                const name = prompt("Folder Name:");
                                if(name) API.CreateNewFolder(contextMenu.path, name).then(handleOpenFolder);
                            }}>New Folder</p>
                        </>
                    )}
                    <p onClick={() => {
                        const newName = prompt("Rename to:", contextMenu.path.split(/[\\/]/).pop());
                        if(newName) API.RenameItem(contextMenu.path, newName).then(handleOpenFolder);
                    }}>Rename</p>
                    <p className="danger" onClick={() => {
                        if(window.confirm("Delete this item permanently?")) {
                            API.DeleteItem(contextMenu.path).then(handleOpenFolder);
                        }
                    }}>Delete</p>
                </div>
            )}

            {showCreate && (
                <div className="modal-overlay">
                    <div className="modal-dark">
                        <h3>New Project</h3>
                        <input className="ide-input" value={pName} onChange={(e)=>setPName(e.target.value)} placeholder="Enter project name..."/>
                        <button className="btn-ok" onClick={()=>{API.CreateProject(pName); setShowCreate(false);}}>Create</button>
                        <button style={{marginLeft:'10px'}} onClick={()=>setShowCreate(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {showWizard && (
                <div className="modal-overlay">
                    <div className="wizard-card">
                        <h3 className="rainbow-text">ATOM SETUP WIZARD</h3>
                        <div className="tool-grid">
                            {tools.map((t, i) => (
                                <div key={i} className="tool-card">
                                    <div style={{fontWeight:'bold'}}>{t.name}</div>
                                    <div style={{fontSize:'11px', color:'#888'}}>{t.desc}</div>
                                    <button className="inst-btn" onClick={() => API.DownloadAndRunTool(t.url, t.filename)}>Download</button>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setShowWizard(false)}>Close Wizard</button>
                    </div>
                </div>
            )}
            
            {showAbout && (
                <div className="modal-overlay">
                    <div className="modal-dark about-card">
                        <h2 className="rainbow-text">ATOM Universal Builder</h2>
                        <div className="about-content">
                            <p>Developed by: <b>Mr. Atom</b></p>
                            <p>Professional Flutter Universal Builder IDE</p>
                            <p>Engine: Wails + React + Go</p>
                            
                            <div className="support-container" style={{textAlign:'center', marginTop:'20px'}}>
                                <p>You can buy me a coffee! ☕ (BEP20)</p>
                                <div className="crypto-card" style={{display:'inline-flex', alignItems:'center', background:'#222', padding:'10px', borderRadius:'5px', border:'1px solid #444'}}>
                                    <span id="wallet-address" style={{fontSize:'12px', marginRight:'10px'}}>0x56824c51be35937da7E60a6223E82cD1795984cC</span>
                                    <button onClick={copyAddress} className="copy-btn" style={{background:'none', border:'none', color:'#007bff', cursor:'pointer', fontSize:'16px'}}>
                                        <i className="fas fa-copy"></i>
                                    </button>
                                </div>
                                {copyStatus && <div style={{color:'green', fontSize:'11px', marginTop:'5px'}}>Copied to clipboard!</div>}
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