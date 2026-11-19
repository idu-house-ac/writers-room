import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MemberSummary } from '@writers-room/shared';

/** A textarea where typing @ offers project members; chosen names are inserted as "@Name" and tracked as mentions. */
export function MentionInput(props: {
  members: MemberSummary[];
  value: string;
  onChange: (value: string, mentions: string[]) => void;
  onSubmit: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { members, value, onChange } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ at: number; text: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // name → id
  const [caret, setCaret] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (caret === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [value, caret]);

  const mentionsIn = (text: string, chosen: Map<string, string>) => [...chosen.entries()].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id);

  const candidates = query ? members.filter((m) => m.name.toLowerCase().startsWith(query.text.toLowerCase())).slice(0, 6) : [];

  useEffect(() => setIndex(0), [query?.text]);

  function update(text: string) {
    const el = ref.current;
    const caret = el ? el.selectionStart : text.length;
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    setQuery(m ? { at: caret - m[1]!.length - 1, text: m[1]! } : null);
    onChange(text, mentionsIn(text, picked));
  }

  function choose(member: MemberSummary) {
    if (!query) return;
    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;
    const next = `${value.slice(0, query.at)}@${member.name} ${value.slice(caret)}`;
    const chosen = new Map(picked).set(member.name, member.id);
    setPicked(chosen);
    setQuery(null);
    onChange(next, mentionsIn(next, chosen));
    setCaret(query.at + member.name.length + 2);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (candidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(candidates[index]!);
        return;
      }
      if (e.key === 'Escape') {
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      props.onSubmit();
    }
  }

  return (
    <div className="mention-input">
      <textarea
        ref={ref}
        className="input"
        rows={3}
        value={value}
        placeholder={props.placeholder ?? 'Write a comment. Type @ to mention someone. ⌘/Ctrl+Enter to send.'}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        onChange={(e) => update(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-label="Comment"
      />
      {candidates.length > 0 && (
        <div className="mention-list" role="listbox">
          {candidates.map((m, i) => (
            <button key={m.id} type="button" role="option" aria-selected={i === index} className={`mention-item${i === index ? ' active' : ''}`} onMouseDown={(e) => { e.preventDefault(); choose(m); }}>
              <span className="avatar" style={{ background: m.colour, width: 20, height: 20, fontSize: 9 }}>{m.name.slice(0, 1).toUpperCase()}</span>
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
