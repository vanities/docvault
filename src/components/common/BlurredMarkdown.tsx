import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppContext } from '../../contexts/AppContext';

/**
 * Matches currency amounts ($45, $45.50, $45,000, $1.5M, $2K) and percentages
 * (35%, 12.5%). Deliberately NOT matching bare integers so that years (2026),
 * counts ("3 entities"), and non-sensitive numerics stay readable.
 */
const NUMERIC_PATTERN = /(\$[\d][\d,]*(?:\.\d+)?(?:[KMBkmb])?|\d+(?:\.\d+)?%)/g;

function blurString(s: string, keyPrefix: string): ReactNode[] {
  // split() with a capturing group interleaves matches at odd indices:
  //   "I have $45 and 30%".split(/(\$\d+|\d+%)/g)
  //   => ["I have ", "$45", " and ", "30%", ""]
  const parts = s.split(NUMERIC_PATTERN);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={`${keyPrefix}-${i}`} className="blur-sm select-none">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function walk(node: ReactNode, keyPrefix = 'k'): ReactNode {
  if (typeof node === 'string') return blurString(node, keyPrefix);
  if (Array.isArray(node)) return node.map((child, i) => walk(child, `${keyPrefix}-${i}`));
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.props.children === undefined) return el;
    return cloneElement(el, undefined, walk(el.props.children, keyPrefix));
  }
  return node;
}

const BLUR_COMPONENTS: Components = {
  p: ({ children }) => <p>{walk(children)}</p>,
  li: ({ children }) => <li>{walk(children)}</li>,
  td: ({ children }) => <td>{walk(children)}</td>,
  th: ({ children }) => <th>{walk(children)}</th>,
  strong: ({ children }) => <strong>{walk(children)}</strong>,
  em: ({ children }) => <em>{walk(children)}</em>,
  h1: ({ children }) => <h1>{walk(children)}</h1>,
  h2: ({ children }) => <h2>{walk(children)}</h2>,
  h3: ({ children }) => <h3>{walk(children)}</h3>,
  h4: ({ children }) => <h4>{walk(children)}</h4>,
  code: ({ children }) => <code>{walk(children)}</code>,
  blockquote: ({ children }) => <blockquote>{walk(children)}</blockquote>,
};

interface BlurredMarkdownProps {
  children: string;
}

/** Renders markdown with dollar amounts and percentages blurred when the
 *  global `blurNumbers` preference is on. Falls through to plain Markdown
 *  otherwise so render cost is unchanged when privacy mode is off. */
export function BlurredMarkdown({ children }: BlurredMarkdownProps) {
  const { blurNumbers } = useAppContext();
  if (!blurNumbers) {
    return <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>;
  }
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={BLUR_COMPONENTS}>
      {children}
    </Markdown>
  );
}
