import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import { AlignCenter, AlignLeft, AlignRight, Bold, Eraser, IndentIncrease, IndentDecrease, Italic, Link2, List, ListOrdered, Redo2, Undo2, Underline } from 'lucide-react';
import type { RichNode } from '../model';
import { sanitizeRichText } from '../lib/storage';
import Modal from './Modal';

const TextFormatting = Extension.create({
  name: 'localTextFormatting',
  addGlobalAttributes() { return [
    { types:['paragraph','heading'], attributes:{indent:{default:0, parseHTML:element=>Number(element.getAttribute('data-indent') || 0),renderHTML:attributes=>attributes.indent?{'data-indent':attributes.indent,style:`margin-left: ${Number(attributes.indent)*20}px`}:{}}} },
    { types:['textStyle'],attributes:{fontSize:{default:null,parseHTML:element=>element.style.fontSize || null,renderHTML:attributes=>attributes.fontSize?{style:`font-size: ${attributes.fontSize}`}:{}}} },
  ]; },
});
const safeLink = (value: string) => /^(https?:\/\/|mailto:)/i.test(value) && !/[\u0000-\u001f\u007f]/.test(value);

export default function RichTextEditor({ value, onChange, label = '内容描述' }: { value: RichNode; onChange: (value: RichNode) => void; label?: string }) {
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const [, refresh] = useState(0);
  const editor = useEditor({
    extensions:[StarterKit.configure({heading:{levels:[2,3]},link:{openOnClick:false,autolink:false,protocols:['http','https','mailto'],isAllowedUri: url=>safeLink(url)}}),TextStyle,Color,TextAlign.configure({types:['heading','paragraph']}),TextFormatting],
    content:value,
    editorProps:{attributes:{class:'richtext-content','aria-label':label,role:'textbox','aria-multiline':'true'},handleDOMEvents:{drop:(_view,event)=>{if(event.dataTransfer?.files.length){event.preventDefault();return true;}return false;}},transformPastedHTML:html=>html.replace(/<(img|iframe|object|embed|video|audio|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<(img|iframe|object|embed|video|audio|svg)\b[^>]*\/?\s*>/gi,'')},
    onUpdate:({editor:instance})=>changeRef.current(instance.getJSON() as RichNode),
    onSelectionUpdate:()=>refresh(v=>v+1),
    onTransaction:()=>refresh(v=>v+1),
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const view = editor.view;
    let frame: number | undefined;
    const incoming = editor.schema.nodeFromJSON(value);
    const equivalent = () => editor.state.doc.eq(incoming) ||
      editor.schema.nodeFromJSON(sanitizeRichText(editor.getJSON())).eq(incoming);
    // IndexedDB removes empty/default attributes and normalizes link marks.
    // An acknowledgement of this edit should never replace the live selection.
    if (equivalent()) return;
    function sync() {
      if (!editor || editor.isDestroyed || view.composing) return;
      if (!equivalent()) editor.commands.setContent(value, { emitUpdate: false });
    }
    function afterComposition() {
      frame = requestAnimationFrame(sync);
    }
    sync();
    if (!view.composing) return;
    view.dom.addEventListener('compositionend', afterComposition, { once: true });
    return () => {
      view.dom.removeEventListener('compositionend', afterComposition);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [editor, value]);
  if(!editor)return <div className="richtext-loading">正在准备编辑器…</div>;
  function indent(delta: number) {
    if(!editor)return;
    if(editor.isActive('listItem')){ if(delta>0)editor.chain().focus().sinkListItem('listItem').run();else editor.chain().focus().liftListItem('listItem').run(); }
    else { const current=Number(editor.getAttributes('paragraph').indent || 0);editor.chain().focus().updateAttributes('paragraph',{indent:Math.max(0,Math.min(5,current+delta))}).run(); }
  }
  const tools = [
    {label:'撤销',icon:Undo2,action:()=>editor.chain().focus().undo().run(),disabled:!editor.can().undo()},
    {label:'重做',icon:Redo2,action:()=>editor.chain().focus().redo().run(),disabled:!editor.can().redo()},
    {label:'加粗',icon:Bold,action:()=>editor.chain().focus().toggleBold().run(),active:editor.isActive('bold')},
    {label:'斜体',icon:Italic,action:()=>editor.chain().focus().toggleItalic().run(),active:editor.isActive('italic')},
    {label:'下划线',icon:Underline,action:()=>editor.chain().focus().toggleUnderline().run(),active:editor.isActive('underline')},
    {label:'无序列表',icon:List,action:()=>editor.chain().focus().toggleBulletList().run(),active:editor.isActive('bulletList')},
    {label:'有序列表',icon:ListOrdered,action:()=>editor.chain().focus().toggleOrderedList().run(),active:editor.isActive('orderedList')},
    {label:'添加链接',icon:Link2,action:()=>{setLinkValue(editor.getAttributes('link').href || '');setLinkError('');setLinkOpen(true);},active:editor.isActive('link')},
    {label:'左对齐',icon:AlignLeft,action:()=>editor.chain().focus().setTextAlign('left').run(),active:editor.isActive({textAlign:'left'})},
    {label:'居中',icon:AlignCenter,action:()=>editor.chain().focus().setTextAlign('center').run(),active:editor.isActive({textAlign:'center'})},
    {label:'右对齐',icon:AlignRight,action:()=>editor.chain().focus().setTextAlign('right').run(),active:editor.isActive({textAlign:'right'})},
    {label:'增加缩进',icon:IndentIncrease,action:()=>indent(1)},
    {label:'减少缩进',icon:IndentDecrease,action:()=>indent(-1)},
    {label:'清除格式',icon:Eraser,action:()=>editor.chain().focus().unsetAllMarks().clearNodes().run()},
  ];
  return <div className="richtext-editor">
    <div className="richtext-toolbar" role="toolbar" aria-label={`${label}格式工具`}>{tools.map(({label:toolLabel,icon:Icon,action,disabled,active})=><button type="button" key={toolLabel} title={toolLabel} aria-label={toolLabel} aria-pressed={active} disabled={disabled} className={active?'active':''} onMouseDown={e=>e.preventDefault()} onClick={action}><Icon size={15}/></button>)}
      <label className="richtext-color" title="文字颜色"><input type="color" aria-label="文字颜色" value={editor.getAttributes('textStyle').color || '#333333'} onChange={e=>editor.chain().focus().setColor(e.target.value).run()}/><span>A</span></label>
      <select aria-label="选中文字字号" value={editor.getAttributes('textStyle').fontSize || ''} onChange={e=>editor.chain().focus().setMark('textStyle',{fontSize:e.target.value || null}).run()}><option value="">字号</option>{[9,10,11,12,14,16].map(n=><option key={n} value={`${n}pt`}>{n}</option>)}</select>
    </div>
    <EditorContent editor={editor}/>
    {linkOpen&&<Modal title="编辑链接" onClose={()=>setLinkOpen(false)}><label className="field"><span>链接地址</span><input autoFocus placeholder="https://example.com" value={linkValue} onChange={e=>setLinkValue(e.target.value)}/></label>{linkError&&<p className="error-text">{linkError}</p>}<div className="modal-actions"><button className="button secondary" onClick={()=>{editor.chain().focus().unsetLink().run();setLinkOpen(false);}}>移除链接</button><button className="button primary" onClick={()=>{const href=linkValue.trim();if(!safeLink(href)){setLinkError('请输入完整的 http、https 或 mailto 链接。');return;}editor.chain().focus().extendMarkRange('link').setLink({href}).run();setLinkOpen(false);}}>保存链接</button></div></Modal>}
  </div>;
}
