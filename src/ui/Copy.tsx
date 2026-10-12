import { useState } from 'react';

/**
 * A link (or, with `className`, a button) that copies text to the clipboard (`text` can be built at
 * click time, and still be on its way) and says so: `done`, or what `done` makes of the text copied.
 */
export function Copy({
  text,
  label = 'copy',
  done = 'copied',
  title,
  className = 'link',
}: {
  text: string | (() => string | Promise<string>);
  label?: string;
  done?: string | ((copied: string) => string);
  title?: string;
  className?: string;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const show = (s: string) => {
    setSaid(s);
    setTimeout(() => setSaid(null), 1400);
  };
  return (
    <button
      className={className}
      title={title}
      onClick={() => {
        const value = typeof text === 'function' ? text() : text;
        if (!navigator.clipboard) return show("couldn't copy");
        copy(value).then(
          (copied) => show(typeof done === 'function' ? done(copied) : done),
          () => show("couldn't copy"),
        );
      }}
    >
      {said ?? label}
    </button>
  );
}

/** Safari lets a page write the clipboard only during the click, so text still being built goes in as a promise. */
async function copy(value: string | Promise<string>): Promise<string> {
  if (typeof value !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': value.then((t) => new Blob([t], { type: 'text/plain' })) })]);
    return value;
  }
  const t = await value;
  await navigator.clipboard.writeText(t);
  return t;
}
