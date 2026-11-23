import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronLeft, ChevronRight, Code2, Copy, FileArchive, FileText, FolderOpen, History, Import, LayoutGrid, LoaderCircle, PenLine, Plus, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Star, Trash2, Upload, X } from 'lucide-react';
import type { ResumeDocument, ResumeSnapshot, TemplateDefinition } from './model';
import { getPresentationMode } from './model';
import { applyResumeTemplate, getTemplate, matchesTemplate, templateCategories, TEMPLATES } from './templates';
import { ConflictError, deleteResume, getResume, getSetting, getSnapshots, loadResumes, restoreResume, restoreSnapshot, saveResume, setSetting, subscribeChanges, toggleTemplateFavorite } from './lib/storage';
import { forgetExitDraft, readExitDraft, rememberExitDraft } from './lib/exitDraft';
import { carrySourceStatus, exportMarkdown, parseMarkdown, readMarkdownFile } from './lib/markdown';
import { ADDITIONAL_TEMPLATES, canonicalCatalogId } from './markdownTemplates';
import { createTemplateResume } from './markdownTemplateResume';
import PwaStatus from './pwa/PwaStatus';
import Modal from './components/Modal';
import TemplateGallery from './components/TemplateGallery';
import TemplateThumbnail from './components/TemplateThumbnail';
import type { SaveState } from './components/ResumeEditor';
import './styles.reference-home.css';

const ResumeEditor = lazy(() => import('./components/ResumeEditor'));

type Toast = { message: string; error: boolean };
type TemplateMode = 'visual' | 'markdown';
const allTemplates = [...TEMPLATES, ...ADDITIONAL_TEMPLATES];
type RenameDialog = { id: string; name: string };
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function downloadFile(blob: Blob, filename: string) { const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000); }
function cleanFilename(name: string) { return (name.trim() || '我的简历').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_'); }

function MarkdownCreateCard({ onCreate }: { onCreate: () => void }) {
  return <article className="reference-markdown-card" data-testid="markdown-create-card"><div className="markdown-file-symbol" aria-hidden="true"><span>M</span><ArrowDownToLine size={22}/></div><h3>Markdown 简历</h3><button className="button primary" data-testid="create-markdown" onClick={onCreate}>选择模板</button></article>;
}

function ReferenceTemplateGallery({ favorites, onFavorite, onPreview, onMarkdown, actions }: {
  favorites: string[];
  onFavorite: (id: string) => void;
  onPreview: (template: TemplateDefinition) => void;
  onMarkdown?: () => void;
  actions?: React.ReactNode;
}) {
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('全部');
  const [page,setPage]=useState(1);
  const gallery=useRef<HTMLDivElement>(null);
  const filtered=allTemplates.filter(template => matchesTemplate(template, category, search));
  const pages=Math.max(1,Math.ceil(filtered.length/6));
  const currentPage=Math.min(page,pages);
  function changePage(next: number) {
    setPage(next);
    if (gallery.current) {
      gallery.current.scrollTop = 0;
      if (gallery.current.getBoundingClientRect().top < 0) gallery.current.scrollIntoView({ block: 'start' });
    }
  }
  return <div ref={gallery} className="reference-template-gallery">
    {actions}
    <details className="reference-filters"><summary><SlidersHorizontal size={15}/>搜索与筛选<span>{filtered.length} 款模板</span></summary><div className="reference-filter-content"><label className="reference-search"><Search size={16}/><input aria-label="搜索模板" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="搜索模板、职位或风格"/></label><div className="reference-categories" aria-label="模板分类">{templateCategories.map(value=><button key={value} className={category===value?'selected':''} aria-pressed={category===value} onClick={()=>{setCategory(value);setPage(1);}}>{value}</button>)}</div></div></details>
    <div className="reference-template-grid">{onMarkdown&&currentPage===1&&category==='全部'&&!search.trim()&&<MarkdownCreateCard onCreate={onMarkdown}/>}{filtered.slice((currentPage-1)*6,currentPage*6).map(template=><article className="reference-template-card" key={template.id} data-testid={`template-${template.id}`}><button className="reference-template-paper" aria-label={`预览${template.name}`} onClick={()=>onPreview(template)}><TemplateThumbnail template={template}/><span className="reference-cover-action">预览模板</span></button><div className="reference-template-caption"><h3><button onClick={()=>onPreview(template)}>{template.name}</button></h3><div className="reference-template-meta"><div className="template-tags">{template.tags.map(tag=><span key={tag}>{tag}</span>)}</div><button className={`icon-button reference-favorite ${favorites.includes(template.id)?'is-favorite':''}`} aria-label={`${favorites.includes(template.id)?'取消收藏':'收藏'}${template.name}`} aria-pressed={favorites.includes(template.id)} onClick={()=>onFavorite(template.id)}><Star size={17} fill={favorites.includes(template.id)?'currentColor':'none'}/></button></div></div></article>)}</div>
    {!filtered.length&&<div className="reference-no-results"><Search size={23}/><p>没有找到匹配的模板</p><button className="text-button" onClick={()=>{setSearch('');setCategory('全部');setPage(1);}}>显示全部模板</button></div>}
    {pages>1&&<nav className="reference-pagination" aria-label="模板分页"><button aria-label="上一页模板" disabled={currentPage===1} onClick={()=>changePage(currentPage-1)}><ChevronLeft size={16}/></button>{Array.from({length:pages},(_,index)=>index+1).map(value=><button key={value} aria-label={`第${value}页模板`} aria-current={currentPage===value?'page':undefined} className={currentPage===value?'selected':''} onClick={()=>changePage(value)}>{value}</button>)}<button aria-label="下一页模板" disabled={currentPage===pages} onClick={()=>changePage(currentPage+1)}><ChevronRight size={16}/></button></nav>}
  </div>;
}

export default function App() {
  const [documents,setDocuments]=useState<ResumeDocument[]>([]);
  const [activeDocument,setActiveDocument]=useState<ResumeDocument|null>(null);
  const [view,setView]=useState<'home'|'templates'|'editor'>('home');
  const [booting,setBooting]=useState(true);
  const [fatalError,setFatalError]=useState('');
  const [saveState,setSaveState]=useState<SaveState>('saved');
  const [favorites,setFavorites]=useState<string[]>([]);
  const [lastBackup,setLastBackup]=useState(0);
  const [libraryTab,setLibraryTab]=useState<'resumes'|'favorites'|'trash'>('resumes');
  const [creationTab,setCreationTab]=useState<'templates'|'markdown'|'import'>('templates');
  const [toast,setToast]=useState<Toast|null>(null);
  const [busy,setBusy]=useState('');
  const [navigating,setNavigating]=useState(false);
  const [preview,setPreview]=useState<{ template: TemplateDefinition; mode: TemplateMode; withExample: boolean } | null>(null);
  const previewTemplate=preview?.template;
  function showTemplate(template: TemplateDefinition, mode: TemplateMode = template.id.startsWith('md-') ? 'markdown' : 'visual') {
    setPreview({ template, mode, withExample: true });
  }
  const [switchTemplates,setSwitchTemplates]=useState(false);
  const [rename,setRename]=useState<RenameDialog|null>(null);
  const [deleteId,setDeleteId]=useState<string|null>(null);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [snapshots,setSnapshots]=useState<ResumeSnapshot[]>([]);
  const [storageInfo,setStorageInfo]=useState(false);
  const [importTextOpen,setImportTextOpen]=useState(false);
  const [importText,setImportText]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const latest=useRef<ResumeDocument|null>(null);
  const dirty=useRef(false);
  const saving=useRef<Promise<void>|null>(null);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const toastTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const persistedAsked=useRef(false);
  const navigateSequence=useRef(0);
  const currentRoute=useRef('#/');
  const runningTask=useRef(false);
  const exitDraftId=useRef<string | null>(null);

  const notify=useCallback((message:string,error=false)=>{clearTimeout(toastTimer.current);setToast({message,error});toastTimer.current=setTimeout(()=>setToast(null),error?10000:5000);},[]);
  const refreshDocuments=useCallback(async()=>{setDocuments(await loadResumes(true));},[]);
  const requestPersistence=useCallback(()=>{if(persistedAsked.current)return;persistedAsked.current=true;if(navigator.storage?.persist)void navigator.storage.persist().catch(()=>false);},[]);

  const flush=useCallback(async():Promise<void>=>{
    clearTimeout(saveTimer.current);
    if(saving.current){await saving.current;if(dirty.current)return flush();return;}
    if(!dirty.current||!latest.current)return;
    const operation=(async()=>{
      while(dirty.current&&latest.current){
        // saveResume normalizes a fresh copy synchronously before its first await.
        const snapshot=latest.current;
        dirty.current=false;setSaveState('saving');
        try{
          const saved=await saveResume(snapshot);
          if(latest.current?.id===snapshot.id){const merged=dirty.current?{...latest.current,revision:saved.revision}:saved;latest.current=merged;setActiveDocument(merged);}
          setDocuments(previous=>[saved,...previous.filter(d=>d.id!==saved.id)].sort((a,b)=>b.updatedAt-a.updatedAt));
          requestPersistence();
        }catch(error){
          if(error instanceof ConflictError){
            const now=Date.now();const source=latest.current??snapshot;
            const copy:ResumeDocument={...source,id:crypto.randomUUID(),title:`${source.title || '我的简历'}（冲突副本）`,revision:0,createdAt:now,updatedAt:now,deletedAt:undefined};
            dirty.current=false;
            try{const saved=await saveResume(copy);const merged=dirty.current&&latest.current?{...latest.current,id:saved.id,title:saved.title,revision:saved.revision,createdAt:saved.createdAt,deletedAt:undefined}:saved;latest.current=merged;setActiveDocument(merged);currentRoute.current=`#/edit/${saved.id}`;window.history.replaceState(null,'',currentRoute.current);setDocuments(previous=>[saved,error.current,...previous.filter(d=>d.id!==snapshot.id&&d.id!==saved.id)]);notify('另一标签页已更新这份简历。你的修改已另存为“冲突副本”，两份内容都已保留。');}
            catch(copyError){dirty.current=true;setSaveState('error');notify('保存失败，当前内容仍保留在编辑器中，请立即导出备份。',true);throw copyError;}
          }else{dirty.current=true;setSaveState('error');notify('本机保存失败，当前内容仍在编辑器中。请导出可编辑备份后再离开。',true);throw error;}
        }
      }
      if(exitDraftId.current){forgetExitDraft(exitDraftId.current);exitDraftId.current=null;}
      setSaveState('saved');
    })();
    saving.current=operation;
    try{await operation;}finally{saving.current=null;}
  },[notify,requestPersistence]);

  const updateDocument=useCallback((update:(doc:ResumeDocument)=>ResumeDocument)=>{
    if(!latest.current)return;
    const previous=latest.current;const updated=update(previous);if(updated===previous)return;
    const next=carrySourceStatus(updated,{...updated,updatedAt:Date.now()});latest.current=next;dirty.current=true;setActiveDocument(next);setSaveState('dirty');
    clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>{void flush().catch(()=>{});},400);
  },[flush]);

  const navigate=useCallback(async(target:'home'|'templates'|'editor',id?:string,record=true)=>{
    const sequence=++navigateSequence.current;
    const destination=target==='editor'&&id?`#/edit/${id}`:target==='templates'?'#/templates':'#/';
    setNavigating(true);
    try{await flush();if(sequence!==navigateSequence.current)return;
      if(target==='editor'&&id){const loaded=await getResume(id);await flush();if(sequence!==navigateSequence.current)return;const document=latest.current?.id===id?latest.current:loaded;if(!document||document.deletedAt){throw new Error('这份简历不在当前浏览器中，可从备份文件导入。');}latest.current=document;dirty.current=false;setActiveDocument(document);setSaveState('saved');setView('editor');}
      else{latest.current=null;setActiveDocument(null);dirty.current=false;setView(target==='editor'?'home':target);}
      setPreview(null);setSwitchTemplates(false);setHistoryOpen(false);setRename(null);setDeleteId(null);setStorageInfo(false);setImportTextOpen(false);
      if(record&&destination!==currentRoute.current)window.history.pushState(null,'',destination);
      else if(!record&&window.location.hash!==destination)window.history.replaceState(null,'',destination);
      currentRoute.current=destination;
      window.scrollTo(0,0);
    }catch(error){
      if(sequence!==navigateSequence.current)return;
      if(!record&&window.location.hash!==currentRoute.current)window.history.replaceState(null,'',currentRoute.current);
      if(!dirty.current)notify(error instanceof Error?error.message:'无法打开简历，请稍后重试。',true);
    }
    finally{if(sequence===navigateSequence.current)setNavigating(false);}
  },[flush,notify]);

  useEffect(()=>{
    let alive=true;
    async function boot(){
      try{
        const [all,savedFavorites,backup]=await Promise.all([loadResumes(true),getSetting<string[]>('favorites',[]),getSetting<number>('lastBackupAt',0)]);
        if(!alive)return;
        setDocuments(all);setFavorites([...new Set(savedFavorites.map(canonicalCatalogId))]);setLastBackup(backup);
        const id=window.location.hash.match(/^#\/edit\/([^/]+)$/)?.[1];
        if(id){
          const stored=all.find(d=>d.id===id);
          const draft=readExitDraft(id,stored);
          let document=stored?.deletedAt?undefined:stored;
          if(draft){
            document=stored&&!stored.deletedAt?draft:{
              ...draft,id:crypto.randomUUID(),revision:0,title:`${draft.title || '我的简历'}（恢复草稿）`,
              createdAt:Date.now(),updatedAt:Date.now(),deletedAt:undefined,
            };
            exitDraftId.current=id;dirty.current=true;setSaveState('dirty');
            saveTimer.current=setTimeout(()=>{void flush().catch(()=>{});},0);
            notify(stored&&!stored.deletedAt?'已找回上次离开时的修改。':'未提交的修改已恢复为单独的草稿。');
          }
          if(document){
            latest.current=document;setActiveDocument(document);setView('editor');
            currentRoute.current=`#/edit/${document.id}`;
            if(window.location.hash!==currentRoute.current)window.history.replaceState(null,'',currentRoute.current);
          }else{window.history.replaceState(null,'','#/');notify('当前浏览器没有这份简历，可从备份文件导入。',true);}
        }else if(window.location.hash==='#/templates'){currentRoute.current='#/templates';setView('templates');}
      }catch(error){if(alive)setFatalError(error instanceof Error?error.message:'无法打开本地存储。');}
      finally{if(alive)setBooting(false);}
    }
    void boot();
    const unsubscribe=subscribeChanges(change=>{
      if(!alive||!change.external)return;
      if(change.store==='resumes'&&change.key){
        const id=change.key;
        void getResume(id).then(updated=>{
          if(alive&&updated)setDocuments(previous=>[updated,...previous.filter(d=>d.id!==id)].sort((a,b)=>b.updatedAt-a.updatedAt));
        }).catch(()=>{});
      }else if(change.store==='resumes'||change.store==='all')void refreshDocuments().catch(()=>{});
      if(change.store==='all'||(change.store==='settings'&&change.key==='favorites')){
        void getSetting<string[]>('favorites',[]).then(ids=>{if(alive)setFavorites([...new Set(ids.map(canonicalCatalogId))]);}).catch(()=>{});
      }
      if(change.store==='all'||(change.store==='settings'&&change.key==='lastBackupAt')){
        void getSetting<number>('lastBackupAt',0).then(time=>{if(alive)setLastBackup(time);}).catch(()=>{});
      }
    });
    return()=>{alive=false;unsubscribe();};
  },[flush,notify,refreshDocuments]);

  useEffect(()=>{
    const saveOnExit=()=>{
      if((dirty.current||saving.current)&&latest.current){
        if(rememberExitDraft(latest.current)){
          if(exitDraftId.current&&exitDraftId.current!==latest.current.id)forgetExitDraft(exitDraftId.current);
          exitDraftId.current=latest.current.id;
        }
        void flush().catch(()=>{});
      }
    };
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirty.current||saving.current){saveOnExit();event.preventDefault();event.returnValue='';}};
    const visibility=()=>{if(document.visibilityState==='hidden')void flush().catch(()=>{});};
    const changeRoute=()=>{const id=window.location.hash.match(/^#\/edit\/([^/]+)$/)?.[1];void navigate(id?'editor':window.location.hash==='#/templates'?'templates':'home',id,false);};
    const applyUpdate=(event:Event)=>{const apply=(event as CustomEvent<{apply:()=>void}>).detail?.apply;if(!apply)return;void flush().then(apply).catch(()=>notify('请先导出当前内容的备份，再刷新应用。',true));};
    window.addEventListener('beforeunload',beforeUnload);window.addEventListener('pagehide',saveOnExit);document.addEventListener('visibilitychange',visibility);window.addEventListener('hashchange',changeRoute);window.addEventListener('resume:update-request',applyUpdate);
    return()=>{window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('pagehide',saveOnExit);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('hashchange',changeRoute);window.removeEventListener('resume:update-request',applyUpdate);};
  },[flush,navigate,notify]);

  async function run(label:string,task:()=>Promise<void>){if(runningTask.current)return;runningTask.current=true;setBusy(label);try{await task();}catch(error){notify(error instanceof Error?error.message:'操作失败，请稍后重试。',true);}finally{runningTask.current=false;setBusy('');}}
  async function create(templateId='neat', example=false, editor: TemplateMode = 'visual') {
    await run('正在创建简历…', async () => {
      await flush();
      const document = createTemplateResume(templateId, example, editor);
      const saved = await saveResume(document);
      requestPersistence();
      await refreshDocuments();
      setPreview(null);
      await navigate('editor', saved.id);
    });
  }
  async function duplicate(document:ResumeDocument){await run('正在复制简历…',async()=>{const now=Date.now();const copy=await saveResume({...structuredClone(document),id:crypto.randomUUID(),revision:0,title:`${document.title}（副本）`,createdAt:now,updatedAt:now,deletedAt:undefined});await refreshDocuments();notify('已复制，原简历保留不变。');await navigate('editor',copy.id);});}
  function switchTemplate(templateId: string, mode?: TemplateMode) {
    const current=latest.current;
    const sameDesign=current&&canonicalCatalogId(current.templateId)===canonicalCatalogId(templateId)&&
      (templateId!=='neat'||mode===undefined||mode===getPresentationMode(current));
    if(!sameDesign){updateDocument(doc=>applyResumeTemplate(doc,templateId,mode));notify('模板已切换。');}
    setPreview(null);
    setSwitchTemplates(false);
  }
  function toggleFavorite(id:string){void toggleTemplateFavorite(id).then(setFavorites).catch(()=>notify('收藏保存失败，请重试。',true));}
  async function backup(single=false,copy=false){await run('正在打包本地备份…',async()=>{
    // A failed database save must not prevent rescuing the unsaved editor state.
    let saveFailed=false;try{await flush();}catch{saveFailed=true;}
    const current=latest.current;
    const backupStartedAt=Date.now();
    let loadedEntireLibrary=true;
    const all=await loadResumes(true).catch(()=>{
      loadedEntireLibrary=false;
      return documents;
    });
    const stored=current?all.find(d=>d.id===current.id):undefined;
    const savedCurrent=stored??current;
    const toExport=single&&savedCurrent?[savedCurrent]:[...all];
    if(saveFailed&&current){
      const rescue={...structuredClone(current),id:crypto.randomUUID(),title:`${current.title || '我的简历'}（未保存草稿）`,revision:0,deletedAt:undefined};
      toExport.push(rescue);
    }else if(!stored&&current&&!toExport.some(d=>d.id===current.id))toExport.push(current);
    if(!toExport.length){notify('还没有需要备份的简历。');return;}
    const {exportBackup, exportBackupText}=await import('./lib/backup');
    if(copy){await navigator.clipboard.writeText(await exportBackupText(toExport));}
    else{const blob=await exportBackup(toExport);downloadFile(blob,`${single&&current?cleanFilename(current.title):'全部简历'}-${new Date().toISOString().slice(0,10)}.resume.zip`);}
    if (!single && loadedEntireLibrary && !saveFailed) {
      setLastBackup(backupStartedAt);
      await setSetting('lastBackupAt',backupStartedAt).catch(()=>{});
    }
    notify(copy?'备份已复制。':'备份已生成。');
  });}
  async function markdownDownload(){const current=latest.current;if(!current)return;downloadFile(new Blob([exportMarkdown(current)],{type:'text/markdown;charset=utf-8'}),`${cleanFilename(current.title)}.md`);notify('Markdown 源码已导出；保留照片请使用可编辑备份。');}
  async function downloadDocument(document:ResumeDocument){await run('正在生成可编辑备份…',async()=>{const current=await getResume(document.id);if(!current)throw new Error('未找到这份简历，请刷新后重试。');const {exportBackup}=await import('./lib/backup');const blob=await exportBackup([current]);downloadFile(blob,`${cleanFilename(current.title)}.resume.zip`);notify('可编辑备份已下载。PDF 可在简历编辑器中直接导出。');});}
  async function importFile(file?:File){if(!file)return;await run('正在本机读取文件…',async()=>{await flush();if(/\.(md|markdown|txt)$/i.test(file.name)){const parsed=parseMarkdown(await readMarkdownFile(file),file.name.replace(/\.[^.]+$/,''));const saved=await saveResume(parsed.document);await refreshDocuments();notify(parsed.warnings.length?`已导入。${parsed.warnings.join(' ')}`:'Markdown 已导入，可继续编辑。');await navigate('editor',saved.id);}else{const {importBackup}=await import('./lib/backup');const imported=await importBackup(file);await refreshDocuments();notify(imported.warnings.length?`已恢复 ${imported.documents.length} 份简历。${imported.warnings.join(' ')}`:`已恢复 ${imported.documents.length} 份简历，原有内容不会被覆盖。`);const first=imported.documents.find(d=>!d.deletedAt);if(first)await navigate('editor',first.id);}requestPersistence();});if(fileInput.current)fileInput.current.value='';}
  async function importPastedContent(){await run('正在导入…',async()=>{
    await flush();let first:ResumeDocument|undefined;let message='';
    const {BACKUP_TEXT_PREFIX,importBackupText}=await import('./lib/backup');
    if(importText.startsWith(BACKUP_TEXT_PREFIX)){
      const imported=await importBackupText(importText);first=imported.documents.find(document=>!document.deletedAt);message=`已恢复 ${imported.documents.length} 份简历。${imported.warnings.join(' ')}`;
    }else{
      const parsed=parseMarkdown(importText);first=await saveResume(parsed.document);message=parsed.warnings.join(' ')||'已导入。';
    }
    await refreshDocuments();setImportTextOpen(false);setImportText('');notify(message);requestPersistence();if(first)await navigate('editor',first.id);
  });}
  async function openHistory(){await run('正在读取历史记录…',async()=>{await flush();const id=latest.current?.id;if(!id)return;const history=await getSnapshots(id);if(latest.current?.id===id){setSnapshots(history);setHistoryOpen(true);}});}
  async function recoverSnapshot(snapshotId:string){await run('正在恢复历史版本…',async()=>{await flush();const current=latest.current;if(!current)return;const restored=await restoreSnapshot(current.id,snapshotId,current.revision);if(latest.current?.id===current.id&&!dirty.current){latest.current=restored;setActiveDocument(restored);setSaveState('saved');setHistoryOpen(false);notify('历史版本已恢复。');}else notify('历史版本已恢复；当前未保存的编辑仍保留，继续保存时会保留副本。');await refreshDocuments();});}

  const liveDocuments=documents.filter(d=>!d.deletedAt);
  const trashDocuments=documents.filter(d=>d.deletedAt);
  const showBackupReminder=liveDocuments.length>0&&(!lastBackup||(Date.now()-lastBackup>7*86400000&&liveDocuments.some(d=>d.updatedAt>lastBackup)));
  const trashView=libraryTab==='trash';
  const visibleDocuments=trashView?trashDocuments:liveDocuments;

  if(booting)return <div className="app-loading" role="status"><LoaderCircle className="spin" size={22}/><p>加载中…</p></div>;
  if(fatalError)return <div className="app-loading"><ShieldCheck size={38}/><h1>暂时无法打开本地存储</h1><p>{fatalError}</p><p className="muted">请检查浏览器是否允许网站保存数据，或退出限制存储的浏览模式。</p><button className="button primary" onClick={()=>window.location.reload()}>重新尝试</button></div>;

  return <><div className="app-interactive" inert={!!busy||navigating} aria-busy={!!busy||navigating}>
    {view==='editor'&&activeDocument?<Suspense fallback={<div className="loading-screen" role="status"><LoaderCircle className="spin"/><p>正在准备本地编辑器…</p></div>}><ResumeEditor key={activeDocument.id} document={activeDocument} onUpdate={updateDocument} onBack={()=>void navigate('home')} onTemplates={()=>setSwitchTemplates(true)} onBackup={()=>void backup(true)} onMarkdown={()=>void markdownDownload()} onHistory={()=>void openHistory()} onToast={notify} saveState={saveState} statusSlot={<PwaStatus/>}/></Suspense>:<div className="dashboard-screen reference-home">
      <header className="site-header"><button className="brand" aria-label="简历首页" onClick={()=>void navigate('home')}><img className="brand-symbol" src={`${import.meta.env.BASE_URL}icon.svg`} width="27" height="27" alt=""/><span>简历</span></button><nav className="main-nav" aria-label="主导航"><button className={view==='home'?'active':''} onClick={()=>void navigate('home')}>我的简历</button><button className={view==='templates'?'active':''} onClick={()=>void navigate('templates')}>简历模板</button></nav><div className="header-actions"><PwaStatus/><button className="button primary import-header" onClick={()=>fileInput.current?.click()}><Upload size={15}/><span>导入简历</span></button></div></header>
      <main className={`dashboard-main ${view==='templates'?'reference-templates-page':''}`}><div className="dashboard-layout">
        {view==='home'&&<aside className="resume-library" aria-label="我的简历"><div className="reference-library-tabs" role="tablist" aria-label="简历分类"><button role="tab" aria-selected={libraryTab==='resumes'} className={libraryTab==='resumes'?'selected':''} onClick={()=>setLibraryTab('resumes')}>我的简历</button><button role="tab" aria-selected={libraryTab==='favorites'} className={libraryTab==='favorites'?'selected':''} onClick={()=>setLibraryTab('favorites')}>收藏模板</button><button role="tab" aria-selected={libraryTab==='trash'} className={libraryTab==='trash'?'selected':''} onClick={()=>setLibraryTab('trash')}>回收站{trashDocuments.length>0&&<span>{trashDocuments.length}</span>}</button><button className="icon-button reference-new-resume" aria-label="新建空白简历" title="新建空白简历" data-testid="new-resume" onClick={()=>void create()}><Plus size={18}/></button></div>
          <div className="resume-list">{libraryTab==='favorites'?favorites.length?allTemplates.filter(template=>favorites.includes(template.id)).map(template=><article className="resume-card reference-saved-template" key={template.id}><button className="resume-small-cover" aria-label={`预览${template.name}`} onClick={()=>showTemplate(template)}><TemplateThumbnail template={template}/></button><div className="resume-card-info"><button className="resume-card-title" onClick={()=>showTemplate(template)}>{template.name}</button><div className="template-tags">{template.tags.map(tag=><span key={tag}>{tag}</span>)}</div><div className="resume-card-actions"><button className="button primary small-button" onClick={()=>showTemplate(template)}>使用模板</button><button className="icon-button is-favorite" aria-label={`取消收藏${template.name}`} onClick={()=>toggleFavorite(template.id)}><Star size={16} fill="currentColor"/></button></div></div></article>):<div className="empty-state library-empty"><Star size={30}/><h3>暂无收藏模板</h3></div>:visibleDocuments.length?visibleDocuments.map(document=><article className="resume-card" key={document.id} data-testid={`resume-${document.id}`}><button className="resume-small-cover" disabled={trashView} aria-label={`编辑${document.title}`} onClick={()=>void navigate('editor',document.id)}><TemplateThumbnail template={getTemplate(document.templateId)} document={document}/></button><div className="resume-card-info"><button className="resume-card-title" disabled={trashView} onClick={()=>void navigate('editor',document.id)}>{document.title || '未命名简历'}</button><span className="resume-style">{getPresentationMode(document)==='markdown'&&document.templateId==='neat'?'经典蓝色':getTemplate(document.templateId).name}</span><div className="reference-update-time"><time title={trashView?'移入回收站时间':'更新时间'} dateTime={new Date(document.deletedAt||document.updatedAt).toISOString()}>{formatDate(document.deletedAt||document.updatedAt)}</time></div><div className="resume-card-actions">{trashView?<button className="text-button" onClick={()=>void run('正在恢复简历…',async()=>{await restoreResume(document.id,document.revision);await refreshDocuments();notify('简历已恢复。');})}><RotateCcw size={14}/>恢复简历</button>:<><button className="icon-button" aria-label={`复制${document.title}`} title="复制简历" onClick={()=>void duplicate(document)}><Copy size={15}/></button><button className="icon-button" aria-label={`下载${document.title}的可编辑备份`} title="下载可编辑备份" onClick={()=>void downloadDocument(document)}><ArrowDownToLine size={15}/></button><button className="icon-button" aria-label={`重命名${document.title}`} title="重命名" onClick={()=>setRename({id:document.id,name:document.title})}><PenLine size={15}/></button><button className="icon-button" aria-label={`删除${document.title}`} title="移入回收站" onClick={()=>setDeleteId(document.id)}><Trash2 size={15}/></button></>}</div></div></article>):<div className="empty-state library-empty">{trashView?<Trash2 size={30}/>:<FileText size={32}/>}<h3>{trashView?'回收站是空的':'暂无简历'}</h3>{!trashView&&<button className="button primary" onClick={()=>void create()}><Plus size={15}/>新建简历</button>}</div>}</div>
          <div className="reference-library-bottom">{showBackupReminder&&<div className="reference-backup-reminder"><FileArchive size={15}/><span>{lastBackup?'有更新待备份':'尚未备份'}</span><button onClick={()=>void backup()}>备份</button></div>}<div className="reference-data-actions"><button title={lastBackup?`上次备份：${formatDate(lastBackup)}`:'导出全部简历的可编辑备份'} onClick={()=>void backup()} disabled={!documents.length}><ArrowDownToLine size={15}/>备份全部</button><button onClick={()=>fileInput.current?.click()}><Import size={15}/>导入恢复</button><button aria-label="本地数据与备份说明" onClick={()=>setStorageInfo(true)}><ShieldCheck size={15}/>本地数据</button></div></div>
        </aside>}
        <section className="template-panel reference-creation-panel" aria-label="新建简历"><div className="reference-creation-tabs" role="tablist" aria-label="新建简历方式"><button role="tab" aria-selected={creationTab==='templates'} className={creationTab==='templates'?'selected':''} onClick={()=>setCreationTab('templates')}>从模板新建</button><button role="tab" aria-selected={creationTab==='markdown'} className={creationTab==='markdown'?'selected':''} onClick={()=>setCreationTab('markdown')}>Markdown 简历</button><button role="tab" aria-selected={creationTab==='import'} className={creationTab==='import'?'selected':''} onClick={()=>setCreationTab('import')}>导入简历</button></div>
          {creationTab!=='import' ? <ReferenceTemplateGallery favorites={favorites} onFavorite={toggleFavorite} onPreview={showTemplate}
              onMarkdown={creationTab==='templates' ? ()=>setCreationTab('markdown') : undefined}
              actions={creationTab==='markdown' && <div className="markdown-library-actions">
                <button className="button secondary" onClick={()=>void create('neat',false,'markdown')}><FileText size={15}/>创建空白 Markdown</button>
                <button className="text-button" onClick={()=>setImportTextOpen(true)}><Code2 size={15}/>粘贴 Markdown</button>
                <button className="text-button" onClick={()=>fileInput.current?.click()}><Import size={15}/>导入文件</button>
              </div>}/> : <div className="reference-import-panel"><button className="reference-import-dropzone" data-testid="import-dropzone" onClick={()=>fileInput.current?.click()} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void importFile(event.dataTransfer.files[0]);}}><Upload size={32} strokeWidth={1.3}/><strong>拖入文件</strong><span>.resume.zip · .md · .markdown · .txt</span><span className="button primary">选择文件</span></button><div className="reference-import-notes"><button className="text-button" onClick={()=>setImportTextOpen(true)}>粘贴 Markdown<ChevronRight size={14}/></button></div></div>}
        </section>
      </div></main>
    </div>}
    <input ref={fileInput} hidden type="file" accept=".zip,.md,.markdown,.txt" data-testid="import-file" onChange={e=>void importFile(e.target.files?.[0])}/>
    {toast&&<div className={`toast ${toast.error?'toast-error':''}`} role={toast.error?'alert':'status'}>{toast.error?<ShieldCheck size={18}/>:<Check size={18}/>}<span>{toast.message}</span><button className="icon-button" aria-label="关闭提示" onClick={()=>setToast(null)}><X size={15}/></button></div>}
    {switchTemplates&&activeDocument&&<div inert={!!previewTemplate} aria-hidden={previewTemplate?true:undefined} style={{visibility:previewTemplate?'hidden':undefined}}>
      <Modal title="切换模板风格" wide onClose={()=>setSwitchTemplates(false)} className="template-picker-modal">
        <TemplateGallery currentTemplateId={activeDocument.templateId} currentPresentation={getPresentationMode(activeDocument)} onPreview={showTemplate} onUse={switchTemplate}/>
      </Modal>
    </div>}
    {preview && previewTemplate && <Modal title="模板预览" onClose={()=>setPreview(null)} wide className="template-preview-modal">
      <div className="template-preview-layout">
        <div className="large-template-cover"><TemplateThumbnail template={previewTemplate} legacyMarkdown={preview.mode==='markdown'&&previewTemplate.id==='neat'} large/></div>
        <div className="template-preview-copy">
          <h2>{previewTemplate.name}</h2>
          <div className="template-tags">{previewTemplate.tags.map(tag=><span key={tag}>{tag}</span>)}</div>
          {switchTemplates ? <button className="button primary full-width" onClick={()=>switchTemplate(previewTemplate.id,preview.mode)}>使用模板<ArrowRight size={16}/></button> : <>
            <div className="template-start-content" role="group" aria-label="起始内容">
              <button aria-pressed={preview.withExample} onClick={()=>setPreview({...preview,withExample:true})}>示例内容</button>
              <button aria-pressed={!preview.withExample} onClick={()=>setPreview({...preview,withExample:false})}>空白简历</button>
            </div>
            <button className={`button ${creationTab==='markdown'?'secondary':'primary'} full-width`} onClick={()=>void create(previewTemplate.id,preview.withExample,'visual')}><FileText size={15}/>用表单编辑</button>
            <button className={`button ${creationTab==='markdown'?'primary':'secondary'} full-width`} onClick={()=>void create(previewTemplate.id,preview.withExample,'markdown')}><Code2 size={15}/>用 Markdown 编辑</button>
          </>}
        </div>
      </div>
    </Modal>}
    {rename&&<Modal title="重命名简历" onClose={()=>setRename(null)}><label className="field"><span>简历名称</span><input autoFocus value={rename.name} maxLength={80} onChange={e=>setRename({...rename,name:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')document.getElementById('confirm-rename')?.click();}}/></label><div className="modal-actions"><button className="button secondary" onClick={()=>setRename(null)}>取消</button><button id="confirm-rename" className="button primary" disabled={!rename.name.trim()} onClick={()=>void run('正在保存名称…',async()=>{const document=await getResume(rename.id);if(document)await saveResume({...document,title:rename.name.trim(),updatedAt:Date.now()});await refreshDocuments();setRename(null);notify('名称已更新。');})}>保存名称</button></div></Modal>}
    {deleteId&&<Modal title="移入回收站？" onClose={()=>setDeleteId(null)}><p>简历可在回收站恢复。</p><div className="modal-actions"><button className="button secondary" onClick={()=>setDeleteId(null)}>保留简历</button><button className="button danger" onClick={()=>void run('正在移入回收站…',async()=>{const document=documents.find(d=>d.id===deleteId);if(document)await deleteResume(document.id,document.revision);await refreshDocuments();setDeleteId(null);notify('已移入回收站，可随时恢复。');})}>移入回收站</button></div></Modal>}
    {historyOpen&&<Modal title="本地历史记录" onClose={()=>setHistoryOpen(false)}><div className="history-list">{snapshots.length?snapshots.map(snapshot=><div className="history-row" key={snapshot.id}><span className="history-icon"><History size={18}/></span><div><strong>{formatDate(snapshot.createdAt)}</strong><span>{snapshot.document.title} · {getTemplate(snapshot.document.templateId).name}</span></div><button className="button secondary small-button" onClick={()=>void recoverSnapshot(snapshot.id)}><RotateCcw size={14}/>恢复</button></div>):<div className="empty-state"><History size={28}/><p>暂无历史记录</p></div>}</div></Modal>}
    {storageInfo&&<Modal title="本地数据" onClose={()=>setStorageInfo(false)}><div className="storage-explanation"><p>清除浏览器数据或更换设备前，请先备份。</p><button className="button primary full-width" disabled={!documents.length} onClick={()=>void backup()}><ArrowDownToLine size={16}/>下载备份</button><button className="button secondary full-width" disabled={!documents.length} onClick={()=>void backup(false,true)}><Copy size={16}/>复制备份</button><button className="button secondary full-width" onClick={()=>{setStorageInfo(false);setImportTextOpen(true);}}><Import size={16}/>粘贴恢复</button></div></Modal>}
    {importTextOpen&&<Modal title="粘贴内容" wide onClose={()=>setImportTextOpen(false)}><textarea className="markdown-input" aria-label="导入内容" placeholder="Markdown 或简历备份" value={importText} onChange={e=>setImportText(e.target.value)}/><div className="modal-actions"><button className="button secondary" onClick={()=>setImportTextOpen(false)}>取消</button><button className="button primary" disabled={!importText.trim()} onClick={()=>void importPastedContent()}><Import size={16}/>导入并编辑</button></div></Modal>}
  </div>{(busy||navigating)&&<div className="operation-shield" role="status"><div className="busy-indicator"><LoaderCircle className="spin" size={17}/>{busy||'正在保存并切换…'}</div></div>}</>;
}
