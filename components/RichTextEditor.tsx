import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import PlaceholderExt from '@tiptap/extension-placeholder';
import MentionExt from '@tiptap/extension-mention';
import UnderlineExt from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Suggestion } from '@tiptap/suggestion';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Code, Send, Paperclip, AtSign, ChevronDown,
  Heading1, Heading2, Heading3, List, ListOrdered, Quote,
  Code2, CheckSquare, Type,
} from 'lucide-react';

interface TeamMember {
  id: number;
  name: string;
  avatar_url?: string | null;
}

interface RichTextEditorProps {
  teamMembers: TeamMember[];
  onSubmit: (html: string) => void;
}

// ─── Slash command definitions ────────────────────────────────────────────────

interface SlashCommand {
  id: string;
  label: string;
  group: 'TEXT' | 'INLINE';
  icon: React.ReactNode;
  action: (editor: Editor) => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'paragraph',    label: 'Normal text',    group: 'TEXT',   icon: <Type size={14} />,         action: e => e.chain().focus().setParagraph().run() },
  { id: 'h1',           label: 'Heading 1',       group: 'TEXT',   icon: <Heading1 size={14} />,     action: e => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2',           label: 'Heading 2',       group: 'TEXT',   icon: <Heading2 size={14} />,     action: e => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3',           label: 'Heading 3',       group: 'TEXT',   icon: <Heading3 size={14} />,     action: e => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'h4',           label: 'Heading 4',       group: 'TEXT',   icon: <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>H4</span>, action: e => e.chain().focus().toggleHeading({ level: 4 }).run() },
  { id: 'checklist',    label: 'Checklist',       group: 'TEXT',   icon: <CheckSquare size={14} />,  action: e => e.chain().focus().toggleTaskList().run() },
  { id: 'bulletList',   label: 'Bulleted list',   group: 'TEXT',   icon: <List size={14} />,         action: e => e.chain().focus().toggleBulletList().run() },
  { id: 'orderedList',  label: 'Numbered list',   group: 'TEXT',   icon: <ListOrdered size={14} />,  action: e => e.chain().focus().toggleOrderedList().run() },
  { id: 'codeBlock',    label: 'Code block',      group: 'TEXT',   icon: <Code2 size={14} />,        action: e => e.chain().focus().toggleCodeBlock().run() },
  { id: 'blockquote',   label: 'Block quote',     group: 'TEXT',   icon: <Quote size={14} />,        action: e => e.chain().focus().toggleBlockquote().run() },
  { id: 'bold',         label: 'Bold',            group: 'INLINE', icon: <Bold size={14} />,         action: e => e.chain().focus().toggleBold().run() },
  { id: 'italic',       label: 'Italic',          group: 'INLINE', icon: <Italic size={14} />,       action: e => e.chain().focus().toggleItalic().run() },
  { id: 'underline',    label: 'Underline',       group: 'INLINE', icon: <UnderlineIcon size={14} />,action: e => e.chain().focus().toggleUnderline().run() },
  { id: 'strike',       label: 'Strikethrough',   group: 'INLINE', icon: <Strikethrough size={14} />,action: e => e.chain().focus().toggleStrike().run() },
  { id: 'code',         label: 'Inline code',     group: 'INLINE', icon: <Code size={14} />,         action: e => e.chain().focus().toggleCode().run() },
];

// ─── Slash command Extension ──────────────────────────────────────────────────

function createSlashExtension(handlersRef: React.MutableRefObject<any>) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }: { query: string }) => {
            if (!query) return SLASH_COMMANDS;
            const q = query.toLowerCase();
            return SLASH_COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.id.includes(q));
          },
          command: ({ editor, range, props }: { editor: Editor; range: any; props: any }) => {
            editor.chain().focus().deleteRange(range).run();
            props.action(editor);
          },
          render: () => ({
            onStart:   (props: any) => handlersRef.current.onStart?.(props),
            onUpdate:  (props: any) => handlersRef.current.onUpdate?.(props),
            onKeyDown: (p: any)     => handlersRef.current.onKeyDown?.(p.event) ?? false,
            onExit:    ()           => handlersRef.current.onExit?.(),
          }),
        }),
      ];
    },
  });
}

// ─── Mention suggestion config ─────────────────────────────────────────────────

function createMentionSuggestion(
  handlersRef: React.MutableRefObject<any>,
  membersRef:  React.MutableRefObject<TeamMember[]>
) {
  return {
    items: ({ query }: { query: string }) =>
      membersRef.current
        .filter(m => m.name.toLowerCase().startsWith(query.toLowerCase()))
        .slice(0, 8),
    render: () => ({
      onStart:   (props: any) => handlersRef.current.onStart?.(props),
      onUpdate:  (props: any) => handlersRef.current.onUpdate?.(props),
      onKeyDown: (p: any)     => handlersRef.current.onKeyDown?.(p.event) ?? false,
      onExit:    ()           => handlersRef.current.onExit?.(),
    }),
  };
}

// ─── Popup position helper ─────────────────────────────────────────────────────

function getPopupStyle(rect: DOMRect | null): React.CSSProperties {
  if (!rect) return { display: 'none' };
  return {
    position: 'fixed',
    top:  rect.bottom + 6,
    left: Math.min(rect.left, window.innerWidth - 248),
    zIndex: 9999,
  };
}

// ─── State types ───────────────────────────────────────────────────────────────

interface SlashMenuState {
  open: boolean;
  items: SlashCommand[];
  selectedIndex: number;
  commandFn: ((item: SlashCommand) => void) | null;
  rect: DOMRect | null;
}

interface MentionMenuState {
  open: boolean;
  items: TeamMember[];
  selectedIndex: number;
  commandFn: ((item: { id: number; label: string }) => void) | null;
  rect: DOMRect | null;
}

interface BubbleState {
  visible: boolean;
  top: number;
  left: number;
}

// ─── Main component ────────────────────────────────────────────────────────────

const RichTextEditor: React.FC<RichTextEditorProps> = ({ teamMembers, onSubmit }) => {
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(
    { open: false, items: [], selectedIndex: 0, commandFn: null, rect: null }
  );
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>(
    { open: false, items: [], selectedIndex: 0, commandFn: null, rect: null }
  );
  const [bubble, setBubble] = useState<BubbleState>({ visible: false, top: 0, left: 0 });
  const [headingOpen, setHeadingOpen] = useState(false);
  const [editorState, setEditorState] = useState(0); // tick to re-render on editor update

  const slashHandlersRef   = useRef<any>({});
  const mentionHandlersRef = useRef<any>({});
  const membersRef         = useRef(teamMembers);

  useEffect(() => { membersRef.current = teamMembers; }, [teamMembers]);

  // ── Slash handlers ────────────────────────────────────────────────────────────
  slashHandlersRef.current.onStart = (props: any) => {
    setSlashMenu({ open: true, items: props.items, selectedIndex: 0, commandFn: props.command, rect: props.clientRect?.() ?? null });
  };
  slashHandlersRef.current.onUpdate = (props: any) => {
    setSlashMenu(prev => ({ ...prev, items: props.items, selectedIndex: 0, commandFn: props.command, rect: props.clientRect?.() ?? prev.rect }));
  };
  slashHandlersRef.current.onKeyDown = (event: KeyboardEvent) => {
    if (!slashMenu.open) return false;
    if (event.key === 'ArrowDown') { setSlashMenu(p => ({ ...p, selectedIndex: (p.selectedIndex + 1) % Math.max(p.items.length, 1) })); return true; }
    if (event.key === 'ArrowUp')   { setSlashMenu(p => ({ ...p, selectedIndex: (p.selectedIndex - 1 + Math.max(p.items.length, 1)) % Math.max(p.items.length, 1) })); return true; }
    if (event.key === 'Enter')     { const item = slashMenu.items[slashMenu.selectedIndex]; if (item && slashMenu.commandFn) slashMenu.commandFn(item); return true; }
    if (event.key === 'Escape')    { setSlashMenu(p => ({ ...p, open: false })); return true; }
    return false;
  };
  slashHandlersRef.current.onExit = () => setSlashMenu(p => ({ ...p, open: false }));

  // ── Mention handlers ──────────────────────────────────────────────────────────
  mentionHandlersRef.current.onStart = (props: any) => {
    setMentionMenu({ open: true, items: props.items, selectedIndex: 0, commandFn: props.command, rect: props.clientRect?.() ?? null });
  };
  mentionHandlersRef.current.onUpdate = (props: any) => {
    setMentionMenu(prev => ({ ...prev, items: props.items, selectedIndex: 0, commandFn: props.command, rect: props.clientRect?.() ?? prev.rect }));
  };
  mentionHandlersRef.current.onKeyDown = (event: KeyboardEvent) => {
    if (!mentionMenu.open) return false;
    if (event.key === 'ArrowDown') { setMentionMenu(p => ({ ...p, selectedIndex: (p.selectedIndex + 1) % Math.max(p.items.length, 1) })); return true; }
    if (event.key === 'ArrowUp')   { setMentionMenu(p => ({ ...p, selectedIndex: (p.selectedIndex - 1 + Math.max(p.items.length, 1)) % Math.max(p.items.length, 1) })); return true; }
    if (event.key === 'Enter')     { const item = mentionMenu.items[mentionMenu.selectedIndex]; if (item && mentionMenu.commandFn) mentionMenu.commandFn({ id: item.id, label: item.name }); return true; }
    if (event.key === 'Escape')    { setMentionMenu(p => ({ ...p, open: false })); return true; }
    return false;
  };
  mentionHandlersRef.current.onExit = () => setMentionMenu(p => ({ ...p, open: false }));

  // ── Editor ────────────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExt,
      TaskList,
      TaskItem.configure({ nested: true }),
      PlaceholderExt.configure({
        placeholder: 'Write a comment… (type / for commands, @ to mention)',
      }),
      MentionExt.configure({
        HTMLAttributes: { class: 'mention-chip' },
        renderHTML({ options, node }: any) {
          return ['span', { ...options.HTMLAttributes, 'data-id': node.attrs.id, 'data-label': node.attrs.label }, `@${node.attrs.label}`];
        },
        suggestion: createMentionSuggestion(mentionHandlersRef, membersRef),
      }),
      createSlashExtension(slashHandlersRef),
    ],
    editorProps: {
      attributes: { class: 'tiptap-editor' },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from !== to) {
        try {
          const start = ed.view.coordsAtPos(from);
          const end   = ed.view.coordsAtPos(to);
          const midX  = (start.left + end.left) / 2;
          setBubble({ visible: true, top: start.top - 52, left: Math.max(8, midX - 130) });
        } catch { setBubble(b => ({ ...b, visible: false })); }
      } else {
        setBubble(b => ({ ...b, visible: false }));
        setHeadingOpen(false);
      }
      setEditorState(n => n + 1);
    },
    onUpdate: () => setEditorState(n => n + 1),
  });

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    if (html === '<p></p>' || editor.isEmpty) return;
    onSubmit(html);
    editor.commands.clearContent();
    setBubble(b => ({ ...b, visible: false }));
  }, [editor, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
  };

  // ── Grouped slash items ───────────────────────────────────────────────────────
  const groupedSlash: { group: string; items: SlashCommand[] }[] = [];
  for (const cmd of slashMenu.items) {
    const g = groupedSlash.find(x => x.group === cmd.group);
    if (g) g.items.push(cmd); else groupedSlash.push({ group: cmd.group, items: [cmd] });
  }

  const isEmpty = !editor || editor.isEmpty;

  return (
    <div style={{ position: 'relative' }}>

      {/* ── Global styles ── */}
      <style>{`
        .tiptap-editor {
          outline: none;
          min-height: 80px;
          padding: 10px 14px;
          font-size: 13px;
          color: #374151;
          line-height: 1.6;
        }
        .tiptap-editor p { margin: 0 0 4px 0; }
        .tiptap-editor p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
          float: left;
          height: 0;
        }
        .tiptap-editor h1 { font-size: 1.4em; font-weight: 700; margin: 8px 0 4px; }
        .tiptap-editor h2 { font-size: 1.2em; font-weight: 700; margin: 8px 0 4px; }
        .tiptap-editor h3 { font-size: 1.05em; font-weight: 600; margin: 6px 0 4px; }
        .tiptap-editor h4 { font-size: 1em; font-weight: 600; margin: 6px 0 4px; }
        .tiptap-editor ul, .tiptap-editor ol { padding-left: 20px; margin: 4px 0; }
        .tiptap-editor li { margin: 2px 0; }
        .tiptap-editor ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
        .tiptap-editor ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 8px; }
        .tiptap-editor ul[data-type="taskList"] > li > label { flex-shrink: 0; margin-top: 3px; cursor: pointer; }
        .tiptap-editor blockquote { border-left: 3px solid #e2e8f0; padding-left: 12px; color: #64748b; margin: 8px 0; }
        .tiptap-editor pre { background: #1e293b; color: #e2e8f0; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; margin: 8px 0; }
        .tiptap-editor code { background: #f1f5f9; color: #e11d48; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; font-family: monospace; }
        .tiptap-editor pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
        .tiptap-editor strong { font-weight: 700; }
        .tiptap-editor em { font-style: italic; }
        .tiptap-editor u { text-decoration: underline; }
        .tiptap-editor s { text-decoration: line-through; }
        .mention-chip {
          display: inline-block;
          background: #eff6ff;
          color: #2563eb;
          border-radius: 4px;
          padding: 0 5px;
          font-weight: 600;
          font-size: 0.9em;
          cursor: default;
        }
        /* Rich comment display */
        .rich-comment h1 { font-size: 1.25em; font-weight: 700; margin: 5px 0 3px; }
        .rich-comment h2 { font-size: 1.1em; font-weight: 700; margin: 5px 0 3px; }
        .rich-comment h3, .rich-comment h4 { font-size: 1em; font-weight: 600; margin: 4px 0 2px; }
        .rich-comment p { margin: 0 0 3px; }
        .rich-comment ul, .rich-comment ol { padding-left: 18px; margin: 3px 0; }
        .rich-comment li { margin: 1px 0; }
        .rich-comment ul[data-type="taskList"] { list-style: none; padding-left: 2px; }
        .rich-comment ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 6px; }
        .rich-comment blockquote { border-left: 3px solid #e2e8f0; padding-left: 10px; color: #64748b; margin: 4px 0; }
        .rich-comment pre { background: #1e293b; color: #e2e8f0; padding: 8px 12px; border-radius: 6px; font-size: 11px; overflow-x: auto; margin: 4px 0; }
        .rich-comment code { background: #f1f5f9; color: #e11d48; padding: 1px 4px; border-radius: 3px; font-size: 0.85em; font-family: monospace; }
        .rich-comment pre code { background: none; color: inherit; padding: 0; }
        .rich-comment strong { font-weight: 700; }
        .rich-comment em { font-style: italic; }
        .rich-comment u { text-decoration: underline; }
        .rich-comment s { text-decoration: line-through; }
        .rich-comment .mention-chip { display: inline-block; background: #eff6ff; color: #2563eb; border-radius: 4px; padding: 0 4px; font-weight: 600; font-size: 0.9em; }
      `}</style>

      {/* ── Floating bubble toolbar ── */}
      {bubble.visible && editor && (
        <div
          style={{
            position: 'fixed', top: bubble.top, left: bubble.left, zIndex: 9998,
            display: 'flex', alignItems: 'center', gap: '1px',
            background: '#1e293b', borderRadius: '8px', padding: '4px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}
          onMouseDown={e => e.preventDefault()} // prevent editor losing focus
        >
          {/* Heading dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setHeadingOpen(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 7px', borderRadius: 5, border: 'none', background: headingOpen ? '#334155' : 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
            >
              H <ChevronDown size={10} />
            </button>
            {headingOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#1e293b', borderRadius: 8, padding: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', zIndex: 10001, minWidth: 70 }}>
                {([1,2,3,4] as (1|2|3|4)[]).map(level => (
                  <button key={level}
                    onClick={() => { editor.chain().focus().toggleHeading({ level }).run(); setHeadingOpen(false); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', borderRadius: 5, border: 'none', background: editor.isActive('heading', { level }) ? '#2563eb' : 'transparent', color: editor.isActive('heading', { level }) ? 'white' : '#e2e8f0', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                  >H{level}</button>
                ))}
              </div>
            )}
          </div>

          <div style={{ width: 1, height: 16, background: '#334155', margin: '0 2px' }} />

          {[
            { icon: <Bold size={13}/>,          active: editor.isActive('bold'),      action: () => editor.chain().focus().toggleBold().run() },
            { icon: <Italic size={13}/>,        active: editor.isActive('italic'),    action: () => editor.chain().focus().toggleItalic().run() },
            { icon: <UnderlineIcon size={13}/>, active: editor.isActive('underline'), action: () => editor.chain().focus().toggleUnderline().run() },
            { icon: <Strikethrough size={13}/>, active: editor.isActive('strike'),    action: () => editor.chain().focus().toggleStrike().run() },
            { icon: <Code size={13}/>,          active: editor.isActive('code'),      action: () => editor.chain().focus().toggleCode().run() },
          ].map((btn, i) => (
            <button key={i} onClick={btn.action}
              style={{ padding: '4px 6px', borderRadius: 5, border: 'none', background: btn.active ? '#2563eb' : 'transparent', color: btn.active ? 'white' : '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >{btn.icon}</button>
          ))}
        </div>
      )}

      {/* ── Editor box ── */}
      <div
        style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'visible', background: 'white' }}
        onKeyDown={handleKeyDown}
      >
        <EditorContent editor={editor} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', borderRadius: '0 0 12px 12px' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { icon: <Paperclip size={15} />, title: 'Attachment', action: () => {} },
              { icon: <AtSign size={15} />,    title: 'Mention',     action: () => editor?.chain().focus().insertContent('@').run() },
            ].map((btn, i) => (
              <button key={i} title={btn.title} onClick={btn.action}
                style={{ padding: 5, borderRadius: 6, border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}
                onMouseOver={e => (e.currentTarget.style.background = '#e2e8f0')}
                onMouseOut={e  => (e.currentTarget.style.background = 'transparent')}
              >{btn.icon}</button>
            ))}
          </div>
          <button onClick={handleSubmit} disabled={isEmpty}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 8, border: 'none', background: isEmpty ? '#e2e8f0' : '#0f172a', color: isEmpty ? '#94a3b8' : 'white', fontSize: 12, fontWeight: 600, cursor: isEmpty ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}
          >Send <Send size={13} /></button>
        </div>
      </div>

      {/* ── Slash command popup ── */}
      {slashMenu.open && slashMenu.items.length > 0 && (
        <div style={{ ...getPopupStyle(slashMenu.rect), background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', width: 240, maxHeight: 320, overflowY: 'auto', padding: '6px 0' }}>
          {groupedSlash.map(group => (
            <div key={group.group}>
              <div style={{ padding: '4px 12px 2px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group.group}</div>
              {group.items.map(cmd => {
                const idx = slashMenu.items.indexOf(cmd);
                const active = idx === slashMenu.selectedIndex;
                return (
                  <button key={cmd.id}
                    onMouseDown={e => { e.preventDefault(); if (slashMenu.commandFn) slashMenu.commandFn(cmd); }}
                    onMouseEnter={() => setSlashMenu(p => ({ ...p, selectedIndex: idx }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '6px 12px', border: 'none', textAlign: 'left', background: active ? '#f0f9ff' : 'transparent', color: active ? '#0369a1' : '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                  >
                    <span style={{ color: active ? '#0369a1' : '#64748b', display: 'flex', width: 18, justifyContent: 'center' }}>{cmd.icon}</span>
                    {cmd.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Mention popup ── */}
      {mentionMenu.open && mentionMenu.items.length > 0 && (
        <div style={{ ...getPopupStyle(mentionMenu.rect), background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', width: 220, maxHeight: 260, overflowY: 'auto', padding: '6px 0' }}>
          <div style={{ padding: '4px 12px 2px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Team Members</div>
          {mentionMenu.items.map((member, idx) => {
            const active = idx === mentionMenu.selectedIndex;
            return (
              <button key={member.id}
                onMouseDown={e => { e.preventDefault(); if (mentionMenu.commandFn) mentionMenu.commandFn({ id: member.id, label: member.name }); }}
                onMouseEnter={() => setMentionMenu(p => ({ ...p, selectedIndex: idx }))}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '6px 12px', border: 'none', textAlign: 'left', background: active ? '#f0f9ff' : 'transparent', color: active ? '#0369a1' : '#374151', cursor: 'pointer', fontSize: 13 }}
              >
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#dbeafe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, overflow: 'hidden', flexShrink: 0 }}>
                  {member.avatar_url
                    ? <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                    : (member.name || 'U').charAt(0).toUpperCase()}
                </div>
                <span style={{ fontWeight: 500 }}>{member.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RichTextEditor;

// ─── Helper: render saved rich HTML in activity feed ─────────────────────────

export const RichCommentContent: React.FC<{ html: string }> = ({ html }) => {
  const isRich = html.startsWith('<') && /(<p>|<h[1-6]|<ul|<ol|<blockquote|<pre)/.test(html);
  if (isRich) {
    return (
      <div
        className="rich-comment"
        style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // Legacy plain-text comment
  return <span style={{ fontSize: 12, color: '#475569', fontStyle: 'italic' }}>"{html}"</span>;
};
