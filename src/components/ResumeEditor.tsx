import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Award, BookOpen, BriefcaseBusiness, Check, ChevronDown, ChevronRight, CircleHelp, Columns3, Code2, Download, Eye, FileArchive, FileText, GraduationCap, History, ImagePlus, Layers3, LayoutTemplate, LoaderCircle, Menu, Palette, Plus, RotateCcw, Settings2, Sparkles, Trash2, UserRound, Wrench, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ResumeDocument, ResumeLayout, ResumeSection, SectionType } from '../model';
import { getPresentationMode, SECTION_LABELS } from '../model';
import { newItem, newSection } from '../sample';
import { PALETTES, getTemplate, resetResumeSpacing, templateLayout, templatePointPerPixel } from '../templates';
import { getAsset, putAsset } from '../lib/storage';
import { prepareImage } from '../lib/images';
import { useResumePdf } from '../pdf/useResumePdf';
import PdfPreview from '../pdf/PdfPreview';
import { downloadPngZip, pdfFilename, pdfSavePicker, savePdfAs } from '../pdf/export';
import { syncFormMarkdown } from '../lib/formMarkdown';
import RichTextEditor from './RichTextEditor';
import Modal from './Modal';
import ActionMenu from './ActionMenu';
import ProfileForm from './ProfileForm';
import MarkdownEditorPane from './MarkdownEditorPane';
import { getEditorMode, getSourceStatus, switchEditingView } from '../lib/markdown';
import '../styles.reference-editor.css';

const SECTION_ICONS: Record<SectionType, LucideIcon> = { education:GraduationCap,experience:BriefcaseBusiness,project:BookOpen,skill:Wrench,award:Award,research:BookOpen,portfolio:Layers3,summary:UserRound,custom:FileText };
const settingOptions=(current:number,values:number[])=>[current,...values.filter(value=>Math.abs(value-current)>.00001)].sort((a,b)=>a-b);
const DEFAULT_MODULES: { type: SectionType; title: string }[] = [
  {type:'education',title:'教育经历'},
  {type:'skill',title:'专业技能'},
  {type:'project',title:'项目经历'},
  {type:'custom',title:'大学信息'},
  {type:'experience',title:'实习/工作经历'},
  {type:'award',title:'荣誉奖项'},
  {type:'research',title:'研究经历'},
  {type:'portfolio',title:'作品集'},
  {type:'custom',title:'其他经历'},
  {type:'summary',title:'个人简介'},
];
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type Props = { document: ResumeDocument; onUpdate: (update: (doc: ResumeDocument) => ResumeDocument) => void; onBack: () => void; onTemplates: () => void; onBackup: () => void; onMarkdown: () => void; onHistory: () => void; onToast: (message: string, error?: boolean) => void; saveState: SaveState; statusSlot?: ReactNode };

export default function ResumeEditor({document:resume,onUpdate:onDocumentUpdate,onBack,onTemplates,onBackup,onMarkdown,onHistory,onToast,saveState,statusSlot}: Props) {
  const isMarkdown=getEditorMode(resume)==='markdown';
  const presentation = getPresentationMode(resume);
  const displayPointPerPixel = templatePointPerPixel(resume.templateId, presentation);
  const defaults = templateLayout(resume.templateId, presentation);
  const previewSurface=useRef<HTMLDivElement>(null);
  const [syncScroll,setSyncScroll]=useState(true);
  const onUpdate:Props['onUpdate']=update=>onDocumentUpdate(current=>{
    const next=update(current);
    if(getEditorMode(current)==='visual') return syncFormMarkdown(current,next);
    return next;
  });
  function switchEditorMode() {
    if (sourceStatus.previewStale && isMarkdown) {
      onToast('请先修正 Markdown 源码，或导出源码备份。', true);
      return;
    }
    setMobileTab('edit');
    onDocumentUpdate(switchEditingView);
  }
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set(['profile']));
  const [activeSection,setActiveSection]=useState('profile');
  const [mobileTab,setMobileTab]=useState<'edit'|'preview'>('edit');
  const [modulesOpen,setModulesOpen]=useState(false);
  const [layoutOpen,setLayoutOpen]=useState(false);
  const [spacingPosition,setSpacingPosition]=useState<{left:number;top:number}|null>(null);
  useEffect(()=>{
    if(!spacingPosition)return;
    const close=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('.spacing-popover,.spacing-trigger'))setSpacingPosition(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSpacingPosition(null);};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[spacingPosition]);
  const [addOpen,setAddOpen]=useState(false);
  const [removeSection,setRemoveSection]=useState<string|null>(null);
  const [photoUrl,setPhotoUrl]=useState<string>();
  const [photoBusy,setPhotoBusy]=useState(false);
  const [pngProgress,setPngProgress]=useState<string|null>(null);
  const photoInput=useRef<HTMLInputElement>(null);
  const pdf=useResumePdf(resume);
  const [pageCount,setPageCount]=useState(0);
  const [download,setDownload]=useState<{blob:Blob;url:string}|null>(null);
  const sourceStatus = getSourceStatus(resume);
  const canDownload = !!pdf.blob && !pdf.loading && !pdf.error && !sourceStatus.previewStale;
  useEffect(()=>{
    if(!pdf.blob) { setDownload(null); return; }
    const url = URL.createObjectURL(pdf.blob);
    setDownload({ blob:pdf.blob, url });
    return ()=>URL.revokeObjectURL(url);
  },[pdf.blob]);
  const downloadUrl = canDownload && download?.blob === pdf.blob ? download?.url : undefined;
  useEffect(()=>{let cancelled=false;let url:string|undefined;setPhotoUrl(undefined);if(resume.profile.photoId)void getAsset(resume.profile.photoId).then(asset=>{if(asset&&!cancelled){url=URL.createObjectURL(asset.blob);setPhotoUrl(url);}}).catch(()=>onToast('照片读取失败，请重新选择本地照片。',true));return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};},[resume.profile.photoId]);
  function layout<K extends keyof ResumeLayout>(key:K,value:ResumeLayout[K]){onUpdate(d=>({...d,layout:{...d.layout,...(key==='marginHorizontal'?{marginLeft:undefined,marginRight:undefined}:{}),[key]:value}}));}
  function updateSection(id:string,update:(s:ResumeSection)=>ResumeSection){onUpdate(d=>({...d,sections:d.sections.map(s=>s.id===id?update(s):s)}));}
  function focusSection(id:string){setActiveSection(id);setExpanded(previous=>new Set([...previous,id]));setMobileTab('edit');setModulesOpen(false);requestAnimationFrame(()=>document.getElementById(`section-${id}`)?.scrollIntoView({block:'start'}));}
  function moveSection(index:number,delta:number){const target=index+delta;if(target<0||target>=resume.sections.length)return;onUpdate(d=>{const sections=[...d.sections];[sections[index],sections[target]]=[sections[target],sections[index]];return {...d,sections};});}
  function addSection(type:SectionType,title?:string){
    const section={...newSection(type),...(title?{title}:{})};
    onUpdate(d=>({...d,sections:[...d.sections,section]}));
    setAddOpen(false);setModulesOpen(false);setMobileTab('edit');setActiveSection(section.id);setExpanded(previous=>new Set([...previous,section.id]));
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const element=document.getElementById(`section-${section.id}`);if(element?.classList.contains('active-section'))element.scrollIntoView({block:'start'});}));
  }
  async function uploadPhoto(file?:File){if(!file)return;const targetId=resume.id;setPhotoBusy(true);try{const asset=await prepareImage(file);await putAsset(asset);onUpdate(d=>d.id===targetId?({...d,profile:{...d.profile,photoId:asset.id}}):d);onToast('照片已保存在本机。');}catch(error){onToast(error instanceof Error?error.message:'照片处理失败。',true);}finally{setPhotoBusy(false);if(photoInput.current)photoInput.current.value='';}}
  const choosePdfFile = pdfSavePicker();
  async function savePdfToFolder() {
    if (!choosePdfFile || !canDownload || !pdf.blob) return;
    try {
      await savePdfAs(pdf.blob, resume.title, choosePdfFile);
      onToast('PDF 已保存到所选位置。');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      onToast('PDF 未能写入所选位置，可以重新选择或直接下载。', true);
    }
  }
  async function exportPng(){if(!pdf.blob||!canDownload)return;setPngProgress('正在生成图片…');try{await downloadPngZip(pdf.blob,resume.title,((...progress:unknown[])=>{if(typeof progress[0]==='number')setPngProgress(`正在导出图片 ${progress[0]}${typeof progress[1]==='number'?` / ${progress[1]}`:''}…`);}) as never);onToast('图片已打包下载。');}catch(error){onToast(error instanceof Error?error.message:'图片导出失败。',true);}finally{setPngProgress(null);}}
  const saveLabel=saveState==='saved'?'已保存':saveState==='saving'?'正在保存…':saveState==='dirty'?'等待保存…':'保存失败，请备份';
  const missingModules=DEFAULT_MODULES.filter(definition=>!resume.sections.some(section=>section.type===definition.type&&(definition.type!=='custom'||section.title===definition.title)));
  const moduleList=<><div className="module-caption">模块选择<span>{resume.sections.filter(s=>s.visible).length+1} 个已启用</span></div><button className={`module-row ${activeSection==='profile'?'selected':''}`} onClick={()=>focusSection('profile')}><UserRound size={18}/><span>基本信息</span><span className="toggle on profile-fixed-toggle" role="switch" aria-label="显示基本信息" aria-checked="true" aria-disabled="true"><span/></span></button>{resume.sections.map(section=>{const Icon=SECTION_ICONS[section.type];return <div className={`module-row ${activeSection===section.id?'selected':''} ${!section.visible?'module-hidden':''}`} key={section.id}><button className="module-select" onClick={()=>focusSection(section.id)}><Icon size={18}/><span>{section.title}</span></button><button className={`toggle ${section.visible?'on':''}`} role="switch" aria-checked={section.visible} aria-label={`显示${section.title}`} onClick={()=>updateSection(section.id,s=>({...s,visible:!s.visible}))}><span/></button></div>;})}{missingModules.map(definition=>{const Icon=SECTION_ICONS[definition.type];return <div className="module-row module-hidden" key={`available-${definition.type}-${definition.title}`}><button className="module-select" onClick={()=>addSection(definition.type,definition.title)}><Icon size={18}/><span>{definition.title}</span></button><button className="toggle" role="switch" aria-checked={false} aria-label={`显示${definition.title}`} onClick={()=>addSection(definition.type,definition.title)}><span/></button></div>;})}<button className="button primary module-add" onClick={()=>{setModulesOpen(false);setAddOpen(true);}}><Plus size={17}/>添加模块</button></>;
  const formatSetting = (value: number) => Number(value.toFixed(3));
  const spacingControls = (points: boolean) => {
    const unit = points ? 1 : displayPointPerPixel;
    return ([
      ['marginTop', '页面上边距', 60], ['marginLeft', '页面左边距', 50], ['marginRight', '页面右边距', 50],
      ['contentIndent', '内容缩进', 50], ['sectionGap', '模块上边距', 50],
      ['titleTopGap', '标题上边距', 50], ['titleGap', '标题下边距', 50],
    ] as const).map(([key, label, maxPixels]) => {
      const inherited = key === 'marginLeft' || key === 'marginRight' ? resume.layout.marginHorizontal : defaults[key] ?? 0;
      const stored = resume.layout[key] ?? inherited;
      const value = stored / unit;
      const maximum = Math.max(maxPixels * displayPointPerPixel / unit, value);
      return <label key={key} className={points ? 'range-field' : 'reference-spacing-row'}>
        <span>{label}{points && <b>{formatSetting(value)}</b>}</span>
        <input type="range" aria-label={label} min={0} max={maximum} step="any" value={value}
          onChange={event => {
            const chosen = Math.round(Number(event.target.value)) * unit;
            const limit = key === 'marginTop' ? 180 : key === 'sectionGap' || key === 'titleGap' ? 100 : 72;
            layout(key, Math.min(chosen, limit));
          }}/>
        {!points && <output>{formatSetting(value)}</output>}
      </label>;
    });
  };
  const layoutFields=<><button type="button" className="button secondary full-width" onClick={()=>{setLayoutOpen(false);onTemplates();}}><LayoutTemplate size={16}/>切换模板 · {resume.templateId==='neat' && presentation==='markdown' ? '经典蓝色' : getTemplate(resume.templateId).name}</button><div className="settings-section"><h3>文字与配色</h3><div className="field-grid"><label className="field"><span>正文字号</span><select value={resume.layout.fontSize} onChange={e=>layout('fontSize',Number(e.target.value))}>{settingOptions(resume.layout.fontSize,[8,9,10,11,12,13,14]).map(n=><option value={n} key={n}>{formatSetting(n)} pt</option>)}</select></label><label className="field"><span>正文行距</span><select value={resume.layout.lineHeight} onChange={e=>layout('lineHeight',Number(e.target.value))}>{settingOptions(resume.layout.lineHeight,[1.2,1.35,1.5,1.65,1.8,2,2.2]).map(n=><option value={n} key={n}>{formatSetting(n)} 倍</option>)}</select></label></div><label className="field"><span>主题色</span><div className="color-swatches">{PALETTES.map(color=><button key={color} style={{background:color}} aria-label={`主题色${color}`} className={resume.layout.accent===color?'selected':''} onClick={()=>layout('accent',color)}>{resume.layout.accent===color&&<Check size={13}/>}</button>)}<input type="color" aria-label="自定义主题色" value={resume.layout.accent} onChange={e=>layout('accent',e.target.value)}/></div></label></div><div className="settings-section"><h3>页面与间距 <span>单位：pt</span></h3>{spacingControls(true)}</div><div className="settings-section"><h3>基本信息布局</h3><div className="segmented">{([{key:'left',icon:AlignLeft,label:'居左'},{key:'center',icon:AlignCenter,label:'居中'},{key:'right',icon:AlignRight,label:'居右'}] as const).map(({key,icon:Icon,label})=><button key={key} className={resume.layout.headerAlign===key?'selected':''} onClick={()=>layout('headerAlign',key)}><Icon size={16}/>{label}</button>)}</div><label className="check-field"><input type="checkbox" checked={resume.layout.showPhoto} onChange={e=>layout('showPhoto',e.target.checked)}/>在简历中显示照片</label><label className="check-field"><input type="checkbox" checked={resume.layout.photoShape==='round'} onChange={e=>layout('photoShape',e.target.checked?'round':'square')}/>使用圆形照片</label></div><button className="button secondary full-width" onClick={()=>onUpdate(d=>({...d,layout:templateLayout(d.templateId,getPresentationMode(d))}))}><RotateCcw size={15}/>重置排版设置</button></>;
  return <div className={`editor-screen reference-editor ${isMarkdown?'markdown-mode':'form-mode'}`}>
    <header className="editor-header"><div className="editor-title-area"><button className="button ghost back-button" aria-label="我的简历" onClick={onBack}><ArrowLeft size={17}/><span>我的简历</span></button><span className="header-divider"/><input className="document-title" style={{width:Math.min(220,Math.max(34,Array.from(resume.title).length*14+12))}} aria-label="简历名称" value={resume.title} maxLength={80} onChange={e=>onUpdate(d=>({...d,title:e.target.value}))}/><span className={`save-status ${saveState}`} role="status" aria-label={saveLabel}>{saveState==='saved'?<Check size={14}/>:saveState==='error'?<CircleHelp size={14}/>:<LoaderCircle className={saveState==='saving'?'spin':''} size={14}/>}<span>{saveLabel}</span></span></div><div className="editor-header-actions"><span className="editor-pwa">{statusSlot}</span><button type="button" className="button secondary editor-mode-control" title={isMarkdown?'切换到表单编辑':'切换到 Markdown 源码'} aria-label={isMarkdown?'切换到表单编辑':'切换到 Markdown 源码'} onClick={switchEditorMode}>{isMarkdown?<FileText size={16}/>:<Code2 size={16}/>}<span className="editor-mode-name">{isMarkdown?'表单编辑':'Markdown 源码'}</span><span className="editor-mode-short">{isMarkdown?'表单':'源码'}</span></button><button className="button secondary history-button" aria-label="历史版本" onClick={onHistory}><History size={16}/><span>历史</span></button><div className="export-group">{downloadUrl ? <a data-testid="download-pdf" className="button primary export-primary" aria-label="导出 PDF" href={downloadUrl} download={pdfFilename(resume.title)}><Download size={16}/><span>导出</span></a>
      : <button type="button" data-testid="download-pdf" className="button primary export-primary" aria-label="导出 PDF" disabled>{pdf.loading?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}<span>导出</span></button>}<ActionMenu className="export-menu"><summary aria-label="其他导出格式"><ChevronDown size={15}/></summary><div className="dropdown-panel">{choosePdfFile && <button disabled={!canDownload} onClick={()=>void savePdfToFolder()}><Download size={16}/>PDF 另存为…</button>}<button disabled={!canDownload||!!pngProgress} onClick={()=>void exportPng()}><ImagePlus size={16}/>PNG 图片打包</button><button onClick={onMarkdown}><FileText size={16}/>Markdown 源文件</button><button onClick={onBackup}><FileArchive size={16}/>可编辑备份</button></div></ActionMenu></div></div></header>
    <input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>void uploadPhoto(event.target.files?.[0])}/>
    <div className="mobile-editor-switch"><div className="segmented"><button aria-pressed={mobileTab==='edit'} className={mobileTab==='edit'?'selected':''} onClick={()=>setMobileTab('edit')}><FileText size={16}/>编辑内容</button><button aria-pressed={mobileTab==='preview'} className={mobileTab==='preview'?'selected':''} onClick={()=>setMobileTab('preview')}><Eye size={16}/>简历预览</button></div><button className="icon-button" aria-label="打开模块栏" onClick={()=>{if(isMarkdown)setMobileTab('edit');setModulesOpen(true);}}><Menu size={20}/></button><button className="icon-button" aria-label="打开排版设置" onClick={()=>setLayoutOpen(true)}><Settings2 size={19}/></button></div>
    <div className={`editor-workspace mobile-${mobileTab} ${isMarkdown?'markdown-workspace':''}`}>
      {isMarkdown?<MarkdownEditorPane key={resume.id} modulesOpen={modulesOpen} onCloseModules={()=>setModulesOpen(false)} document={resume} onUpdate={onDocumentUpdate} onChoosePhoto={()=>photoInput.current?.click()} syncScroll={syncScroll} onScrollRatio={ratio=>{const surface=previewSurface.current;if(surface&&syncScroll)surface.scrollTop=ratio*(surface.scrollHeight-surface.clientHeight);}}/>:<>
      <aside className="module-sidebar">{moduleList}</aside>
      <main className="edit-form-pane">
        <section id="section-profile" className={`edit-section ${activeSection==='profile'?'active-section':''}`}><div className="section-heading"><button className="section-toggle" onClick={()=>setExpanded(previous=>{const next=new Set(previous);next.has('profile')?next.delete('profile'):next.add('profile');return next;})}><UserRound size={19}/><h2>基本信息</h2></button><button className="icon-button" aria-label="展开或收起基本信息" onClick={()=>setExpanded(previous=>{const next=new Set(previous);next.has('profile')?next.delete('profile'):next.add('profile');return next;})}><ChevronDown size={17} className={expanded.has('profile')?'chevron-expanded':''}/></button></div>{expanded.has('profile')&&<ProfileForm document={resume} onUpdate={onUpdate} photoUrl={photoUrl} photoBusy={photoBusy} onChoosePhoto={()=>photoInput.current?.click()}/>}</section>
        {resume.sections.map((section,index)=>{const Icon=SECTION_ICONS[section.type];const open=expanded.has(section.id);const labels=section.type==='education'?['学校名称','专业 / 学历']:section.type==='experience'?['公司 / 组织','职位 / 部门']:section.type==='skill'?['技能名称','补充信息']:section.type==='project'?['项目名称','担任角色']:['标题 / 名称','补充信息'];return <section key={section.id} id={`section-${section.id}`} className={`edit-section ${activeSection===section.id?'active-section':''} ${!section.visible?'disabled-section':''}`}><div className="section-heading"><button className="section-toggle" onClick={()=>{setActiveSection(section.id);setExpanded(s=>{const next=new Set(s);open?next.delete(section.id):next.add(section.id);return next;});}}><Icon size={19}/><h2>{section.title}</h2>{!section.visible&&<span className="hidden-label">已隐藏</span>}</button><div className="section-tools"><button className="icon-button" disabled={index===0} aria-label={`上移${section.title}`} onClick={()=>moveSection(index,-1)}><ArrowUp size={15}/></button><button className="icon-button" disabled={index===resume.sections.length-1} aria-label={`下移${section.title}`} onClick={()=>moveSection(index,1)}><ArrowDown size={15}/></button><button className="icon-button delete-section" aria-label={`移除${section.title}`} onClick={()=>setRemoveSection(section.id)}><Trash2 size={15}/></button><button className="icon-button" aria-label={`${open?'收起':'展开'}${section.title}`} onClick={()=>setExpanded(s=>{const next=new Set(s);open?next.delete(section.id):next.add(section.id);return next;})}><ChevronDown size={17} className={open?'chevron-expanded':''}/></button></div></div>{open&&<div className="section-fields"><div className="section-options"><label className="inline-field"><span>模块名称</span><input aria-label="模块名称" value={section.title} onChange={e=>updateSection(section.id,s=>({...s,title:e.target.value}))}/></label><label className="check-field"><input type="checkbox" checked={section.pageBreakBefore} onChange={e=>updateSection(section.id,s=>({...s,pageBreakBefore:e.target.checked}))}/>另起一页</label></div>{section.items.map((item,itemIndex)=><div className="experience-item" key={item.id}><div className="item-number"><span>{String(itemIndex+1).padStart(2,'0')}</span><button className="text-button muted" aria-label={`删除${section.title}第${itemIndex+1}项`} onClick={()=>updateSection(section.id,s=>({...s,items:s.items.filter(i=>i.id!==item.id)}))}><Trash2 size={13}/>删除此项</button></div><div className="field-grid"><label className="field"><span>{labels[0]}</span><input value={item.title} placeholder={`填写${labels[0]}`} onChange={e=>updateSection(section.id,s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,title:e.target.value}:i)}))}/></label><label className="field"><span>{labels[1]}</span><input value={item.subtitle} placeholder="选填" onChange={e=>updateSection(section.id,s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,subtitle:e.target.value}:i)}))}/></label>{!['skill','summary'].includes(section.type)&&<><label className="field"><span>开始时间</span><input value={item.startDate} placeholder="2023.09" onChange={e=>updateSection(section.id,s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,startDate:e.target.value}:i)}))}/></label><label className="field"><span>结束时间</span><input value={item.endDate} placeholder="2026.06 / 至今" onChange={e=>updateSection(section.id,s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,endDate:e.target.value}:i)}))}/></label></>}{['project','portfolio','research'].includes(section.type)&&<label className="field field-span"><span>相关链接</span><input value={item.url} placeholder="https://（选填）" onChange={e=>updateSection(section.id,s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,url:e.target.value}:i)}))}/></label>}</div><label className="field-description">{section.type==='skill'?'技能描述':'内容描述'}</label><RichTextEditor key={`${resume.id}-${item.id}`} value={item.description} label={`${section.title}第${itemIndex+1}项描述`} onChange={description=>updateSection(section.id,s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,description}:i)}))}/></div>)}<button className="button add-item-button" onClick={()=>updateSection(section.id,s=>({...s,items:[...s.items,newItem()]}))}><Plus size={16}/>添加一项{section.title}</button></div>}</section>;})}
        <button className="button add-section-bottom" onClick={()=>setAddOpen(true)}><Plus size={17}/>添加自定义模块</button>
      </main></>}
      <aside className="preview-pane">
        <div className="preview-settings">
          <div className="reference-preview-actions">{!isMarkdown&&<button onClick={()=>setLayoutOpen(true)}><Columns3 size={14}/>基础布局</button>}{isMarkdown&&<button onClick={onTemplates}><LayoutTemplate size={14}/>模板风格</button>}</div>
          <div className="preview-quick-settings"><label>字体<select aria-label="字体"><option>思源黑体</option></select></label><label>字号<select aria-label="预览正文字号" value={resume.layout.fontSize} onChange={event=>layout('fontSize',Number(event.target.value))}>{settingOptions(resume.layout.fontSize,[8,9,10,11,12,13,14].map(value=>value*displayPointPerPixel)).map(value=><option value={value} key={value}>{formatSetting(value/displayPointPerPixel)}</option>)}</select></label><label>行距<select aria-label="预览正文行距" value={resume.layout.lineHeight} onChange={event=>layout('lineHeight',Number(event.target.value))}>{settingOptions(resume.layout.lineHeight,[16,18,20,22,24,26,28].map(value=>value*displayPointPerPixel/resume.layout.fontSize).filter(ratio=>ratio>=0.5 && ratio<=4)).map(value=><option value={value} key={value}>{formatSetting(value*resume.layout.fontSize/displayPointPerPixel)}</option>)}</select></label><label>主题色<input type="color" aria-label="预览主题色" value={resume.layout.accent} onChange={event=>layout('accent',event.target.value)}/></label></div>
          <div className="reference-preview-actions">{!isMarkdown&&<><button onClick={onTemplates}><LayoutTemplate size={14}/>模板风格</button><button onClick={()=>setAddOpen(true)}><Plus size={14}/>添加模块</button></>}<button className="spacing-trigger" aria-expanded={!!spacingPosition} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setSpacingPosition(current=>current?null:{left:rect.left-200,top:rect.bottom+10});}}><Menu size={14}/>间距配置</button>{isMarkdown?<label className="sync-scroll-switch"><input type="checkbox" checked={syncScroll} onChange={event=>setSyncScroll(event.target.checked)}/>同步滚动</label>:null}</div>
        </div>
        <div className="pdf-surface" ref={previewSurface}>{sourceStatus.previewStale && <div className="md-editor-warning md-editor-warning-error" role="alert">预览为上次有效版本。请修正 Markdown 源码后导出。</div>}<button className="smart-fit-button" title="收紧字号与间距；保留全部内容，多页内容不会被截断" onClick={()=>{onUpdate(current=>({...current,layout:{...current.layout,fontSize:Math.min(current.layout.fontSize,10.5),marginTop:20,marginHorizontal:22,marginLeft:22,marginRight:22,titleTopGap:0,sectionGap:4,titleGap:5,lineHeight:1.35}}));onToast('已优化字号与间距，保留全部内容；较长简历仍会自动分页。');}}>紧凑排版</button><PdfPreview key={resume.id} onPageCount={setPageCount} blob={pdf.previewBlob} loading={pdf.loading} error={pdf.error??undefined}/></div>
        <div className="preview-bottom"><span>共 {pageCount||'—'} 页</span></div>
      </aside>
    </div>
    {pngProgress&&<div className="export-progress" role="status"><LoaderCircle className="spin" size={17}/>{pngProgress}</div>}
    {modulesOpen&&!isMarkdown&&<Modal title="简历模块" onClose={()=>setModulesOpen(false)} className="mobile-modules-modal">{moduleList}</Modal>}
    {spacingPosition&&<div className="spacing-popover" role="dialog" aria-label="间距配置" style={{'--spacing-anchor-left':`${spacingPosition.left}px`,'--spacing-anchor-top':`${spacingPosition.top}px`} as CSSProperties}>
      {spacingControls(false)}
      <button className="button secondary" onClick={()=>onUpdate(current=>({...current,layout:resetResumeSpacing(current)}))}>重 置</button>
    </div>}
    {layoutOpen&&<Modal title="排版设置" onClose={()=>setLayoutOpen(false)} className="layout-modal">{layoutFields}</Modal>}
    {addOpen&&<Modal title="添加简历模块" onClose={()=>setAddOpen(false)}><div className="add-module-grid">{(Object.entries(SECTION_LABELS) as [SectionType,string][]).map(([type,label])=>{const Icon=SECTION_ICONS[type];return <button key={type} onClick={()=>addSection(type)}><Icon size={22}/><span>{label}</span><Plus size={15}/></button>;})}</div></Modal>}
    {removeSection&&<Modal title="移除这个模块？" onClose={()=>setRemoveSection(null)}><p>模块内容将从当前简历中移除，你可以在历史记录中恢复之前保存的版本。</p><div className="modal-actions"><button className="button secondary" onClick={()=>setRemoveSection(null)}>保留模块</button><button className="button danger" onClick={()=>{onUpdate(d=>({...d,sections:d.sections.filter(s=>s.id!==removeSection)}));setRemoveSection(null);}}>移除模块</button></div></Modal>}
  </div>;
}
